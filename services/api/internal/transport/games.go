package transport

// Fits and games (docs/design/games.md). The games slice gets the snapshot,
// the members and their times as plain values from here: transport is where
// slots, groups, availability and games meet.

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/seburgi/padel-kaernten/services/api/internal/games"
	"github.com/seburgi/padel-kaernten/services/api/internal/groups"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/problem"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots/sites"
	"github.com/seburgi/padel-kaernten/services/api/internal/transport/gen"
)

// venues is the latest snapshot as the games slice reads it, with only the
// courts of area (groups.Anywhere for all of them).
func (h *Handler) venues(r *http.Request, area string) ([]games.Venue, time.Time, error) {
	snap, err := h.Slots.Latest(r.Context())
	if err != nil {
		return nil, time.Time{}, err
	}
	var s sites.Snapshot
	if err := json.Unmarshal(snap.JSON, &s); err != nil {
		return nil, time.Time{}, err
	}
	out := make([]games.Venue, len(s.Venues))
	for i, v := range s.Venues {
		gv := games.Venue{ID: v.ID, Name: v.Name, Step: v.Step, Failed: v.Failed, NotBookable: v.NotBookable, Links: v.Links}
		for _, c := range v.Courts {
			if !inArea(c.Area, area) {
				continue
			}
			gc := games.Court{Name: c.Name}
			for _, f := range c.Free {
				slot := games.Slot{Day: f.Day, From: f.From, To: f.To}
				if f.PricePerHour != nil {
					p := f.PricePerHour.Amount
					slot.PricePerHour = &p
				}
				gc.Free = append(gc.Free, slot)
			}
			gv.Courts = append(gv.Courts, gc)
		}
		out[i] = gv
	}
	return out, snap.TakenAt, nil
}

// inArea says whether a court of the snapshot's area counts for a group
// playing in area. Überdacht is weatherproof, so with the halls, as on the
// courts page; a court of unknown area counts only for groups.Anywhere.
func inArea(court, area string) bool {
	if area == groups.Anywhere || area == "" {
		return true
	}
	if court == "ueberdacht" {
		court = groups.Hall
	}
	return court == area
}

// noSnapshot answers when the booking sites were never asked.
func noSnapshot(w http.ResponseWriter) {
	problem.Write(w, problem.New(http.StatusServiceUnavailable, "no-snapshot",
		"No free courts yet", "The booking sites have not been asked yet; refresh."))
}

// member is group id when viewer is in it, or a 404 written.
func (h *Handler) member(w http.ResponseWriter, r *http.Request, viewer string, id int64) (groups.Group, bool) {
	g, err := h.Groups.Get(r.Context(), viewer, id)
	if err == nil && g.How != "member" {
		err = groups.ErrNotFound
	}
	if err != nil {
		h.groupError(w, r, err)
		return groups.Group{}, false
	}
	return g, true
}

func names(g groups.Group) map[string]string {
	out := make(map[string]string, len(g.List))
	for _, m := range g.List {
		out[m.Email] = m.Name
	}
	return out
}

func people(emails []string, name map[string]string) []gen.Person {
	out := make([]gen.Person, len(emails))
	for i, e := range emails {
		out[i] = gen.Person{Email: e, Name: name[e]}
	}
	return out
}

func euros(cents *int, players int) (*gen.Money, *gen.Money) {
	if cents == nil {
		return nil, nil
	}
	return &gen.Money{Amount: *cents, Currency: "EUR"},
		&gen.Money{Amount: (*cents + players/2) / players, Currency: "EUR"}
}

func link(links map[string]string, day string) *string {
	if l, ok := links[day]; ok && l != "" {
		return &l
	}
	return nil
}

