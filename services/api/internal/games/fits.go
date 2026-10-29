package games

import (
	"fmt"
	"slices"
	"sort"
)

// Slot is a free stretch on one court and day, in minutes after midnight
// in Vienna, with the whole court's price per hour in cents when known.
type Slot struct {
	Day          string
	From, To     int
	PricePerHour *int
}

// Court is one court's free slots.
type Court struct {
	Name string
	Free []Slot
}

// Venue is what the games slice needs of one venue in the snapshot;
// transport fills it from slots.
type Venue struct {
	ID, Name    string
	Step        int
	Failed      bool
	NotBookable []string
	Links       map[string]string
	Courts      []Court
}

// Span is a stretch someone can play, in minutes after midnight.
type Span struct{ From, To int }

// Person is a member as the fits see them: when they can, per day
// (YYYY-MM-DD), the days they said do not suit, and where they drive to,
// none meaning every venue.
type Person struct {
	Email    string
	Days     map[string][]Span
	Declined map[string]bool
	Venues   []string
}

// Fit is a game that fits: a court free for the whole game while the
// people in Can are all free. Ask, on a near miss, are the members who
// entered nothing for that day, not even "passt nicht", and drive there.
type Fit struct {
	Day            string
	Start, Minutes int
	VenueID        string
	VenueName      string
	Court          string
	PriceCents     *int
	Can            []string
	Ask            []string
}

// How many fits and near misses at most come back.
const (
	MaxFits   = 40
	MaxNearly = 10
)

// Durations a game may last.
var Durations = []int{60, 90, 120}

// Window says which starts count: days from Today on, and on Today only
// starts at or after NotBefore minutes.
type Window struct {
	Today     string
	NotBefore int
}

// Fits finds the games of minutes that need people can play, at a court
// free for the whole game (docs/design/games.md), and the near misses one
// short of need with members to ask. Pure: everything comes in.
func Fits(venues []Venue, people []Person, minutes, need int, w Window) (fits, nearly []Fit) {
	seen := map[string]bool{}
	for _, v := range venues {
		if v.Failed {
			continue
		}
		grid := v.Step
		if grid <= 0 {
			grid = 30
		}
		for _, c := range v.Courts {
			for _, b := range blocks(c.Free) {
				if b.day < w.Today || slices.Contains(v.NotBookable, b.day) {
					continue
				}
				for t := b.from; t+minutes <= b.to; t += grid {
					if b.day == w.Today && t < w.NotBefore {
						continue
					}
					key := fmt.Sprintf("%s|%s|%d", b.day, v.ID, t)
					if seen[key] {
						continue
					}
					can, ask := who(people, v.ID, b.day, t, t+minutes)
					f := Fit{Day: b.day, Start: t, Minutes: minutes, VenueID: v.ID, VenueName: v.Name,
						Court: c.Name, PriceCents: price(b.parts, t, t+minutes), Can: can}
					switch {
					case len(can) >= need:
						seen[key] = true
						fits = append(fits, f)
					case len(can) == need-1 && len(ask) > 0:
						seen[key] = true
						f.Ask = ask
						nearly = append(nearly, f)
					}
				}
			}
		}
	}
	order(fits)
	order(nearly)
	return limit(fits, MaxFits), limit(nearly, MaxNearly)
}

type block struct {
	day      string
	from, to int
	parts    []Slot
}

// blocks joins a court's slots that touch on the same day.
func blocks(free []Slot) []block {
	var out []block
	for _, s := range free {
		if n := len(out); n > 0 && out[n-1].day == s.Day && out[n-1].to == s.From {
			out[n-1].to = s.To
			out[n-1].parts = append(out[n-1].parts, s)
			continue
		}
		out = append(out, block{day: s.Day, from: s.From, to: s.To, parts: []Slot{s}})
	}
	return out
}

// price is the whole game's price in cents, or nil when a part has none.
func price(parts []Slot, from, to int) *int {
	cents := 0.0
	for _, p := range parts {
		overlap := min(p.To, to) - max(p.From, from)
		if overlap <= 0 {
			continue
		}
		if p.PricePerHour == nil {
			return nil
		}
		cents += float64(*p.PricePerHour) * float64(overlap) / 60
	}
	n := int(cents + 0.5)
	return &n
}

func drives(p Person, venue string) bool {
	return len(p.Venues) == 0 || slices.Contains(p.Venues, venue)
}

// who are the people free for all of from..to on day who drive to venue,
// and those who drive there but entered nothing for day.
func who(people []Person, venue, day string, from, to int) (can, ask []string) {
	can, ask = []string{}, []string{}
	for _, p := range people {
		if !drives(p, venue) {
			continue
		}
		if p.Declined[day] {
			continue
		}
		spans := p.Days[day]
		if len(spans) == 0 {
			ask = append(ask, p.Email)
			continue
		}
		for _, s := range spans {
			if s.From <= from && to <= s.To {
				can = append(can, p.Email)
				break
			}
		}
	}
	return can, ask
}

// order sorts by how many can, then by when, then by the price.
func order(fits []Fit) {
	sort.SliceStable(fits, func(i, j int) bool {
		a, b := fits[i], fits[j]
		if len(a.Can) != len(b.Can) {
			return len(a.Can) > len(b.Can)
		}
		if a.Day != b.Day {
			return a.Day < b.Day
		}
		if a.Start != b.Start {
			return a.Start < b.Start
		}
		return cheaper(a.PriceCents, b.PriceCents)
	})
}

func cheaper(a, b *int) bool {
	switch {
	case a == nil:
		return false
	case b == nil:
		return true
	}
	return *a < *b
}

func limit(fits []Fit, n int) []Fit {
	if fits == nil {
		return []Fit{}
	}
	return fits[:min(len(fits), n)]
}
