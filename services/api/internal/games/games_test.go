package games_test

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/seburgi/padel-kaernten/services/api/internal/games"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
)

const (
	anna     = "anna@example.at"
	bert     = "bert@example.at"
	carla    = "carla@example.at"
	dora     = "dora@example.at"
	emil     = "emil@example.at"
	stranger = "x@example.at"
)

var n int

func key() string {
	n++
	return fmt.Sprintf("5c9b2824-b0cd-4c0b-9052-%012d", n)
}

func cents(n int) *int { return &n }

// 2026-10-29, a Thursday: court 1 free 17:00–21:00 at 40 € an hour (the
// last hour at 48 €), court 2 free 18:00–19:30 without a price.
func villach() games.Venue {
	return games.Venue{ID: "villach", Name: "Padel Villach", Step: 30,
		Links: map[string]string{"2026-10-29": "https://book.example/29"},
		Courts: []games.Court{
			{Name: "Court 1", Free: []games.Slot{
				{Day: "2026-10-29", From: 1020, To: 1200, PricePerHour: cents(4000)},
				{Day: "2026-10-29", From: 1200, To: 1260, PricePerHour: cents(4800)},
			}},
			{Name: "Court 2", Free: []games.Slot{{Day: "2026-10-29", From: 1080, To: 1170}}},
		}}
}

func person(email string, venues []string, days map[string][]games.Span) games.Person {
	return games.Person{Email: email, Days: days, Venues: venues}
}

func evening(from, to int) map[string][]games.Span {
	return map[string][]games.Span{"2026-10-29": {{From: 600, To: 660}, {From: from, To: to}}}
}

func TestFits(t *testing.T) {
	people := []games.Person{
		person(anna, nil, evening(1020, 1260)),
		person(bert, []string{"villach"}, evening(1080, 1260)),
		person(carla, nil, evening(1080, 1200)),
		person(dora, nil, evening(1110, 1260)),
		person(emil, []string{"annenheim"}, evening(1020, 1260)), // never drives to Villach
		person(stranger, nil, nil),                               // entered nothing
	}
	w := games.Window{Today: "2026-10-29", NotBefore: 1050}
	venues := []games.Venue{villach(), {ID: "failed", Failed: true},
		{ID: "later", NotBookable: []string{"2026-10-29"}, Courts: villach().Courts}}
	fits, nearly := games.Fits(venues, people, 90, 4, w)

	// 18:30–20:00 is the first start all four can; it counts once, on the
	// court listed first.
	if len(fits) == 0 || fits[0].Start != 1110 || fits[0].Court != "Court 1" ||
		!reflect.DeepEqual(fits[0].Can, []string{anna, bert, carla, dora}) || *fits[0].PriceCents != 6000 {
		t.Fatalf("fits: %+v", fits)
	}
	if len(fits) != 1 {
		t.Errorf("only 18:30 fits all four until 20:00: %+v", fits)
	}
	// Near misses: three can, and the stranger is named to ask.
	if len(nearly) == 0 || !reflect.DeepEqual(nearly[0].Ask, []string{stranger}) || len(nearly[0].Can) != 3 {
		t.Fatalf("nearly: %+v", nearly)
	}
	for _, f := range nearly {
		if f.Day == "2026-10-29" && f.Start < 1050 {
			t.Errorf("a start already past: %+v", f)
		}
	}

	// 19:30–21:00 on court 1 crosses into the dearer hour: 30 min at 40 €
	// and 60 at 48 €.
	late, _ := games.Fits(venues, people[:2], 90, 2, w)
	var found bool
	for _, f := range late {
		if f.Start == 1170 && f.Court == "Court 1" {
			found = true
			if *f.PriceCents != 2000+4800 {
				t.Errorf("price across parts: %d", *f.PriceCents)
			}
		}
	}
	if !found {
		t.Errorf("no 19:30 fit: %+v", late)
	}
	// Court 2 has no price.
	only2 := villach()
	only2.Courts = only2.Courts[1:]
	two, _ := games.Fits([]games.Venue{only2}, people[:2], 90, 2, w)
	if len(two) != 1 || two[0].PriceCents != nil {
		t.Errorf("unpriced: %+v", two)
	}
	// Days gone count for nothing.
	if f, nf := games.Fits(venues, people, 90, 4, games.Window{Today: "2026-10-30"}); len(f)+len(nf) != 0 {
		t.Errorf("yesterday: %+v %+v", f, nf)
	}
	// Ordered by how many can, then when.
	all, _ := games.Fits(venues, people, 60, 2, games.Window{Today: "2026-10-29"})
	for i := 1; i < len(all); i++ {
		a, b := all[i-1], all[i]
		if len(a.Can) < len(b.Can) || len(a.Can) == len(b.Can) && a.Start > b.Start {
			t.Fatalf("order at %d: %+v then %+v", i, a, b)
		}
	}
}

