package transport_test

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/seburgi/padel-kaernten/services/api/internal/slots/sites"
)

func TestGames(t *testing.T) {
	a := setup(t)
	const markus, lisa, eva = "markus@example.at", "lisa@example.at", "eva@example.at"
	tomorrow := time.Now().In(time.FixedZone("CET", 3600)).AddDate(0, 0, 1).Format(time.DateOnly)

	w := a.send(seb, "POST", "/api/v1/groups", `{"name":"Runde","kind":"private"}`)
	var g struct{ ID int64 }
	_ = json.Unmarshal(w.Body.Bytes(), &g)
	group := fmt.Sprintf("/api/v1/groups/%d", g.ID)
	for _, who := range []string{anna, markus, lisa} {
		_ = a.send(seb, "POST", group+"/invitations", fmt.Sprintf(`{"email":%q}`, who))
		_ = a.send(who, "POST", group+"/join", "")
	}
	_ = a.send(anna, "PUT", "/api/v1/me/name", `{"name":"Anna"}`)

	if w := a.do(a.as(seb, "GET", group+"/fits?minutes=90", "")); w.Code != 503 || problemType(w) != "no-snapshot" {
		t.Errorf("fits without a snapshot: %d %s", w.Code, w.Body)
	}
	newGame := fmt.Sprintf(`{"venueId":"villach","court":"Court 1","day":%q,"start":1110,"minutes":90}`, tomorrow)
	if w := a.send(seb, "POST", group+"/games", newGame); w.Code != 503 {
		t.Errorf("propose without a snapshot: %d %s", w.Code, w.Body)
	}
	price := sites.Money{Amount: 4000, Currency: "EUR"}
	a.sites.snap = &sites.Snapshot{TakenAt: time.Now().UTC().Truncate(time.Second), Days: []string{tomorrow},
		Venues: []sites.Venue{{ID: "villach", Name: "Padel Villach", Step: 30, NotBookable: []string{},
			Links:  map[string]string{tomorrow: "https://book.example/" + tomorrow},
			Courts: []sites.Court{{Name: "Court 1", Area: "ueberdacht", Free: []sites.Slot{{Day: tomorrow, From: 1080, To: 1260, PricePerHour: &price}}}}}}}
	if w := a.send(seb, "POST", "/api/v1/slots/refresh", ""); w.Code != 200 {
		t.Fatalf("refresh: %d %s", w.Code, w.Body)
	}
	for _, who := range []string{seb, anna, markus} {
		_ = a.send(who, "PUT", "/api/v1/availability/days/"+tomorrow, `{"spans":[{"from":1080,"to":1260}]}`)
	}

	// Three can; Lisa entered nothing and is the one to ask.
	w = a.do(a.as(seb, "GET", group+"/fits?minutes=90", ""))
	var fits struct {
		Need   int
		Fits   []json.RawMessage
		Nearly []struct {
			Ask []struct{ Email string }
			Can []struct{ Email, Name string }
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &fits); w.Code != 200 || err != nil || fits.Need != 4 || len(fits.Fits) != 0 ||
		len(fits.Nearly) == 0 || fits.Nearly[0].Ask[0].Email != lisa {
		t.Fatalf("nearly: %d %s", w.Code, w.Body)
	}
	_ = a.send(lisa, "PUT", "/api/v1/availability/days/"+tomorrow, `{"spans":[{"from":1080,"to":1260}]}`)
	w = a.do(a.as(seb, "GET", group+"/fits?minutes=90", ""))
	if body := w.Body.String(); w.Code != 200 || !strings.Contains(body, `"perHead":{"amount":1500,"currency":"EUR"}`) ||
		!strings.Contains(body, `{"email":"anna@example.at","name":"Anna"}`) || !strings.Contains(body, `"link":"https://book.example/`) {
		t.Fatalf("fits: %d %s", w.Code, body)
	}
	// Where the group plays, set by any member: überdacht counts as a hall.
	if w := a.send(anna, "PATCH", group, `{"area":"freiluft"}`); w.Code != 200 || !strings.Contains(w.Body.String(), `"area":"freiluft"`) {
		t.Fatalf("anna sets freiluft: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(seb, "GET", group+"/fits?minutes=90", "")); !strings.Contains(w.Body.String(), `"fits":[]`) {
		t.Errorf("fits outdoors only: %s", w.Body)
	}
	if w := a.send(anna, "PATCH", group, `{"area":"halle"}`); w.Code != 200 {
		t.Fatalf("anna sets halle: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(seb, "GET", group+"/fits?minutes=90", "")); !strings.Contains(w.Body.String(), `"court":"Court 1"`) {
		t.Errorf("fits in halls: %s", w.Body)
	}
	if w := a.send(anna, "PATCH", group, `{"area":"dach"}`); w.Code != 400 {
		t.Errorf("a bad area: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(seb, "GET", group+"/fits?minutes=45", "")); w.Code != 400 || problemType(w) != "invalid-game" {
		t.Errorf("45 minutes: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(eva, "GET", group+"/fits?minutes=90", "")); w.Code != 404 {
		t.Errorf("not a member: %d %s", w.Code, w.Body)
	}

	w = a.send(seb, "POST", group+"/games", newGame)
	var game struct {
		ID         int64
		State      string
		Link       string
		GroupName  string
		ProposedBy struct{ Email string }
		Lineup     []struct{ Email, State string }
	}
	if err := json.Unmarshal(w.Body.Bytes(), &game); w.Code != 201 || err != nil || game.State != "proposed" ||
		game.GroupName != "Runde" || game.Link == "" || len(game.Lineup) != 1 || game.ProposedBy.Email != seb {
		t.Fatalf("propose: %d %s", w.Code, w.Body)
	}
	path := fmt.Sprintf("/api/v1/games/%d", game.ID)
	gone := fmt.Sprintf(`{"venueId":"villach","court":"Court 1","day":%q,"start":1230,"minutes":60}`, tomorrow)
	if w := a.send(seb, "POST", group+"/games", gone); w.Code != 409 || problemType(w) != "court-gone" {
		t.Errorf("gone: %d %s", w.Code, w.Body)
	}
	if w := a.send(seb, "POST", group+"/games", `{`); w.Code != 400 {
		t.Errorf("broken body: %d", w.Code)
	}
	for _, who := range []string{anna, markus, lisa} {
		_ = a.send(who, "PUT", path+"/players/me", `{"answer":"in"}`)
	}
	w = a.send(lisa, "PUT", path+"/players/me", `{"answer":"in"}`)
	if !strings.Contains(w.Body.String(), `"email":"lisa@example.at","name":"","state":"in"`) {
		t.Errorf("lisa in: %s", w.Body)
	}
	if w := a.send(anna, "PUT", path+"/players/me", `{"answer":"maybe"}`); w.Code != 400 {
		t.Errorf("maybe: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", path+"/players/me", `{`); w.Code != 400 {
		t.Errorf("broken answer: %d", w.Code)
	}
	if w := a.do(a.as(anna, "GET", "/api/v1/games", "")); !strings.Contains(w.Body.String(), `"groupName":"Runde"`) {
		t.Errorf("list: %s", w.Body)
	}
	if w := a.do(a.as(anna, "GET", fmt.Sprintf("/api/v1/games?groupId=%d", g.ID), "")); !strings.Contains(w.Body.String(), `"id":`) {
		t.Errorf("list of a group: %s", w.Body)
	}
	if w := a.do(a.as(eva, "GET", "/api/v1/games", "")); w.Body.String() != `{"items":[]}`+"\n" && w.Body.String() != `{"items":[]}` {
		t.Errorf("eva's list: %q", w.Body)
	}
	if w := a.do(a.as(eva, "GET", path, "")); w.Code != 404 || problemType(w) != "no-game" {
		t.Errorf("eva reads it: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PATCH", path, `{"state":"booked"}`); w.Code != 403 {
		t.Errorf("anna books: %d %s", w.Code, w.Body)
	}
	if w := a.send(seb, "PATCH", path, `{`); w.Code != 400 {
		t.Errorf("broken change: %d", w.Code)
	}
	if w := a.send(seb, "PATCH", path, `{"state":"booked"}`); w.Code != 200 || !strings.Contains(w.Body.String(), `"state":"booked"`) {
		t.Errorf("booked: %d %s", w.Code, w.Body)
	}
	if w := a.send(seb, "PATCH", path, `{"state":"cancelled"}`); w.Code != 200 {
		t.Errorf("cancelled: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", path+"/players/me", `{"answer":"out"}`); w.Code != 409 || problemType(w) != "game-closed" {
		t.Errorf("closed: %d %s", w.Code, w.Body)
	}
	const k = "8c9b2824-b0cd-4c0b-9052-000000000099"
	_ = a.do(withKey(a.as(markus, "PUT", path+"/players/me", `{"answer":"in"}`), k))
	if w := a.do(withKey(a.as(markus, "PUT", path+"/players/me", `{"answer":"out"}`), k)); w.Code != 409 {
		t.Errorf("key reused: %d %s", w.Code, w.Body)
	}
	// Without a snapshot a game still reads, only without its link.
	if _, err := a.pool.Exec(t.Context(), `DELETE FROM snapshot`); err != nil {
		t.Fatal(err)
	}
	if w := a.do(a.as(anna, "GET", path, "")); w.Code != 200 || strings.Contains(w.Body.String(), `"link"`) {
		t.Errorf("no snapshot: %d %s", w.Code, w.Body)
	}
}
