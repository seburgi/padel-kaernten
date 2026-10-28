// Package games is playing together (docs/design/games.md): the fits, games
// of four that the free courts and the members' times allow, computed on
// request and never stored; and games proposed from them, the people who
// say yes, the reserves, and whether it is booked. Who may see a game is
// read through the view game_visibility: the members of its group.
package games

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"time"
	_ "time/tzdata" // the image has no zoneinfo

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
)

var (
	// ErrNotFound means the game or group does not exist, or the caller is
	// not a member.
	ErrNotFound = errors.New("no such game")
	// ErrForbidden means only whoever proposed the game may do this.
	ErrForbidden = errors.New("not allowed for this game")
	// ErrInvalid means a duration, answer or state the app does not take.
	ErrInvalid = errors.New("invalid game")
	// ErrGone means the court is no longer free for the whole game.
	ErrGone = errors.New("the court is no longer free")
	// ErrClosed means the game is cancelled or over.
	ErrClosed = errors.New("the game is closed")
)

// Players is how many play a game of padel.
const Players = 4

// The states of a game, and of a player in it.
const (
	Proposed  = "proposed"
	Booked    = "booked"
	Cancelled = "cancelled"

	In      = "in"
	Reserve = "reserve"
	Out     = "out"
)

// Player is one answer to a game, in the order given.
type Player struct {
	Email      string
	State      string
	AnsweredAt time.Time
}

// Game is a proposed game and who answered.
type Game struct {
	ID         int64
	GroupID    int64
	VenueID    string
	VenueName  string
	Court      string
	Day        string
	Start      int
	Minutes    int
	Players    int
	PriceCents *int
	State      string
	ProposedBy string
	CreatedAt  time.Time
	BookedAt   *time.Time
	Lineup     []Player
}

var vienna = mustZone("Europe/Vienna")

func mustZone(name string) *time.Location {
	l, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return l
}

// What happened to a game, for whoever wants to tell people (Event.Kind).
const (
	EventProposed  = "proposed"
	EventFull      = "full"
	EventMovedUp   = "moved-up"
	EventBooked    = "booked"
	EventCancelled = "cancelled"
)

// Event is something people may want to hear of: Game as it is after,
// Who whoever it is about (who moved up), Key the write's Idempotency-Key.
type Event struct {
	Kind string
	Game Game
	Who  string
	Key  string
}

// Service keeps the games.
type Service struct {
	pool *pgxpool.Pool
	// Now is the clock; nil is time.Now.
	Now func() time.Time
	// Changed hears of each event once the write is in; a retried request
	// that changes nothing tells it nothing. It must not fail the write.
	Changed func(context.Context, Event)
}

func (s *Service) tell(ctx context.Context, g Game, key string, events []Event) {
	if s.Changed == nil {
		return
	}
	for _, e := range events {
		e.Game, e.Key = g, key
		s.Changed(ctx, e)
	}
}

// NewService is the games service.
func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Window is now in Vienna: today, and the minute a start must not be
// before today.
func (s *Service) Window() Window {
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	t := now().In(vienna)
	return Window{Today: t.Format(time.DateOnly), NotBefore: t.Hour()*60 + t.Minute()}
}

const columns = `g.id, g.group_id, g.venue_id, g.venue_name, g.court, to_char(g.day, 'YYYY-MM-DD'),
	g.start_min, g.minutes, g.players, g.price_cents, g.state, g.proposed_by, g.created_at, g.booked_at`

func scan(row pgx.Row) (Game, error) {
	var g Game
	err := row.Scan(&g.ID, &g.GroupID, &g.VenueID, &g.VenueName, &g.Court, &g.Day, &g.Start, &g.Minutes,
		&g.Players, &g.PriceCents, &g.State, &g.ProposedBy, &g.CreatedAt, &g.BookedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Game{}, ErrNotFound
	}
	return g, err
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func lineup(ctx context.Context, q querier, g *Game) error {
	rows, err := q.Query(ctx,
		`SELECT email, state, answered_at FROM game_players WHERE game_id = $1 ORDER BY answered_at, email`, g.ID)
	if err != nil {
		return err
	}
	g.Lineup, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Player, error) {
		var p Player
		return p, r.Scan(&p.Email, &p.State, &p.AnsweredAt)
	})
	return err
}

