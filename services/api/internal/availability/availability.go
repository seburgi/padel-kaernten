// Package availability is when each person can play and where they drive
// to (docs/design/availability.md). It belongs to the person, not to a
// group: every group they are in sees the same. Times are calendar days in
// Vienna plus minutes after midnight, on a 30-minute grid from 6:00 to
// 24:00, for today and the 13 days after it.
package availability

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"time"
	_ "time/tzdata" // the image has no zoneinfo

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
)

// The grid.
const (
	Step  = 30
	First = 6 * 60
	Last  = 24 * 60
	// Days is how far ahead one can say when they can: today and 13 more.
	Days = 14
)

var (
	// ErrInvalid means spans off the grid, outside 6:00 to 24:00, or empty.
	ErrInvalid = errors.New("invalid spans")
	// ErrOutside means a day before today or more than 13 days ahead.
	ErrOutside = errors.New("day outside the window")
	// ErrUnknownVenue means a venue id that is not in venues.json.
	ErrUnknownVenue = errors.New("unknown venue")
)

var vienna = mustZone("Europe/Vienna")

func mustZone(name string) *time.Location {
	l, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return l
}

// Span is from..to in minutes after midnight, to exclusive.
type Span struct{ From, To int }

// Day is the spans of one day, YYYY-MM-DD.
type Day struct {
	Day   string
	Spans []Span
}

// Template is what someone usually has on a weekday, 1 Monday to 7 Sunday.
type Template struct {
	Weekday int
	Spans   []Span
}

// Mine is everything one person said.
type Mine struct {
	// From and To are the window, YYYY-MM-DD, both included.
	From, To  string
	Days      []Day // only days with spans, in order
	Templates []Template
	Venues    []string // none means every venue
}

// Merge checks spans and joins the ones that overlap or touch, in order.
func Merge(spans []Span) ([]Span, error) {
	for _, s := range spans {
		if s.From < First || s.To > Last || s.From >= s.To || s.From%Step != 0 || s.To%Step != 0 {
			return nil, ErrInvalid
		}
	}
	sorted := slices.Clone(spans)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].From < sorted[j].From })
	out := []Span{}
	for _, s := range sorted {
		if n := len(out); n > 0 && s.From <= out[n-1].To {
			out[n-1].To = max(out[n-1].To, s.To)
			continue
		}
		out = append(out, s)
	}
	return out, nil
}

// Service keeps what people said.
type Service struct {
	pool  *pgxpool.Pool
	known func(venue string) bool
	// Now is the clock; nil is time.Now.
	Now func() time.Time
}

// NewService is the availability service; known says which venue ids
// exist.
func NewService(pool *pgxpool.Pool, known func(string) bool) *Service {
	return &Service{pool: pool, known: known}
}

// Window is today in Vienna and the last day one can enter, YYYY-MM-DD.
func (s *Service) Window() (string, string) {
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	t := now().In(vienna)
	today := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return today.Format(time.DateOnly), today.AddDate(0, 0, Days-1).Format(time.DateOnly)
}

func (s *Service) inWindow(day string) bool {
	d, err := time.Parse(time.DateOnly, day)
	if err != nil || d.Format(time.DateOnly) != day {
		return false
	}
	from, to := s.Window()
	return day >= from && day <= to
}

