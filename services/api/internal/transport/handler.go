// Package transport is the API's HTTP side: it implements the server
// interface generated from api/openapi.yaml, works out who is calling and
// serves the app. The slices have no handlers of their own
// (burgstaller-platform standards/architecture/slices.md).
package transport

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/seburgi/padel-kaernten/services/api/internal/availability"
	"github.com/seburgi/padel-kaernten/services/api/internal/games"
	"github.com/seburgi/padel-kaernten/services/api/internal/groups"
	"github.com/seburgi/padel-kaernten/services/api/internal/invitations"
	"github.com/seburgi/padel-kaernten/services/api/internal/notify"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/problem"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/retention"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots"
	"github.com/seburgi/padel-kaernten/services/api/internal/transport/gen"
	"github.com/seburgi/padel-kaernten/services/api/internal/whatsnew"
)

// Handler answers every route of the contract.
type Handler struct {
	Slots       *slots.Service
	Invitations *invitations.Service
	WhatsNew    *whatsnew.Service
	Groups      *groups.Service
	// Availability counts the days each member entered.
	Availability *availability.Service
	Games        *games.Service
	Gateway      *Gateway
	// Owner is the one address that may invite (OWNER_EMAIL).
	Owner    string
	Revision string
	Log      *slog.Logger
	// Reap is the nightly retention run; ReapCaller the one account that
	// may start it (POST /reap).
	Reap       func(ctx context.Context, dry bool) ([]retention.Result, error)
	ReapCaller string
	// Push keeps the browsers and sends; nil is no push at all. Queue takes
	// the messages to send (Cloud Tasks, or at once on a laptop), and
	// NotifyCaller is the one account POST /tasks/notify takes.
	Push         *notify.Service
	Queue        notify.Queue
	NotifyCaller string
}

var _ gen.ServerInterface = (*Handler)(nil)

// GetClientConfig has no flags yet.
func (h *Handler) GetClientConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, gen.ClientConfig{Features: map[string]bool{}})
}

// GetVersion is the running build.
func (h *Handler) GetVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, gen.Version{Revision: h.Revision})
}

// GetMe is the signed-in person.
func (h *Handler) GetMe(w http.ResponseWriter, r *http.Request) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	p, err := h.Groups.Seen(r.Context(), email)
	if err != nil {
		h.internal(w, r, "recording a visit", err)
		return
	}
	writeJSON(w, http.StatusOK, h.me(p))
}

// GetSlots is the latest snapshot, 304 when the client has it.
func (h *Handler) GetSlots(w http.ResponseWriter, r *http.Request, params gen.GetSlotsParams) {
	if _, ok := h.person(w, r); !ok {
		return
	}
	snap, err := h.Slots.Latest(r.Context())
	if errors.Is(err, slots.ErrNone) {
		problem.Write(w, problem.New(http.StatusServiceUnavailable, "no-snapshot",
			"No free courts yet", "The booking sites have not been asked yet; refresh."))
		return
	}
	if err != nil {
		h.internal(w, r, "reading the snapshot", err)
		return
	}
	tag := etag(snap)
	w.Header().Set("ETag", tag)
	w.Header().Set("Cache-Control", "no-cache")
	if params.IfNoneMatch != nil && *params.IfNoneMatch == tag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeRaw(w, http.StatusOK, snap.JSON)
}

// RefreshSlots asks the booking sites again when the snapshot is older than
// five minutes.
func (h *Handler) RefreshSlots(w http.ResponseWriter, r *http.Request, params gen.RefreshSlotsParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	snap, err := h.Slots.Refresh(r.Context(), email, params.IdempotencyKey.String())
	switch {
	case err == nil:
		w.Header().Set("ETag", etag(snap))
		writeRaw(w, http.StatusOK, snap.JSON)
	case errors.Is(err, idempotency.ErrKeyReused):
		keyReused(w)
	case errors.Is(err, slots.ErrSitesFailed):
		h.Log.ErrorContext(r.Context(), "refresh failed", "error", err)
		problem.Write(w, problem.New(http.StatusBadGateway, "sites-failed",
			"The booking sites did not answer", "The last free courts stay; try again in a moment."))
	default:
		h.internal(w, r, "refreshing", err)
	}
}

// ListInvitations is a page of the owner's invitations.
func (h *Handler) ListInvitations(w http.ResponseWriter, r *http.Request, params gen.ListInvitationsParams) {
	if _, ok := h.owner(w, r); !ok {
		return
	}
	limit := 50
	if params.Limit != nil {
		limit = *params.Limit
	}
	if limit < 1 || limit > 200 {
		problem.Write(w, problem.New(http.StatusBadRequest, "invalid-limit", "limit is 1 to 200", ""))
		return
	}
	after := ""
	if params.Cursor != nil && *params.Cursor != "" {
		b, err := base64.RawURLEncoding.DecodeString(*params.Cursor)
		if err != nil {
			problem.Write(w, problem.New(http.StatusBadRequest, "invalid-cursor", "Not a cursor this app made", ""))
			return
		}
		after = string(b)
	}
	list, err := h.Invitations.List(r.Context(), after, limit+1)
	if err != nil {
		h.internal(w, r, "listing invitations", err)
		return
	}
	page := gen.InvitationPage{Items: []gen.Invitation{}}
	if len(list) > limit {
		list = list[:limit]
		next := base64.RawURLEncoding.EncodeToString([]byte(list[limit-1].Email))
		page.NextCursor = &next
	}
	for _, i := range list {
		page.Items = append(page.Items, invitation(i))
	}
	writeJSON(w, http.StatusOK, page)
}

