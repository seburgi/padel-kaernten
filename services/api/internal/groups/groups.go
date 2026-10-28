// Package groups is who plays with whom (docs/design/groups.md): groups
// that form themselves, their members, invitations into them and requests
// to join. Every member may invite; an invitation is held by the platform
// service under the ref group-<id>, which keeps the person in the sign-in
// group padel while it or their membership stands. Who may see a group is
// read through the view group_visibility.
package groups

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
)

var (
	// ErrNotFound means the group does not exist or the caller may not see it.
	ErrNotFound = errors.New("no such group")
	// ErrForbidden means the caller sees the group but may not do this.
	ErrForbidden = errors.New("not allowed in this group")
	// ErrInvalid means a name, kind or area the app does not take.
	ErrInvalid = errors.New("invalid group")
	// ErrInvalidEmail means the address is not one an invitation can go to.
	ErrInvalidEmail = errors.New("not an email address")
	// ErrAlready means the person is a member already.
	ErrAlready = errors.New("already a member")
	// ErrLimit means the caller has too many open invitations, or sent too
	// many today.
	ErrLimit = errors.New("too many invitations")
	// ErrPlatform means the platform service failed; nothing was recorded.
	ErrPlatform = errors.New("the platform service failed")
)

// The invitation limits per person (Seb, 2026-10-28).
const (
	MaxOpenInvitations = 20
	MaxInvitationsADay = 10
)

// The kinds of group.
const (
	Private   = "private"
	OnRequest = "on_request"
	Open      = "open"
)

// Where a group plays: every court, or only the halls or only the open-air
// ones (Seb, 2026-10-28). The fits leave the other courts out.
const (
	Anywhere = "alle"
	Hall     = "halle"
	OpenAir  = "freiluft"
)

// FirstGroup is the name of the group everyone Seb invited before groups
// existed is moved into (Seb, 2026-10-28).
const FirstGroup = "Padel Kärnten"

// Summary is a group as a list shows it to one viewer. How is member,
// invited or listed (open or on request, not joined); Role is admin or
// member for a member, "" otherwise. Area is where it plays.
type Summary struct {
	ID        int64
	Name      string
	Kind      string
	Area      string
	How       string
	Role      string
	Members   int
	Requested bool
}

// Member is one person in a group.
type Member struct {
	Email    string
	Name     string
	Role     string
	JoinedAt time.Time
}

// Invitation is an unanswered invitation into a group.
type Invitation struct {
	Email     string
	InvitedBy string
	InvitedAt time.Time
}

// Request is someone asking into a group.
type Request struct {
	Email   string
	Name    string
	AskedAt time.Time
}

// Group is one group with what the viewer may see of it: members always;
// invitations and requests only for members.
type Group struct {
	Summary
	List        []Member
	Invitations []Invitation
	Requests    []Request
}

// Platform is the platform service (platformsvc.Client).
type Platform interface {
	InviteAs(ctx context.Context, email, ref string) error
	WithdrawAs(ctx context.Context, email, ref string) error
}

// Service keeps the groups.
type Service struct {
	pool     *pgxpool.Pool
	platform Platform
}

// NewService is the groups service.
func NewService(pool *pgxpool.Pool, p Platform) *Service {
	return &Service{pool: pool, platform: p}
}

// Ref is the platform service's key for an invitation into group id.
func Ref(id int64) string { return "group-" + strconv.FormatInt(id, 10) }

// NormalizeEmail is the address as it is kept: trimmed and lower-cased, as
// the gateway's note names people.
func NormalizeEmail(email string) (string, error) {
	e := strings.ToLower(strings.TrimSpace(email))
	a, err := mail.ParseAddress(e)
	if err != nil || a.Address != e || len(e) > 254 || !strings.Contains(e[strings.LastIndex(e, "@")+1:], ".") {
		return "", ErrInvalidEmail
	}
	return e, nil
}

func cleanName(name string) (string, error) {
	n := strings.Join(strings.Fields(name), " ")
	if n == "" || len([]rune(n)) > 40 {
		return "", ErrInvalid
	}
	return n, nil
}

func validKind(kind string) bool { return kind == Private || kind == OnRequest || kind == Open }

func validArea(area string) bool { return area == Anywhere || area == Hall || area == OpenAir }

// Person is someone who has opened the app.
type Person struct {
	Email    string
	Name     string // "" until they gave one
	Welcomed bool   // has seen /welcome (docs/design/help.md)
}

