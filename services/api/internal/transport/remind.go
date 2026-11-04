package transport

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"

	"github.com/seburgi/burgstaller-platform/kit/go/gateway"

	"github.com/seburgi/padel-kaernten/services/api/internal/availability"
	"github.com/seburgi/padel-kaernten/services/api/internal/notify"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/problem"
)

// RemindOpen is how many open days of the 14 bring the reminder (Seb,
// 2026-11-04: "Nehmen wir 5 Tage").
const RemindOpen = 5

// remindTask is POST /remind, Cloud Scheduler on Sundays at 18:00
// (docs/design/notify.md): everyone in a group with at least RemindOpen
// days of the window neither entered nor declined hears so. Only the
// scheduler's account may call it. Each person's message is named by the
// day, so a second run that day tells nobody twice.
func (h *Handler) remindTask(w http.ResponseWriter, r *http.Request) {
	if h.RemindCaller == "" || gateway.CallerOf(r) != h.RemindCaller {
		problem.Write(w, problem.New(http.StatusForbidden, "not-the-scheduler", "Only the scheduler reminds", ""))
		return
	}
	ctx := r.Context()
	members, err := h.Groups.Members(ctx)
	if err != nil {
		h.internal(w, r, "reading the members", err)
		return
	}
	entered, err := h.Availability.Entered(ctx, members)
	if err != nil {
		h.internal(w, r, "counting entered days", err)
		return
	}
	today, _ := h.Availability.Window()
	reminded := 0
	for _, email := range members {
		open := availability.Days - entered[email]
		if open < RemindOpen || h.Queue == nil {
			continue
		}
		sum := sha256.Sum256([]byte(email))
		name := fmt.Sprintf("remind-%s-%s", today, hex.EncodeToString(sum[:8]))
		if err := h.Queue.Enqueue(ctx, name, remindMessage(email, open)); err != nil {
			h.internal(w, r, "queueing a reminder", err)
			return
		}
		reminded++
	}
	h.Log.InfoContext(ctx, "reminded", "members", len(members), "reminded", reminded)
	writeJSON(w, http.StatusOK, map[string]int{"members": len(members), "reminded": reminded})
}

// remindMessage asks email to say when they can; a newer one replaces it.
func remindMessage(email string, open int) notify.Message {
	return notify.Message{
		To:    []string{email},
		Title: "Wann kannst du?",
		Body:  fmt.Sprintf("In den nächsten zwei Wochen sind noch %d Tage offen. Sag, wann du kannst, oder „Passt nicht“.", open),
		URL:   "/availability",
		Tag:   "remind",
	}
}
