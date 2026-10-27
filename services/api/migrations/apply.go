package migrations

import (
	"context"
	"fmt"
	"io/fs"
	"sort"

	"github.com/jackc/pgx/v5"
)

// Lock is the advisory lock Apply holds. Any number will do as long as
// nothing else in this database takes it; this one spells "PADL".
const Lock int64 = 0x5041444C

// Apply runs every unapplied migration in lexicographic order, each in its
// own transaction, recording it in schema_migrations.
//
// It lives here rather than in cmd/migrate because the test harness needs
// the identical sequence: a test database built by a second, drifting copy
// of this loop would pass against a schema production never has.
//
// Ordering is lexicographic over the filename, which is why the zero-padded
// NNNN_ prefix is load-bearing rather than cosmetic.
//
// The API calls it at start-up, before it serves, so instances
// starting together after a deploy would race. Apply holds Lock for the
// whole run and they take turns: the first applies, the others find
// nothing left to do.
func Apply(ctx context.Context, conn *pgx.Conn, log func(string, ...any)) error {
	if log == nil {
		log = func(string, ...any) {}
	}

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, Lock); err != nil {
		return fmt.Errorf("take the migration lock: %w", err)
	}
	defer func() {
		_, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, Lock)
	}()

	if _, err := conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("create tracking table: %w", err)
	}

	applied := map[string]bool{}
	rows, err := conn.Query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("read applied: %w", err)
	}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return err
		}
		applied[v] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	entries, err := fs.Glob(FS, "*.sql")
	if err != nil {
		return err
	}
	sort.Strings(entries)

	for _, path := range entries {
		version := path[:len(path)-len(".sql")]
		if applied[version] {
			continue
		}

		body, err := FS.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %s: %w", path, err)
		}

		tx, err := conn.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin %s: %w", version, err)
		}
		if _, err := tx.Exec(ctx, string(body)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply %s: %w", version, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations (version) VALUES ($1)`, version); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record %s: %w", version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit %s: %w", version, err)
		}
		log("applied %s", version)
	}
	return nil
}
