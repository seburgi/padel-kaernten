package idempotency_test

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
)

func TestReap_deletesKeysOlderThanAWeek(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := t.Context()
	if _, err := pool.Exec(ctx, `INSERT INTO idempotency_keys (key, owner_uid, operation, request_hash, created_at) VALUES
		('6c9b2824-b0cd-4c0b-9052-83d9f457e086', 'a', 'op', '\x00', now() - interval '8 days'),
		('6c9b2824-b0cd-4c0b-9052-83d9f457e087', 'a', 'op', '\x00', now() - interval '6 days')`); err != nil {
		t.Fatal(err)
	}
	if n, err := idempotency.Reap(ctx, pool); err != nil || n != 1 {
		t.Errorf("reaped %d, %v", n, err)
	}
}

func TestBegin_aFirstAttemptStillInFlightIsAConflict(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := t.Context()
	hash, err := idempotency.Hash("op", map[string]string{"a": "b"})
	if err != nil {
		t.Fatal(err)
	}
	key := "6c9b2824-b0cd-4c0b-9052-83d9f457e088"
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		_, err := idempotency.Begin(ctx, tx, key, "a", "op", hash)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		_, err := idempotency.Begin(ctx, tx, key, "a", "op", hash)
		return err
	})
	if !errors.Is(err, idempotency.ErrKeyReused) {
		t.Errorf("got %v", err)
	}
}

func TestComplete_letsTheSameRequestReplay(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := t.Context()
	hash, _ := idempotency.Hash("op", 1)
	key := "6c9b2824-b0cd-4c0b-9052-83d9f457e089"
	if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := idempotency.Begin(ctx, tx, key, "a", "op", hash); err != nil {
			return err
		}
		return idempotency.Complete(ctx, tx, key, "r1")
	}); err != nil {
		t.Fatal(err)
	}
	var claim idempotency.Claim
	if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) (err error) {
		claim, err = idempotency.Begin(ctx, tx, key, "a", "op", hash)
		return err
	}); err != nil || !claim.Replay || claim.ResourceID != "r1" {
		t.Errorf("%v %+v", err, claim)
	}
	if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		_, err := idempotency.Begin(ctx, tx, key, "b", "op", hash)
		return err
	}); !errors.Is(err, idempotency.ErrKeyReused) {
		t.Errorf("another owner: %v", err)
	}
}