func TestFits_limits(t *testing.T) {
	var venues []games.Venue
	for i := range 30 {
		v := villach()
		v.ID = fmt.Sprintf("v%d", i)
		v.Step = 0 // the grid then is half hours
		venues = append(venues, v)
	}
	always := map[string][]games.Span{"2026-10-29": {{From: 360, To: 1440}}}
	people := []games.Person{person(anna, nil, always), person(bert, nil, always), person(carla, nil, always), person(stranger, nil, nil)}
	fits, nearly := games.Fits(venues, people, 60, 3, games.Window{Today: "2026-10-29"})
	if len(fits) != games.MaxFits || len(nearly) != 0 {
		t.Errorf("fits %d, nearly %d", len(fits), len(nearly))
	}
	_, nearly = games.Fits(venues, people, 60, 4, games.Window{Today: "2026-10-29"})
	if len(nearly) != games.MaxNearly {
		t.Errorf("nearly %d", len(nearly))
	}
}

func setup(t *testing.T) (*games.Service, *pgxpool.Pool, int64) {
	pool := testdb.Pool(t)
	ctx := t.Context()
	var group int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO groups (name, kind, created_by) VALUES ('Runde', 'private', $1) RETURNING id`, anna).Scan(&group); err != nil {
		t.Fatal(err)
	}
	for _, e := range []string{anna, bert, carla, dora, emil} {
		if _, err := pool.Exec(ctx, `INSERT INTO memberships (group_id, email, role) VALUES ($1, $2, 'member')`, group, e); err != nil {
			t.Fatal(err)
		}
	}
	s := games.NewService(pool)
	// 16:00 in Vienna on 2026-10-29.
	s.Now = func() time.Time { return time.Date(2026, 10, 29, 15, 0, 0, 0, time.UTC) }
	return s, pool, group
}

func propose(t *testing.T, s *games.Service, group int64) games.Game {
	t.Helper()
	g, err := s.Propose(t.Context(), anna, key(), group,
		games.Proposal{VenueID: "villach", Court: "Court 1", Day: "2026-10-29", Start: 1110, Minutes: 90},
		[]games.Venue{villach()})
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func states(g games.Game) map[string]string {
	out := map[string]string{}
	for _, p := range g.Lineup {
		out[p.Email] = p.State
	}
	return out
}

func TestPropose(t *testing.T) {
	s, _, group := setup(t)
	ctx := t.Context()
	if w := s.Window(); w.Today != "2026-10-29" || w.NotBefore != 960 {
		t.Fatalf("window: %+v", w)
	}
	k := key()
	p := games.Proposal{VenueID: "villach", Court: "Court 1", Day: "2026-10-29", Start: 1110, Minutes: 90}
	g, err := s.Propose(ctx, anna, k, group, p, []games.Venue{villach()})
	if err != nil || g.State != games.Proposed || g.VenueName != "Padel Villach" || *g.PriceCents != 6000 ||
		g.Players != 4 || g.ProposedBy != anna || !reflect.DeepEqual(states(g), map[string]string{anna: games.In}) {
		t.Fatalf("propose: %+v %v", g, err)
	}
	if again, err := s.Propose(ctx, anna, k, group, p, []games.Venue{villach()}); err != nil || again.ID != g.ID {
		t.Errorf("replay: %+v %v", again, err)
	}
	other := p
	other.Start = 1080
	if _, err := s.Propose(ctx, anna, k, group, other, []games.Venue{villach()}); !errors.Is(err, idempotency.ErrKeyReused) {
		t.Errorf("key reused: %v", err)
	}
	for name, q := range map[string]games.Proposal{
		"booked meanwhile": {VenueID: "villach", Court: "Court 2", Day: "2026-10-29", Start: 1110, Minutes: 90},
		"no such court":    {VenueID: "villach", Court: "Court 9", Day: "2026-10-29", Start: 1110, Minutes: 90},
		"no such venue":    {VenueID: "mars", Court: "Court 1", Day: "2026-10-29", Start: 1110, Minutes: 90},
		"started":          {VenueID: "villach", Court: "Court 1", Day: "2026-10-29", Start: 930, Minutes: 60},
		"yesterday":        {VenueID: "villach", Court: "Court 1", Day: "2026-10-28", Start: 1110, Minutes: 60},
	} {
		if _, err := s.Propose(ctx, anna, key(), group, q, []games.Venue{villach()}); !errors.Is(err, games.ErrGone) {
			t.Errorf("%s: %v", name, err)
		}
	}
	p45 := p
	p45.Minutes = 45
	if _, err := s.Propose(ctx, anna, key(), group, p45, []games.Venue{villach()}); !errors.Is(err, games.ErrInvalid) {
		t.Errorf("45 minutes: %v", err)
	}
	if _, err := s.Propose(ctx, stranger, key(), group, p, []games.Venue{villach()}); !errors.Is(err, games.ErrNotFound) {
		t.Errorf("not a member: %v", err)
	}
	if _, err := s.Get(ctx, stranger, g.ID); !errors.Is(err, games.ErrNotFound) {
		t.Errorf("a stranger reads it: %v", err)
	}
	list, err := s.Upcoming(ctx, bert, group)
	if err != nil || len(list) != 1 || list[0].ID != g.ID || len(list[0].Lineup) != 1 {
		t.Errorf("upcoming: %+v %v", list, err)
	}
	if list, _ := s.Upcoming(ctx, bert, 0); len(list) != 1 {
		t.Errorf("every group: %+v", list)
	}
	if list, _ := s.Upcoming(ctx, stranger, 0); len(list) != 0 {
		t.Errorf("a stranger's: %+v", list)
	}
}

func TestAnswer(t *testing.T) {
	s, _, group := setup(t)
	ctx := t.Context()
	g := propose(t, s, group)
	answer := func(who, a string) games.Game {
		t.Helper()
		got, err := s.Answer(ctx, who, key(), g.ID, a)
		if err != nil {
			t.Fatalf("%s %s: %+v", who, a, err)
		}
		return got
	}
	answer(bert, games.In)
	answer(carla, games.In)
	answer(dora, games.Out)
	full := answer(emil, games.In)
	if st := states(full); st[emil] != games.In || st[dora] != games.Out || len(st) != 5 {
		t.Fatalf("four in: %+v", st)
	}
	answer(dora, games.In)
	if st := states(answer(dora, games.In)); st[dora] != games.Reserve {
		t.Errorf("full makes a reserve, twice: %+v", st)
	}
	// Bert drops out: Dora moves up.
	after := answer(bert, games.Out)
	if st := states(after); st[bert] != games.Out || st[dora] != games.In {
		t.Errorf("moving up: %+v", st)
	}
	answer(bert, games.Out)
	// A reserve saying no lets nobody up.
	answer(bert, games.In)
	if st := states(answer(bert, games.Out)); st[bert] != games.Out {
		t.Errorf("reserve out: %+v", st)
	}

	if _, err := s.Answer(ctx, bert, key(), g.ID, "maybe"); !errors.Is(err, games.ErrInvalid) {
		t.Errorf("maybe: %v", err)
	}
	if _, err := s.Answer(ctx, stranger, key(), g.ID, games.In); !errors.Is(err, games.ErrNotFound) {
		t.Errorf("stranger: %v", err)
	}
	k := key()
	if _, err := s.Answer(ctx, bert, k, g.ID, games.In); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Answer(ctx, bert, k, g.ID, games.In); err != nil {
		t.Errorf("replay: %v", err)
	}

	// Booking and cancelling are the proposer's.
	if _, err := s.SetState(ctx, bert, key(), g.ID, games.Booked); !errors.Is(err, games.ErrForbidden) {
		t.Errorf("bert books: %v", err)
	}
	if _, err := s.SetState(ctx, anna, key(), g.ID, "played"); !errors.Is(err, games.ErrInvalid) {
		t.Errorf("played: %v", err)
	}
	booked, err := s.SetState(ctx, anna, key(), g.ID, games.Booked)
	if err != nil || booked.State != games.Booked || booked.BookedAt == nil {
		t.Fatalf("booked: %+v %v", booked, err)
	}
	cancelled, err := s.SetState(ctx, anna, key(), g.ID, games.Cancelled)
	if err != nil || cancelled.State != games.Cancelled {
		t.Fatalf("cancelled: %+v %v", cancelled, err)
	}
	if _, err := s.SetState(ctx, anna, key(), g.ID, games.Booked); !errors.Is(err, games.ErrClosed) {
		t.Errorf("book a cancelled game: %v", err)
	}
	if _, err := s.Answer(ctx, carla, key(), g.ID, games.Out); !errors.Is(err, games.ErrClosed) {
		t.Errorf("answer a cancelled game: %v", err)
	}
	if list, _ := s.Upcoming(ctx, anna, group); len(list) != 0 {
		t.Errorf("cancelled is not upcoming: %+v", list)
	}

	// A day later the game is over.
	g2 := propose(t, s, group)
	s.Now = func() time.Time { return time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC) }
	if _, err := s.Answer(ctx, bert, key(), g2.ID, games.In); !errors.Is(err, games.ErrClosed) {
		t.Errorf("answer after: %v", err)
	}
	if list, _ := s.Upcoming(ctx, anna, 0); len(list) != 0 {
		t.Errorf("past is not upcoming: %+v", list)
	}
}

func TestDatabaseDown(t *testing.T) {
	s, pool, group := setup(t)
	g := propose(t, s, group)
	down, err := pgxpool.NewWithConfig(context.Background(), pool.Config())
	if err != nil {
		t.Fatal(err)
	}
	down.Close()
	d := games.NewService(down)
	d.Now = s.Now
	ctx := t.Context()
	if _, err := d.Get(ctx, anna, g.ID); err == nil {
		t.Error("get")
	}
	if _, err := d.Upcoming(ctx, anna, 0); err == nil {
		t.Error("upcoming")
	}
	if _, err := d.Propose(ctx, anna, key(), group,
		games.Proposal{VenueID: "villach", Court: "Court 1", Day: "2026-10-29", Start: 1110, Minutes: 90},
		[]games.Venue{villach()}); err == nil {
		t.Error("propose")
	}
	if _, err := d.Answer(ctx, anna, key(), g.ID, games.In); err == nil {
		t.Error("answer")
	}
}
