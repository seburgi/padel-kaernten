package transport

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/seburgi/burgstaller-platform/kit/go/gateway"

	"github.com/seburgi/padel-kaernten/services/api/internal/games"
	"github.com/seburgi/padel-kaernten/services/api/internal/groups"
	"github.com/seburgi/padel-kaernten/services/api/internal/notify"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/problem"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots"
)

// The hours (Vienna) of the hourly run's messages that wait for a time of
// day (docs/design/notify.md): fits from the morning to the evening, the
// reminder before a game from the evening before.
const (
	FitsFrom   = 8
	FitsUntil  = 20
	BeforeFrom = 18
	// FitsDays is how far ahead a new fit is told of: today and two more.
	FitsDays = 3
)

// nudgeTask is POST /nudge, Cloud Scheduler every hour (Seb, 2026-11-04,
// usability plan 3, 4, 5 and 11): it tells of what nobody asked for yet,
// each thing once (notify.Once):
//   - stale: whoever proposed a game that still lacks people, a day before;
//   - missing: when a game lacks one, the members who have not answered,
//     drive there and might have time;
//   - before: from 18:00, whoever plays a booked game tomorrow;
//   - fits: from 8:00 to 20:00, a new 90-minute time in the next three days
//     when four of a group can and a court is free, to those who can.
//
// Only the scheduler's account may call it.
func (h *Handler) nudgeTask(w http.ResponseWriter, r *http.Request) {
	if h.NudgeCaller == "" || gateway.CallerOf(r) != h.NudgeCaller {
		problem.Write(w, problem.New(http.StatusForbidden, "not-the-scheduler", "Only the scheduler nudges", ""))
		return
	}
	if h.Push == nil || h.Queue == nil {
		writeJSON(w, http.StatusOK, map[string]int{})
		return
	}
	ctx := r.Context()
	n := nudger{h: h, ctx: ctx, w: h.Games.Window(), sent: map[string]int{}}
	ahead, err := h.Games.Ahead(ctx)
	if err == nil {
		err = n.games(ahead)
	}
	if err == nil {
		err = n.fits(ahead)
	}
	if err != nil {
		h.internal(w, r, "nudging", err)
		return
	}
	h.Log.InfoContext(ctx, "nudged", "stale", n.sent["stale"], "missing", n.sent["missing"],
		"before", n.sent["before"], "fits", n.sent["fits"])
	writeJSON(w, http.StatusOK, n.sent)
}

type nudger struct {
	h    *Handler
	ctx  context.Context
	w    games.Window
	sent map[string]int
	// groups by id, read once.
	all map[int64]groups.Group
}

// minutesUntil is how long from now in Vienna until day at start.
func (n *nudger) minutesUntil(day string, start int) int {
	today, _ := time.Parse(time.DateOnly, n.w.Today)
	d, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return -1
	}
	return int(d.Sub(today).Hours()/24)*24*60 + start - n.w.NotBefore
}

func (n *nudger) group(id int64) (groups.Group, error) {
	if n.all == nil {
		all, err := n.h.Groups.All(n.ctx)
		if err != nil {
			return groups.Group{}, err
		}
		n.all = map[int64]groups.Group{}
		for _, g := range all {
			n.all[g.ID] = g
		}
	}
	return n.all[id], nil
}

// send claims key and queues m; nothing when key was told of already or
// m is to nobody.
func (n *nudger) send(kind, key string, m notify.Message) error {
	if len(m.To) == 0 {
		return nil
	}
	first, err := n.h.Push.Once(n.ctx, key)
	if err != nil || !first {
		return err
	}
	m.Kind = kind
	if err := n.h.Queue.Enqueue(n.ctx, key, m); err != nil {
		return err
	}
	n.sent[kind]++
	return nil
}

