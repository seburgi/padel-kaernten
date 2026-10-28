package transport

// Groups and names (docs/design/groups.md). The member list carries how
// many days each member said when they can, from availability: transport
// is where the two slices meet.

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/seburgi/padel-kaernten/services/api/internal/groups"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/problem"
	"github.com/seburgi/padel-kaernten/services/api/internal/transport/gen"
)

// ListGroups is the caller's groups, invitations and the open ones.
func (h *Handler) ListGroups(w http.ResponseWriter, r *http.Request) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	list, err := h.Groups.List(r.Context(), email)
	if err != nil {
		h.internal(w, r, "listing groups", err)
		return
	}
	out := gen.GroupList{Items: make([]gen.GroupSummary, 0, len(list))}
	for _, g := range list {
		out.Items = append(out.Items, groupSummary(g))
	}
	writeJSON(w, http.StatusOK, out)
}

// CreateGroup founds a group.
func (h *Handler) CreateGroup(w http.ResponseWriter, r *http.Request, params gen.CreateGroupParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.NewGroup
	if !decode(w, r, &body) {
		return
	}
	g, err := h.Groups.Create(r.Context(), email, params.IdempotencyKey.String(), body.Name, string(body.Kind))
	h.answerGroup(w, r, http.StatusCreated, g, err)
}

// GetGroup is one group.
func (h *Handler) GetGroup(w http.ResponseWriter, r *http.Request, id gen.GroupId) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	g, err := h.Groups.Get(r.Context(), email, id)
	h.answerGroup(w, r, http.StatusOK, g, err)
}

// UpdateGroup renames a group or changes its kind.
func (h *Handler) UpdateGroup(w http.ResponseWriter, r *http.Request, id gen.GroupId, params gen.UpdateGroupParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.GroupChange
	if !decode(w, r, &body) {
		return
	}
	g, err := h.Groups.Update(r.Context(), email, params.IdempotencyKey.String(), id, body.Name, (*string)(body.Kind))
	h.answerGroup(w, r, http.StatusOK, g, err)
}

// InviteToGroup invites someone into a group.
func (h *Handler) InviteToGroup(w http.ResponseWriter, r *http.Request, id gen.GroupId, params gen.InviteToGroupParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.NewInvitation
	if !decode(w, r, &body) {
		return
	}
	inv, err := h.Groups.Invite(r.Context(), email, params.IdempotencyKey.String(), id, body.Email)
	if err != nil {
		h.groupError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, groupInvitation(inv))
}

// DropGroupInvitation declines an invitation or takes one back.
func (h *Handler) DropGroupInvitation(w http.ResponseWriter, r *http.Request, id gen.GroupId, invited string) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	h.noContent(w, r, h.Groups.DropInvitation(r.Context(), email, id, invited))
}

// JoinGroup accepts an invitation, joins or asks in.
func (h *Handler) JoinGroup(w http.ResponseWriter, r *http.Request, id gen.GroupId, params gen.JoinGroupParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	joined, err := h.Groups.Join(r.Context(), email, params.IdempotencyKey.String(), id)
	if err != nil {
		h.groupError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, gen.Joined{State: string(joined)})
}

// AdmitToGroup lets someone who asked in.
func (h *Handler) AdmitToGroup(w http.ResponseWriter, r *http.Request, id gen.GroupId, admitted string, _ gen.AdmitToGroupParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	err := h.Groups.Admit(r.Context(), email, id, admitted)
	if errors.Is(err, groups.ErrNotFound) {
		// The group was found: what is missing is the request.
		problem.Write(w, problem.New(http.StatusNotFound, "no-request", "They did not ask to join", ""))
		return
	}
	h.noContent(w, r, err)
}

// RemoveFromGroup is leaving, or an admin removing someone.
func (h *Handler) RemoveFromGroup(w http.ResponseWriter, r *http.Request, id gen.GroupId, removed string) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	h.noContent(w, r, h.Groups.Remove(r.Context(), email, id, removed))
}

// DropJoinRequest turns a request down or takes it back.
func (h *Handler) DropJoinRequest(w http.ResponseWriter, r *http.Request, id gen.GroupId, asked string) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	h.noContent(w, r, h.Groups.DropRequest(r.Context(), email, id, asked))
}

