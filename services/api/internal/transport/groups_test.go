package transport_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var keys int

// send is a write from who with a fresh Idempotency-Key.
func (a *app) send(who, method, path, body string) *httptest.ResponseRecorder {
	keys++
	return a.do(withKey(a.as(who, method, path, body), fmt.Sprintf("7c9b2824-b0cd-4c0b-9052-%012d", keys)))
}

func TestGroups(t *testing.T) {
	a := setup(t)
	const markus = "markus@example.at"
	// Everyone opens the app once.
	for _, who := range []string{seb, anna, markus} {
		if w := a.do(a.as(who, "GET", "/api/v1/me", "")); w.Code != 200 || !strings.Contains(w.Body.String(), `"name":""`) {
			t.Fatalf("me: %d %s", w.Code, w.Body)
		}
	}
	w := a.send(seb, "PUT", "/api/v1/me/name", `{"name":" Seb "}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"name":"Seb"`) || !strings.Contains(w.Body.String(), `"canInvite":true`) {
		t.Fatalf("name: %d %s", w.Code, w.Body)
	}
	if w := a.send(seb, "PUT", "/api/v1/me/name", `{"name":""}`); w.Code != 400 || problemType(w) != "invalid-name" {
		t.Errorf("empty name: %d %s", w.Code, w.Body)
	}

	w = a.send(seb, "POST", "/api/v1/groups", `{"name":"Donnerstagsrunde","kind":"private"}`)
	var g struct {
		ID         int64 `json:"id"`
		Role       string
		MemberList []struct {
			Email       string
			Name        string
			DaysEntered int
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &g); w.Code != 201 || err != nil || g.Role != "admin" || g.MemberList[0].Name != "Seb" {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	if w := a.send(seb, "POST", "/api/v1/groups", `{"name":"","kind":"private"}`); w.Code != 400 || problemType(w) != "invalid-group" {
		t.Errorf("no name: %d %s", w.Code, w.Body)
	}
	if w := a.send(seb, "POST", "/api/v1/groups", `{`); w.Code != 400 {
		t.Errorf("broken body: %d", w.Code)
	}
	path := fmt.Sprintf("/api/v1/groups/%d", g.ID)

	if w := a.do(a.as(anna, "GET", path, "")); w.Code != 404 || problemType(w) != "no-group" {
		t.Errorf("private to anna: %d %s", w.Code, w.Body)
	}
	if w := a.send(seb, "POST", path+"/invitations", `{"email":"Anna@Example.at"}`); w.Code != 201 || !strings.Contains(w.Body.String(), `"invitedBy":"seb@example.at"`) {
		t.Fatalf("invite: %d %s", w.Code, w.Body)
	}
	if w := a.send(seb, "POST", path+"/invitations", `{"email":"seb@example.at"}`); w.Code != 409 || problemType(w) != "already-member" {
		t.Errorf("a member: %d %s", w.Code, w.Body)
	}
	if w := a.send(seb, "POST", path+"/invitations", `{"email":"nope"}`); w.Code != 400 || problemType(w) != "invalid-email" {
		t.Errorf("not an address: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(anna, "GET", "/api/v1/groups", "")); !strings.Contains(w.Body.String(), `"how":"invited"`) {
		t.Errorf("anna's list: %s", w.Body)
	}
	if w := a.send(anna, "POST", path+"/join", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"state":"member"`) {
		t.Fatalf("accept: %d %s", w.Code, w.Body)
	}
	// Anna says when she can; the group shows it.
	day := time.Now().In(time.FixedZone("CET", 3600)).AddDate(0, 0, 2).Format("2006-01-02")
	if w := a.send(anna, "PUT", "/api/v1/availability/days/"+day, `{"spans":[{"from":1110,"to":1320}]}`); w.Code != 200 {
		t.Fatalf("availability: %d %s", w.Code, w.Body)
	}
	w = a.do(a.as(seb, "GET", path, ""))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"daysEntered":1`) {
		t.Errorf("seb's view: %d %s", w.Code, w.Body)
	}

	if w := a.send(anna, "PATCH", path, `{"kind":"open"}`); w.Code != 403 || problemType(w) != "not-allowed" {
		t.Errorf("anna changes the kind: %d %s", w.Code, w.Body)
	}
	if w := a.send(seb, "PATCH", path, `{"kind":"on_request"}`); w.Code != 200 || !strings.Contains(w.Body.String(), `"kind":"on_request"`) {
		t.Fatalf("on request: %d %s", w.Code, w.Body)
	}
	if w := a.send(markus, "POST", path+"/join", ""); !strings.Contains(w.Body.String(), `"state":"requested"`) {
		t.Fatalf("markus asks: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(anna, "DELETE", path+"/requests/"+markus, "")); w.Code != 204 {
		t.Errorf("anna turns markus down: %d %s", w.Code, w.Body)
	}
	_ = a.send(markus, "POST", path+"/join", "")
	if w := a.send(anna, "PUT", path+"/members/"+markus, ""); w.Code != 204 {
		t.Errorf("anna lets markus in: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", path+"/members/lisa@example.at", ""); w.Code != 404 || problemType(w) != "no-request" {
		t.Errorf("lisa never asked: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(markus, "DELETE", path+"/members/"+anna, "")); w.Code != 403 {
		t.Errorf("markus removes anna: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(markus, "DELETE", path+"/members/"+markus, "")); w.Code != 204 {
		t.Errorf("markus leaves: %d %s", w.Code, w.Body)
	}
	_ = a.send(seb, "POST", path+"/invitations", `{"email":"lisa@example.at"}`)
	if w := a.do(a.as(seb, "DELETE", path+"/invitations/lisa@example.at", "")); w.Code != 204 {
		t.Errorf("take back: %d %s", w.Code, w.Body)
	}

	a.platform.err = errors.New("down")
	if w := a.send(seb, "POST", path+"/invitations", `{"email":"lisa@example.at"}`); w.Code != 502 || problemType(w) != "platform-failed" {
		t.Errorf("platform down: %d %s", w.Code, w.Body)
	}
	a.platform.err = nil
	for i := range 10 {
		_ = a.send(anna, "POST", path+"/invitations", fmt.Sprintf(`{"email":"p%d@example.at"}`, i))
	}
	if w := a.send(anna, "POST", path+"/invitations", `{"email":"p99@example.at"}`); w.Code != 429 || problemType(w) != "invite-limit" {
		t.Errorf("the eleventh: %d %s", w.Code, w.Body)
	}
	k := withKey(a.as(seb, "POST", "/api/v1/groups", `{"name":"A","kind":"open"}`), "8c9b2824-b0cd-4c0b-9052-000000000001")
	_ = a.do(k)
	k = withKey(a.as(seb, "POST", "/api/v1/groups", `{"name":"B","kind":"open"}`), "8c9b2824-b0cd-4c0b-9052-000000000001")
	if w := a.do(k); w.Code != 409 {
		t.Errorf("key reused: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as("", "GET", "/api/v1/groups", "")); w.Code != 401 {
		t.Errorf("no note: %d", w.Code)
	}
}

func TestAvailability(t *testing.T) {
	a := setup(t)
	w := a.do(a.as(anna, "GET", "/api/v1/availability", ""))
	var m struct {
		From, To string
		Days     []any
	}
	if err := json.Unmarshal(w.Body.Bytes(), &m); w.Code != 200 || err != nil || m.From == "" || len(m.Days) != 0 {
		t.Fatalf("empty: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", "/api/v1/availability/days/"+m.From, `{"spans":[{"from":420,"to":540},{"from":540,"to":600}]}`); w.Code != 200 ||
		!strings.Contains(w.Body.String(), `"spans":[{"from":420,"to":600}]`) {
		t.Errorf("merged: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", "/api/v1/availability/days/2020-01-01", `{"spans":[]}`); w.Code != 400 || problemType(w) != "outside-window" {
		t.Errorf("long ago: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", "/api/v1/availability/days/"+m.From, `{"spans":[{"from":0,"to":30}]}`); w.Code != 400 || problemType(w) != "invalid-spans" {
		t.Errorf("at night: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", "/api/v1/availability/templates", `{"templates":[{"weekday":4,"spans":[{"from":1110,"to":1320}]}]}`); w.Code != 200 {
		t.Errorf("templates: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", "/api/v1/availability/templates", `{"templates":[{"weekday":9,"spans":[]}]}`); w.Code != 400 {
		t.Errorf("weekday 9: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", "/api/v1/availability/venues", `{"venues":["villach"]}`); w.Code != 200 {
		t.Errorf("venues: %d %s", w.Code, w.Body)
	}
	if w := a.send(anna, "PUT", "/api/v1/availability/venues", `{"venues":["mars"]}`); w.Code != 400 || problemType(w) != "unknown-venue" {
		t.Errorf("unknown venue: %d %s", w.Code, w.Body)
	}
	for _, path := range []string{"/api/v1/availability/days/" + m.From, "/api/v1/availability/templates", "/api/v1/availability/venues"} {
		if w := a.send(anna, "PUT", path, `{`); w.Code != 400 {
			t.Errorf("%s broken body: %d", path, w.Code)
		}
	}
	w = a.do(a.as(anna, "GET", "/api/v1/availability", ""))
	if !strings.Contains(w.Body.String(), `"venues":["villach"]`) || !strings.Contains(w.Body.String(), `"weekday":4`) {
		t.Errorf("all of it: %s", w.Body)
	}
}

// Every new call wants a note, and answers a problem when the database is
// down.
func TestGroups_noNoteAndDatabaseDown(t *testing.T) {
	a := setup(t)
	calls := []struct{ method, path, body string }{
		{"GET", "/api/v1/groups", ""},
		{"POST", "/api/v1/groups", `{"name":"A","kind":"open"}`},
		{"GET", "/api/v1/groups/1", ""},
		{"PATCH", "/api/v1/groups/1", `{"name":"B"}`},
		{"POST", "/api/v1/groups/1/invitations", `{"email":"lisa@example.at"}`},
		{"DELETE", "/api/v1/groups/1/invitations/lisa@example.at", ""},
		{"POST", "/api/v1/groups/1/join", ""},
		{"PUT", "/api/v1/groups/1/members/lisa@example.at", ""},
		{"DELETE", "/api/v1/groups/1/members/lisa@example.at", ""},
		{"DELETE", "/api/v1/groups/1/requests/lisa@example.at", ""},
		{"PUT", "/api/v1/me/name", `{"name":"Anna"}`},
		{"GET", "/api/v1/availability", ""},
		{"PUT", "/api/v1/availability/days/2026-10-30", `{"spans":[]}`},
		{"PUT", "/api/v1/availability/templates", `{"templates":[]}`},
		{"PUT", "/api/v1/availability/venues", `{"venues":[]}`},
	}
	for _, c := range calls {
		keys++
		r := withKey(a.as("", c.method, c.path, c.body), fmt.Sprintf("9c9b2824-b0cd-4c0b-9052-%012d", keys))
		if w := a.do(r); w.Code != 401 {
			t.Errorf("%s %s without a note: %d", c.method, c.path, w.Code)
		}
	}

	down, err := pgxpool.NewWithConfig(t.Context(), a.pool.Config())
	if err != nil {
		t.Fatal(err)
	}
	down.Close()
	a.h = a.router(down)
	for _, c := range calls {
		if c.path == "/api/v1/availability/days/2026-10-30" {
			continue // outside the window before it reaches the database
		}
		if w := a.send(anna, c.method, c.path, c.body); w.Code != 500 {
			t.Errorf("%s %s with the database down: %d %s", c.method, c.path, w.Code, w.Body)
		}
	}
	if w := a.do(a.as(anna, "GET", "/api/v1/me", "")); w.Code != 500 {
		t.Errorf("me with the database down: %d", w.Code)
	}
}

// Someone outside sees an open group listed, without a role.
func TestGroups_listedAndKeys(t *testing.T) {
	a := setup(t)
	const lisa = "lisa@example.at"
	w := a.send(seb, "POST", "/api/v1/groups", `{"name":"Offen","kind":"open"}`)
	var g struct{ ID int64 }
	_ = json.Unmarshal(w.Body.Bytes(), &g)
	_ = a.do(a.as(lisa, "GET", "/api/v1/me", ""))
	w = a.do(a.as(lisa, "GET", "/api/v1/groups", ""))
	if !strings.Contains(w.Body.String(), `"how":"listed"`) || strings.Contains(w.Body.String(), `"role"`) {
		t.Errorf("listed: %s", w.Body)
	}
	path := fmt.Sprintf("/api/v1/groups/%d", g.ID)
	if w := a.send(lisa, "PATCH", "/api/v1/groups/999999", `{"name":"X"}`); w.Code != 404 {
		t.Errorf("update nothing: %d %s", w.Code, w.Body)
	}
	if w := a.send(lisa, "POST", "/api/v1/groups/999999/join", ""); w.Code != 404 {
		t.Errorf("join nothing: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(lisa, "DELETE", path+"/members/"+seb, "")); w.Code != 404 && w.Code != 403 {
		t.Errorf("lisa removes seb: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(lisa, "DELETE", path+"/requests/"+seb, "")); w.Code < 400 {
		t.Errorf("lisa drops a request: %d %s", w.Code, w.Body)
	}
	_ = a.send(seb, "POST", path+"/invitations", `{"email":"anna@example.at"}`)
	if w := a.do(a.as(lisa, "DELETE", path+"/invitations/"+anna, "")); w.Code != 403 {
		t.Errorf("lisa drops an invitation: %d %s", w.Code, w.Body)
	}
	for _, c := range []struct{ method, path, a, b string }{
		{"PUT", "/api/v1/me/name", `{"name":"Lisa"}`, `{"name":"Liz"}`},
		{"PATCH", path, `{"name":"Offen"}`, `{"name":"Zu"}`},
		{"PUT", "/api/v1/availability/templates", `{"templates":[]}`, `{"templates":[{"weekday":1,"spans":[{"from":600,"to":660}]}]}`},
		{"PUT", "/api/v1/availability/venues", `{"venues":[]}`, `{"venues":["villach"]}`},
	} {
		who := lisa
		if c.method == "PATCH" {
			who = seb
		}
		const k = "8c9b2824-b0cd-4c0b-9052-000000000077"
		_ = a.do(withKey(a.as(who, c.method, c.path, c.a), k))
		if w := a.do(withKey(a.as(who, c.method, c.path, c.b), k)); w.Code != 409 {
			t.Errorf("%s key reused: %d %s", c.path, w.Code, w.Body)
		}
	}
}