// Seen records that email opened the app and returns them. It is what
// makes the open groups visible to them.
func (s *Service) Seen(ctx context.Context, email string) (Person, error) {
	p := Person{Email: email}
	var name *string
	err := s.pool.QueryRow(ctx,
		`INSERT INTO people (email) VALUES ($1)
		 ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
		 RETURNING name, welcomed_at IS NOT NULL`, email).Scan(&name, &p.Welcomed)
	if name != nil {
		p.Name = *name
	}
	return p, err
}

// SetName sets the name the others see.
func (s *Service) SetName(ctx context.Context, email, key, name string) (Person, error) {
	n, err := cleanName(name)
	if err != nil {
		return Person{}, err
	}
	hash, err := idempotency.Hash("name", n)
	if err != nil {
		return Person{}, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, email, "name", hash)
		if err != nil || claim.Replay {
			return err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO people (email, name) VALUES ($1, $2)
			 ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name`, email, n); err != nil {
			return err
		}
		return idempotency.Complete(ctx, tx, key, email)
	})
	if err != nil {
		return Person{}, err
	}
	return s.Seen(ctx, email)
}

// Welcome records that email has seen the welcome. The first time counts;
// a second is the same.
func (s *Service) Welcome(ctx context.Context, email, key string) (Person, error) {
	hash, err := idempotency.Hash("welcomed", email)
	if err != nil {
		return Person{}, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, email, "welcomed", hash)
		if err != nil || claim.Replay {
			return err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO people (email, welcomed_at) VALUES ($1, now())
			 ON CONFLICT (email) DO UPDATE SET welcomed_at = coalesce(people.welcomed_at, now())`, email); err != nil {
			return err
		}
		return idempotency.Complete(ctx, tx, key, email)
	})
	if err != nil {
		return Person{}, err
	}
	return s.Seen(ctx, email)
}

