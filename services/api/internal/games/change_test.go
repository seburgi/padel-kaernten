package games_test

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/seburgi/padel-kaernten/services/api/internal/games"
)

// wider is villach with a third court free all evening on the 29th and
// court 1 free on the 30th too.
func wider() games.Venue {
	v := villach()
	v.Courts[0].Free = append(v.Courts[0].Free, games.Slot{Day: "2026-10-30", From: 1020, To: 1260, PricePerHour: cents(4000)})
	v.Courts = append(v.Courts, games.Court{Name: "Court 3", Free: []games.Slot{
		{Day: "2026-10-29", From: 1020, To: 1260, PricePerHour: cents(3600)},
	}})
	return v
}

func TestMoves(t *testing.T) {
	w := games.Window{Today: "2026-10-29", NotBefore: 1050}
	g := games.Game{VenueID: "villach", Court: "Court 1", Day: "2026-10-29", Start: 1110, Minutes: 90}
	key := func(f games.Fit) string { return f.Day + " " + f.Court + " " + clock(f.Start) }
	var got []string
	for _, f := range games.Moves([]games.Venue{villach(), {ID: "failed", Failed: true}}, g, 90, w) {
		got = append(got, key(f))
	}
	// One court per start, never the game itself, nothing past.
	want := []string{"2026-10-29 Court 1 17:30", "2026-10-29 Court 1 18:00", "2026-10-29 Court 1 19:00", "2026-10-29 Court 1 19:30"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("moves:\n got %q\nwant %q", got, want)
	}
	// At the game's own venue and time every other court is one.
	g.Start = 1080
	got = nil
	for _, f := range games.Moves([]games.Venue{villach()}, g, 90, w) {
		got = append(got, key(f))
	}
	want = []string{"2026-10-29 Court 1 17:30", "2026-10-29 Court 2 18:00", "2026-10-29 Court 1 18:30", "2026-10-29 Court 1 19:00", "2026-10-29 Court 1 19:30"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("same time:\n got %q\nwant %q", got, want)
	}
	// Another length, and a day the site takes no bookings for.
	later := villach()
	later.NotBookable = []string{"2026-10-29"}
	if m := games.Moves([]games.Venue{later}, g, 60, w); len(m) != 0 {
		t.Errorf("not bookable: %+v", m)
	}
	if m := games.Moves([]games.Venue{villach()}, g, 120, w); len(m) == 0 || m[0].Minutes != 120 {
		t.Errorf("120: %+v", m)
	}
}

func clock(m int) string {
	return string(rune('0'+m/600)) + string(rune('0'+m/60%10)) + ":" + string(rune('0'+m%60/10)) + "0"
}

