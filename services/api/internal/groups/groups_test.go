package groups_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/seburgi/padel-kaernten/services/api/internal/groups"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
)

type fakePlatform struct {
	calls []string
	err   error
}

func (f *fakePlatform) InviteAs(_ context.Context, email, ref string) error {
	f.calls = append(f.calls, "invite "+email+" "+ref)
	return f.err
}

func (f *fakePlatform) WithdrawAs(_ context.Context, email, ref string) error {
	f.calls = append(f.calls, "withdraw "+email+" "+ref)
	return f.err
}

const (
	seb    = "seb@example.at"
	anna   = "anna@example.at"
	markus = "markus@example.at"
	lisa   = "lisa@example.at"
)

var n int

// key is a fresh Idempotency-Key.
func key() string {
	n++
	return fmt.Sprintf("6c9b2824-b0cd-4c0b-9052-%012d", n)
}

func setup(t *testing.T) (*groups.Service, *fakePlatform, *pgxpool.Pool) {
	t.Helper()
	pool := testdb.Pool(t)
	p := &fakePlatform{}
	return groups.NewService(pool, p), p, pool
}

func seen(t *testing.T, s *groups.Service, people ...string) {
	t.Helper()
	for _, e := range people {
		if _, err := s.Seen(t.Context(), e); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEnsureFirst_movesSebsInvitationsIn(t *testing.T) {
	s, _, pool := setup(t)
	ctx := t.Context()
	if _, err := pool.Exec(ctx,
		`INSERT INTO invitations (email, invited_by) VALUES ($1, $3), ($2, $3)`, anna, markus, seb); err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureFirst(ctx, seb); err != nil {
		t.Fatal(err)
	}
	// Once only.
	if err := s.EnsureFirst(ctx, seb); err != nil {
		t.Fatal(err)
	}
	list, err := s.List(ctx, anna)
	if err != nil || len(list) != 1 || list[0].Name != groups.FirstGroup || list[0].Kind != groups.Private ||
		list[0].Members != 3 || list[0].Role != "member" {
		t.Fatalf("anna's groups: %+v %v", list, err)
	}
	g, err := s.Get(ctx, seb, list[0].ID)
	if err != nil || g.Role != "admin" || len(g.List) != 3 {
		t.Errorf("seb's view: %+v %v", g, err)
	}
	if list, _ := s.List(ctx, lisa); len(list) != 0 {
		t.Errorf("a private group is unseen from outside: %+v", list)
	}
}

func TestCreateUpdateAndSee(t *testing.T) {
	s, _, _ := setup(t)
	ctx := t.Context()
	seen(t, s, seb, anna)
	k := key()
	g, err := s.Create(ctx, seb, k, "  Donnerstags   Runde ", groups.Private)
	if err != nil || g.Name != "Donnerstags Runde" || g.Role != "admin" || g.How != "member" || len(g.List) != 1 {
		t.Fatalf("create: %+v %v", g, err)
	}
	if again, err := s.Create(ctx, seb, k, "Donnerstags Runde", groups.Private); err != nil || again.ID != g.ID {
		t.Errorf("replay: %+v %v", again, err)
	}
	for _, bad := range []struct{ name, kind string }{{"", groups.Open}, {strings.Repeat("x", 41), groups.Open}, {"Ok", "secret"}} {
		if _, err := s.Create(ctx, seb, key(), bad.name, bad.kind); !errors.Is(err, groups.ErrInvalid) {
			t.Errorf("create %q %q: %v", bad.name, bad.kind, err)
		}
	}
	if _, err := s.Get(ctx, anna, g.ID); !errors.Is(err, groups.ErrNotFound) {
		t.Errorf("anna sees a private group: %v", err)
	}
	open := groups.Open
	if _, err := s.Update(ctx, anna, key(), g.ID, nil, &open); !errors.Is(err, groups.ErrNotFound) {
		t.Errorf("anna changes it: %v", err)
	}
	name := "Büro-Padel"
	g, err = s.Update(ctx, seb, key(), g.ID, &name, &open)
	if err != nil || g.Name != name || g.Kind != groups.Open {
		t.Fatalf("update: %+v %v", g, err)
	}
	// Open now: Anna sees it, listed, without invitations or requests.
	got, err := s.Get(ctx, anna, g.ID)
	if err != nil || got.How != "listed" || got.Role != "" || len(got.List) != 1 {
		t.Errorf("anna's view: %+v %v", got, err)
	}
	if _, err := s.Update(ctx, anna, key(), g.ID, &name, nil); !errors.Is(err, groups.ErrForbidden) {
		t.Errorf("a non-admin renames: %v", err)
	}
	bad := "secret"
	if _, err := s.Update(ctx, seb, key(), g.ID, nil, &bad); !errors.Is(err, groups.ErrInvalid) {
		t.Errorf("a bad kind: %v", err)
	}
	empty := " "
	if _, err := s.Update(ctx, seb, key(), g.ID, &empty, nil); !errors.Is(err, groups.ErrInvalid) {
		t.Errorf("an empty name: %v", err)
	}
	if _, err := s.Get(ctx, seb, 999); !errors.Is(err, groups.ErrNotFound) {
		t.Errorf("no such group: %v", err)
	}
}

func TestInviteAcceptLeave(t *testing.T) {
	s, p, _ := setup(t)
	ctx := t.Context()
	seen(t, s, seb, anna, markus)
	g, _ := s.Create(ctx, seb, key(), "Runde", groups.Private)
	ref := groups.Ref(g.ID)

	k := key()
	inv, err := s.Invite(ctx, seb, k, g.ID, " Anna@Example.at ")
	if err != nil || inv.Email != anna || inv.InvitedBy != seb {
		t.Fatalf("invite: %+v %v", inv, err)
	}
	if again, err := s.Invite(ctx, seb, k, g.ID, anna); err != nil || again != inv || len(p.calls) != 1 {
		t.Errorf("replay: %+v %v %v", again, err, p.calls)
	}
	if _, err := s.Invite(ctx, seb, k, g.ID, markus); !errors.Is(err, idempotency.ErrKeyReused) {
		t.Errorf("a key for another address: %v", err)
	}
	if _, err := s.Invite(ctx, seb, key(), g.ID, "nope"); !errors.Is(err, groups.ErrInvalidEmail) {
		t.Errorf("not an address: %v", err)
	}
	if _, err := s.Invite(ctx, seb, key(), g.ID, seb); !errors.Is(err, groups.ErrAlready) {
		t.Errorf("a member: %v", err)
	}
	// Anna sees the invitation, but not who else is invited.
	list, _ := s.List(ctx, anna)
	if len(list) != 1 || list[0].How != "invited" {
		t.Fatalf("anna's list: %+v", list)
	}
	if _, err := s.Invite(ctx, anna, key(), g.ID, markus); !errors.Is(err, groups.ErrForbidden) {
		t.Errorf("an invited person invites: %v", err)
	}
	full, _ := s.Get(ctx, seb, g.ID)
	if len(full.Invitations) != 1 {
		t.Errorf("seb sees the invitation: %+v", full.Invitations)
	}

	if joined, err := s.Join(ctx, anna, key(), g.ID); err != nil || joined != groups.JoinedMember {
		t.Fatalf("accept: %v %v", joined, err)
	}
	// Now a member, Anna invites too; the ref stays for her membership.
	if _, err := s.Invite(ctx, anna, key(), g.ID, markus); err != nil {
		t.Fatalf("anna invites: %v", err)
	}
	// Markus declines; then Anna leaves.
	if err := s.DropInvitation(ctx, markus, g.ID, markus); err != nil {
		t.Fatal(err)
	}
	if err := s.DropInvitation(ctx, markus, g.ID, markus); err != nil {
		t.Errorf("declining twice: %v", err)
	}
	if err := s.Remove(ctx, anna, g.ID, anna); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"invite " + anna + " " + ref,
		"invite " + markus + " " + ref,
		"withdraw " + markus + " " + ref,
		"withdraw " + anna + " " + ref,
	}
	if strings.Join(p.calls, "\n") != strings.Join(want, "\n") {
		t.Errorf("platform calls:\n%s", strings.Join(p.calls, "\n"))
	}
}

func TestInvite_whoMayDrop(t *testing.T) {
	s, _, _ := setup(t)
	ctx := t.Context()
	seen(t, s, seb, anna, markus, lisa)
	g, _ := s.Create(ctx, seb, key(), "Runde", groups.Private)
	_, _ = s.Invite(ctx, seb, key(), g.ID, anna)
	_, _ = s.Join(ctx, anna, key(), g.ID)
	_, _ = s.Invite(ctx, anna, key(), g.ID, markus)
	_, _ = s.Invite(ctx, seb, key(), g.ID, lisa)
	// Anna may not take back Seb's invitation; Seb, the admin, may take
	// back Anna's.
	if err := s.DropInvitation(ctx, anna, g.ID, lisa); !errors.Is(err, groups.ErrForbidden) {
		t.Errorf("anna drops seb's: %v", err)
	}
	if err := s.DropInvitation(ctx, seb, g.ID, markus); err != nil {
		t.Errorf("the admin drops anna's: %v", err)
	}
	if err := s.DropInvitation(ctx, seb, g.ID, "x"); !errors.Is(err, groups.ErrInvalidEmail) {
		t.Errorf("not an address: %v", err)
	}
}

func TestInvite_limits(t *testing.T) {
	s, _, _ := setup(t)
	ctx := t.Context()
	seen(t, s, seb)
	g, _ := s.Create(ctx, seb, key(), "Viele", groups.Private)
	for i := range groups.MaxInvitationsADay {
		if _, err := s.Invite(ctx, seb, key(), g.ID, fmt.Sprintf("p%d@example.at", i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Invite(ctx, seb, key(), g.ID, "one-more@example.at"); !errors.Is(err, groups.ErrLimit) {
		t.Errorf("the eleventh today: %v", err)
	}
}

func TestInvite_platformFails(t *testing.T) {
	s, p, _ := setup(t)
	ctx := t.Context()
	seen(t, s, seb)
	g, _ := s.Create(ctx, seb, key(), "Runde", groups.Private)
	p.err = errors.New("down")
	if _, err := s.Invite(ctx, seb, key(), g.ID, anna); !errors.Is(err, groups.ErrPlatform) {
		t.Fatalf("invite: %v", err)
	}
	if g, _ := s.Get(ctx, seb, g.ID); len(g.Invitations) != 0 {
		t.Errorf("recorded anyway: %+v", g.Invitations)
	}
}

func TestOpenAndOnRequest(t *testing.T) {
	s, _, _ := setup(t)
	ctx := t.Context()
	seen(t, s, seb, anna, markus)
	open, _ := s.Create(ctx, seb, key(), "Villach offen", groups.Open)
	asked, _ := s.Create(ctx, seb, key(), "Auf Anfrage", groups.OnRequest)

	if joined, err := s.Join(ctx, anna, key(), open.ID); err != nil || joined != groups.JoinedMember {
		t.Fatalf("join open: %v %v", joined, err)
	}
	k := key()
	if joined, err := s.Join(ctx, anna, k, asked.ID); err != nil || joined != groups.JoinedRequested {
		t.Fatalf("ask: %v %v", joined, err)
	}
	if joined, err := s.Join(ctx, anna, k, asked.ID); err != nil || joined != groups.JoinedRequested {
		t.Errorf("replay: %v %v", joined, err)
	}
	list, _ := s.List(ctx, anna)
	if len(list) != 2 || list[0].Name != "Villach offen" || list[1].How != "listed" || !list[1].Requested {
		t.Errorf("anna's list: %+v", list)
	}
	g, _ := s.Get(ctx, seb, asked.ID)
	if len(g.Requests) != 1 || g.Requests[0].Email != anna {
		t.Fatalf("requests: %+v", g.Requests)
	}
	// Markus is not a member: he may not let Anna in or turn her down.
	if err := s.Admit(ctx, markus, asked.ID, anna); !errors.Is(err, groups.ErrForbidden) {
		t.Errorf("markus admits: %v", err)
	}
	if err := s.DropRequest(ctx, markus, asked.ID, anna); !errors.Is(err, groups.ErrForbidden) {
		t.Errorf("markus turns down: %v", err)
	}
	if err := s.Admit(ctx, seb, asked.ID, anna); err != nil {
		t.Fatal(err)
	}
	if err := s.Admit(ctx, seb, asked.ID, anna); err != nil {
		t.Errorf("admitting twice: %v", err)
	}
	if err := s.Admit(ctx, seb, asked.ID, markus); !errors.Is(err, groups.ErrNotFound) {
		t.Errorf("admitting someone who never asked: %v", err)
	}
	_, _ = s.Join(ctx, markus, key(), asked.ID)
	if err := s.DropRequest(ctx, markus, asked.ID, markus); err != nil {
		t.Errorf("markus takes his request back: %v", err)
	}
	if joined, err := s.Join(ctx, anna, key(), asked.ID); err != nil || joined != groups.JoinedMember {
		t.Errorf("a member joins again: %v %v", joined, err)
	}
}

func TestRemove_adminsAndTheLastOne(t *testing.T) {
	s, p, _ := setup(t)
	ctx := t.Context()
	seen(t, s, seb, anna, markus)
	g, _ := s.Create(ctx, seb, key(), "Offen", groups.Open)
	_, _ = s.Join(ctx, anna, key(), g.ID)
	_, _ = s.Join(ctx, markus, key(), g.ID)
	if err := s.Remove(ctx, anna, g.ID, markus); !errors.Is(err, groups.ErrForbidden) {
		t.Errorf("a member removes another: %v", err)
	}
	if err := s.Remove(ctx, seb, g.ID, markus); err != nil {
		t.Fatal(err)
	}
	// The last admin leaves: Anna, in longest, takes over.
	if err := s.Remove(ctx, seb, g.ID, seb); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, anna, g.ID)
	if err != nil || got.Role != "admin" || len(got.List) != 1 {
		t.Fatalf("anna took over: %+v %v", got, err)
	}
	_, _ = s.Invite(ctx, anna, key(), g.ID, "new@example.at")
	p.calls = nil
	// The last one leaves: the group and its invitations go.
	if err := s.Remove(ctx, anna, g.ID, anna); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, anna, g.ID); !errors.Is(err, groups.ErrNotFound) {
		t.Errorf("the group stayed: %v", err)
	}
	ref := groups.Ref(g.ID)
	if strings.Join(p.calls, ",") != "withdraw "+anna+" "+ref+",withdraw new@example.at "+ref {
		t.Errorf("platform calls: %v", p.calls)
	}
	if err := s.Remove(ctx, anna, g.ID, anna); !errors.Is(err, groups.ErrNotFound) {
		t.Errorf("leaving a gone group: %v", err)
	}
}

func TestNames(t *testing.T) {
	s, _, _ := setup(t)
	ctx := t.Context()
	if p, err := s.Seen(ctx, anna); err != nil || p.Name != "" {
		t.Fatalf("first visit: %+v %v", p, err)
	}
	k := key()
	if p, err := s.SetName(ctx, anna, k, "  Anna  B. "); err != nil || p.Name != "Anna B." {
		t.Fatalf("set: %+v %v", p, err)
	}
	if p, err := s.SetName(ctx, anna, k, "Anna B."); err != nil || p.Name != "Anna B." {
		t.Errorf("replay: %+v %v", p, err)
	}
	if _, err := s.SetName(ctx, anna, key(), ""); !errors.Is(err, groups.ErrInvalid) {
		t.Errorf("empty: %v", err)
	}
	g, _ := s.Create(ctx, anna, key(), "A", groups.Private)
	if got, _ := s.Get(ctx, anna, g.ID); got.List[0].Name != "Anna B." {
		t.Errorf("members carry names: %+v", got.List)
	}
}