func (n *nudger) games(ahead []games.Game) error {
	hour := n.w.NotBefore / 60
	tomorrow := ""
	if t, err := time.Parse(time.DateOnly, n.w.Today); err == nil {
		tomorrow = t.AddDate(0, 0, 1).Format(time.DateOnly)
	}
	for _, g := range ahead {
		until := n.minutesUntil(g.Day, g.Start)
		if until <= 0 {
			continue
		}
		in := lineup(g, games.In)
		when := whenText(g.Day, g.Start)
		url := fmt.Sprintf("/games/%d", g.ID)
		switch {
		case g.State == games.Booked:
			if hour >= BeforeFrom && g.Day == tomorrow {
				err := n.send(notify.KindBefore, fmt.Sprintf("before-%d", g.ID), notify.Message{
					To: in, Title: "Morgen: " + spanText(g.Start, g.Minutes),
					Body: fmt.Sprintf("%s, %s. Viel Spaß!", g.VenueName, g.Court), URL: url, Tag: fmt.Sprintf("game-%d", g.ID),
				})
				if err != nil {
					return err
				}
			}
		case g.State == games.Proposed && len(in) < g.Players:
			missing := g.Players - len(in)
			if until <= 24*60 {
				err := n.send(notify.KindStale, fmt.Sprintf("stale-%d", g.ID), notify.Message{
					To: []string{g.ProposedBy}, Title: fmt.Sprintf("Noch %d gesucht", missing),
					Body: fmt.Sprintf("%s in %s: es fehlen noch Leute. Weiter warten oder absagen?", when, g.VenueName),
					URL:  url, Tag: fmt.Sprintf("game-%d", g.ID),
				})
				if err != nil {
					return err
				}
			}
			if missing == 1 {
				if err := n.missing(g, when, url); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// missing asks the members who have not answered, drive to the venue and
// either have time for the whole game or have not said anything that day.
func (n *nudger) missing(g games.Game, when, url string) error {
	grp, err := n.group(g.GroupID)
	if err != nil {
		return err
	}
	ps, err := n.h.players(n.ctx, grp)
	if err != nil {
		return err
	}
	answered := map[string]bool{}
	for _, p := range g.Lineup {
		answered[p.Email] = true
	}
	var to []string
	for _, p := range ps {
		if answered[p.Email] || p.Declined[g.Day] || (len(p.Venues) > 0 && !slices.Contains(p.Venues, g.VenueID)) {
			continue
		}
		spans := p.Days[g.Day]
		covers := slices.ContainsFunc(spans, func(s games.Span) bool { return s.From <= g.Start && s.To >= g.Start+g.Minutes })
		if len(spans) == 0 || covers {
			to = append(to, p.Email)
		}
	}
	return n.send(notify.KindMissing, fmt.Sprintf("missing-%d", g.ID), notify.Message{
		To: to, Title: "Es fehlt nur noch eine Person",
		Body: fmt.Sprintf("%s in %s, %s. Bist du dabei?", when, g.VenueName, spanText(g.Start, g.Minutes)),
		URL:  url, Tag: fmt.Sprintf("game-%d", g.ID), Game: g.ID,
	})
}

// fits tells of the first new 90-minute fit of each group in the next
// FitsDays days, from FitsFrom to FitsUntil, to those who can: once a
// group and day of play. A time that overlaps a game of the group already
// is no news.
func (n *nudger) fits(ahead []games.Game) error {
	hour := n.w.NotBefore / 60
	if hour < FitsFrom || hour >= FitsUntil {
		return nil
	}
	if _, err := n.group(0); err != nil {
		return err
	}
	venuesByArea := map[string][]games.Venue{}
	last := ""
	if t, err := time.Parse(time.DateOnly, n.w.Today); err == nil {
		last = t.AddDate(0, 0, FitsDays-1).Format(time.DateOnly)
	}
	ids := make([]int64, 0, len(n.all))
	for id := range n.all {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		grp := n.all[id]
		if len(grp.List) < games.Players {
			continue
		}
		venues, ok := venuesByArea[grp.Area]
		if !ok {
			v, _, err := n.h.venues(n.ctx, grp.Area)
			if errors.Is(err, slots.ErrNone) {
				return nil // no snapshot yet: no fits to tell of
			}
			if err != nil {
				return err
			}
			venues, venuesByArea[grp.Area] = v, v
		}
		ps, err := n.h.players(n.ctx, grp)
		if err != nil {
			return err
		}
		fits, _ := games.Fits(venues, ps, 90, games.Players, n.w)
		name := names(grp)
		for _, f := range fits {
			if f.Day > last || taken(ahead, id, f) {
				continue
			}
			// One a group and day of play: later starts that day are the
			// same news.
			key := fmt.Sprintf("fits-%d-%s", id, f.Day)
			first, err := n.h.Push.Once(n.ctx, key)
			if err != nil {
				return err
			}
			if !first {
				continue
			}
			who := make([]string, 0, len(f.Can))
			for _, e := range f.Can {
				who = append(who, displayName(name, e))
			}
			m := notify.Message{
				To: f.Can, Kind: notify.KindFits, Title: "Es passt für vier: " + whenText(f.Day, f.Start),
				Body: fmt.Sprintf("%s können, %s hat 90 Minuten frei. Vorschlagen?", strings.Join(who, ", "), f.VenueName),
				URL:  fmt.Sprintf("/groups/%d/fits", id), Tag: fmt.Sprintf("fits-%d", id),
			}
			if err := n.h.Queue.Enqueue(n.ctx, key, m); err != nil {
				return err
			}
			n.sent["fits"]++
			break // one a group a run; the daily cap does the rest
		}
	}
	return nil
}

// taken says whether group already has a game that overlaps fit.
func taken(ahead []games.Game, group int64, f games.Fit) bool {
	return slices.ContainsFunc(ahead, func(g games.Game) bool {
		return g.GroupID == group && g.Day == f.Day && g.Start < f.Start+f.Minutes && f.Start < g.Start+g.Minutes
	})
}

func displayName(name map[string]string, email string) string {
	if n := name[email]; n != "" {
		return n
	}
	local, _, _ := strings.Cut(email, "@")
	return local
}
