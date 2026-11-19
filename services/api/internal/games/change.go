package games

// Changing a game afterwards (docs/design/games.md, Seb 2026-11-18): whoever
// proposed it moves it to another time, venue or court, takes someone out,
// or cancels it with a reason (SetState). Nobody's times are entered for
// them: whether someone would have time is only shown.

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// MaxMoves is how many free times Moves hands back at most.
const MaxMoves = 300

// Moves are the free courts g could move to in venues, the latest snapshot
// with only the courts of the group's area: every start on the venue's step
// where a court is free for minutes, from now on, one court per venue and
// start, except at g's own venue and time, where every other court is one.
// The days the group has another game are for the caller to leave out.
// Ordered by day, start and price. Pure: everything comes in.
func Moves(venues []Venue, g Game, minutes int, w Window) []Fit {
	seen := map[string]bool{}
	out := []Fit{}
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
					here := v.ID == g.VenueID && b.day == g.Day && t == g.Start && minutes == g.Minutes
					if here && c.Name == g.Court {
						continue
					}
					key := fmt.Sprintf("%s|%s|%d", b.day, v.ID, t)
					if here {
						key += "|" + c.Name
					}
					if seen[key] {
						continue
					}
					seen[key] = true
					out = append(out, Fit{Day: b.day, Start: t, Minutes: minutes, VenueID: v.ID, VenueName: v.Name,
						Court: c.Name, PriceCents: price(b.parts, t, t+minutes), Can: []string{}, Ask: []string{}})
				}
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Day != b.Day {
			return a.Day < b.Day
		}
		if a.Start != b.Start {
			return a.Start < b.Start
		}
		return cheaper(a.PriceCents, b.PriceCents)
	})
	return out[:min(len(out), MaxMoves)]
}

// Move puts a game at p, a court the latest snapshot (venues) shows free
// for all of it; only whoever proposed it may. Another court at the same
// venue and time keeps every answer. A new time or venue asks whoever was
// in again: their places stay theirs until they answer, those who said no
// are asked again (their answer is dropped), the reserves stay reserves, and
// a booked game is proposed again, to be booked anew. note goes to the
// others.
func (s *Service) Move(ctx context.Context, who, key string, id int64, p Proposal, note string, venues []Venue) (Game, error) {
	note = strings.TrimSpace(note)
	if !slices.Contains(Durations, p.Minutes) || utf8.RuneCountInString(note) > MaxNote {
		return Game{}, ErrInvalid
	}
	w := s.Window()
	venue, cents, err := stillFree(venues, p, w)
	if err != nil {
		return Game{}, err
	}
	return s.write(ctx, who, key, "move-game", id, []any{p, note}, func(tx pgx.Tx, g Game) ([]Event, error) {
		if err := mayChange(g, who, w.Today); err != nil {
			return nil, err
		}
		same := g.VenueID == p.VenueID && g.Day == p.Day && g.Start == p.Start && g.Minutes == p.Minutes
		if same && g.Court == p.Court {
			return nil, nil
		}
		if g.Day != p.Day {
			var taken bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM games WHERE group_id = $1 AND day = $2::date
				AND state <> 'cancelled' AND id <> $3)`, g.GroupID, p.Day, id).Scan(&taken); err != nil {
				return nil, err
			}
			if taken {
				return nil, ErrDayTaken
			}
		}
		if _, err := tx.Exec(ctx, `
			UPDATE games SET venue_id = $2, venue_name = $3, court = $4, day = $5::date, start_min = $6, minutes = $7,
			       price_cents = $8, changed_at = now(), change_note = nullif($9, ''),
			       before_day = day, before_start = start_min, before_minutes = minutes,
			       before_venue_name = venue_name, before_court = court,
			       state = CASE WHEN $10 THEN state ELSE 'proposed' END,
			       booked_at = CASE WHEN $10 THEN booked_at ELSE NULL END,
			       code = CASE WHEN $10 THEN code ELSE NULL END
			 WHERE id = $1`,
			id, venue.ID, venue.Name, p.Court, p.Day, p.Start, p.Minutes, cents, note, same); err != nil {
			return nil, err
		}
		if same {
			return []Event{{Kind: EventCourtChanged, Who: who}}, nil
		}
		if _, err := tx.Exec(ctx, `UPDATE game_players SET state = 'asked'
			 WHERE game_id = $1 AND state = 'in' AND email <> $2`, id, who); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM game_players WHERE game_id = $1 AND state = 'out'`, id); err != nil {
			return nil, err
		}
		return []Event{{Kind: EventMoved, Who: who}}, nil
	})
}

// Remove takes email out of a game, for someone who told whoever proposed
// it that they cannot come; only that person may, and never themselves.
// It counts as their no: the first reserve moves up into a place they held.
func (s *Service) Remove(ctx context.Context, who, key string, id int64, email string) (Game, error) {
	today := s.Window().Today
	if email == "" || email == who {
		return Game{}, ErrInvalid
	}
	return s.write(ctx, who, key, "game-remove", id, email, func(tx pgx.Tx, g Game) ([]Event, error) {
		if err := mayChange(g, who, today); err != nil {
			return nil, err
		}
		var was string
		err := tx.QueryRow(ctx, `SELECT state FROM game_players WHERE game_id = $1 AND email = $2`, id, email).Scan(&was)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && was == Out {
			return nil, ErrNotPlaying
		}
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `UPDATE game_players SET state = 'out', answered_at = now()
			 WHERE game_id = $1 AND email = $2`, id, email); err != nil {
			return nil, err
		}
		events := []Event{{Kind: EventRemoved, Who: email}}
		if was == Reserve {
			return events, nil
		}
		return moveUp(ctx, tx, id, events)
	})
}
