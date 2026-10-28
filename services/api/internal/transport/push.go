package transport

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/seburgi/burgstaller-platform/kit/go/gateway"

	"github.com/seburgi/padel-kaernten/services/api/internal/games"
	"github.com/seburgi/padel-kaernten/services/api/internal/groups"
	"github.com/seburgi/padel-kaernten/services/api/internal/notify"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/problem"
	"github.com/seburgi/padel-kaernten/services/api/internal/transport/gen"
)

// GetPush is the VAPID public key, or nothing when push is off.
func (h *Handler) GetPush(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.person(w, r); !ok {
		return
	}
	var info gen.PushInfo
	if h.Push != nil && h.Push.Key != nil {
		key := h.Push.Key.Public()
		info.PublicKey = &key
	}
	writeJSON(w, http.StatusOK, info)
}

// SubscribePush keeps this browser for the caller. The upsert is
// idempotent by itself, so the key is not claimed.
func (h *Handler) SubscribePush(w http.ResponseWriter, r *http.Request, id gen.SubscriptionId, _ gen.SubscribePushParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.PushSubscription
	if !decode(w, r, &body) {
		return
	}
	if notify.ID(body.Endpoint) != id {
		problem.Write(w, problem.New(http.StatusBadRequest, "invalid-subscription", "The id is not the endpoint's", ""))
		return
	}
	if h.Push == nil {
		problem.Write(w, problem.New(http.StatusConflict, "push-off", "Notifications are off", ""))
		return
	}
	_, err := h.Push.Subscribe(r.Context(), email, notify.Subscription{Endpoint: body.Endpoint, P256dh: body.Keys.P256dh, Auth: body.Keys.Auth})
	switch {
	case errors.Is(err, notify.ErrOff):
		problem.Write(w, problem.New(http.StatusConflict, "push-off", "Notifications are off", ""))
	case errors.Is(err, notify.ErrInvalid):
		problem.Write(w, problem.New(http.StatusBadRequest, "invalid-subscription", "Not a subscription the API can send to", ""))
	case err != nil:
		h.internal(w, r, "subscribing", err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// UnsubscribePush forgets one of the caller's browsers.
func (h *Handler) UnsubscribePush(w http.ResponseWriter, r *http.Request, id gen.SubscriptionId) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	if h.Push != nil {
		if err := h.Push.Unsubscribe(r.Context(), email, id); err != nil {
			h.internal(w, r, "unsubscribing", err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// notifyTask is POST /tasks/notify, the queue's task coming back: it sends
// the message. Only the API's own account may call it, as Cloud Tasks
// does; the gateway calls with its own and is refused.
func (h *Handler) notifyTask(w http.ResponseWriter, r *http.Request) {
	if h.Push == nil || h.NotifyCaller == "" || gateway.CallerOf(r) != h.NotifyCaller {
		problem.Write(w, problem.New(http.StatusForbidden, "not-the-queue", "Only the queue sends", ""))
		return
	}
	var m notify.Message
	if !decode(w, r, &m) {
		return
	}
	rep, err := h.Push.Deliver(r.Context(), m)
	if err != nil {
		// The queue tries again.
		h.internal(w, r, "sending pushes", err)
		return
	}
	h.Log.InfoContext(r.Context(), "pushed", "tag", m.Tag, "people", len(m.To), "sent", rep.Sent, "dropped", rep.Dropped, "failed", rep.Failed)
	writeJSON(w, http.StatusOK, rep)
}

// GameChanged tells the people a game's event concerns, through the
// queue (docs/design/notify.md). It never fails the write that caused it.
func (h *Handler) GameChanged(ctx context.Context, e games.Event) {
	if h.Queue == nil {
		return
	}
	grp, err := h.Groups.Get(ctx, e.Who, e.Game.GroupID)
	if err != nil {
		h.Log.ErrorContext(ctx, "notify: reading the group", "error", err, "game", e.Game.ID)
		return
	}
	m, ok := gameMessage(e, grp)
	if !ok {
		return
	}
	sum := sha256.Sum256([]byte(e.Key))
	name := fmt.Sprintf("game-%d-%s-%s", e.Game.ID, e.Kind, hex.EncodeToString(sum[:8]))
	if err := h.Queue.Enqueue(ctx, name, m); err != nil {
		h.Log.ErrorContext(ctx, "notify: enqueue", "error", err, "game", e.Game.ID, "event", e.Kind)
	}
}

// gameMessage is what an event says, in German, and to whom; false when
// nobody needs to hear it.
func gameMessage(e games.Event, grp groups.Group) (notify.Message, bool) {
	g := e.Game
	name := names(grp)
	who := func(email string) string {
		if n := name[email]; n != "" {
			return n
		}
		local, _, _ := strings.Cut(email, "@")
		return local
	}
	when := whenText(g.Day, g.Start)
	m := notify.Message{URL: fmt.Sprintf("/games/%d", g.ID), Tag: fmt.Sprintf("game-%d", g.ID)}
	var to []string
	switch e.Kind {
	case games.EventProposed:
		for _, p := range grp.List {
			to = append(to, p.Email)
		}
		m.Title = "Neues Spiel: " + when
		m.Body = fmt.Sprintf("%s schlägt %s vor, %s. Bist du dabei?", who(g.ProposedBy), g.VenueName, spanText(g.Start, g.Minutes))
	case games.EventFull:
		to = []string{g.ProposedBy}
		m.Title = "Ihr seid vier"
		m.Body = fmt.Sprintf("%s in %s: %s hat zugesagt. Jetzt buchen.", when, g.VenueName, who(e.Who))
	case games.EventMovedUp:
		to = []string{e.Who}
		m.Title = "Du bist nachgerückt"
		m.Body = fmt.Sprintf("%s in %s: du spielst mit.", when, g.VenueName)
	case games.EventBooked:
		to = lineup(g, games.In)
		m.Title = "Gebucht: " + when
		m.Body = fmt.Sprintf("%s, %s. %s hat gebucht.", g.VenueName, g.Court, who(g.ProposedBy))
	case games.EventCancelled:
		to = lineup(g, games.In, games.Reserve)
		m.Title = "Abgesagt: " + when
		m.Body = fmt.Sprintf("%s hat das Spiel in %s abgesagt.", who(g.ProposedBy), g.VenueName)
	}
	// Nobody hears of what they did themselves.
	for _, email := range to {
		if email != e.Who || e.Kind == games.EventMovedUp {
			m.To = append(m.To, email)
		}
	}
	return m, len(m.To) > 0
}

func lineup(g games.Game, states ...string) []string {
	var out []string
	for _, p := range g.Lineup {
		for _, s := range states {
			if p.State == s {
				out = append(out, p.Email)
			}
		}
	}
	return out
}

var weekdays = [...]string{"So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"}

// whenText is "Do 30.10., 18:00".
func whenText(day string, start int) string {
	d, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return day
	}
	return fmt.Sprintf("%s %d.%d., %s", weekdays[d.Weekday()], d.Day(), int(d.Month()), clockText(start))
}

func clockText(m int) string { return fmt.Sprintf("%d:%02d", m/60, m%60) }

// spanText is "18:00–19:30".
func spanText(start, minutes int) string {
	return clockText(start) + "–" + clockText(start+minutes)
}
