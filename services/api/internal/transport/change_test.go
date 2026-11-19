package transport_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/seburgi/padel-kaernten/services/api/internal/slots/sites"
)

// Changing a game afterwards (games.md): moves, move, remove, a cancel's note.
func TestChangeGame(t *testing.T) {
	a := setup(t)
	const markus, lisa = "markus@example.at", "lisa@example.at"
	tomorrow := time.Now().In(time.FixedZone("CET", 3600)).AddDate(0, 0, 1).Format(time.DateOnly)
	w := a.send(seb, "POST", "/api/v1/groups", `{"name":"Runde","kind":"private"}`)
	var g struct{ ID int64 }
	_ = json.Unmarshal(w.Body.Bytes(), &g)
	group := fmt.Sprintf("/api/v1/groups/%d", g.ID)
	for _, who := range []string{anna, markus, lisa} {
		_ = a.send(seb, "POST", group+"/invitations", fmt.Sprintf(`{"email":%q}`, who))
		_ = a.send(who, "POST", group+"/join", "")
	}
	price := sites.Money{Amount: 4000, Currency: "EUR"}
	a.sites.snap = &sites.Snapshot{TakenAt: time.Now().UTC().Truncate(time.Second), Days: []string{tomorrow},
		Venues: []sites.Venue{{ID: "villach", Name: "Padel Villach", Step: 30, NotBookable: []string{},
			Courts: []sites.Court{
				{Name: "Court 1", Area: "halle", Free: []sites.Slot{{Day: tomorrow, From: 1080, To: 1260, PricePerHour: &price}}},
				{Name: "Court 2", Area: "halle", Free: []sites.Slot{{Day: tomorrow, From: 1110, To: 1200, PricePerHour: &price}}},
			}}}}
	if w := a.send(seb, "POST", "/api/v1/slots/refresh", ""); w.Code != 200 {
		t.Fatalf("refresh: %d %s", w.Code, w.Body)
	}
	w = a.send(seb, "POST", group+"/games",
		fmt.Sprintf(`{"venueId":"villach","court":"Court 1","day":%q,"start":1110,"minutes":90}`, tomorrow))
	var game struct{ ID int64 }
	if err := json.Unmarshal(w.Body.Bytes(), &game); w.Code != 201 || err != nil {
		t.Fatalf("propose: %d %s", w.Code, w.Body)
	}
	path := fmt.Sprintf("/api/v1/games/%d", game.ID)
	for _, who := range []string{anna, markus, lisa} {
		_ = a.send(who, "PUT", path+"/players/me", `{"answer":"in"}`)
	}

	// Where it could go: court 2 at the same time, court 1 at other times.
	if w := a.do(a.as(anna, "GET", path+"/moves?minutes=90", "")); w.Code != 403 {
		t.Errorf("anna's moves: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(seb, "GET", path+"/moves?minutes=45", "")); w.Code != 400 {
		t.Errorf("45 minutes: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(seb, "GET", "/api/v1/games/999999/moves?minutes=90", "")); w.Code != 404 {
		t.Errorf("no such game: %d %s", w.Code, w.Body)
	}
	w = a.do(a.as(seb, "GET", path+"/moves?minutes=90", ""))
	if body := w.Body.String(); w.Code != 200 || !strings.Contains(body, `"court":"Court 2","day":"`+tomorrow+`","minutes":90`) ||
		!strings.Contains(body, `"start":1080`) || !strings.Contains(body, `"perHead":{"amount":1500`) {
		t.Fatalf("moves: %d %s", w.Code, body)
	}

	for body, want := range map[string]string{
		`{"players":4,"note":"hallo"}`: "invalid-game",
		fmt.Sprintf(`{"move":{"venueId":"villach","court":"Court 2","day":%q,"start":1080,"minutes":90}}`, tomorrow): "court-gone",
		`{"remove":"eva@example.at"}`: "not-playing",
		`{"remove":"seb@example.at"}`: "invalid-game",
	} {
		if w := a.send(seb, "PATCH", path, body); problemType(w) != want {
			t.Errorf("%s: %d %s", body, w.Code, w.Body)
		}
	}
	if w := a.send(anna, "PATCH", path, `{"remove":"lisa@example.at"}`); w.Code != 403 {
		t.Errorf("anna takes lisa out: %d %s", w.Code, w.Body)
	}

	a.queue.take()
	// Court 2, same time: everyone stays in.
	w = a.send(seb, "PATCH", path,
		fmt.Sprintf(`{"move":{"venueId":"villach","court":"Court 2","day":%q,"start":1110,"minutes":90},"note":"Court 1 ist weg"}`, tomorrow))
	if body := w.Body.String(); w.Code != 200 || !strings.Contains(body, `"court":"Court 2"`) ||
		!strings.Contains(body, `"change":{"at":`) || !strings.Contains(body, `"court":"Court 1","day":"`+tomorrow) ||
		!strings.Contains(body, `"note":"Court 1 ist weg"`) || strings.Contains(body, `"asked"`) {
		t.Fatalf("court: %d %s", w.Code, body)
	}
	if sent := a.queue.take(); len(sent) != 1 || !strings.HasPrefix(sent[0].Title, "Anderer Platz: ") ||
		!sameSet(sent[0].To, anna, markus, lisa) || !strings.Contains(sent[0].Body, "jetzt Court 2") ||
		!strings.Contains(sent[0].Body, "„Court 1 ist weg“") {
		t.Errorf("court message: %+v", sent)
	}
	// Another time: the others say again.
	w = a.send(seb, "PATCH", path,
		fmt.Sprintf(`{"move":{"venueId":"villach","court":"Court 1","day":%q,"start":1170,"minutes":60}}`, tomorrow))
	if body := w.Body.String(); w.Code != 200 || strings.Count(body, `"state":"asked"`) != 3 || !strings.Contains(body, `"start":1170`) {
		t.Fatalf("moved: %d %s", w.Code, body)
	}
	if sent := a.queue.take(); len(sent) != 1 || !strings.HasPrefix(sent[0].Title, "Verschoben: ") || sent[0].Game != game.ID ||
		!sameSet(sent[0].To, anna, markus, lisa) || !strings.HasSuffix(sent[0].Body, "Passt es dir noch?") {
		t.Errorf("moved message: %+v", sent)
	}
	if w := a.send(seb, "PATCH", path, `{"remove":"Lisa@example.at"}`); w.Code != 200 ||
		!strings.Contains(w.Body.String(), `"email":"lisa@example.at","name":"","state":"out"`) {
		t.Errorf("lisa out: %d %s", w.Code, w.Body)
	}
	if sent := a.queue.take(); len(sent) != 1 || !strings.HasPrefix(sent[0].Title, "Nicht mehr dabei: ") || !sameSet(sent[0].To, lisa) {
		t.Errorf("removed message: %+v", sent)
	}
	if w := a.send(anna, "PUT", path+"/players/me", `{"answer":"in"}`); !strings.Contains(w.Body.String(), `"email":"anna@example.at","name":"","state":"in"`) {
		t.Errorf("anna again: %s", w.Body)
	}
	_ = a.send(markus, "PUT", path+"/players/me", `{"answer":"out"}`)
	if sent := a.queue.take(); len(sent) != 1 || !strings.HasPrefix(sent[0].Title, "Kann nicht: ") || !sameSet(sent[0].To, seb) ||
		!strings.Contains(sent[0].Body, "markus kann zur neuen Zeit") {
		t.Errorf("declined message: %+v", sent)
	}
	if w := a.send(seb, "PATCH", path, `{"state":"cancelled","note":"Regen"}`); w.Code != 200 ||
		!strings.Contains(w.Body.String(), `"cancelNote":"Regen"`) {
		t.Errorf("cancelled: %d %s", w.Code, w.Body)
	}
	if sent := a.queue.take(); len(sent) != 1 || !sameSet(sent[0].To, anna) || !strings.HasSuffix(sent[0].Body, "„Regen“") {
		t.Errorf("cancelled message: %+v", sent)
	}
	// Without a snapshot there is nowhere to move to.
	if _, err := a.pool.Exec(t.Context(), `DELETE FROM snapshot`); err != nil {
		t.Fatal(err)
	}
	if w := a.do(a.as(seb, "GET", path+"/moves?minutes=90", "")); w.Code != 503 {
		t.Errorf("moves without a snapshot: %d %s", w.Code, w.Body)
	}
	if w := a.send(seb, "PATCH", path,
		fmt.Sprintf(`{"move":{"venueId":"villach","court":"Court 1","day":%q,"start":1080,"minutes":60}}`, tomorrow)); w.Code != 503 {
		t.Errorf("move without a snapshot: %d %s", w.Code, w.Body)
	}
}