// ListFits is the games of four the group's times and the free courts allow.
func (h *Handler) ListFits(w http.ResponseWriter, r *http.Request, id gen.GroupId, params gen.ListFitsParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	if !slices.Contains(games.Durations, int(params.Minutes)) {
		h.gameError(w, r, games.ErrInvalid)
		return
	}
	g, ok := h.member(w, r, email, id)
	if !ok {
		return
	}
	venues, takenAt, err := h.venues(r, g.Area)
	if errors.Is(err, slots.ErrNone) {
		noSnapshot(w)
		return
	}
	if err != nil {
		h.internal(w, r, "reading the snapshot", err)
		return
	}
	emails := make([]string, len(g.List))
	for i, m := range g.List {
		emails[i] = m.Email
	}
	said, err := h.Availability.Of(r.Context(), emails)
	if err != nil {
		h.internal(w, r, "reading availability", err)
		return
	}
	ps := make([]games.Person, len(emails))
	for i, e := range emails {
		days := map[string][]games.Span{}
		for day, spans := range said[e].Days {
			for _, s := range spans {
				days[day] = append(days[day], games.Span{From: s.From, To: s.To})
			}
		}
		ps[i] = games.Person{Email: e, Days: days, Declined: said[e].Declined, Venues: said[e].Venues}
	}
	links := map[string]map[string]string{}
	for _, v := range venues {
		links[v.ID] = v.Links
	}
	fits, nearly := games.Fits(venues, ps, int(params.Minutes), games.Players, h.Games.Window())
	name := names(g)
	out := gen.FitList{TakenAt: utc(takenAt), Need: games.Players, Fits: make([]gen.Fit, 0, len(fits)),
		Nearly: make([]gen.Fit, 0, len(nearly))}
	conv := func(f games.Fit) gen.Fit {
		price, each := euros(f.PriceCents, games.Players)
		return gen.Fit{Day: date(f.Day), Start: f.Start, Minutes: f.Minutes, VenueId: f.VenueID, VenueName: f.VenueName,
			Court: f.Court, Price: price, PerHead: each, Link: link(links[f.VenueID], f.Day),
			Can: people(f.Can, name), Ask: people(f.Ask, name)}
	}
	for _, f := range fits {
		out.Fits = append(out.Fits, conv(f))
	}
	for _, f := range nearly {
		out.Nearly = append(out.Nearly, conv(f))
	}
	writeJSON(w, http.StatusOK, out)
}

// ProposeGame makes a game of a fit.
func (h *Handler) ProposeGame(w http.ResponseWriter, r *http.Request, id gen.GroupId, params gen.ProposeGameParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.NewGame
	if !decode(w, r, &body) {
		return
	}
	venues, _, err := h.venues(r, groups.Anywhere)
	if errors.Is(err, slots.ErrNone) {
		noSnapshot(w)
		return
	}
	if err != nil {
		h.internal(w, r, "reading the snapshot", err)
		return
	}
	g, err := h.Games.Propose(r.Context(), email, params.IdempotencyKey.String(), id, games.Proposal{
		VenueID: body.VenueId, Court: body.Court, Day: body.Day.Format(time.DateOnly), Start: body.Start, Minutes: body.Minutes,
	}, venues)
	h.answerGame(w, r, http.StatusCreated, email, g, err)
}

// ListGames is the coming games of the caller's groups.
func (h *Handler) ListGames(w http.ResponseWriter, r *http.Request, params gen.ListGamesParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var group int64
	if params.GroupId != nil {
		group = *params.GroupId
	}
	list, err := h.Games.Upcoming(r.Context(), email, group)
	if err != nil {
		h.internal(w, r, "listing games", err)
		return
	}
	out := gen.GameList{Items: make([]gen.Game, 0, len(list))}
	seen := map[int64]groups.Group{}
	venues, _, _ := h.venues(r, groups.Anywhere) // links only; none without a snapshot
	for _, g := range list {
		grp, ok := seen[g.GroupID]
		if !ok {
			if grp, err = h.Groups.Get(r.Context(), email, g.GroupID); err != nil {
				h.internal(w, r, "reading a game's group", err)
				return
			}
			seen[g.GroupID] = grp
		}
		out.Items = append(out.Items, gameOut(g, grp, venues))
	}
	writeJSON(w, http.StatusOK, out)
}

