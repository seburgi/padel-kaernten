package invitations_test

import (
	"context"
	"errors"
	"testing"

	"github.com/seburgi/padel-kaernten/services/api/internal/invitations"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
)

type fakePlatform struct {
	calls []string
	err   error
}

func (f *fakePlatform) Invite(_ context.Context, email string) error {
	f.calls = append(f.calls, "invite "+email)
	return f.err
}

func (f *fakePlatform) Withdraw(_ context.Context, email string) error {
	f.calls = append(f.calls, "withdraw "+email)
	return f.err
}

const (
	key1 = "6c9b2824-b0cd-4c0b-9052-83d9f457e001"
	key2 = "6c9b2824-b0cd-4c0b-9052-83d9f457e002"
	seb  = "seb@example.at"
)

func TestInviteListWithdraw(t *testing.T) {
	p := &fakePlatform{}
	svc := invitations.NewService(testdb.Pool(t), p)
	ctx := t.Context()

	inv, err := svc.Invite(ctx, seb, key1, "  Anna@Example.AT ")
	if err != nil || inv.Email != "anna@example.at" || inv.InvitedAt.IsZero() {
		t.Fatalf("invite: %+v %v", inv, err)
	}
	// The same key again answers the same invitation without asking again.
	if again, err := svc.Invite(ctx, seb, key1, "anna@example.at"); err != nil || again != inv || len(p.calls) != 1 {
		t.Errorf("replay: %+v %v, calls %v", again, err, p.calls)
	}
	if _, err := svc.Invite(ctx, seb, key1, "bert@example.at"); !errors.Is(err, idempotency.ErrKeyReused) {
		t.Errorf("a key for another address: %v", err)
	}
	// Inviting someone already invited answers their invitation.
	if again, err := svc.Invite(ctx, seb, key2, "anna@example.at"); err != nil || !again.InvitedAt.Equal(inv.InvitedAt) {
		t.Errorf("invited twice: %+v %v", again, err)
	}

	list, err := svc.List(ctx, "", 10)
	if err != nil || len(list) != 1 || list[0].Email != "anna@example.at" {
		t.Fatalf("list: %+v %v", list, err)
	}
	if list, _ := svc.List(ctx, "anna@example.at", 10); len(list) != 0 {
		t.Errorf("after the last: %+v", list)
	}

	if err := svc.Withdraw(ctx, "ANNA@example.at"); err != nil {
		t.Fatal(err)
	}
	if list, _ := svc.List(ctx, "", 10); len(list) != 0 {
		t.Errorf("after withdrawing: %+v", list)
	}
	want := []string{"invite anna@example.at", "invite anna@example.at", "withdraw anna@example.at"}
	if len(p.calls) != 3 || p.calls[0] != want[0] || p.calls[1] != want[1] || p.calls[2] != want[2] {
		t.Errorf("calls: %v", p.calls)
	}
}

func TestInvite_whenThePlatformFailsNothingIsRecorded(t *testing.T) {
	p := &fakePlatform{err: errors.New("502")}
	svc := invitations.NewService(testdb.Pool(t), p)
	ctx := t.Context()
	if _, err := svc.Invite(ctx, seb, key1, "anna@example.at"); !errors.Is(err, invitations.ErrPlatform) {
		t.Fatalf("got %v", err)
	}
	if list, _ := svc.List(ctx, "", 10); len(list) != 0 {
		t.Errorf("recorded: %+v", list)
	}
	if err := svc.Withdraw(ctx, "anna@example.at"); !errors.Is(err, invitations.ErrPlatform) {
		t.Errorf("withdraw: %v", err)
	}
	// The key was not kept: a retry tries again.
	p.err = nil
	if _, err := svc.Invite(ctx, seb, key1, "anna@example.at"); err != nil {
		t.Errorf("retry: %v", err)
	}
}

func TestNormalize(t *testing.T) {
	for in, want := range map[string]string{
		"a@b.at":         "a@b.at",
		" A+x@B.co.at ":  "a+x@b.co.at",
		"no-at":          "",
		"a@b":            "",
		"Anna <a@b.at>":  "",
		"a@b.at, c@d.at": "",
	} {
		got, err := invitations.Normalize(in)
		if got != want || (want == "") != (err != nil) {
			t.Errorf("%q: %q %v", in, got, err)
		}
	}
}