func TestMove(t *testing.T) {
	s, _, group := setup(t)
	ctx := t.Context()
	var got []string
	s.Changed = func(_ context.Context, e games.Event) { got = append(got, e.Kind+" "+e.Who) }
	g := propose(t, s, group)
	for who, a := range map[string]string{bert: games.In, carla: games.In, emil: games.In, dora: games.Out} {
		if _, err := s.Answer(ctx, who, key(), g.ID, a); err != nil {
			t.Fatal(err)
		}
	}
	got = nil
	venues := []games.Venue{wider()}
	move := func(who string, p games.Proposal, note string) (games.Game, error) {
		return s.Move(ctx, who, key(), g.ID, p, note, venues)
	}
	at := func(court, day string, start, minutes int) games.Proposal {
		return games.Proposal{VenueID: "villach", Court: court, Day: day, Start: start, Minutes: minutes}
	}

	if _, err := move(bert, at("Court 3", "2026-10-29", 1110, 90), ""); !errors.Is(err, games.ErrForbidden) {
		t.Errorf("bert moves it: %v", err)
	}
	if _, err := move(anna, at("Court 2", "2026-10-29", 1110, 90), ""); !errors.Is(err, games.ErrGone) {
		t.Errorf("a court not free: %v", err)
	}
	if _, err := move(anna, at("Court 3", "2026-10-29", 1110, 45), ""); !errors.Is(err, games.ErrInvalid) {
		t.Errorf("45 minutes: %v", err)
	}
	if _, err := move(anna, at("Court 3", "2026-10-29", 1110, 90), strings.Repeat("x", 141)); !errors.Is(err, games.ErrInvalid) {
		t.Errorf("a long note: %v", err)
	}
	if same, err := move(anna, at("Court 1", "2026-10-29", 1110, 90), ""); err != nil || same.Change != nil {
		t.Errorf("where it is: %+v %v", same, err)
	}

	// Another court, same venue and time: every answer stays.
	court, err := move(anna, at("Court 3", "2026-10-29", 1110, 90), "Court 1 ist weg")
	if err != nil || court.Court != "Court 3" || *court.PriceCents != 5400 || court.Change == nil ||
		court.Change.Court != "Court 1" || court.Change.Note != "Court 1 ist weg" ||
		!reflect.DeepEqual(states(court), map[string]string{anna: games.In, bert: games.In, carla: games.In, emil: games.In, dora: games.Out}) {
		t.Fatalf("court: %+v %v", court, err)
	}

	// Booked, then a new time: whoever was in says again, the no is
	// dropped, and it is to be booked anew, without the old access code.
	if _, err := s.SetState(ctx, anna, key(), g.ID, games.Booked, "", &[]string{"4711"}[0]); err != nil {
		t.Fatal(err)
	}
	moved, err := move(anna, at("Court 1", "2026-10-29", 1020, 60), "")
	if err != nil || moved.Start != 1020 || moved.Minutes != 60 || moved.State != games.Proposed || moved.BookedAt != nil || moved.Code != "" ||
		moved.Change.Court != "Court 3" || moved.Change.Start != 1110 || moved.Change.Note != "" ||
		!reflect.DeepEqual(states(moved), map[string]string{anna: games.In, bert: games.Asked, carla: games.Asked, emil: games.Asked}) {
		t.Fatalf("moved: %+v %v", moved, err)
	}
	if h := games.Held(moved); len(h) != 4 {
		t.Errorf("held: %v", h)
	}
	// Places held for those asked: none for Dora, and no fewer places.
	if g, err := s.Answer(ctx, dora, key(), g.ID, games.In); err != nil || states(g)[dora] != games.Reserve {
		t.Errorf("dora waits: %+v %v", g, err)
	}
	if _, err := s.SetPlayers(ctx, anna, key(), g.ID, 3); !errors.Is(err, games.ErrPlaces) {
		t.Errorf("fewer places than held: %v", err)
	}
	if _, err := s.Accept(ctx, anna, key(), g.ID, bert); !errors.Is(err, games.ErrNotReserve) {
		t.Errorf("accept someone asked: %v", err)
	}
	// Bert says yes again; Carla cannot, so Dora moves up; Emil's yes
	// makes it full.
	for who, a := range map[string]string{bert: games.In, carla: games.Out} {
		if _, err := s.Answer(ctx, who, key(), g.ID, a); err != nil {
			t.Fatal(err)
		}
	}
	full, err := s.Answer(ctx, emil, key(), g.ID, games.In)
	if err != nil || !reflect.DeepEqual(states(full),
		map[string]string{anna: games.In, bert: games.In, carla: games.Out, dora: games.In, emil: games.In}) {
		t.Fatalf("again: %+v %v", full, err)
	}

	// One game a day: not onto a day the group has another.
	other, err := s.Propose(ctx, bert, key(), group, at("Court 1", "2026-10-30", 1110, 90), venues)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := move(anna, at("Court 1", "2026-10-30", 1020, 90), ""); !errors.Is(err, games.ErrDayTaken) {
		t.Errorf("a day taken: %v", err)
	}
	if _, err := s.SetState(ctx, bert, key(), other.ID, games.Cancelled, "", nil); err != nil {
		t.Fatal(err)
	}
	if g, err := move(anna, at("Court 1", "2026-10-30", 1020, 90), ""); err != nil || g.Day != "2026-10-30" {
		t.Errorf("the day free again: %+v %v", g, err)
	}

	want := []string{"court-changed " + anna, "booked " + anna, "moved " + anna, "declined " + carla,
		"moved-up " + dora, "full " + emil, "moved " + anna}
	// bert's proposal and cancel on the other game come in between.
	var mine []string
	for _, e := range got {
		if e != "proposed "+bert && e != "cancelled "+bert {
			mine = append(mine, e)
		}
	}
	if !reflect.DeepEqual(mine, want) {
		t.Errorf("events:\n got %q\nwant %q", mine, want)
	}

	if _, err := s.SetState(ctx, anna, key(), g.ID, games.Cancelled, "", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := move(anna, at("Court 1", "2026-10-30", 1080, 90), ""); !errors.Is(err, games.ErrClosed) {
		t.Errorf("move a cancelled game: %v", err)
	}
}

func TestRemove(t *testing.T) {
	s, _, group := setup(t)
	ctx := t.Context()
	var got []string
	s.Changed = func(_ context.Context, e games.Event) { got = append(got, e.Kind+" "+e.Who) }
	g := propose(t, s, group)
	for _, who := range []string{bert, carla, dora, emil} {
		if _, err := s.Answer(ctx, who, key(), g.ID, games.In); err != nil {
			t.Fatal(err)
		}
	}
	got = nil
	remove := func(who, email string) (games.Game, error) { return s.Remove(ctx, who, key(), g.ID, email) }
	if _, err := remove(bert, carla); !errors.Is(err, games.ErrForbidden) {
		t.Errorf("bert takes carla out: %v", err)
	}
	for _, email := range []string{anna, ""} {
		if _, err := remove(anna, email); !errors.Is(err, games.ErrInvalid) {
			t.Errorf("take %q out: %v", email, err)
		}
	}
	if _, err := remove(anna, stranger); !errors.Is(err, games.ErrNotPlaying) {
		t.Errorf("take a stranger out: %v", err)
	}
	// Carla is out, Emil, the reserve, moves up.
	out, err := remove(anna, carla)
	if err != nil || states(out)[carla] != games.Out || states(out)[emil] != games.In {
		t.Fatalf("carla out: %+v %v", out, err)
	}
	if _, err := remove(anna, carla); !errors.Is(err, games.ErrNotPlaying) {
		t.Errorf("out twice: %v", err)
	}
	// A reserve taken out lets nobody up.
	if _, err := s.Answer(ctx, carla, key(), g.ID, games.In); err != nil {
		t.Fatal(err)
	}
	if g, err := remove(anna, carla); err != nil || states(g)[carla] != games.Out {
		t.Errorf("reserve out: %+v %v", g, err)
	}
	want := []string{"removed " + carla, "moved-up " + emil, "removed " + carla}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("events:\n got %q\nwant %q", got, want)
	}
}

func TestCancelNote(t *testing.T) {
	s, _, group := setup(t)
	ctx := t.Context()
	g := propose(t, s, group)
	if _, err := s.SetState(ctx, anna, key(), g.ID, games.Booked, "warum", nil); !errors.Is(err, games.ErrInvalid) {
		t.Errorf("a note on booking: %v", err)
	}
	if _, err := s.SetState(ctx, anna, key(), g.ID, games.Cancelled, strings.Repeat("ü", 141), nil); !errors.Is(err, games.ErrInvalid) {
		t.Errorf("a long note: %v", err)
	}
	c, err := s.SetState(ctx, anna, key(), g.ID, games.Cancelled, "  Platz ausgebucht ", nil)
	if err != nil || c.CancelNote != "Platz ausgebucht" {
		t.Errorf("cancelled: %+v %v", c, err)
	}
}
