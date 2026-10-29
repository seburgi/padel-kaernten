package availability_test

import (
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/seburgi/padel-kaernten/services/api/internal/availability"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
)

const (
	anna = "anna@example.at"
	lisa = "lisa@example.at"
)

var n int

func key() string {
	n++
	return fmt.Sprintf("6c9b2824-b0cd-4c0b-9052-%012d", n)
}

type span = availability.Span

func TestMerge(t *testing.T) {
	for _, c := range []struct {
		in   []span
		want []span
		err  bool
	}{
		{in: nil, want: []span{}},
		{in: []span{{1110, 1320}, {420, 540}}, want: []span{{420, 540}, {1110, 1320}}},
		// Overlapping and touching become one.
		{in: []span{{420, 540}, {480, 600}, {600, 660}}, want: []span{{420, 660}}},
		{in: []span{{360, 1440}, {600, 660}}, want: []span{{360, 1440}}},
		{in: []span{{330, 420}}, err: true},  // before 6:00
		{in: []span{{420, 1470}}, err: true}, // after 24:00
		{in: []span{{420, 435}}, err: true},  // off the grid
		{in: []span{{540, 540}}, err: true},  // empty
		{in: []span{{600, 540}}, err: true},  // backwards
	} {
		got, err := availability.Merge(c.in)
		if (err != nil) != c.err || (!c.err && !reflect.DeepEqual(got, c.want)) {
			t.Errorf("Merge(%v) = %v, %v", c.in, got, err)
		}
	}
}

func setup(t *testing.T) *availability.Service {
	s := availability.NewService(testdb.Pool(t), func(v string) bool { return v == "villach" || v == "annenheim" })
	// 23:30 UTC is already the next day in Vienna.
	s.Now = func() time.Time { return time.Date(2026, 10, 27, 23, 30, 0, 0, time.UTC) }
	return s
}

func TestDays(t *testing.T) {
	s := setup(t)
	ctx := t.Context()
	if from, to := s.Window(); from != "2026-10-28" || to != "2026-11-10" {
		t.Fatalf("window: %s %s", from, to)
	}
	k := key()
	got, err := s.SetDay(ctx, anna, k, "2026-10-29", []span{{1110, 1320}, {420, 540}, {480, 510}}, false)
	if err != nil || !reflect.DeepEqual(got, availability.Day{Day: "2026-10-29", Spans: []span{{420, 540}, {1110, 1320}}}) {
		t.Fatalf("set: %v %v", got, err)
	}
	if _, err := s.SetDay(ctx, anna, k, "2026-10-29", []span{{420, 540}, {1110, 1320}}, false); err != nil {
		t.Errorf("replay: %v", err)
	}
	if _, err := s.SetDay(ctx, anna, k, "2026-10-30", nil, false); !errors.Is(err, idempotency.ErrKeyReused) {
		t.Errorf("a key for another day: %v", err)
	}
	if _, err := s.SetDay(ctx, anna, key(), "2026-11-10", []span{{1080, 1200}}, false); err != nil {
		t.Errorf("the last day: %v", err)
	}
	for _, day := range []string{"2026-10-27", "2026-11-11", "2026-13-01", "28.10.2026"} {
		if _, err := s.SetDay(ctx, anna, key(), day, nil, false); !errors.Is(err, availability.ErrOutside) {
			t.Errorf("%s: %v", day, err)
		}
	}
	if _, err := s.SetDay(ctx, anna, key(), "2026-10-30", []span{{420, 425}}, false); !errors.Is(err, availability.ErrInvalid) {
		t.Errorf("off the grid: %v", err)
	}
	_, _ = s.SetDay(ctx, lisa, key(), "2026-10-29", []span{{600, 660}}, false)

	m, err := s.Get(ctx, anna)
	if err != nil || len(m.Days) != 2 || m.Days[0].Day != "2026-10-29" || len(m.Days[0].Spans) != 2 ||
		m.Days[1].Day != "2026-11-10" || m.From != "2026-10-28" {
		t.Fatalf("get: %+v %v", m, err)
	}
	// Clearing a day.
	if got, err := s.SetDay(ctx, anna, key(), "2026-11-10", nil, false); err != nil || len(got.Spans) != 0 || got.Declined {
		t.Errorf("clear: %v %v", got, err)
	}
	entered, err := s.Entered(ctx, []string{anna, lisa, "markus@example.at"})
	if err != nil || !reflect.DeepEqual(entered, map[string]int{anna: 1, lisa: 1}) {
		t.Errorf("entered: %v %v", entered, err)
	}
}