func get(ctx context.Context, q querier, viewer string, id int64) (Game, error) {
	g, err := scan(q.QueryRow(ctx, `SELECT `+columns+` FROM games g
		JOIN game_visibility v ON v.game_id = g.id AND v.viewer = $1 WHERE g.id = $2`, viewer, id))
	if err != nil {
		return Game{}, err
	}
	return g, lineup(ctx, q, &g)
}

// Get is one game, for a member of its group.
func (s *Service) Get(ctx context.Context, viewer string, id int64) (Game, error) {
	return get(ctx, s.pool, viewer, id)
}

// Upcoming are the games of viewer's groups from today on that are not
// cancelled, soonest first; group 0 means every group.
func (s *Service) Upcoming(ctx context.Context, viewer string, group int64) ([]Game, error) {
	today := s.Window().Today
	var out []Game
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+columns+` FROM games g
			JOIN game_visibility v ON v.game_id = g.id AND v.viewer = $1
			WHERE g.day >= $2::date AND g.state <> 'cancelled' AND ($3 = 0 OR g.group_id = $3)
			ORDER BY g.day, g.start_min, g.id`, viewer, today, group)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Game, error) { return scan(r) })
		if err != nil {
			return err
		}
		for i := range out {
			if err := lineup(ctx, tx, &out[i]); err != nil {
				return err
			}
		}
		return nil
	})
	if out == nil {
		out = []Game{}
	}
	return out, err
}

// Proposal is the fit someone proposes.
type Proposal struct {
	VenueID string
	Court   string
	Day     string
	Start   int
	Minutes int
}

// Propose makes a game of a fit in group, with who, a member, playing.
// The court must still be free for the whole game in venues, the latest
// snapshot; its price is taken from there.
func (s *Service) Propose(ctx context.Context, who, key string, group int64, p Proposal, venues []Venue) (Game, error) {
	if !slices.Contains(Durations, p.Minutes) {
		return Game{}, ErrInvalid
	}
	venue, cents, err := stillFree(venues, p, s.Window())
	if err != nil {
		return Game{}, err
	}
	hash, err := idempotency.Hash("propose-game", []any{group, p})
	if err != nil {
		return Game{}, err
	}
	var id int64
	var events []Event
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, who, "propose-game", hash)
		if err != nil {
			return err
		}
		if claim.Replay {
			id, err = strconv.ParseInt(claim.ResourceID, 10, 64)
			return err
		}
		var member bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM memberships WHERE group_id = $1 AND email = $2)`, group, who).Scan(&member); err != nil {
			return err
		}
		if !member {
			return ErrNotFound
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO games (group_id, venue_id, venue_name, court, day, start_min, minutes, players, price_cents, proposed_by)
			VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10) RETURNING id`,
			group, venue.ID, venue.Name, p.Court, p.Day, p.Start, p.Minutes, Players, cents, who).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO game_players (game_id, email, state) VALUES ($1, $2, 'in')`, id, who); err != nil {
			return err
		}
		events = []Event{{Kind: EventProposed, Who: who}}
		return idempotency.Complete(ctx, tx, key, strconv.FormatInt(id, 10))
	})
	if err != nil {
		return Game{}, err
	}
	g, err := s.Get(ctx, who, id)
	if err == nil {
		s.tell(ctx, g, key, events)
	}
	return g, err
}

// stillFree finds the proposal's venue and its price when the court is
// free for the whole game and the start is not past.
func stillFree(venues []Venue, p Proposal, w Window) (Venue, *int, error) {
	if p.Day < w.Today || (p.Day == w.Today && p.Start < w.NotBefore) {
		return Venue{}, nil, ErrGone
	}
	for _, v := range venues {
		if v.ID != p.VenueID || v.Failed {
			continue
		}
		for _, c := range v.Courts {
			if c.Name != p.Court {
				continue
			}
			for _, b := range blocks(c.Free) {
				if b.day == p.Day && b.from <= p.Start && p.Start+p.Minutes <= b.to {
					return v, price(b.parts, p.Start, p.Start+p.Minutes), nil
				}
			}
		}
	}
	return Venue{}, nil, ErrGone
}

// write runs fn once per Idempotency-Key, on a game who may see, and
// answers the game as it is after.
func (s *Service) write(ctx context.Context, who, key, op string, id int64, body any, fn func(pgx.Tx, Game) ([]Event, error)) (Game, error) {
	hash, err := idempotency.Hash(op, []any{id, body})
	if err != nil {
		return Game{}, err
	}
	var events []Event
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, who, op, hash)
		if err != nil || claim.Replay {
			return err
		}
		g, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM games g
			JOIN game_visibility v ON v.game_id = g.id AND v.viewer = $1 WHERE g.id = $2 FOR UPDATE OF g`, who, id))
		if err != nil {
			return err
		}
		if events, err = fn(tx, g); err != nil {
			return err
		}
		return idempotency.Complete(ctx, tx, key, strconv.FormatInt(id, 10))
	})
	if err != nil {
		return Game{}, err
	}
	g, err := s.Get(ctx, who, id)
	if err == nil {
		s.tell(ctx, g, key, events)
	}
	return g, err
}

