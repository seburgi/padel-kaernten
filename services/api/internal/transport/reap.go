package transport

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/seburgi/burgstaller-platform/kit/go/gateway"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/problem"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/retention"
)

// reap is POST /reap, the nightly retention run (burgstaller-platform
// standards/data/retention.md). Only the scheduler's account may call it;
// the gateway calls with its own and is refused like anyone else.
// ?dry_run=true says what it would delete and deletes nothing.
func (h *Handler) reap(w http.ResponseWriter, r *http.Request) {
	if h.Reap == nil || h.ReapCaller == "" || gateway.CallerOf(r) != h.ReapCaller {
		problem.Write(w, problem.New(http.StatusForbidden, "not-the-scheduler", "Only the scheduler reaps", ""))
		return
	}
	dry, _ := strconv.ParseBool(r.URL.Query().Get("dry_run"))
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Minute)
	defer cancel()
	results, err := h.Reap(ctx, dry)
	for _, res := range results {
		h.Log.InfoContext(ctx, "reaped", "table", res.Table, "rows", res.Rows, "windowDays", res.Days, "dryRun", res.Dry)
	}
	switch {
	case errors.Is(err, retention.ErrBusy):
		problem.Write(w, problem.New(http.StatusConflict, "reap-running", "Another run is going", ""))
		return
	case err != nil:
		h.internal(w, r, "reaping", err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(results)
}