func TestDeclined(t *testing.T) {
	s := setup(t)
	ctx := t.Context()
	if _, err := s.SetDay(ctx, anna, key(), "2026-10-30", []span{{600, 660}}, true); !errors.Is(err, availability.ErrInvalid) {
		t.Errorf("spans on a declined day: %v", err)
	}
	_, _ = s.SetDay(ctx, anna, key(), "2026-10-29", []span{{600, 660}}, false)
	got, err := s.SetDay(ctx, anna, key(), "2026-10-31", nil, true)
	if err != nil || !reflect.DeepEqual(got, availability.Day{Day: "2026-10-31", Spans: []span{}, Declined: true}) {
		t.Fatalf("decline: %+v %v", got, err)
	}
	m, err := s.Get(ctx, anna)
	want := []availability.Day{
		{Day: "2026-10-29", Spans: []span{{600, 660}}},
		{Day: "2026-10-31", Spans: []span{}, Declined: true},
	}
	if err != nil || !reflect.DeepEqual(m.Days, want) {
		t.Fatalf("get: %+v %v", m.Days, err)
	}
	if entered, _ := s.Entered(ctx, []string{anna}); entered[anna] != 2 {
		t.Errorf("a declined day counts as entered: %v", entered)
	}
	if of, _ := s.Of(ctx, []string{anna}); !of[anna].Declined["2026-10-31"] || len(of[anna].Days["2026-10-31"]) != 0 {
		t.Errorf("of: %+v", of[anna])
	}
	// Spans replace "passt nicht", and nothing leaves the day open.
	_, _ = s.SetDay(ctx, anna, key(), "2026-10-31", []span{{1080, 1200}}, false)
	if m, _ := s.Get(ctx, anna); len(m.Days) != 2 || m.Days[1].Declined || len(m.Days[1].Spans) != 1 {
		t.Errorf("spans after declined: %+v", m.Days)
	}
	_, _ = s.SetDay(ctx, anna, key(), "2026-10-31", nil, true)
	_, _ = s.SetDay(ctx, anna, key(), "2026-10-31", nil, false)
	if m, _ := s.Get(ctx, anna); len(m.Days) != 1 {
		t.Errorf("open again: %+v", m.Days)
	}
}

func TestTemplatesAndVenues(t *testing.T) {
	s := setup(t)
	ctx := t.Context()
	got, err := s.SetTemplates(ctx, anna, key(), []availability.Template{
		{Weekday: 4, Spans: []span{{1110, 1320}}},
		{Weekday: 2, Spans: []span{{1110, 1200}}},
		{Weekday: 2, Spans: []span{{1200, 1320}}},
	})
	want := []availability.Template{{Weekday: 2, Spans: []span{{1110, 1320}}}, {Weekday: 4, Spans: []span{{1110, 1320}}}}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("templates: %+v %v", got, err)
	}
	if _, err := s.SetTemplates(ctx, anna, key(), []availability.Template{{Weekday: 8}}); !errors.Is(err, availability.ErrInvalid) {
		t.Errorf("weekday 8: %v", err)
	}
	if _, err := s.SetTemplates(ctx, anna, key(), []availability.Template{{Weekday: 1, Spans: []span{{0, 30}}}}); !errors.Is(err, availability.ErrInvalid) {
		t.Errorf("before 6: %v", err)
	}
	venues, err := s.SetVenues(ctx, anna, key(), []string{"villach", "annenheim", "villach"})
	if err != nil || !reflect.DeepEqual(venues, []string{"annenheim", "villach"}) {
		t.Fatalf("venues: %v %v", venues, err)
	}
	if _, err := s.SetVenues(ctx, anna, key(), []string{"nowhere"}); !errors.Is(err, availability.ErrUnknownVenue) {
		t.Errorf("unknown venue: %v", err)
	}
	m, err := s.Get(ctx, anna)
	if err != nil || !reflect.DeepEqual(m.Templates, want) || !reflect.DeepEqual(m.Venues, venues) || len(m.Days) != 0 {
		t.Errorf("get: %+v %v", m, err)
	}
	if v, err := s.SetVenues(ctx, anna, key(), nil); err != nil || len(v) != 0 {
		t.Errorf("every venue again: %v %v", v, err)
	}
	if _, err := s.SetTemplates(ctx, anna, key(), nil); err != nil {
		t.Errorf("no templates: %v", err)
	}
	if m, _ := s.Get(ctx, anna); len(m.Templates) != 0 || len(m.Venues) != 0 {
		t.Errorf("cleared: %+v", m)
	}
}

func TestOf(t *testing.T) {
	s := setup(t)
	ctx := t.Context()
	_, _ = s.SetDay(ctx, anna, key(), "2026-10-29", []span{{1110, 1320}, {420, 540}}, false)
	_, _ = s.SetDay(ctx, anna, key(), "2026-10-30", []span{{600, 660}}, false)
	_, _ = s.SetVenues(ctx, anna, key(), []string{"villach"})
	_, _ = s.SetDay(ctx, lisa, key(), "2026-10-29", []span{{600, 660}}, false)
	got, err := s.Of(ctx, []string{anna, lisa, "markus@example.at"})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]availability.Person{
		anna: {Days: map[string][]span{"2026-10-29": {{420, 540}, {1110, 1320}}, "2026-10-30": {{600, 660}}},
			Declined: map[string]bool{}, Venues: []string{"villach"}},
		lisa:                {Days: map[string][]span{"2026-10-29": {{600, 660}}}, Declined: map[string]bool{}, Venues: []string{}},
		"markus@example.at": {Days: map[string][]span{}, Declined: map[string]bool{}, Venues: []string{}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("of: %+v", got)
	}
}
