package transport_test

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/seburgi/burgstaller-platform/kit/go/gateway/gatewaytest"
)

func TestRemind(t *testing.T) {
	a := setup(t)
	const markus, lisa = "markus@example.at", "lisa@example.at"
	w := a.send(seb, "POST", "/api/v1/groups", `{"name":"Runde","kind":"private"}`)
	var g struct{ ID int64 }
	_ = json.Unmarshal(w.Body.Bytes(), &g)
	group := fmt.Sprintf("/api/v1/groups/%d", g.ID)
	for _, who := range []string{anna, markus} {
		_ = a.send(seb, "POST", group+"/invitations", fmt.Sprintf(`{"email":%q}`, who))
		_ = a.send(who, "POST", group+"/join", "")
	}
	// Lisa is in the app but in no group: never asked.
	_ = a.do(a.as(lisa, "GET", "/api/v1/me", ""))

	// Seb leaves 4 days open, Markus 5 (one of them declined counts as
	// entered), Anna all 14.
	today := time.Now().In(time.FixedZone("CET", 3600))
	day := func(i int) string { return today.AddDate(0, 0, i).Format(time.DateOnly) }
	for i := range 10 {
		_ = a.send(seb, "PUT", "/api/v1/availability/days/"+day(i+1), `{"spans":[{"from":1080,"to":1260}]}`)
	}
	for i := range 8 {
		_ = a.send(markus, "PUT", "/api/v1/availability/days/"+day(i+1), `{"spans":[{"from":1080,"to":1260}]}`)
	}
	_ = a.send(markus, "PUT", "/api/v1/availability/days/"+day(9), `{"spans":[],"declined":true}`)
	a.queue.take()

	for name, r := range map[string]any{
		"the gateway":   gatewayAccount,
		"the refresher": refreshAccount,
	} {
		if w := a.do(gatewaytest.From(r.(string), "POST", "/remind", "")); w.Code != 403 || problemType(w) != "not-the-scheduler" {
			t.Errorf("%s: %d %s", name, w.Code, w.Body)
		}
	}
	if sent := a.queue.take(); len(sent) != 0 {
		t.Fatalf("refused, yet sent %v", sent)
	}

	w = a.do(gatewaytest.From(remindAccount, "POST", "/remind", ""))
	if w.Code != 200 || w.Body.String() != "{\"members\":3,\"reminded\":2}\n" {
		t.Fatalf("remind: %d %s", w.Code, w.Body)
	}
	sent := a.queue.take()
	got := map[string]string{}
	for _, m := range sent {
		if len(m.To) != 1 || m.Title != "Wann kannst du?" || m.URL != "/availability" || m.Tag != "remind" {
			t.Errorf("message: %+v", m)
			continue
		}
		got[m.To[0]] = m.Body
	}
	if len(got) != 2 ||
		got[anna] != "In den nächsten zwei Wochen sind noch 14 Tage offen. Sag, wann du kannst, oder „Passt nicht“." ||
		got[markus] != "In den nächsten zwei Wochen sind noch 5 Tage offen. Sag, wann du kannst, oder „Passt nicht“." {
		t.Errorf("reminded: %v", got)
	}

	// A second run the same day names the same tasks, which the queue drops.
	first := a.queue.names[len(a.queue.names)-2:]
	_ = a.do(gatewaytest.From(remindAccount, "POST", "/remind", ""))
	again := a.queue.names[len(a.queue.names)-2:]
	if fmt.Sprint(first) != fmt.Sprint(again) {
		t.Errorf("names: %v, then %v", first, again)
	}
}
