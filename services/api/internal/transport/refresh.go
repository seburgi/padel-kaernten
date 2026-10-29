package transport

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/seburgi/burgstaller-platform/kit/go/gateway"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/problem"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots"
)

// refreshTask is POST /refresh, Cloud Scheduler every 30 minutes
// (docs/design/slots.md), so the app opens on courts at most half an hour
// old without anyone waiting for the sites. Only the scheduler's account
// may call it. The five minutes hold here too: right after someone's
// refresh it asks nobody.
func (h *Handler) refreshTask(w http.ResponseWriter, r *http.Request) {
	if h.RefreshCaller == "" || gateway.CallerOf(r) != h.RefreshCaller {
		problem.Write(w, problem.New(http.StatusForbidden, "not-the-scheduler", "Only the scheduler refreshes", ""))
		return
	}
	snap, err := h.Slots.Refresh(r.Context(), "scheduler", uuid.NewString())
	switch {
	case errors.Is(err, slots.ErrSitesFailed):
		h.Log.ErrorContext(r.Context(), "scheduled refresh failed", "error", err)
		problem.Write(w, problem.New(http.StatusBadGateway, "sites-failed", "The booking sites did not answer", ""))
		return
	case err != nil:
		h.internal(w, r, "refreshing", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"takenAt": snap.TakenAt.UTC().Format(time.RFC3339)})
}