// Answer is who saying yes (in) or no (out). A yes when the game is full
// makes a reserve; a no from someone playing lets the first reserve in.
func (s *Service) Answer(ctx context.Context, who, key string, id int64, answer string) (Game, error) {
	today := s.Window().Today
	if answer != In && answer != Out {
		return Game{}, ErrInvalid
	}
	return s.write(ctx, who, key, "answer-game", id, answer, func(tx pgx.Tx, g Game) ([]Event, error) {
		if g.State == Cancelled || g.Day < today {
			return nil, ErrClosed
		}
		var was string
		err := tx.QueryRow(ctx, `SELECT state FROM game_players WHERE game_id = $1 AND email = $2`, id, who).Scan(&was)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if answer == In && (was == In || was == Reserve) || answer == Out && was == Out {
			return nil, nil
		}
		state := Out
		var events []Event
		if answer == In {
			var playing int
			if err := tx.QueryRow(ctx,
				`SELECT count(*) FROM game_players WHERE game_id = $1 AND state = 'in'`, id).Scan(&playing); err != nil {
				return nil, err
			}
			state = In
			switch {
			case playing >= g.Players:
				state = Reserve
			case playing+1 == g.Players:
				events = append(events, Event{Kind: EventFull, Who: who})
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO game_players (game_id, email, state) VALUES ($1, $2, $3)
			ON CONFLICT (game_id, email) DO UPDATE SET state = $3, answered_at = now()`, id, who, state); err != nil {
			return nil, err
		}
		if was != In {
			return events, nil
		}
		var moved string
		err = tx.QueryRow(ctx, `
				UPDATE game_players SET state = 'in' WHERE (game_id, email) = (
					SELECT game_id, email FROM game_players WHERE game_id = $1 AND state = 'reserve'
					 ORDER BY answered_at, email LIMIT 1)
				RETURNING email`, id).Scan(&moved)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return events, nil
		case err != nil:
			return nil, err
		}
		return append(events, Event{Kind: EventMovedUp, Who: moved}), nil
	})
}

// SetState books or cancels a game; only whoever proposed it may.
func (s *Service) SetState(ctx context.Context, who, key string, id int64, state string) (Game, error) {
	if state != Booked && state != Cancelled {
		return Game{}, ErrInvalid
	}
	return s.write(ctx, who, key, "game-state", id, state, func(tx pgx.Tx, g Game) ([]Event, error) {
		if g.ProposedBy != who {
			return nil, ErrForbidden
		}
		if g.State == Cancelled {
			return nil, ErrClosed
		}
		if g.State == state {
			return nil, nil
		}
		_, err := tx.Exec(ctx, `
			UPDATE games SET state = $2, booked_at = CASE WHEN $2 = 'booked' THEN coalesce(booked_at, now()) ELSE booked_at END
			 WHERE id = $1`, id, state)
		if err != nil {
			return nil, err
		}
		kind := EventBooked
		if state == Cancelled {
			kind = EventCancelled
		}
		return []Event{{Kind: kind, Who: who}}, nil
	})
}