// EnsureFirst makes the first group once, when there is none: "Padel
// Kärnten", private, with owner as its admin and everyone in invitations
// (Seb's invitations into the app) as members. Their invitation into the
// app stays, so nobody loses access.
func (s *Service) EnsureFirst(ctx context.Context, owner string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Instances starting together make it once.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(0x67726f75)`); err != nil {
			return err
		}
		var any bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM groups)`).Scan(&any); err != nil || any || owner == "" {
			return err
		}
		var id int64
		if err := tx.QueryRow(ctx,
			`INSERT INTO groups (name, kind, created_by) VALUES ($1, 'private', $2) RETURNING id`,
			FirstGroup, owner).Scan(&id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO memberships (group_id, email, role, joined_at)
			 SELECT $1::bigint, $2::text, 'admin', now()
			 UNION ALL
			 SELECT $1::bigint, email, 'member', invited_at FROM invitations WHERE email <> $2::text`, id, owner)
		return err
	})
}

const summaryColumns = `g.id, g.name, g.kind, g.area, v.how, COALESCE(m.role, ''),
	(SELECT count(*) FROM memberships c WHERE c.group_id = g.id),
	EXISTS (SELECT 1 FROM join_requests r WHERE r.group_id = g.id AND r.email = v.viewer)`

const summaryFrom = `FROM group_visibility v
	JOIN groups g ON g.id = v.group_id
	LEFT JOIN memberships m ON m.group_id = g.id AND m.email = v.viewer`

func scanSummary(row pgx.Row) (Summary, error) {
	var g Summary
	return g, row.Scan(&g.ID, &g.Name, &g.Kind, &g.Area, &g.How, &g.Role, &g.Members, &g.Requested)
}

// List is every group viewer may see: theirs first, then the ones they are
// invited into, then the open ones, each by name.
func (s *Service) List(ctx context.Context, viewer string) ([]Summary, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+summaryColumns+` `+summaryFrom+`
		WHERE v.viewer = $1
		ORDER BY CASE v.how WHEN 'member' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END, lower(g.name), g.id`, viewer)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Summary, error) { return scanSummary(r) })
}

func (s *Service) summary(ctx context.Context, q pgx.Tx, viewer string, id int64) (Summary, error) {
	g, err := scanSummary(q.QueryRow(ctx, `SELECT `+summaryColumns+` `+summaryFrom+`
		WHERE v.viewer = $1 AND v.group_id = $2`, viewer, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return g, ErrNotFound
	}
	return g, err
}

// Get is group id as viewer may see it.
func (s *Service) Get(ctx context.Context, viewer string, id int64) (Group, error) {
	var g Group
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		sum, err := s.summary(ctx, tx, viewer, id)
		if err != nil {
			return err
		}
		g.Summary = sum
		rows, err := tx.Query(ctx,
			`SELECT m.email, COALESCE(p.name, ''), m.role, m.joined_at
			   FROM memberships m LEFT JOIN people p ON p.email = m.email
			  WHERE m.group_id = $1
			  ORDER BY m.joined_at, m.email`, id)
		if err != nil {
			return err
		}
		if g.List, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Member, error) {
			var m Member
			return m, r.Scan(&m.Email, &m.Name, &m.Role, &m.JoinedAt)
		}); err != nil {
			return err
		}
		g.Invitations, g.Requests = []Invitation{}, []Request{}
		if sum.How != "member" {
			return nil
		}
		rows, err = tx.Query(ctx,
			`SELECT email, invited_by, invited_at FROM group_invitations WHERE group_id = $1 ORDER BY invited_at, email`, id)
		if err != nil {
			return err
		}
		if g.Invitations, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Invitation, error) {
			var i Invitation
			return i, r.Scan(&i.Email, &i.InvitedBy, &i.InvitedAt)
		}); err != nil {
			return err
		}
		rows, err = tx.Query(ctx,
			`SELECT r.email, COALESCE(p.name, ''), r.asked_at
			   FROM join_requests r LEFT JOIN people p ON p.email = r.email
			  WHERE r.group_id = $1 ORDER BY r.asked_at, r.email`, id)
		if err != nil {
			return err
		}
		g.Requests, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Request, error) {
			var q Request
			return q, r.Scan(&q.Email, &q.Name, &q.AskedAt)
		})
		return err
	})
	return g, err
}

// Create founds a group with who as its admin.
func (s *Service) Create(ctx context.Context, who, key, name, kind string) (Group, error) {
	n, err := cleanName(name)
	if err != nil || !validKind(kind) {
		return Group{}, ErrInvalid
	}
	hash, err := idempotency.Hash("create-group", []string{n, kind})
	if err != nil {
		return Group{}, err
	}
	var id int64
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, who, "create-group", hash)
		if err != nil {
			return err
		}
		if claim.Replay {
			id, err = strconv.ParseInt(claim.ResourceID, 10, 64)
			return err
		}
		if err := tx.QueryRow(ctx,
			`INSERT INTO groups (name, kind, created_by) VALUES ($1, $2, $3) RETURNING id`, n, kind, who).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO memberships (group_id, email, role) VALUES ($1, $2, 'admin')`, id, who); err != nil {
			return err
		}
		return idempotency.Complete(ctx, tx, key, strconv.FormatInt(id, 10))
	})
	if err != nil {
		return Group{}, err
	}
	return s.Get(ctx, who, id)
}

// Change is what Update changes; nil leaves it.
type Change struct {
	Name, Kind, Area *string
}

// Update changes the name, the kind or where the group plays. The name and
// the kind are the admins'; where it plays any member sets.
func (s *Service) Update(ctx context.Context, who, key string, id int64, c Change) (Group, error) {
	var n string
	if c.Name != nil {
		var err error
		if n, err = cleanName(*c.Name); err != nil {
			return Group{}, err
		}
	}
	if (c.Kind != nil && !validKind(*c.Kind)) || (c.Area != nil && !validArea(*c.Area)) {
		return Group{}, ErrInvalid
	}
	hash, err := idempotency.Hash("update-group", []any{id, c.Name, c.Kind, c.Area})
	if err != nil {
		return Group{}, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, who, "update-group", hash)
		if err != nil || claim.Replay {
			return err
		}
		sum, err := s.summary(ctx, tx, who, id)
		if err != nil {
			return err
		}
		if sum.How != "member" || ((c.Name != nil || c.Kind != nil) && sum.Role != "admin") {
			return ErrForbidden
		}
		if c.Name != nil {
			if _, err := tx.Exec(ctx, `UPDATE groups SET name = $2 WHERE id = $1`, id, n); err != nil {
				return err
			}
		}
		if c.Kind != nil {
			if _, err := tx.Exec(ctx, `UPDATE groups SET kind = $2 WHERE id = $1`, id, *c.Kind); err != nil {
				return err
			}
		}
		if c.Area != nil {
			if _, err := tx.Exec(ctx, `UPDATE groups SET area = $2 WHERE id = $1`, id, *c.Area); err != nil {
				return err
			}
		}
		return idempotency.Complete(ctx, tx, key, strconv.FormatInt(id, 10))
	})
	if err != nil {
		return Group{}, err
	}
	return s.Get(ctx, who, id)
}

