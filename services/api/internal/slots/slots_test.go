package slots_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots/sites"
)

type fakeSites struct {
	now   *time.Time
	calls atomic.Int32
	err   error
	wait  chan struct{}
}

func (f *fakeSites) Take(context.Context) (sites.Snapshot, []error, error) {
	f.calls.Add(1)
	if f.wait != nil {
		<-f.wait
	}
	if f.err != nil {
		return sites.Snapshot{}, []error{f.err}, f.err
	}
	return sites.Snapshot{TakenAt: f.now.UTC(), Days: []string{"2026-10-27"}, Venues: []sites.Venue{{ID: "a", Name: "A"}}},
		[]error{errors.New("b: down")}, nil
}

func setup(t *testing.T) (*slots.Service, *fakeSites, *time.Time) {
	t.Helper()
	pool := testdb.Pool(t)
	now := time.Date(2026, 10, 27, 17, 0, 0, 0, time.UTC)
	f := &fakeSites{now: &now}
	return slots.NewService(pool, f, func() time.Time { return now }, slog.New(slog.NewTextHandler(io.Discard, nil))), f, &now
}

const (
	key1 = "6c9b2824-b0cd-4c0b-9052-83d9f457e001"
	key2 = "6c9b2824-b0cd-4c0b-9052-83d9f457e002"
	key3 = "6c9b2824-b0cd-4c0b-9052-83d9f457e003"
)

func TestRefresh_asksAtMostEveryFiveMinutes(t *testing.T) {
	svc, f, now := setup(t)
	ctx := t.Context()
	if _, err := svc.Latest(ctx); !errors.Is(err, slots.ErrNone) {
		t.Fatalf("before the first refresh: %v", err)
	}
	first, err := svc.Refresh(ctx, "a@b.at", key1)
	if err != nil {
		t.Fatal(err)
	}
	var snap sites.Snapshot
	if err := json.Unmarshal(first.JSON, &snap); err != nil || snap.Venues[0].ID != "a" || !first.TakenAt.Equal(*now) {
		t.Fatalf("first: %s %v", first.JSON, err)
	}

	*now = now.Add(4 * time.Minute)
	if again, err := svc.Refresh(ctx, "a@b.at", key2); err != nil || !again.TakenAt.Equal(first.TakenAt) || f.calls.Load() != 1 {
		t.Fatalf("within five minutes it asked again: %d calls, %v", f.calls.Load(), err)
	}

	*now = now.Add(2 * time.Minute)
	fresh, err := svc.Refresh(ctx, "a@b.at", key3)
	if err != nil || f.calls.Load() != 2 || !fresh.TakenAt.Equal(*now) {
		t.Fatalf("after six minutes: %d calls, %v %v", f.calls.Load(), fresh.TakenAt, err)
	}
	if latest, err := svc.Latest(ctx); err != nil || !latest.TakenAt.Equal(fresh.TakenAt) {
		t.Errorf("latest: %v %v", latest.TakenAt, err)
	}
}

func TestRefresh_theSameKeyAgainAsksNothing(t *testing.T) {
	svc, f, now := setup(t)
	ctx := t.Context()
	if _, err := svc.Refresh(ctx, "a@b.at", key1); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Hour)
	if _, err := svc.Refresh(ctx, "a@b.at", key1); err != nil || f.calls.Load() != 1 {
		t.Errorf("a replay asked again: %d calls, %v", f.calls.Load(), err)
	}
	if _, err := svc.Refresh(ctx, "other@b.at", key1); !errors.Is(err, idempotency.ErrKeyReused) {
		t.Errorf("another person's key: %v", err)
	}
}

func TestRefresh_whenEverySiteFailsTheLastStays(t *testing.T) {
	svc, f, now := setup(t)
	ctx := t.Context()
	first, err := svc.Refresh(ctx, "a@b.at", key1)
	if err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Hour)
	f.err = errors.New("no network")
	if _, err := svc.Refresh(ctx, "a@b.at", key2); !errors.Is(err, slots.ErrSitesFailed) {
		t.Fatalf("got %v", err)
	}
	if latest, err := svc.Latest(ctx); err != nil || !latest.TakenAt.Equal(first.TakenAt) {
		t.Errorf("latest: %v %v", latest.TakenAt, err)
	}
	// The failed call kept no answer: the same key tries again.
	f.err = nil
	if _, err := svc.Refresh(ctx, "a@b.at", key2); err != nil || f.calls.Load() != 3 {
		t.Errorf("retry: %d calls, %v", f.calls.Load(), err)
	}
}

func TestRefresh_callsTogetherAskOnce(t *testing.T) {
	svc, f, _ := setup(t)
	f.wait = make(chan struct{})
	var wg sync.WaitGroup
	for _, k := range []string{key1, key2, key3} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.Refresh(context.Background(), "a@b.at", k); err != nil {
				t.Error(err)
			}
		}()
	}
	for f.calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	close(f.wait)
	wg.Wait()
	if f.calls.Load() != 1 {
		t.Errorf("asked %d times", f.calls.Load())
	}
}

// heldSites notes how many of the pool's connections are taken while the
// sites are asked.
type heldSites struct {
	fakeSites
	pool interface{ Stat() *pgxpool.Stat }
	held int32
}

func (h *heldSites) Take(ctx context.Context) (sites.Snapshot, []error, error) {
	h.held = h.pool.Stat().AcquiredConns()
	return h.fakeSites.Take(ctx)
}

func TestRefresh_asksTheSitesWithoutHoldingAConnection(t *testing.T) {
	pool := testdb.Pool(t)
	now := time.Date(2026, 10, 27, 17, 0, 0, 0, time.UTC)
	h := &heldSites{fakeSites: fakeSites{now: &now}, pool: pool, held: -1}
	svc := slots.NewService(pool, h, func() time.Time { return now }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, err := svc.Refresh(t.Context(), "a@b.at", key1); err != nil {
		t.Fatal(err)
	}
	if h.held != 0 {
		t.Errorf("%d connections held while asking the sites", h.held)
	}
}
