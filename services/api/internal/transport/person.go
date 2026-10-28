package transport

// Who is calling: a person the gateway signed in
// (burgstaller-platform standards/auth/checking-the-note.md).

import (
	"net/http"

	"github.com/seburgi/burgstaller-platform/kit/go/gateway"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/localgateway"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/problem"
)

// Gateway is how the API knows the gateway in front of it.
type Gateway struct {
	// Caller is the gateway's own account; only it may hand on a person.
	Caller string
	// Address is the app's own, padel.burgstaller.me.
	Address string
	Keys    *gateway.Keys
	// Local is the stand-in on a laptop (ENVIRONMENT=local), nil when
	// deployed. With it there is no gateway account to check, and the note
	// comes from its cookie or a plain Authorization: Bearer.
	Local *localgateway.Gateway
}

// person is the signed-in address of a request the gateway handed on, or
// a problem already written, in the standard's order: the caller, the
// CSRF check for writes, then the note.
func (h *Handler) person(w http.ResponseWriter, r *http.Request) (string, bool) {
	g := h.Gateway
	if g != nil && g.Local != nil {
		return h.verified(w, r, localgateway.NoteOf(r))
	}
	if g == nil || g.Caller == "" || gateway.CallerOf(r) != g.Caller || r.Header.Get(gateway.ServerlessAuthorization) == "" {
		problem.Write(w, problem.New(http.StatusForbidden, "not-the-gateway", "Only through the sign-in gateway", ""))
		return "", false
	}
	if !sameOrigin(r, g.Address) {
		problem.Write(w, problem.New(http.StatusForbidden, "cross-site", "Only from the app's own pages", ""))
		return "", false
	}
	return h.verified(w, r, gateway.AssertionOf(r))
}

// verified is the address the note names, once its signature, address
// and time check out.
func (h *Handler) verified(w http.ResponseWriter, r *http.Request, note string) (string, bool) {
	email, err := h.Gateway.Keys.Verify(r.Context(), note)
	if err != nil {
		h.Log.WarnContext(r.Context(), "a note the app does not take", "error", err)
		problem.Write(w, problem.New(http.StatusUnauthorized, "not-signed-in", "Sign in again", ""))
		return "", false
	}
	return email, true
}

// owner is the owner's address when the request comes from them, or a
// problem already written.
func (h *Handler) owner(w http.ResponseWriter, r *http.Request) (string, bool) {
	email, ok := h.person(w, r)
	if !ok {
		return "", false
	}
	if h.Owner == "" || email != h.Owner {
		problem.Write(w, problem.New(http.StatusForbidden, "not-owner", "Only Seb invites", ""))
		return "", false
	}
	return email, true
}

// sameOrigin is the CSRF defence for writes: the gateway's cookie goes with
// any request to the address, so a change must come from the app's own
// pages. No Origin and no Sec-Fetch-Site is not a browser, and passes.
func sameOrigin(r *http.Request, address string) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	switch r.Header.Get("Sec-Fetch-Site") {
	case "same-origin", "none":
		return true
	case "":
		origin := r.Header.Get("Origin")
		return origin == "" || origin == "https://"+address
	}
	return false
}
