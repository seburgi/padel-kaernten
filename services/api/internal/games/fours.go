package games

import (
	"slices"
	"sort"
)

// Why a half hour where four can has no game (docs/design/games.md, "Wer
// kann wann").
const (
	// WhyShort: four can, but never the same four for a whole hour.
	WhyShort = "short"
	// WhyVenues: a court of the group's area is free, but fewer than four
	// of those who can drive there.
	WhyVenues = "venues"
	// WhyArea: only courts outside the group's area are free.
	WhyArea = "area"
	// WhyNone: no court is free at all.
	WhyNone = "none"
)

// Step is the half hour the grid of "Wer kann wann" counts in.
const Step = 30

// HalfHour is one half hour of a day, from Start, in which at least need
// members can play. Fits says a game of some length with a free court
// covers it; otherwise Why says what is missing. Venues are, for
// WhyVenues, the venues of the area with a court free; for WhyArea, those
// outside it; for WhyNone, the venues of the area that take no bookings for
// the day yet.
type HalfHour struct {
	Day    string
	Start  int
	Can    []string
	Fits   bool
	Why    string
	Venues []string
}

// Fours is every half hour in the window where need members can, and for
// each whether a game fits and, if not, why. venues are the courts of the
// group's area, outside the others (both as Fits takes them). Pure, like
// Fits.
func Fours(venues, outside []Venue, people []Person, need int, w Window) []HalfHour {
	var fits []Fit
	for _, m := range Durations {
		f, _ := all(venues, people, m, need, w)
		fits = append(fits, f...)
	}
	days := map[string]bool{}
	for _, p := range people {
		for d := range p.Days {
			if d >= w.Today {
				days[d] = true
			}
		}
	}
	var out []HalfHour
	for _, day := range sorted(days) {
		for t := 0; t < 24*60; t += Step {
			if day == w.Today && t < w.NotBefore {
				continue
			}
			can := free(people, day, t, t+Step)
			if len(can) < need {
				continue
			}
			h := HalfHour{Day: day, Start: t, Can: can, Venues: []string{}}
			if slices.ContainsFunc(fits, func(f Fit) bool {
				return f.Day == day && f.Start < t+Step && t < f.Start+f.Minutes
			}) {
				h.Fits = true
				out = append(out, h)
				continue
			}
			wins := windows(people, need, w, day, t)
			switch {
			case len(wins) == 0:
				h.Why = WhyShort
			case len(open(venues, day, wins)) > 0:
				h.Why, h.Venues = WhyVenues, open(venues, day, wins)
			case len(open(outside, day, wins)) > 0:
				h.Why, h.Venues = WhyArea, open(outside, day, wins)
			default:
				h.Why, h.Venues = WhyNone, later(venues, day)
			}
			out = append(out, h)
		}
	}
	return out
}

func sorted(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// free are the people free for all of from..to on day, wherever they drive.
func free(people []Person, day string, from, to int) []string {
	out := []string{}
	for _, p := range people {
		if p.Declined[day] {
			continue
		}
		for _, s := range p.Days[day] {
			if s.From <= from && to <= s.To {
				out = append(out, p.Email)
				break
			}
		}
	}
	return out
}

type span struct{ from, to int }

// windows are the games of every length, on the half hour, that cover the
// half hour from t and that need people are free for all of.
func windows(people []Person, need int, w Window, day string, t int) []span {
	var out []span
	for _, m := range Durations {
		for s := t + Step - m; s <= t; s += Step {
			if s < 0 || s+m > 24*60 || (day == w.Today && s < w.NotBefore) {
				continue
			}
			if len(free(people, day, s, s+m)) >= need {
				out = append(out, span{s, s + m})
			}
		}
	}
	return out
}

// open are the venues with a court free for one of games on day.
func open(venues []Venue, day string, games []span) []string {
	out := []string{}
	for _, v := range venues {
		if v.Failed || slices.Contains(v.NotBookable, day) {
			continue
		}
		if slices.ContainsFunc(v.Courts, func(c Court) bool {
			return slices.ContainsFunc(blocks(c.Free), func(b block) bool {
				return b.day == day && slices.ContainsFunc(games, func(g span) bool {
					return b.from <= g.from && g.to <= b.to
				})
			})
		}) {
			out = append(out, v.Name)
		}
	}
	return out
}

// later are the venues that take no bookings for day yet.
func later(venues []Venue, day string) []string {
	out := []string{}
	for _, v := range venues {
		if !v.Failed && slices.Contains(v.NotBookable, day) {
			out = append(out, v.Name)
		}
	}
	return out
}
