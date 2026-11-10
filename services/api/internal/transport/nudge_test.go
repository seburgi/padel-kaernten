package transport_test

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/seburgi/burgstaller-platform/kit/go/gateway/gatewaytest"

	"github.com/seburgi/padel-kaernten/services/api/internal/notify"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots/sites"
)

func TestNudge(t *testing.T) {
	a := setup(t)
	vienna, _ := time.LoadLocation("Europe/Vienna")
	now := time.Date(2026, 11, 10, 19, 30, 0, 0, vienna) // a Tuesday evening
	a.now = func() time.Time { return now }
	a.h = a.router(a.pool)
	const markus, lisa = "markus@example.at", "lisa@example.at"
	d1, d2 := "2026-11-11", "2026-11-12"

	w := a.send(seb, "POST", "/api/v1/groups", `{"name":"Runde","kind":"private"}`)
	var g struct{ ID int64 }
	_ = json.Unmarshal(w.Body.Bytes(), &g)
	group := fmt.Sprintf("/api/v1/groups/%d", g.ID)
	for _, who := range []string{anna, markus, lisa} {
		_ = a.send(seb, "POST", group+"/invitations", fmt.Sprintf(`{"email":%q}`, who))
		_ = a.send(who, "POST", group+"/join", "")
	}
	_ = a.send(anna, "PUT", "/api/v1/me/name", `{"name":"Anna"}`)
	free := []sites.Slot{{Day: d1, From: 1080, To: 1260}, {Day: d2, From: 1080, To: 1260}}
	a.sites.snap = &sites.Snapshot{TakenAt: time.Now().UTC().Truncate(time.Second), Days: []string{d1, d2},
		Venues: []sites.Venue{{ID: "villach", Name: "Padel Villach", Step: 30, NotBookable: []string{},
			Courts: []sites.Court{{Name: "Court 1", Free: free}, {Name: "Court 2", Free: free[:1]}}}}}
	if w := a.send(seb, "POST", "/api/v1/slots/refresh", ""); w.Code != 200 {
		t.Fatalf("refresh: %d %s", w.Code, w.Body)
	}
	// Seb, Anna and Markus can both days; Lisa said nothing for d1.
	for _, who := range []string{seb, anna, markus, lisa} {
		for _, day := range []string{d1, d2} {
			if who == lisa && day == d1 {
				continue
			}
			if w := a.send(who, "PUT", "/api/v1/availability/days/"+day, `{"spans":[{"from":1080,"to":1260}]}`); w.Code != 200 {
				t.Fatalf("day: %d %s", w.Code, w.Body)
			}
		}
	}
	propose := func(court string, start int) int64 {
		t.Helper()
		w := a.send(seb, "POST", group+"/games", fmt.Sprintf(`{"venueId":"villach","court":%q,"day":%q,"start":%d,"minutes":90}`, court, d1, start))
		var game struct{ ID int64 }
		if err := json.Unmarshal(w.Body.Bytes(), &game); err != nil || game.ID == 0 {
			t.Fatalf("propose: %d %s", w.Code, w.Body)
		}
		return game.ID
	}
	// A booked game tomorrow on Court 2, and one on Court 1 three are in.
	booked := propose("Court 2", 1080)
	for _, who := range []string{anna, markus, lisa} {
		_ = a.send(who, "PUT", fmt.Sprintf("/api/v1/games/%d/players/me", booked), `{"answer":"in"}`)
	}
	_ = a.send(seb, "PATCH", fmt.Sprintf("/api/v1/games/%d", booked), `{"state":"booked"}`)
	short := propose("Court 1", 1170)
	_ = a.send(anna, "PUT", fmt.Sprintf("/api/v1/games/%d/players/me", short), `{"answer":"in"}`)
	_ = a.send(markus, "PUT", fmt.Sprintf("/api/v1/games/%d/players/me", short), `{"answer":"in"}`)
	a.queue.take()

	if w := a.do(gatewaytest.From(remindAccount, "POST", "/nudge", "")); w.Code != 403 || problemType(w) != "not-the-scheduler" {
		t.Errorf("another account: %d %s", w.Code, w.Body)
	}
	w = a.do(gatewaytest.From(nudgeAccount, "POST", "/nudge", ""))
	if w.Code != 200 || w.Body.String() != `{"before":1,"fits":1,"missing":1,"stale":1}`+"\n" {
		t.Fatalf("nudge: %d %s", w.Code, w.Body)
	}
	got := map[string]notify.Message{}
	for _, m := range a.queue.take() {
		sort.Strings(m.To)
		got[m.Kind] = m
	}
	if m := got[notify.KindBefore]; m.Title != "Morgen: 18:00–19:30" || m.Body != "Padel Villach, Court 2. Viel Spaß!" ||
		!sameSet(m.To, seb, anna, markus, lisa) {
		t.Errorf("before: %+v", m)
	}
	if m := got[notify.KindStale]; m.Title != "Noch 1 gesucht" || !sameSet(m.To, seb) || m.URL != fmt.Sprintf("/games/%d", short) {
		t.Errorf("stale: %+v", m)
	}
	// Lisa has not answered and said nothing for the day; she is asked.
	if m := got[notify.KindMissing]; m.Title != "Es fehlt nur noch eine Person" || !sameSet(m.To, lisa) || m.Game != short ||
		m.Body != "Mi 11.11., 19:30 in Padel Villach, 19:30–21:00. Bist du dabei?" {
		t.Errorf("missing: %+v", m)
	}
	// d1 is taken by the games; d2 fits for all four.
	if m := got[notify.KindFits]; m.Title != "Es passt für vier: Do 12.11., 18:00" || !sameSet(m.To, seb, anna, markus, lisa) ||
		!strings.HasPrefix(m.Body, "seb, Anna, markus, lisa können, Padel Villach hat 90 Minuten frei") ||
		m.URL != group[len("/api/v1"):]+"/fits" {
		t.Errorf("fits: %+v", m)
	}

	// Each thing once.
	if w := a.do(gatewaytest.From(nudgeAccount, "POST", "/nudge", "")); w.Body.String() != "{}\n" {
		t.Errorf("again: %s", w.Body)
	}
	if sent := a.queue.take(); len(sent) != 0 {
		t.Errorf("again sent %v", sent)
	}

	// A second group of the same four with a game on d2 at 19:30: 18:00 on
	// d2 still fits on Court 1, but a day with a game is no news.
	w = a.send(seb, "POST", "/api/v1/groups", `{"name":"Zweite","kind":"private"}`)
	var g2 struct{ ID int64 }
	_ = json.Unmarshal(w.Body.Bytes(), &g2)
	second := fmt.Sprintf("/api/v1/groups/%d", g2.ID)
	for _, who := range []string{anna, markus, lisa} {
		_ = a.send(seb, "POST", second+"/invitations", fmt.Sprintf(`{"email":%q}`, who))
		_ = a.send(who, "POST", second+"/join", "")
	}
	if w := a.send(seb, "POST", second+"/games", fmt.Sprintf(`{"venueId":"villach","court":"Court 1","day":%q,"start":1170,"minutes":90}`, d2)); w.Code != 201 {
		t.Fatalf("propose in the second group: %d %s", w.Code, w.Body)
	}
	a.queue.take()
	if w := a.do(gatewaytest.From(nudgeAccount, "POST", "/nudge", "")); w.Body.String() != "{}\n" {
		t.Errorf("a day with a game: %s", w.Body)
	}
	if sent := a.queue.take(); len(sent) != 0 {
		t.Errorf("a day with a game sent %v", sent)
	}

	// The next morning before 8: no new fits, and before 18 no reminders.
	now = time.Date(2026, 11, 11, 7, 0, 0, 0, vienna)
	_ = a.send(lisa, "PUT", "/api/v1/availability/days/"+d2, `{"spans":[{"from":1080,"to":1200}]}`)
	if w := a.do(gatewaytest.From(nudgeAccount, "POST", "/nudge", "")); w.Body.String() != "{}\n" {
		t.Errorf("morning: %s", w.Body)
	}
}
