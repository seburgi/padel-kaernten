// Package slots is the free courts: the latest snapshot of what the booking
// sites show, and a refresh that asks them again at most every five minutes
// (docs/design/slots.md). There is no schedule; the app asks when it opens.
package slots

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots/sites"
)

// MinAge is how old the latest snapshot must be before a refresh asks the
// booking sites again (Seb, 2026-10-27): the sites are other people's, and
// a court booked in the last five minutes is rare.
const MinAge = 5 * time.Minute

// TakeTimeout bounds one round of asking every site.
const TakeTimeout = 90 * time.Second

var (
	// ErrNone means no snapshot was taken yet.
	ErrNone = errors.New("no snapshot yet")
	// ErrSitesFailed means every booking site failed; the last snapshot stays.
	ErrSitesFailed = errors.New("every booking site failed")
)

// Snapshot is a snapshot as the API hands it out: the JSON of a
// sites.Snapshot and when it was taken.
type Snapshot struct {
	JSON    []byte
	TakenAt time.Time
}

// Taker asks the booking sites (sites.Client).
type Taker interface {
	Take(ctx context.Context) (sites.Snapshot, []error, error)
}

// Service keeps and refreshes the snapshot.
type Service struct {
	pool  *pgxpool.Pool
	sites Taker
	now   func() time.Time
	log   *slog.Logger

	// refreshing lets one refresh ask the sites at a time; the others wait
	// and then find a fresh snapshot. The service runs one instance
	// (app-padel.tf); the save only ever replaces an older snapshot, so a
	// second instance could at worst ask twice.
	refreshing sync.Mutex
}

// NewService is the slots service; now nil is time.Now.
func NewService(pool *pgxpool.Pool, s Taker, now func() time.Time, log *slog.Logger) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{pool: pool, sites: s, now: now, log: log}
}

// Latest is the newest snapshot, or ErrNone.
func (s *Service) Latest(ctx context.Context) (Snapshot, error) {
	return latest(ctx, s.pool)
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func latest(ctx context.Context, q querier) (Snapshot, error) {
	var snap Snapshot
	err := q.QueryRow(ctx, `SELECT data::text, taken_at FROM snapshot WHERE id = 1`).Scan(&snap.JSON, &snap.TakenAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Snapshot{}, ErrNone
	}
	if err != nil {
		return Snapshot{}, fmt.Errorf("read the snapshot: %w", err)
	}
	return snap, nil
}

// Refresh answers a snapshot at most MinAge old, asking the booking sites
// when the latest is older. key is the call's Idempotency-Key and who the
// person calling: the same key again answers the latest snapshot without
// asking.
func (s *Service) Refresh(ctx context.Context, who, key string) (Snapshot, error) {
	s.refreshing.Lock()
	defer s.refreshing.Unlock()

	hash, err := idempotency.Hash("refreshSlots", struct{}{})
	if err != nil {
		return Snapshot{}, err
	}
	var out Snapshot
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, who, "refreshSlots", hash)
		if err != nil {
			return err
		}
		current, err := latest(ctx, tx)
		if err != nil && !errors.Is(err, ErrNone) {
			return err
		}
		if claim.Replay || (err == nil && s.now().Sub(current.TakenAt) < MinAge) {
			if err != nil {
				return err
			}
			out = current
			if claim.Replay {
				return nil
			}
			return idempotency.Complete(ctx, tx, key, current.TakenAt.UTC().Format(time.RFC3339))
		}

		takeCtx, cancel := context.WithTimeout(ctx, TakeTimeout)
		defer cancel()
		snap, failed, err := s.sites.Take(takeCtx)
		for _, f := range failed {
			s.log.WarnContext(ctx, "a booking site failed", "error", f)
		}
		if err != nil {
			return fmt.Errorf("%w: %w", ErrSitesFailed, err)
		}
		data, err := json.Marshal(snap)
		if err != nil {
			return err
		}
		// Only ever replace an older snapshot.
		if _, err := tx.Exec(ctx, `
			INSERT INTO snapshot (id, data, taken_at) VALUES (1, $1::json, $2)
			ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, taken_at = EXCLUDED.taken_at
			WHERE snapshot.taken_at < EXCLUDED.taken_at`, string(data), snap.TakenAt); err != nil {
			return fmt.Errorf("save the snapshot: %w", err)
		}
		if out, err = latest(ctx, tx); err != nil {
			return err
		}
		s.log.InfoContext(ctx, "refreshed", "venues", len(snap.Venues), "failed", len(failed))
		return idempotency.Complete(ctx, tx, key, out.TakenAt.UTC().Format(time.RFC3339))
	})
	return out, err
}
