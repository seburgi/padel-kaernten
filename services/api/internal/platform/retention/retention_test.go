package retention_test

import (
	"context"
	"testing"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/retention"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
)

func TestRun_deletesOnlyWhatIsOlderThanItsWindow(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	if _, err := pool.Exec(ctx, `INSERT INTO idempotency_keys (key, owner_uid, operation, request_hash, created_at)
		VALUES ('00000000-0000-0000-0000-000000000001', 'a', 'p', '\x00', now() - interval '8 days'), ('00000000-0000-0000-0000-000000000002', 'a', 'p', '\x00', now())`); err != nil {
		t.Fatal(err)
	}
	dry, err := retention.Run(ctx, pool, retention.Tables, true)
	if err != nil || len(dry) != 1 || dry[0].Rows != 1 || !dry[0].Dry {
		t.Fatalf("dry run: %+v %v", dry, err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM idempotency_keys`).Scan(&n)
	if n != 2 {
		t.Fatalf("a dry run deleted: %d left", n)
	}
	got, err := retention.Run(ctx, pool, retention.Tables, false)
	if err != nil || got[0].Rows != 1 || got[0].Days != 7 {
		t.Fatalf("run: %+v %v", got, err)
	}
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM idempotency_keys WHERE key = '00000000-0000-0000-0000-000000000002'`).Scan(&n)
	if n != 1 {
		t.Error("the new key went too")
	}
}

func TestRun_refusesAWindowOfZero(t *testing.T) {
	pool := testdb.Pool(t)
	if _, err := retention.Run(context.Background(), pool, []retention.Table{{Name: "idempotency_keys", Column: "created_at"}}, true); err == nil {
		t.Error("a window of zero ran")
	}
}
