// Package invitations is who Seb let into Padel (docs/design/invitations.md).
// Only the owner invites; an invitation puts the person into the Rauthy
// group padel through the platform service, which is the one list the
// gateway lets through (burgstaller-platform
// standards/auth/who-may-use-an-app.md). This table is what the app shows.
package invitations

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
)

var (
	// ErrInvalid means the address is not one an invitation can go to.
	ErrInvalid = errors.New("not an email address")
	// ErrPlatform means the platform service failed; nothing was recorded.
	ErrPlatform = errors.New("the platform service failed")
)

// Invitation is one person Seb invited.
type Invitation struct {
	Email     string
	InvitedAt time.Time
}

// Platform is the platform service (platformsvc.Client).
type Platform interface {
	Invite(ctx context.Context, email string) error
	Withdraw(ctx context.Context, email string) error
}

// Service lists, makes and withdraws invitations.
type Service struct {
	pool     *pgxpool.Pool
	platform Platform
}

// NewService is the invitations service.
func NewService(pool *pgxpool.Pool, p Platform) *Service {
	return &Service{pool: pool, platform: p}
}

// Normalize is the address as it is kept: trimmed and lower-cased, as the
// gateway's note names people. ErrInvalid when it is not one address.
func Normalize(email string) (string, error) {
	e := strings.ToLower(strings.TrimSpace(email))
	a, err := mail.ParseAddress(e)
	if err != nil || a.Address != e || len(e) > 254 || !strings.Contains(e[strings.LastIndex(e, "@")+1:], ".") {
		return "", ErrInvalid
	}
	return e, nil
}

// List is a page of invitations by email, after the given one.
func (s *Service) List(ctx context.Context, after string, limit int) ([]Invitation, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT email, invited_at FROM invitations WHERE email > $1 ORDER BY email LIMIT $2`, after, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Invitation, error) {
		var i Invitation
		return i, r.Scan(&i.Email, &i.InvitedAt)
	})
}

// Invite lets email in, as asked by who with the Idempotency-Key key. The
// platform service is asked first: when it fails, nothing is recorded and
// a retry tries again. Inviting someone already invited answers their
// invitation.
func (s *Service) Invite(ctx context.Context, who, key, email string) (Invitation, error) {
	email, err := Normalize(email)
	if err != nil {
		return Invitation{}, err
	}
	hash, err := idempotency.Hash("invite", email)
	if err != nil {
		return Invitation{}, err
	}
	var out Invitation
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, who, "invite", hash)
		if err != nil {
			return err
		}
		if !claim.Replay {
			if err := s.platform.Invite(ctx, email); err != nil {
				return fmt.Errorf("%w: %w", ErrPlatform, err)
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO invitations (email, invited_by) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
				email, who); err != nil {
				return err
			}
			if err := idempotency.Complete(ctx, tx, key, email); err != nil {
				return err
			}
		}
		return tx.QueryRow(ctx, `SELECT email, invited_at FROM invitations WHERE email = $1`, email).
			Scan(&out.Email, &out.InvitedAt)
	})
	return out, err
}

// Withdraw takes the invitation of email back: out of the group (unless
// they were in it before Padel invited them), and off the list. Safe to
// repeat.
func (s *Service) Withdraw(ctx context.Context, email string) error {
	email, err := Normalize(email)
	if err != nil {
		return err
	}
	if err := s.platform.Withdraw(ctx, email); err != nil {
		return fmt.Errorf("%w: %w", ErrPlatform, err)
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM invitations WHERE email = $1`, email)
	return err
}
