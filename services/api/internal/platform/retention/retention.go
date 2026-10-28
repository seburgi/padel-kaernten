// Package retention deletes what would otherwise grow forever, called by the
// nightly POST /reap (burgstaller-platform standards/data/retention.md).
// Each table has a window in days; a run deletes in bounded chunks under an
// advisory lock, so two runs never overlap and a killed run resumes the next
// night. A dry run counts and deletes nothing.
package retention

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Table is one thing that grows: rows of Name whose Column is older than
// Days are deleted.
type Table struct {
	Name   string
	Column string
	Days   int
}

// Tables is every table the run looks at. Idempotency answers are kept a
// week (standards/api/idempotency.md); a retry comes long before that.
// Spans of days gone by are no use (docs/design/availability.md); two days
// keeps yesterday in Vienna whatever the hour in UTC.
var Tables = []Table{
	{Name: "idempotency_keys", Column: "created_at", Days: 7},
	{Name: "availability_spans", Column: "day", Days: 2},
}

// Result is what a run did, or would do, to one table.
type Result struct {
	Table string `json:"table"`
	Rows  int64  `json:"rows"`
	Days  int    `json:"windowDays"`
	Dry   bool   `json:"dryRun"`
}

// ErrBusy means another run holds the lock.
var ErrBusy = errors.New("retention: another run is going")

// chunk is how many rows one DELETE takes.
const chunk = 1000

// lockKey is the advisory lock that keeps runs apart ("reap" as a number).
const lockKey = 0x72656170

// Run deletes, table by table, what is older than its window.
func Run(ctx context.Context, pool *pgxpool.Pool, tables []Table, dry bool) ([]Result, error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, lockKey).Scan(&locked); err != nil {
		return nil, err
	}
	if !locked {
		return nil, ErrBusy
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, lockKey) }()

	results := make([]Result, 0, len(tables))
	for _, t := range tables {
		if t.Days < 1 {
			return results, fmt.Errorf("retention: %s has a window of %d days; zero is refused", t.Name, t.Days)
		}
		res := Result{Table: t.Name, Days: t.Days, Dry: dry}
		ident := pgx.Identifier{t.Name}.Sanitize()
		col := pgx.Identifier{t.Column}.Sanitize()
		if dry {
			err = conn.QueryRow(ctx, fmt.Sprintf(`SELECT count(*) FROM %s WHERE %s < now() - make_interval(days => $1)`, ident, col), t.Days).Scan(&res.Rows)
		} else {
			for {
				tag, derr := conn.Exec(ctx, fmt.Sprintf(`DELETE FROM %[1]s WHERE ctid IN (
					SELECT ctid FROM %[1]s WHERE %[2]s < now() - make_interval(days => $1)
					LIMIT %[3]d FOR UPDATE SKIP LOCKED)`, ident, col, chunk), t.Days)
				if derr != nil {
					err = derr
					break
				}
				res.Rows += tag.RowsAffected()
				if tag.RowsAffected() < chunk {
					break
				}
			}
		}
		results = append(results, res)
		if err != nil {
			return results, fmt.Errorf("retention: %s: %w", t.Name, err)
		}
	}
	return results, nil
}
