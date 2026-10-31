package transport

// When people can play (docs/design/availability.md).

import (
	"errors"
	"net/http"
	"slices"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/seburgi/padel-kaernten/services/api/internal/availability"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/problem"
	"github.com/seburgi/padel-kaernten/services/api/internal/transport/gen"
)

// GetAvailability is what the caller said.
func (h *Handler) GetAvailability(w http.ResponseWriter, r *http.Request) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	m, err := h.Availability.Get(r.Context(), email)
	if err != nil {
		h.internal(w, r, "reading availability", err)
		return
	}
	out := gen.Availability{From: date(m.From), To: date(m.To), Days: []gen.AvailabilityDay{},
		Templates: templatesOut(m.Templates), Venues: m.Venues}
	for _, d := range m.Days {
		out.Days = append(out.Days, dayOut(d))
	}
	writeJSON(w, http.StatusOK, out)
}

// SetAvailabilityDay replaces one day: its spans, declined, or open.
func (h *Handler) SetAvailabilityDay(w http.ResponseWriter, r *http.Request, day openapi_types.Date, params gen.SetAvailabilityDayParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.SpanList
	if !decode(w, r, &body) {
		return
	}
	d := day.Format("2006-01-02")
	saved, err := h.Availability.SetDay(r.Context(), email, params.IdempotencyKey.String(), d,
		spansIn(body.Spans), body.Declined != nil && *body.Declined)
	if err != nil {
		h.availabilityError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, dayOut(saved))
}

// SetAvailabilityTemplates replaces the usual weekdays.
func (h *Handler) SetAvailabilityTemplates(w http.ResponseWriter, r *http.Request, params gen.SetAvailabilityTemplatesParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.TemplateList
	if !decode(w, r, &body) {
		return
	}
	in := make([]availability.Template, len(body.Templates))
	for i, t := range body.Templates {
		in[i] = availability.Template{Weekday: t.Weekday, Spans: spansIn(t.Spans)}
	}
	out, err := h.Availability.SetTemplates(r.Context(), email, params.IdempotencyKey.String(), in)
	if err != nil {
		h.availabilityError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, gen.TemplateList{Templates: templatesOut(out)})
}

// SetVenues replaces the venues the caller drives to.
func (h *Handler) SetVenues(w http.ResponseWriter, r *http.Request, params gen.SetVenuesParams) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	var body gen.VenueChoice
	if !decode(w, r, &body) {
		return
	}
	out, err := h.Availability.SetVenues(r.Context(), email, params.IdempotencyKey.String(), body.Venues)
	if err != nil {
		h.availabilityError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, gen.VenueChoice{Venues: out})
}

func (h *Handler) availabilityError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, availability.ErrInvalid):
		problem.Write(w, problem.New(http.StatusBadRequest, "invalid-spans", "Spans are on the half hour, from 6:00 to 24:00, and a declined day has none", ""))
	case errors.Is(err, availability.ErrOutside):
		problem.Write(w, problem.New(http.StatusBadRequest, "outside-window", "Only today and the next 13 days", ""))
	case errors.Is(err, availability.ErrUnknownVenue):
		problem.Write(w, problem.New(http.StatusBadRequest, "unknown-venue", "No such venue", err.Error()))
	case errors.Is(err, idempotency.ErrKeyReused):
		keyReused(w)
	default:
		h.internal(w, r, "availability", err)
	}
}

func spansIn(in []gen.Span) []availability.Span {
	out := make([]availability.Span, len(in))
	for i, s := range in {
		out[i] = availability.Span{From: s.From, To: s.To}
	}
	return out
}

func dayOut(d availability.Day) gen.AvailabilityDay {
	return gen.AvailabilityDay{Day: date(d.Day), Spans: spansOut(d.Spans), Declined: d.Declined}
}

func spansOut(in []availability.Span) []gen.Span {
	out := make([]gen.Span, len(in))
	for i, s := range in {
		out[i] = gen.Span{From: s.From, To: s.To}
	}
	return out
}

func templatesOut(in []availability.Template) []gen.Template {
	out := make([]gen.Template, len(in))
	for i, t := range in {
		out[i] = gen.Template{Weekday: t.Weekday, Spans: spansOut(t.Spans)}
	}
	return out
}

func date(day string) openapi_types.Date {
	var d openapi_types.Date
	_ = d.UnmarshalText([]byte(day))
	return d
}

// GetGroupAvailability is when each member of a group can play, for "Wer
// kann wann" on the group's page. Members only, like the fits.
func (h *Handler) GetGroupAvailability(w http.ResponseWriter, r *http.Request, id gen.GroupId) {
	email, ok := h.person(w, r)
	if !ok {
		return
	}
	g, ok := h.member(w, r, email, id)
	if !ok {
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
	from, to := h.Availability.Window()
	out := gen.GroupAvailability{From: date(from), To: date(to), Members: make([]gen.MemberAvailability, 0, len(g.List))}
	for _, m := range g.List {
		p := said[m.Email]
		days := make([]string, 0, len(p.Days)+len(p.Declined))
		for d := range p.Days {
			days = append(days, d)
		}
		for d := range p.Declined {
			if _, both := p.Days[d]; !both {
				days = append(days, d)
			}
		}
		slices.Sort(days)
		ma := gen.MemberAvailability{Email: m.Email, Name: m.Name, Days: make([]gen.AvailabilityDay, len(days))}
		for i, d := range days {
			ma.Days[i] = dayOut(availability.Day{Day: d, Spans: p.Days[d], Declined: p.Declined[d] && len(p.Days[d]) == 0})
		}
		out.Members = append(out.Members, ma)
	}
	writeJSON(w, http.StatusOK, out)
}