// Invite asks email into group id, as who, a member. The platform service
// is asked first: when it fails, nothing is recorded. Inviting someone
// already invited answers their invitation.
func (s *Service) Invite(ctx context.Context, who, key string, id int64, email string) (Invitation, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return Invitation{}, err
	}
	hash, err := idempotency.Hash("group-invite", []any{id, email})
	if err != nil {
		return Invitation{}, err
	}
	var out Invitation
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, who, "group-invite", hash)
		if err != nil {
			return err
		}
		if !claim.Replay {
			if err := s.invite(ctx, tx, who, id, email); err != nil {
				return err
			}
			if err := idempotency.Complete(ctx, tx, key, email); err != nil {
				return err
			}
		}
		err = tx.QueryRow(ctx,
			`SELECT email, invited_by, invited_at FROM group_invitations WHERE group_id = $1 AND email = $2`, id, email).
			Scan(&out.Email, &out.InvitedBy, &out.InvitedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			// Answered since the first attempt.
			return ErrAlready
		}
		return err
	})
	return out, err
}

func (s *Service) invite(ctx context.Context, tx pgx.Tx, who string, id int64, email string) error {
	sum, err := s.summary(ctx, tx, who, id)
	if err != nil {
		return err
	}
	if sum.How != "member" {
		return ErrForbidden
	}
	var member, invited bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM memberships WHERE group_id = $1 AND email = $2),
		        EXISTS (SELECT 1 FROM group_invitations WHERE group_id = $1 AND email = $2)`, id, email).
		Scan(&member, &invited); err != nil {
		return err
	}
	if member {
		return ErrAlready
	}
	if invited {
		return nil
	}
	var open, today int
	if err := tx.QueryRow(ctx,
		`SELECT count(*), count(*) FILTER (WHERE invited_at > now() - interval '1 day')
		   FROM group_invitations WHERE invited_by = $1`, who).Scan(&open, &today); err != nil {
		return err
	}
	if open >= MaxOpenInvitations || today >= MaxInvitationsADay {
		return ErrLimit
	}
	if err := s.platform.InviteAs(ctx, email, Ref(id)); err != nil {
		return fmt.Errorf("%w: %w", ErrPlatform, err)
	}
	// A request to join is answered by the invitation.
	if _, err := tx.Exec(ctx, `DELETE FROM join_requests WHERE group_id = $1 AND email = $2`, id, email); err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO group_invitations (group_id, email, invited_by) VALUES ($1, $2, $3)`, id, email, who)
	return err
}

// DropInvitation takes an invitation back (whoever sent it, or an admin)
// or declines it (the person invited). Safe to repeat.
func (s *Service) DropInvitation(ctx context.Context, who string, id int64, email string) error {
	email, err := NormalizeEmail(email)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		sum, err := s.summary(ctx, tx, who, id)
		if errors.Is(err, ErrNotFound) && who == email {
			// Declined already: the group is out of sight.
			return nil
		}
		if err != nil {
			return err
		}
		var by string
		err = tx.QueryRow(ctx,
			`SELECT invited_by FROM group_invitations WHERE group_id = $1 AND email = $2 FOR UPDATE`, id, email).Scan(&by)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if who != email && who != by && sum.Role != "admin" {
			return ErrForbidden
		}
		if err := s.platform.WithdrawAs(ctx, email, Ref(id)); err != nil {
			return fmt.Errorf("%w: %w", ErrPlatform, err)
		}
		_, err = tx.Exec(ctx, `DELETE FROM group_invitations WHERE group_id = $1 AND email = $2`, id, email)
		return err
	})
}

// Joined is what joining did: member, or requested on a group that is
// open on request.
type Joined string

// What joining can do.
const (
	JoinedMember    Joined = "member"
	JoinedRequested Joined = "requested"
)

