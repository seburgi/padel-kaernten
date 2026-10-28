// Package idempotency (from Billomatic) claims and completes Idempotency-Key records inside
// a caller-supplied transaction.
//
// Infrastructure only: it knows about keys, hashes and a pgx.Tx, never
// about what operation is being guarded.
//
// The load-bearing property is in the signature. Every function here takes
// a pgx.Tx rather than a pool, because the claim has to commit or roll back
// with the write it guards. A middleware-level cache cannot be atomic with
// the write, and a non-atomic idempotency check is a race, not a guarantee.
package idempotency

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ErrKeyReused means the key was already used for a *different* request.
// The contract promises 409 for this (api/openapi.yaml: "idempotency key
// reused with a different body"), and it is a real client bug: reusing a
// key across two distinct operations makes retries unsafe for both.
var ErrKeyReused = errors.New("idempotency: key reused with a different request")

// Claim is the outcome of trying to take a key.
type Claim struct {
	// Replay is true when this exact request already succeeded. The caller
	// must NOT perform the write again; it returns the recorded resource.
	Replay bool
	// ResourceID is what the first attempt produced. Only set on a replay.
	ResourceID string
}

// Hash canonicalises a request body for comparison.
//
// Marshalling through encoding/json rather than hashing the raw bytes is
// deliberate: a retry that re-serialises the same struct may order keys
// differently or change whitespace, and neither makes it a different
// request. What matters is that the *decoded* request is the same.
func Hash(operation string, body any) ([]byte, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("idempotency: hashing request: %w", err)
	}
	h := sha256.New()
	h.Write([]byte(operation))
	h.Write([]byte{0x1f})
	h.Write(b)
	return h.Sum(nil), nil
}

// Begin claims the key for this operation, inside tx.
//
// Three outcomes, and the caller has to handle all three:
//
//   - claimed (Replay false): go ahead and write, then call Complete.
//   - replay (Replay true): the identical request already succeeded. Load
//     ResourceID and return it. Do not write.
//   - ErrKeyReused: same key, different request. Render 409.
//
// The INSERT ... ON CONFLICT DO NOTHING is what makes this safe under
// concurrency: two simultaneous retries race on the primary key and exactly
// one wins. The loser reads the winner's row in the same transaction.
func Begin(ctx context.Context, tx pgx.Tx, key, ownerUID, operation string, requestHash []byte) (Claim, error) {
	tag, err := tx.Exec(ctx,
		`INSERT INTO idempotency_keys (key, owner_uid, operation, request_hash)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (key) DO NOTHING`,
		key, ownerUID, operation, requestHash)
	if err != nil {
		return Claim{}, fmt.Errorf("idempotency: claiming key: %w", err)
	}
	if tag.RowsAffected() == 1 {
		return Claim{}, nil
	}

	// The key was already taken. Read it back through the SAME tx — reading
	// through the pool here would see a snapshot outside this transaction
	// and could miss a concurrent claim that has not committed yet.
	var (
		storedOwner string
		storedOp    string
		storedHash  []byte
		resourceID  *string
	)
	err = tx.QueryRow(ctx,
		`SELECT owner_uid, operation, request_hash, resource_id
		   FROM idempotency_keys WHERE key = $1`, key).
		Scan(&storedOwner, &storedOp, &storedHash, &resourceID)
	if err != nil {
		return Claim{}, fmt.Errorf("idempotency: reading claimed key: %w", err)
	}

	// A key belonging to someone else is a reuse, not a replay. Answering
	// otherwise would hand one user another's resource id.
	if storedOwner != ownerUID || storedOp != operation || !bytes.Equal(storedHash, requestHash) {
		return Claim{}, ErrKeyReused
	}

	// Same request, and the first attempt has not recorded its resource yet
	// — it is still in flight, or it failed and rolled back the write while
	// leaving the claim. Treat it as a conflict rather than replaying a
	// resource id we do not have.
	if resourceID == nil {
		return Claim{}, ErrKeyReused
	}
	return Claim{Replay: true, ResourceID: *resourceID}, nil
}

// Complete records what the operation produced, so a later retry replays it.
// Must run in the same tx as Begin and as the write itself.
func Complete(ctx context.Context, tx pgx.Tx, key, resourceID string) error {
	if _, err := tx.Exec(ctx,
		`UPDATE idempotency_keys SET resource_id = $2 WHERE key = $1`,
		key, resourceID); err != nil {
		return fmt.Errorf("idempotency: completing key: %w", err)
	}
	return nil
}