// GetGame is one game.
func (h *Handler) GetGame(w http.ResponseWriter, r *http.Request, id gen.GameId) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	g, err := h.Games.Get(r.Context(), email, id)
	h.answerGame(w, r, http.StatusOK, email, g, err)
}

// UpdateGame books or cancels a game.
func (h *Handler) UpdateGame(w http.ResponseWriter, r *http.Request, id gen.GameId, params gen.UpdateGameParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.GameChange
	if !decode(w, r, &body) {
		return
	}
	g, err := h.Games.SetState(r.Context(), email, params.IdempotencyKey.String(), id, body.State)
	h.answerGame(w, r, http.StatusOK, email, g, err)
}

// AnswerGame is the caller saying yes or no.
func (h *Handler) AnswerGame(w http.ResponseWriter, r *http.Request, id gen.GameId, params gen.AnswerGameParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.GameAnswer
	if !decode(w, r, &body) {
		return
	}
	g, err := h.Games.Answer(r.Context(), email, params.IdempotencyKey.String(), id, body.Answer)
	h.answerGame(w, r, http.StatusOK, email, g, err)
}

func (h *Handler) answerGame(w http.ResponseWriter, r *http.Request, status int, viewer string, g games.Game, err error) {
	if err != nil {
		h.gameError(w, r, err)
		return
	}
	grp, err := h.Groups.Get(r.Context(), viewer, g.GroupID)
	if err != nil {
		h.internal(w, r, "reading a game's group", err)
		return
	}
	venues, _, _ := h.venues(r, groups.Anywhere) // links only; none without a snapshot
	writeJSON(w, status, gameOut(g, grp, venues))
}

func gameOut(g games.Game, grp groups.Group, venues []games.Venue) gen.Game {
	name := names(grp)
	price, each := euros(g.PriceCents, g.Players)
	out := gen.Game{Id: g.ID, GroupId: g.GroupID, GroupName: grp.Name, VenueId: g.VenueID, VenueName: g.VenueName,
		Court: g.Court, Day: date(g.Day), Start: g.Start, Minutes: g.Minutes, Players: g.Players,
		Price: price, PerHead: each, State: g.State, ProposedBy: gen.Person{Email: g.ProposedBy, Name: name[g.ProposedBy]},
		Lineup: make([]gen.Player, 0, len(g.Lineup))}
	for _, v := range venues {
		if v.ID == g.VenueID {
			out.Link = link(v.Links, g.Day)
		}
	}
	for _, p := range g.Lineup {
		out.Lineup = append(out.Lineup, gen.Player{Email: p.Email, Name: name[p.Email], State: p.State})
	}
	return out
}

func (h *Handler) gameError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, games.ErrNotFound):
		problem.Write(w, problem.New(http.StatusNotFound, "no-game", "No such game", ""))
	case errors.Is(err, games.ErrForbidden):
		problem.Write(w, problem.New(http.StatusForbidden, "not-allowed", "Only whoever proposed the game may", ""))
	case errors.Is(err, games.ErrInvalid):
		problem.Write(w, problem.New(http.StatusBadRequest, "invalid-game", "A game is 60, 90 or 120 minutes; an answer in or out", ""))
	case errors.Is(err, games.ErrGone):
		problem.Write(w, problem.New(http.StatusConflict, "court-gone", "The court is no longer free", ""))
	case errors.Is(err, games.ErrClosed):
		problem.Write(w, problem.New(http.StatusConflict, "game-closed", "The game is cancelled or over", ""))
	case errors.Is(err, idempotency.ErrKeyReused):
		keyReused(w)
	default:
		h.internal(w, r, "games", err)
	}
}
