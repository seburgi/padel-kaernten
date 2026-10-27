package testdb_test

import (
	"testing"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
)

// The harness proves it migrates and isolates, or every test built on it
// tests the harness rather than the code.
func TestHarness_migrates(t *testing.T) {
	pool := testdb.Pool(t)
	if _, err := pool.Exec(t.Context(),
		`INSERT INTO invitations (email, invited_by) VALUES ('a@example.at', 'seb@example.at')`); err != nil {
		t.Fatalf("insert: %v", err)
	}
}

// Runs after the test above and must not see its row.
func TestHarness_truncatesBetweenTests(t *testing.T) {
	pool := testdb.Pool(t)
	var n int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM invitations`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("invitations has %d rows at the start of a test; want 0", n)
	}
}