// SetMyName sets the name the others see.
func (h *Handler) SetMyName(w http.ResponseWriter, r *http.Request, params gen.SetMyNameParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.NameChange
	if !decode(w, r, &body) {
		return
	}
	p, err := h.Groups.SetName(r.Context(), email, params.IdempotencyKey.String(), body.Name)
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, gen.Me{Email: email, Name: p.Name, CanInvite: email == h.Owner})
	case errors.Is(err, groups.ErrInvalid):
		problem.Write(w, problem.New(http.StatusBadRequest, "invalid-name", "A name is 1 to 40 characters", ""))
	default:
		h.groupError(w, r, err)
	}
}

func (h *Handler) answerGroup(w http.ResponseWriter, r *http.Request, status int, g groups.Group, err error) {
	if err != nil {
		h.groupError(w, r, err)
		return
	}
	emails := make([]string, len(g.List))
	for i, m := range g.List {
		emails[i] = m.Email
	}
	entered, err := h.Availability.Entered(r.Context(), emails)
	if err != nil {
		h.internal(w, r, "counting entered days", err)
		return
	}
	out := gen.Group{
		Id: g.ID, Name: g.Name, Kind: gen.GroupKind(g.Kind), How: g.How, Members: g.Members, Requested: g.Requested,
		MemberList: make([]gen.Member, 0, len(g.List)), Invitations: make([]gen.GroupInvitation, 0, len(g.Invitations)),
		Requests: make([]gen.JoinRequest, 0, len(g.Requests)),
	}
	if g.Role != "" {
		role := g.Role
		out.Role = &role
	}
	for _, m := range g.List {
		out.MemberList = append(out.MemberList, gen.Member{Email: m.Email, Name: m.Name, Role: m.Role,
			JoinedAt: utc(m.JoinedAt), DaysEntered: entered[m.Email]})
	}
	for _, i := range g.Invitations {
		out.Invitations = append(out.Invitations, groupInvitation(i))
	}
	for _, q := range g.Requests {
		out.Requests = append(out.Requests, gen.JoinRequest{Email: q.Email, Name: q.Name, AskedAt: utc(q.AskedAt)})
	}
	writeJSON(w, status, out)
}

func (h *Handler) noContent(w http.ResponseWriter, r *http.Request, err error) {
	if err != nil {
		h.groupError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) groupError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, groups.ErrNotFound):
		problem.Write(w, problem.New(http.StatusNotFound, "no-group", "No such group", ""))
	case errors.Is(err, groups.ErrForbidden):
		problem.Write(w, problem.New(http.StatusForbidden, "not-allowed", "Not allowed in this group", ""))
	case errors.Is(err, groups.ErrInvalid):
		problem.Write(w, problem.New(http.StatusBadRequest, "invalid-group", "A name is 1 to 40 characters; kind is private, on_request or open", ""))
	case errors.Is(err, groups.ErrInvalidEmail):
		invalidEmail(w)
	case errors.Is(err, groups.ErrAlready):
		problem.Write(w, problem.New(http.StatusConflict, "already-member", "Already in the group", ""))
	case errors.Is(err, groups.ErrLimit):
		problem.Write(w, problem.New(http.StatusTooManyRequests, "invite-limit", "Too many invitations",
			"At most 20 open invitations, and 10 new a day."))
	case errors.Is(err, groups.ErrPlatform):
		h.platformFailed(w, r, err)
	case errors.Is(err, idempotency.ErrKeyReused):
		keyReused(w)
	default:
		h.internal(w, r, "groups", err)
	}
}

func groupSummary(g groups.Summary) gen.GroupSummary {
	out := gen.GroupSummary{Id: g.ID, Name: g.Name, Kind: gen.GroupKind(g.Kind), How: g.How, Members: g.Members, Requested: g.Requested}
	if g.Role != "" {
		role := g.Role
		out.Role = &role
	}
	return out
}

func groupInvitation(i groups.Invitation) gen.GroupInvitation {
	return gen.GroupInvitation{Email: i.Email, InvitedBy: i.InvitedBy, InvitedAt: utc(i.InvitedAt)}
}

func utc(t time.Time) time.Time { return t.UTC().Truncate(time.Second) }

// decode reads a JSON body of at most 64 KiB, or writes a 400.
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(v); err != nil {
		problem.Write(w, problem.New(http.StatusBadRequest, "bad-request", "Bad request", "The body is not what this call takes."))
		return false
	}
	return true
}