// Invite lets someone in.
func (h *Handler) Invite(w http.ResponseWriter, r *http.Request, params gen.InviteParams) {
	who, ok := h.owner(w, r)
	if !ok {
		return
	}
	var body gen.NewInvitation
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		problem.Write(w, problem.New(http.StatusBadRequest, "bad-request", "Bad request", "The body is not an invitation."))
		return
	}
	inv, err := h.Invitations.Invite(r.Context(), who, params.IdempotencyKey.String(), body.Email)
	switch {
	case err == nil:
		writeJSON(w, http.StatusCreated, invitation(inv))
	case errors.Is(err, invitations.ErrInvalid):
		invalidEmail(w)
	case errors.Is(err, idempotency.ErrKeyReused):
		keyReused(w)
	case errors.Is(err, invitations.ErrPlatform):
		h.platformFailed(w, r, err)
	default:
		h.internal(w, r, "inviting", err)
	}
}

// WithdrawInvitation takes an invitation back.
func (h *Handler) WithdrawInvitation(w http.ResponseWriter, r *http.Request, email string) {
	if _, ok := h.owner(w, r); !ok {
		return
	}
	err := h.Invitations.Withdraw(r.Context(), email)
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, invitations.ErrInvalid):
		invalidEmail(w)
	case errors.Is(err, invitations.ErrPlatform):
		h.platformFailed(w, r, err)
	default:
		h.internal(w, r, "withdrawing", err)
	}
}

// ListReleaseNotes is What's new, each note saying whether the caller has
// read it.
func (h *Handler) ListReleaseNotes(w http.ResponseWriter, r *http.Request) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	notes, err := h.WhatsNew.List(r.Context(), email)
	if err != nil {
		h.internal(w, r, "listing release notes", err)
		return
	}
	list := gen.ReleaseNoteList{Items: make([]gen.ReleaseNote, 0, len(notes))}
	for _, n := range notes {
		item := gen.ReleaseNote{Slug: n.Slug, Area: n.Area, Title: n.Title, Paragraphs: n.Paragraphs, Read: n.Read}
		if d, err := time.Parse(time.DateOnly, n.Date); err == nil {
			item.Date.Time = d
		}
		if n.Link != "" {
			link := n.Link
			item.Link = &link
		}
		list.Items = append(list.Items, item)
	}
	writeJSON(w, http.StatusOK, list)
}

// MarkReleaseNotesRead records that the caller has seen these notes.
func (h *Handler) MarkReleaseNotesRead(w http.ResponseWriter, r *http.Request, params gen.MarkReleaseNotesReadParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.ReleaseNotesRead
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil || len(body.Slugs) > 1000 {
		problem.Write(w, problem.New(http.StatusBadRequest, "bad-request", "Bad request", "The body is not a list of notes."))
		return
	}
	err := h.WhatsNew.MarkRead(r.Context(), email, params.IdempotencyKey.String(), body.Slugs)
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, idempotency.ErrKeyReused):
		keyReused(w)
	default:
		h.internal(w, r, "marking release notes read", err)
	}
}

func invitation(i invitations.Invitation) gen.Invitation {
	return gen.Invitation{Email: i.Email, InvitedAt: i.InvitedAt.UTC().Truncate(time.Second)}
}

func etag(s slots.Snapshot) string { return fmt.Sprintf(`"%d"`, s.TakenAt.UnixNano()) }

func invalidEmail(w http.ResponseWriter) {
	problem.Write(w, problem.New(http.StatusBadRequest, "invalid-email", "Not an email address", "Write one address, like name@example.at."))
}

func keyReused(w http.ResponseWriter) {
	problem.Write(w, problem.New(http.StatusConflict, "idempotency-key-reused",
		"This request was already sent differently", "Send it again with a new Idempotency-Key."))
}

func (h *Handler) platformFailed(w http.ResponseWriter, r *http.Request, err error) {
	h.Log.ErrorContext(r.Context(), "the platform service failed", "error", err)
	problem.Write(w, problem.New(http.StatusBadGateway, "platform-failed",
		"Sign-in did not answer", "Nothing was changed; try again."))
}

func (h *Handler) internal(w http.ResponseWriter, r *http.Request, what string, err error) {
	h.Log.ErrorContext(r.Context(), what, "error", err)
	problem.Write(w, problem.New(http.StatusInternalServerError, "internal", "Something went wrong", ""))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeRaw(w http.ResponseWriter, status int, b []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(b)
}
