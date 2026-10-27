package database_test

import (
	"testing"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/database"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
)

// Opening an up-to-date database migrates nothing and serves.
func TestOpen_migratesAndServes(t *testing.T) {
	var applied []string
	pool, err := database.Open(t.Context(), testdb.URL(t), func(format string, args ...any) {
		applied = append(applied, format)
	})
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if len(applied) != 0 {
		t.Errorf("applied again: %v", applied)
	}
	var n int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM schema_migrations`).Scan(&n); err != nil || n == 0 {
		t.Errorf("schema_migrations: %d %v", n, err)
	}
}

func TestOpen_refusesABrokenURL(t *testing.T) {
	if _, err := database.Open(t.Context(), "postgres://%zz", nil); err == nil {
		t.Fatal("a broken URL opened")
	}
	if _, err := database.Open(t.Context(), "postgres://nobody@127.0.0.1:1/none?connect_timeout=1", nil); err == nil {
		t.Fatal("an unreachable database opened")
	}
}
