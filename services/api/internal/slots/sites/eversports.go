package sites

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Eversports: the calendar (HTML, every cell marked free, with prices) and
// the taken slots (JSON); free is the one minus the other. At most 21 days
// ahead, a week per call (docs/design/booking-sites.md).
var (
	evNames = regexp.MustCompile(`<td data-court="(\d+)"[^>]*>\s*<div class="court-name[^"]*">([^<]*)<`)
	evAreas = regexp.MustCompile(`<tr[^>]*data-area="(\w+)"[^>]*>\s*<td data-court="(\d+)"`)
	evCells = regexp.MustCompile(`<td [^>]*data-state=[^>]*>`)
	// Eversports mixes "..." and '...' in attributes.
	evAttrs = regexp.MustCompile(`([\w-]+)=(?:"([^"]*)"|'([^']*)')`)
)

const eversportsBase = "https://www.eversports.at"

func eversports(ctx context.Context, c *Client, v config, days []time.Time) (result, error) {
	base := eversportsBase
	r := result{free: newFree(), links: map[string]string{}, step: 60, areas: map[string]string{}}
	wanted := map[string]bool{}
	for _, d := range days {
		wanted[isoDay(d)] = true
	}
	hdr := http.Header{"X-Requested-With": {"XMLHttpRequest"}}
	last := days[len(days)-1]
	for start := days[0]; !start.After(last); start = start.AddDate(0, 0, 7) {
		form := url.Values{
			"facilityId": {strconv.Itoa(v.FacilityID)}, "facilitySlug": {v.FacilitySlug},
			"sport[id]": {strconv.Itoa(v.Sport.ID)}, "sport[slug]": {v.Sport.Slug}, "sport[name]": {v.Sport.Name},
			"sport[uuid]": {v.Sport.UUID}, "date": {isoDay(start)}, "type": {"user"},
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/booking/calendar/update", strings.NewReader(form.Encode()))
		if err != nil {
			return r, err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		resp, err := c.do(req, hdr)
		if err != nil {
			return r, err
		}
		raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		_ = resp.Body.Close()
		if err != nil {
			return r, err
		}
		page := string(raw)
		names, cells := eversportsCalendar(page, wanted, &r)
		if len(cells) == 0 {
			continue
		}
		ids := map[string]bool{}
		for _, cell := range cells {
			ids[cell["data-court"]] = true
		}
		var courts []string
		for id := range ids {
			courts = append(courts, id)
		}
		sort.Strings(courts)
		q := url.Values{"facilityId": {strconv.Itoa(v.FacilityID)}, "startDate": {isoDay(start)}, "courts[]": courts}
		resp, err = c.get(ctx, base+"/api/slot?"+q.Encode(), hdr)
		if err != nil {
			return r, err
		}
		var body struct {
			Slots json.RawMessage `json:"slots"`
		}
		err = json.NewDecoder(resp.Body).Decode(&body)
		_ = resp.Body.Close()
		if err != nil {
			return r, err
		}
		taken, err := eversportsTaken(body.Slots)
		if err != nil {
			return r, err
		}
		occupied := map[string]bool{}
		for _, o := range taken {
			occupied[o.Date+" "+o.Start+" "+o.Court.String()] = true
		}
		eversportsFree(cells, names, occupied, &r)
	}
	link := base + "/sb/" + v.FacilitySlug
	for _, d := range days {
		r.links[isoDay(d)] = link
	}
	return r, nil
}

type takenSlot struct {
	Date  string      `json:"date"`
	Start string      `json:"start"`
	Court json.Number `json:"court"`
}

// eversportsTaken reads the taken slots: a list, or since 2026-10 a list
// inside {"slots": …}.
func eversportsTaken(raw json.RawMessage) ([]takenSlot, error) {
	var list []takenSlot
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	if err := json.Unmarshal(raw, &list); err == nil {
		return list, nil
	}
	var nested struct {
		Slots []takenSlot `json:"slots"`
	}
	if err := json.Unmarshal(raw, &nested); err != nil {
		return nil, fmt.Errorf("taken slots: %w", err)
	}
	return nested.Slots, nil
}

// eversportsCalendar reads the court names and areas and the cells of the
// wanted days from one week's calendar.
func eversportsCalendar(page string, wanted map[string]bool, r *result) (map[string]string, []map[string]string) {
	names := map[string]string{}
	for _, m := range evNames.FindAllStringSubmatch(page, -1) {
		names[m[1]] = strings.TrimSpace(html.UnescapeString(m[2]))
	}
	for _, m := range evAreas.FindAllStringSubmatch(page, -1) {
		if name, ok := names[m[2]]; ok {
			area := map[string]string{"indoor": "halle", "outdoor": "freiluft"}[m[1]]
			if area == "" {
				area = m[1]
			}
			r.areas[name] = area
		}
	}
	var cells []map[string]string
	for _, tag := range evCells.FindAllString(page, -1) {
		a := map[string]string{}
		for _, m := range evAttrs.FindAllStringSubmatch(tag, -1) {
			a[m[1]] = m[2] + m[3]
		}
		if wanted[a["data-date"]] {
			cells = append(cells, a)
		}
	}
	return names, cells
}

func eversportsFree(cells []map[string]string, names map[string]string, occupied map[string]bool, r *result) {
	for _, cell := range cells {
		id, day := cell["data-court"], cell["data-date"]
		court, ok := names[id]
		if !ok {
			court = "Platz " + id
		}
		r.free.day(court, day)
		if cell["data-state"] != "free" || occupied[day+" "+cell["data-start"]+" "+id] {
			continue
		}
		b, e := hhmm(cell["data-start"]), hhmm(cell["data-end"])
		if b < 0 || e < 0 {
			continue
		}
		if e-b != 0 {
			r.step = e - b
		}
		var eurH *float64
		if p, err := strconv.ParseFloat(cell["data-price"], 64); err == nil && e > b {
			v := p * 60 / float64(e-b)
			eurH = &v
		}
		r.free.add(court, day, unit{b, e, eurH})
	}
}

// hhmm is minutes after midnight of "HHMM", or -1.
func hhmm(s string) int {
	if len(s) != 4 {
		return -1
	}
	h, err1 := strconv.Atoi(s[:2])
	m, err2 := strconv.Atoi(s[2:])
	if err1 != nil || err2 != nil {
		return -1
	}
	return h*60 + m
}