// Join puts who into group id: accepting an invitation, joining an open
// group, or asking into one that is open on request.
func (s *Service) Join(ctx context.Context, who, key string, id int64) (Joined, error) {
	hash, err := idempotency.Hash("join", id)
	if err != nil {
		return "", err
	}
	var out Joined
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, who, "join", hash)
		if err != nil {
			return err
		}
		if claim.Replay {
			out = Joined(claim.ResourceID)
			return nil
		}
		sum, err := s.summary(ctx, tx, who, id)
		if err != nil {
			return err
		}
		switch {
		case sum.How == "member":
			out = JoinedMember
		case sum.How == "invited" || sum.Kind == Open:
			// An invitation's ref stays with the platform service: it now
			// stands for the membership, and goes when they leave.
			if _, err := tx.Exec(ctx,
				`DELETE FROM group_invitations WHERE group_id = $1 AND email = $2`, id, who); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx,
				`DELETE FROM join_requests WHERE group_id = $1 AND email = $2`, id, who); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO memberships (group_id, email, role) VALUES ($1, $2, 'member')`, id, who); err != nil {
				return err
			}
			out = JoinedMember
		default: // on request
			if _, err := tx.Exec(ctx,
				`INSERT INTO join_requests (group_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, who); err != nil {
				return err
			}
			out = JoinedRequested
		}
		return idempotency.Complete(ctx, tx, key, string(out))
	})
	return out, err
}

// Admit lets someone who asked into group id in; any member may. Safe to
// repeat.
func (s *Service) Admit(ctx context.Context, who string, id int64, email string) error {
	email, err := NormalizeEmail(email)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		sum, err := s.summary(ctx, tx, who, id)
		if err != nil {
			return err
		}
		if sum.How != "member" {
			return ErrForbidden
		}
		tag, err := tx.Exec(ctx, `DELETE FROM join_requests WHERE group_id = $1 AND email = $2`, id, email)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			var member bool
			if err := tx.QueryRow(ctx,
				`SELECT EXISTS (SELECT 1 FROM memberships WHERE group_id = $1 AND email = $2)`, id, email).Scan(&member); err != nil {
				return err
			}
			if member {
				return nil
			}
			return ErrNotFound
		}
		_, err = tx.Exec(ctx,
			`INSERT INTO memberships (group_id, email, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, id, email)
		return err
	})
}

// DropRequest turns a request down (a member) or takes it back (the person
// who asked). Safe to repeat.
func (s *Service) DropRequest(ctx context.Context, who string, id int64, email string) error {
	email, err := NormalizeEmail(email)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		sum, err := s.summary(ctx, tx, who, id)
		if err != nil {
			return err
		}
		if who != email && sum.How != "member" {
			return ErrForbidden
		}
		_, err = tx.Exec(ctx, `DELETE FROM join_requests WHERE group_id = $1 AND email = $2`, id, email)
		return err
	})
}

// Remove takes email out of group id: who leaving, or an admin removing
// them. When the last admin goes, the member longest in becomes admin; when
// the last member goes, the group goes, and its open invitations with it.
// Safe to repeat.
func (s *Service) Remove(ctx context.Context, who string, id int64, email string) error {
	email, err := NormalizeEmail(email)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		sum, err := s.summary(ctx, tx, who, id)
		if err != nil {
			return err
		}
		if who != email && sum.Role != "admin" {
			return ErrForbidden
		}
		if _, err := tx.Exec(ctx, `SELECT 1 FROM groups WHERE id = $1 FOR UPDATE`, id); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM memberships WHERE group_id = $1 AND email = $2`, id, email)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		if err := s.platform.WithdrawAs(ctx, email, Ref(id)); err != nil {
			return fmt.Errorf("%w: %w", ErrPlatform, err)
		}
		var left, admins int
		if err := tx.QueryRow(ctx,
			`SELECT count(*), count(*) FILTER (WHERE role = 'admin') FROM memberships WHERE group_id = $1`, id).
			Scan(&left, &admins); err != nil {
			return err
		}
		switch {
		case left == 0:
			return s.dissolve(ctx, tx, id)
		case admins == 0:
			_, err = tx.Exec(ctx,
				`UPDATE memberships SET role = 'admin'
				  WHERE (group_id, email) = (SELECT group_id, email FROM memberships
				                              WHERE group_id = $1 ORDER BY joined_at, email LIMIT 1)`, id)
		}
		return err
	})
}

func (s *Service) dissolve(ctx context.Context, tx pgx.Tx, id int64) error {
	rows, err := tx.Query(ctx, `SELECT email FROM group_invitations WHERE group_id = $1`, id)
	if err != nil {
		return err
	}
	invited, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, e := range invited {
		if err := s.platform.WithdrawAs(ctx, e, Ref(id)); err != nil {
			return fmt.Errorf("%w: %w", ErrPlatform, err)
		}
	}
	_, err = tx.Exec(ctx, `DELETE FROM groups WHERE id = $1`, id)
	return err
}