// Get is what email said, for the window.
func (s *Service) Get(ctx context.Context, email string) (Mine, error) {
	from, to := s.Window()
	m := Mine{From: from, To: to, Days: []Day{}, Templates: []Template{}, Venues: []string{}}
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT to_char(day, 'YYYY-MM-DD'), from_min, to_min FROM availability_spans
			  WHERE email = $1 AND day BETWEEN $2::date AND $3::date ORDER BY day, from_min`, email, from, to)
		if err != nil {
			return err
		}
		var day string
		var sp Span
		if _, err := pgx.ForEachRow(rows, []any{&day, &sp.From, &sp.To}, func() error {
			if n := len(m.Days); n == 0 || m.Days[n-1].Day != day {
				m.Days = append(m.Days, Day{Day: day})
			}
			m.Days[len(m.Days)-1].Spans = append(m.Days[len(m.Days)-1].Spans, sp)
			return nil
		}); err != nil {
			return err
		}
		rows, err = tx.Query(ctx,
			`SELECT weekday, from_min, to_min FROM availability_templates WHERE email = $1 ORDER BY weekday, from_min`, email)
		if err != nil {
			return err
		}
		var wd int
		if _, err := pgx.ForEachRow(rows, []any{&wd, &sp.From, &sp.To}, func() error {
			if n := len(m.Templates); n == 0 || m.Templates[n-1].Weekday != wd {
				m.Templates = append(m.Templates, Template{Weekday: wd})
			}
			m.Templates[len(m.Templates)-1].Spans = append(m.Templates[len(m.Templates)-1].Spans, sp)
			return nil
		}); err != nil {
			return err
		}
		rows, err = tx.Query(ctx, `SELECT venue_id FROM venue_choices WHERE email = $1 ORDER BY venue_id`, email)
		if err != nil {
			return err
		}
		m.Venues, err = pgx.CollectRows(rows, pgx.RowTo[string])
		return err
	})
	return m, err
}

// write runs fn once per Idempotency-Key.
func (s *Service) write(ctx context.Context, email, key, op string, body any, fn func(pgx.Tx) error) error {
	hash, err := idempotency.Hash(op, body)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, email, op, hash)
		if err != nil || claim.Replay {
			return err
		}
		if err := fn(tx); err != nil {
			return err
		}
		return idempotency.Complete(ctx, tx, key, op)
	})
}

// SetDay replaces the spans of one day; none clears it.
func (s *Service) SetDay(ctx context.Context, email, key, day string, spans []Span) ([]Span, error) {
	if !s.inWindow(day) {
		return nil, ErrOutside
	}
	merged, err := Merge(spans)
	if err != nil {
		return nil, err
	}
	err = s.write(ctx, email, key, "availability-day", []any{day, merged}, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM availability_spans WHERE email = $1 AND day = $2::date`, email, day); err != nil {
			return err
		}
		for _, sp := range merged {
			if _, err := tx.Exec(ctx,
				`INSERT INTO availability_spans (email, day, from_min, to_min) VALUES ($1, $2::date, $3, $4)`,
				email, day, sp.From, sp.To); err != nil {
				return err
			}
		}
		return nil
	})
	return merged, err
}

// SetTemplates replaces every weekday's usual spans.
func (s *Service) SetTemplates(ctx context.Context, email, key string, templates []Template) ([]Template, error) {
	byDay := map[int][]Span{}
	for _, t := range templates {
		if t.Weekday < 1 || t.Weekday > 7 {
			return nil, ErrInvalid
		}
		byDay[t.Weekday] = append(byDay[t.Weekday], t.Spans...)
	}
	out := []Template{}
	for wd := 1; wd <= 7; wd++ {
		if len(byDay[wd]) == 0 {
			continue
		}
		merged, err := Merge(byDay[wd])
		if err != nil {
			return nil, err
		}
		out = append(out, Template{Weekday: wd, Spans: merged})
	}
	err := s.write(ctx, email, key, "availability-templates", out, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM availability_templates WHERE email = $1`, email); err != nil {
			return err
		}
		for _, t := range out {
			for _, sp := range t.Spans {
				if _, err := tx.Exec(ctx,
					`INSERT INTO availability_templates (email, weekday, from_min, to_min) VALUES ($1, $2, $3, $4)`,
					email, t.Weekday, sp.From, sp.To); err != nil {
					return err
				}
			}
		}
		return nil
	})
	return out, err
}

// SetVenues replaces the venues someone drives to; none means every venue.
func (s *Service) SetVenues(ctx context.Context, email, key string, venues []string) ([]string, error) {
	out := slices.Clone(venues)
	slices.Sort(out)
	out = slices.Compact(out)
	for _, v := range out {
		if !s.known(v) {
			return nil, fmt.Errorf("%w: %q", ErrUnknownVenue, v)
		}
	}
	if out == nil {
		out = []string{}
	}
	err := s.write(ctx, email, key, "venues", out, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM venue_choices WHERE email = $1`, email); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO venue_choices (email, venue_id) SELECT $1, unnest($2::text[])`, email, out)
		return err
	})
	return out, err
}

// Entered is, per address, on how many days of the window it has spans.
// Addresses with none are left out.
func (s *Service) Entered(ctx context.Context, emails []string) (map[string]int, error) {
	from, to := s.Window()
	rows, err := s.pool.Query(ctx,
		`SELECT email, count(DISTINCT day) FROM availability_spans
		  WHERE email = ANY($1::text[]) AND day BETWEEN $2::date AND $3::date GROUP BY email`, emails, from, to)
	if err != nil {
		return nil, err
	}
	out := map[string]int{}
	var e string
	var n int
	_, err = pgx.ForEachRow(rows, []any{&e, &n}, func() error {
		out[e] = n
		return nil
	})
	return out, err
}
