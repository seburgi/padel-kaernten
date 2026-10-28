package transport_test

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/seburgi/burgstaller-platform/kit/go/gateway/gatewaytest"

	"github.com/seburgi/padel-kaernten/services/api/internal/notify"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots/sites"
)

func subscription(t *testing.T, endpoint string) (string, string) {
	t.Helper()
	k, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"endpoint":%q,"keys":{"p256dh":%q,"auth":%q}}`, endpoint,
		base64.RawURLEncoding.EncodeToString(k.PublicKey().Bytes()), base64.RawURLEncoding.EncodeToString(make([]byte, 16)))
	return notify.ID(endpoint), body
}

func TestPushSubscriptions(t *testing.T) {
	a := setup(t)
	w := a.do(a.as(anna, "GET", "/api/v1/push", ""))
	var info struct{ PublicKey string }
	if _ = json.Unmarshal(w.Body.Bytes(), &info); w.Code != 200 || info.PublicKey != a.key.Public() {
		t.Fatalf("push: %d %s", w.Code, w.Body)
	}
	id, body := subscription(t, "https://push.example/anna")
	if w := a.send(anna, "PUT", "/api/v1/push/subscriptions/"+id, body); w.Code != 204 {
		t.Fatalf("subscribe: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", "/api/v1/push/subscriptions/"+id, body); w.Code != 204 {
		t.Errorf("again: %d %s", w.Code, w.Body)
	}
	other, _ := subscription(t, "https://push.example/other")
	if w := a.send(anna, "PUT", "/api/v1/push/subscriptions/"+other, body); w.Code != 400 || problemType(w) != "invalid-subscription" {
		t.Errorf("id of another endpoint: %d %s", w.Code, w.Body)
	}
	plainID, plain := subscription(t, "http://push.example/anna")
	if w := a.send(anna, "PUT", "/api/v1/push/subscriptions/"+plainID, plain); w.Code != 400 || problemType(w) != "invalid-subscription" {
		t.Errorf("http: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", "/api/v1/push/subscriptions/"+id, "{"); w.Code != 400 {
		t.Errorf("broken body: %d", w.Code)
	}
	var n int
	if err := a.pool.QueryRow(t.Context(), `SELECT count(*) FROM push_subscriptions WHERE email = $1`, anna).Scan(&n); err != nil || n != 1 {
		t.Errorf("rows %d %v", n, err)
	}
	if w := a.do(a.as(seb, "DELETE", "/api/v1/push/subscriptions/"+id, "")); w.Code != 204 {
		t.Errorf("someone else's: %d", w.Code)
	}
	if w := a.do(a.as(anna, "DELETE", "/api/v1/push/subscriptions/"+id, "")); w.Code != 204 {
		t.Errorf("unsubscribe: %d", w.Code)
	}
	if err := a.pool.QueryRow(t.Context(), `SELECT count(*) FROM push_subscriptions`).Scan(&n); err != nil || n != 0 {
		t.Errorf("rows after %d %v", n, err)
	}
	for _, r := range []*httptestRequest{
		{"GET", "/api/v1/push"}, {"PUT", "/api/v1/push/subscriptions/" + id}, {"DELETE", "/api/v1/push/subscriptions/" + id},
	} {
		if w := a.do(withKey(a.as("", r.method, r.path, body), "7c9b2824-b0cd-4c0b-9052-999999999999")); w.Code != 401 {
			t.Errorf("%s %s without a note: %d", r.method, r.path, w.Code)
		}
	}

	// The queue's task: only the API's own account.
	m := `{"to":["anna@example.at"],"title":"Hallo","body":"x","url":"/play"}`
	task := func(caller, body string) *http.Request {
		r := gatewaytest.From(caller, "POST", notify.Path, "")
		r.Body = io.NopCloser(strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		return r
	}
	if w := a.do(task(gatewayAccount, m)); w.Code != 403 || problemType(w) != "not-the-queue" {
		t.Errorf("gateway sends: %d %s", w.Code, w.Body)
	}
	if w := a.do(task(apiAccount, "{")); w.Code != 400 {
		t.Errorf("broken task: %d %s", w.Code, w.Body)
	}
	if w := a.do(task(apiAccount, m)); w.Code != 200 || !strings.Contains(w.Body.String(), `"sent":0`) {
		t.Errorf("task: %d %s", w.Code, w.Body)
	}
	down, err := pgxpool.NewWithConfig(context.Background(), a.pool.Config())
	if err != nil {
		t.Fatal(err)
	}
	down.Close()
	a.h = a.router(down)
	if w := a.do(task(apiAccount, m)); w.Code != 500 {
		t.Errorf("database down: %d %s", w.Code, w.Body)
	}
}

type httptestRequest struct{ method, path string }

func TestPushOff(t *testing.T) {
	a := setup(t)
	a.key = nil
	a.h = a.router(a.pool)
	w := a.do(a.as(anna, "GET", "/api/v1/push", ""))
	if w.Code != 200 || strings.Contains(w.Body.String(), "publicKey") {
		t.Errorf("push off: %d %s", w.Code, w.Body)
	}
	id, body := subscription(t, "https://push.example/anna")
	if w := a.send(anna, "PUT", "/api/v1/push/subscriptions/"+id, body); w.Code != 409 || problemType(w) != "push-off" {
		t.Errorf("subscribe when off: %d %s", w.Code, w.Body)
	}
}

// What people hear of a game, and that a retry does not say it twice.
func TestGameMessages(t *testing.T) {
	a := setup(t)
	const markus, lisa = "markus@example.at", "lisa@example.at"
	day := time.Now().In(time.FixedZone("CET", 3600)).AddDate(0, 0, 1)
	tomorrow := day.Format(time.DateOnly)
	when := fmt.Sprintf("%s %d.%d., 18:30", []string{"So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"}[day.Weekday()], day.Day(), int(day.Month()))

	w := a.send(seb, "POST", "/api/v1/groups", `{"name":"Runde","kind":"private"}`)
	var g struct{ ID int64 }
	_ = json.Unmarshal(w.Body.Bytes(), &g)
	group := fmt.Sprintf("/api/v1/groups/%d", g.ID)
	for _, who := range []string{anna, markus, lisa} {
		_ = a.send(seb, "POST", group+"/invitations", fmt.Sprintf(`{"email":%q}`, who))
		_ = a.send(who, "POST", group+"/join", "")
	}
	_ = a.send(seb, "PUT", "/api/v1/me/name", `{"name":"Seb"}`)
	a.sites.snap = &sites.Snapshot{TakenAt: time.Now().UTC().Truncate(time.Second), Days: []string{tomorrow},
		Venues: []sites.Venue{{ID: "villach", Name: "Padel Villach", Step: 30, NotBookable: []string{},
			Courts: []sites.Court{{Name: "Court 1", Free: []sites.Slot{{Day: tomorrow, From: 1080, To: 1260}}}}}}}
	if w := a.send(seb, "POST", "/api/v1/slots/refresh", ""); w.Code != 200 {
		t.Fatalf("refresh: %d %s", w.Code, w.Body)
	}
	a.queue.take()

	newGame := fmt.Sprintf(`{"venueId":"villach","court":"Court 1","day":%q,"start":1110,"minutes":90}`, tomorrow)
	r := withKey(a.as(seb, "POST", group+"/games", newGame), "7c9b2824-b0cd-4c0b-9052-777777777777")
	w = a.do(r)
	var game struct{ ID int64 }
	_ = json.Unmarshal(w.Body.Bytes(), &game)
	// The same request again: the same game, no second message.
	_ = a.do(withKey(a.as(seb, "POST", group+"/games", newGame), "7c9b2824-b0cd-4c0b-9052-777777777777"))
	sent := a.queue.take()
	if len(sent) != 1 || sent[0].Title != "Neues Spiel: "+when ||
		sent[0].Body != "Seb schlägt Padel Villach vor, 18:30–20:00. Bist du dabei?" ||
		sent[0].URL != fmt.Sprintf("/games/%d", game.ID) || !sameSet(sent[0].To, anna, markus, lisa) {
		t.Fatalf("proposed: %+v", sent)
	}
	path := fmt.Sprintf("/api/v1/games/%d", game.ID)
	for _, who := range []string{anna, markus} {
		_ = a.send(who, "PUT", path+"/players/me", `{"answer":"in"}`)
	}
	if sent := a.queue.take(); len(sent) != 0 {
		t.Errorf("answers before it is full: %+v", sent)
	}
	_ = a.send(lisa, "PUT", path+"/players/me", `{"answer":"in"}`)
	if sent := a.queue.take(); len(sent) != 1 || sent[0].Title != "Ihr seid vier" || !sameSet(sent[0].To, seb) ||
		!strings.Contains(sent[0].Body, "lisa hat zugesagt") {
		t.Errorf("full: %+v", sent)
	}
	const eva = "eva@example.at"
	_ = a.send(seb, "POST", group+"/invitations", fmt.Sprintf(`{"email":%q}`, eva))
	_ = a.send(eva, "POST", group+"/join", "")
	_ = a.send(eva, "PUT", path+"/players/me", `{"answer":"in"}`)
	_ = a.send(markus, "PUT", path+"/players/me", `{"answer":"out"}`)
	if sent := a.queue.take(); len(sent) != 1 || sent[0].Title != "Du bist nachgerückt" || !sameSet(sent[0].To, eva) {
		t.Errorf("moved up: %+v", sent)
	}
	_ = a.send(seb, "PATCH", path, `{"state":"booked"}`)
	if sent := a.queue.take(); len(sent) != 1 || sent[0].Title != "Gebucht: "+when || !sameSet(sent[0].To, anna, lisa, eva) ||
		sent[0].Body != "Padel Villach, Court 1. Seb hat gebucht." {
		t.Errorf("booked: %+v", sent)
	}
	_ = a.send(markus, "PUT", path+"/players/me", `{"answer":"in"}`)
	a.queue.err = errors.New("queue down")
	if w := a.send(seb, "PATCH", path, `{"state":"cancelled"}`); w.Code != 200 {
		t.Errorf("a queue that is down fails nothing: %d %s", w.Code, w.Body)
	}
	a.queue.err = nil

	// Alone in the game: booking tells nobody.
	w = a.send(seb, "POST", group+"/games", strings.Replace(newGame, "1110", "1140", 1))
	_ = json.Unmarshal(w.Body.Bytes(), &game)
	a.queue.take()
	_ = a.send(seb, "PATCH", fmt.Sprintf("/api/v1/games/%d", game.ID), `{"state":"booked"}`)
	if sent := a.queue.take(); len(sent) != 0 {
		t.Errorf("booked alone: %+v", sent)
	}
	// Someone without a name is shown by their address.
	w = a.send(lisa, "POST", group+"/games", strings.Replace(newGame, "1110", "1170", 1))
	if w.Code != 201 {
		t.Fatalf("lisa proposes: %d %s", w.Code, w.Body)
	}
	if sent := a.queue.take(); len(sent) != 1 || !strings.HasPrefix(sent[0].Body, "lisa schlägt") {
		t.Errorf("unnamed proposer: %+v", sent)
	}
}

func sameSet(got []string, want ...string) bool {
	g := slices.Clone(got)
	slices.Sort(g)
	slices.Sort(want)
	return slices.Equal(g, want)
}
