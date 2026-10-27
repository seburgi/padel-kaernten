// Package testdb gives store tests a real Postgres, the same major version
// as production (burgstaller-platform standards/quality/database-tests.md).
//
// One container per test binary, started on first use by testcontainers and
// reaped when the process exits; the real migrations run on it, so the tests
// exercise the real schema. Each test gets a truncated database rather than
// a fresh container: starting Postgres is seconds, truncating milliseconds.
//
// Without a Docker daemon the tests skip, so a laptop without Docker can run
// the rest. The gate and CI set PLATFORM_REQUIRE_DB=1, and there a test that
// cannot reach its database fails: a green run with skips proves nothing
// about the schema.
package testdb

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/seburgi/padel-kaernten/services/api/migrations"
)

var (
	once sync.Once
	dsn  string
	err  error
)

// Pool returns a pool against a migrated, empty database.
//
// Every table is truncated when the test finishes, so tests in one package
// may not run in parallel against it — which is why nothing here calls
// t.Parallel and why callers should not either.
func Pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	u := dsnOrSkip(t)

	ctx := t.Context()
	pool, poolErr := pgxpool.New(ctx, u)
	if poolErr != nil {
		t.Fatalf("testdb: pool: %v", poolErr)
	}
	t.Cleanup(func() {
		// Truncate before closing, not after: a leaked row from a failed
		// test is otherwise inherited by the next one, and the resulting
		// failure points at innocent code.
		truncate(t, pool)
		pool.Close()
	})
	return pool
}

func dsnOrSkip(t *testing.T) string {
	t.Helper()
	once.Do(start)
	if err != nil {
		// Distinguish "no Docker here" from "Docker is here and broken".
		// Skipping the second would hide a genuinely failing harness.
		if !dockerAvailable() && os.Getenv("PLATFORM_REQUIRE_DB") == "" {
			t.Skipf("testdb: skipping, no Docker daemon reachable (%v)", err)
		}
		t.Fatalf("testdb: %v", err)
	}
	return dsn
}

func start() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	// Pinned to the same major the local stack and Cloud SQL run. A test
	// suite that passes on a different major than production is a test
	// suite with an opinion about the wrong database.
	c, runErr := tcpostgres.Run(ctx, "postgres:18",
		tcpostgres.WithDatabase("app"),
		tcpostgres.WithUsername("app"),
		tcpostgres.WithPassword("app"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second)),
	)
	if runErr != nil {
		err = fmt.Errorf("starting postgres: %w", runErr)
		return
	}

	u, connErr := c.ConnectionString(ctx, "sslmode=disable")
	if connErr != nil {
		err = fmt.Errorf("connection string: %w", connErr)
		return
	}

	conn, connErr := pgx.Connect(ctx, u)
	if connErr != nil {
		err = fmt.Errorf("connect: %w", connErr)
		return
	}
	defer func() { _ = conn.Close(ctx) }()

	// The real migration runner over the real embedded files, so the test
	// schema and the production schema are the same artefact.
	if applyErr := migrations.Apply(ctx, conn, nil); applyErr != nil {
		err = fmt.Errorf("migrate: %w", applyErr)
		return
	}
	dsn = u
}

// truncate empties every table the migrations created, discovering them
// rather than listing them: a hand-maintained list silently stops
// truncating the table added last, and the symptom is a test that fails
// only when run after another one.
func truncate(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	rows, qErr := pool.Query(ctx, `
		SELECT quote_ident(tablename)
		  FROM pg_tables
		 WHERE schemaname = 'public'
		   AND tablename <> 'schema_migrations'`)
	if qErr != nil {
		t.Fatalf("testdb: listing tables: %v", qErr)
	}
	var names []string
	for rows.Next() {
		var n string
		if scanErr := rows.Scan(&n); scanErr != nil {
			rows.Close()
			t.Fatalf("testdb: scanning table name: %v", scanErr)
		}
		names = append(names, n)
	}
	rows.Close()
	if rows.Err() != nil {
		t.Fatalf("testdb: listing tables: %v", rows.Err())
	}
	if len(names) == 0 {
		return
	}

	// One statement so foreign keys never block the order, and RESTART
	// IDENTITY so a bigserial does not leak row counts between tests.
	if _, execErr := pool.Exec(ctx,
		"TRUNCATE TABLE "+strings.Join(names, ", ")+" RESTART IDENTITY CASCADE"); execErr != nil {
		t.Fatalf("testdb: truncate: %v", execErr)
	}
}

func dockerAvailable() bool {
	p, provErr := testcontainers.NewDockerProvider()
	if provErr != nil {
		return false
	}
	defer func() { _ = p.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return p.Health(ctx) == nil
}

// URL is the migrated database's address, for code that opens its own
// connection (database.Open). It is not truncated after the test.
func URL(t *testing.T) string {
	t.Helper()
	return dsnOrSkip(t)
}
