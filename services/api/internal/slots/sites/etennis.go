package sites

import (
	"context"
	"fmt"
	"html"
	"io"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// eTennis renders its booking page on the server: one page per week, a
// column per court, a div per slot (docs/design/booking-sites.md).
var (
	etLabels  = regexp.MustCompile(`(?s)time-schedule-left">(.*?)</div></div>`)
	etTimes   = regexp.MustCompile(`<span>(\d\d):(\d\d)</span>`)
	etLegend  = regexp.MustCompile(`<div class="price (price[-\d]+)">\s*(?:&euro;|€)\s*([\d.,]+)`)
	etDays    = regexp.MustCompile(`<div class="day[^"]*"[^>]*data-dt="(\d+)"`)
	etNames   = regexp.MustCompile(`<div class="court[^"]*" style="width:[^"]*">([^<]*)</div>`)
	etColumns = regexp.MustCompile(`<div class="court[^"]*" data-cid="\d+"`)
	etSlots   = regexp.MustCompile(`<div\s+class="slot av([^"]*)"[^>]*data-begin="(\d+)"\s+data-size="(\d+)"`)
	etClass   = regexp.MustCompile(`price[-\d]+`)
)

func etennis(ctx context.Context, c *Client, v config, days []time.Time) (result, error) {
	r := result{free: newFree(), links: map[string]string{}, step: 30}
	wanted := map[string]bool{}
	var mondays []time.Time
	seenMonday := map[string]bool{}
	for _, d := range days {
		wanted[isoDay(d)] = true
		monday := d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
		if !seenMonday[isoDay(monday)] {
			seenMonday[isoDay(monday)] = true
			mondays = append(mondays, monday)
		}
	}
	for _, monday := range mondays {
		noon := time.Date(monday.Year(), monday.Month(), monday.Day(), 12, 0, 0, 0, Vienna)
		resp, err := c.get(ctx, fmt.Sprintf("%s/reservierung?c=%d&t=%d", v.BaseURL, v.CategoryID, noon.Unix()), nil)
		if err != nil {
			return r, err
		}
		raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		_ = resp.Body.Close()
		if err != nil {
			return r, err
		}
		page := string(raw)
		if err := etennisWeek(v, page, wanted, &r); err != nil {
			return r, err
		}
	}
	return r, nil
}

// etennisWeek reads one week's page into r.
func etennisWeek(v config, page string, wanted map[string]bool, r *result) error {
	scope := page
	if m := etLabels.FindStringSubmatch(page); m != nil {
		scope = m[1]
	}
	unit := 30
	if t := etTimes.FindAllStringSubmatch(scope, 2); len(t) == 2 {
		if d := atoi(t[1][1])*60 + atoi(t[1][2]) - atoi(t[0][1])*60 - atoi(t[0][2]); d != 0 {
			unit = d
		}
	}
	r.step = unit

	// The legend "Preise/h": every slot carries the class of its price.
	legend := map[string]float64{}
	_, afterBox, found := strings.Cut(page, `class="pricebox"`)
	if !found {
		afterBox = page
	}
	for _, m := range etLegend.FindAllStringSubmatch(afterBox, -1) {
		if eur, err := strconv.ParseFloat(strings.ReplaceAll(m[2], ",", "."), 64); err == nil {
			legend[m[1]] = eur
		}
	}
	for cls, eur := range v.PriceClasses { // classes the legend lacks
		legend[cls] = eur
	}

	var dayDates []time.Time
	for _, m := range etDays.FindAllStringSubmatch(page, -1) {
		dayDates = append(dayDates, time.Unix(int64(atoi(m[1])), 0).In(Vienna))
	}
	parts := strings.Split(page, `class="day-body"`)
	if len(dayDates) != len(parts)-1 {
		return fmt.Errorf("unexpected page: %d days for %d day columns", len(dayDates), len(parts)-1)
	}
	for i, day := range dayDates {
		if !wanted[isoDay(day)] {
			continue
		}
		head := parts[i]
		if k := strings.LastIndex(head, "day-courts"); k >= 0 {
			head = head[k+len("day-courts"):]
		}
		body := parts[i+1]
		names := etNames.FindAllStringSubmatch(head, -1)
		columns := etColumns.Split(body, -1)[1:]
		for ci, col := range columns {
			court := fmt.Sprintf("Platz %d", ci+1)
			if ci < len(names) {
				court = strings.TrimSpace(html.UnescapeString(names[ci][1]))
			}
			r.free.day(court, isoDay(day))
			for _, m := range etSlots.FindAllStringSubmatch(col, -1) {
				b := time.Unix(int64(atoi(m[2])), 0).In(Vienna)
				var eurH *float64
				if cls := etClass.FindString(m[1]); cls != "" {
					if p, ok := legend[cls]; ok {
						eurH = &p
					}
				}
				r.free.addTimes(court, day, b, b.Add(time.Duration(unit*atoi(m[3]))*time.Minute), eurH)
			}
		}
		midnight := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, Vienna)
		r.links[isoDay(day)] = fmt.Sprintf("%s/reservierung?c=%d&d=%d", v.BaseURL, v.CategoryID, midnight.Unix())
	}
	return nil
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
