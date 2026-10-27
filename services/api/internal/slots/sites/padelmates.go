package sites

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"time"
)

// Padelmates' public slot API: every bookable option (30 to 120 minutes)
// with whether it is reserved. A 30 minute stretch is free when at least one
// unreserved option covers it. reservedBookings holds booking details and is
// never read (docs/design/booking-sites.md).
type padelmatesDay struct {
	TooEarly       bool `json:"too_early_for_advance_booking"`
	OriginalCourts []struct {
		Name           string `json:"name"`
		SportType      string `json:"sport_type"`
		CourtTypeEnum  string `json:"court_type_enum"`
		AvailableSlots []struct {
			Start          int64 `json:"start_datetime"`
			End            int64 `json:"end_datetime"`
			IntervalPrices []struct {
				Duration json.Number `json:"duration"`
				Price    json.Number `json:"price"`
			} `json:"interval_prices"`
		} `json:"available_slots"`
	} `json:"originalCourts"`
	AllSlots []struct {
		CourtName            string      `json:"courtName"`
		StartTimestamp       int64       `json:"startTimestamp"`
		Duration             json.Number `json:"duration"`
		ReservedIntersection bool        `json:"reservedIntersection"`
	} `json:"allSlots"`
}

const padelmatesAPI = "https://fastapi-production-fargate.padelmates.io/player/player_booking/all_courts_slot_prices_v3"

func padelmates(ctx context.Context, c *Client, v config, days []time.Time) (result, error) {
	r := result{free: newFree(), links: map[string]string{}, step: 30, areas: map[string]string{}}
	api := padelmatesAPI
	for _, day := range days {
		start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, Vienna)
		q := url.Values{
			"club_id":        {v.ClubID},
			"lang":           {"de"},
			"start_datetime": {fmt.Sprint(start.UnixMilli())},
			"end_datetime":   {fmt.Sprint(start.AddDate(0, 0, 1).UnixMilli())},
		}
		resp, err := c.get(ctx, api+"?"+q.Encode(), nil)
		if err != nil {
			return r, err
		}
		var data padelmatesDay
		err = json.NewDecoder(resp.Body).Decode(&data)
		_ = resp.Body.Close()
		if err != nil {
			return r, err
		}
		padelmatesDayInto(data, day, &r)
	}
	link := "https://padelmates.se/club/" + v.ClubID
	for _, d := range days {
		r.links[isoDay(d)] = link
	}
	return r, nil
}

type tariff struct {
	start, end int64 // ms
	eurH       float64
}

func padelmatesDayInto(data padelmatesDay, day time.Time, r *result) {
	if data.TooEarly {
		r.notBookable = append(r.notBookable, isoDay(day))
	}
	padel := map[string]bool{}
	tariffs := map[string][]tariff{}
	for _, c := range data.OriginalCourts {
		if c.SportType == "PADEL" {
			padel[c.Name] = true
			r.free.day(c.Name, isoDay(day))
			if a := map[string]string{"INDOOR": "halle", "OUTDOOR": "freiluft"}[c.CourtTypeEnum]; a != "" {
				r.areas[c.Name] = a
			}
		}
		// The 60 minute price is the hourly rate; without one it is
		// worked out from the shortest duration.
		for _, w := range c.AvailableSlots {
			prices := map[int]float64{}
			for _, ip := range w.IntervalPrices {
				d, err1 := ip.Duration.Int64()
				p, err2 := ip.Price.Float64()
				if err1 == nil && err2 == nil && p != 0 {
					prices[int(d)] = p
				}
			}
			eurH, ok := prices[60]
			if !ok {
				durations := make([]int, 0, len(prices))
				for d := range prices {
					durations = append(durations, d)
				}
				sort.Ints(durations)
				if len(durations) > 0 && durations[0] > 0 {
					eurH, ok = prices[durations[0]]*60/float64(durations[0]), true
				}
			}
			if ok && eurH != 0 {
				tariffs[c.Name] = append(tariffs[c.Name], tariff{w.Start, w.End, float64(int(eurH*100+0.5)) / 100})
			}
		}
	}

	type key struct {
		court string
		min   int
	}
	covered := map[key]bool{}
	var order []key
	for _, s := range data.AllSlots {
		if s.ReservedIntersection || !padel[s.CourtName] {
			continue
		}
		b := time.UnixMilli(s.StartTimestamp).In(Vienna)
		if !sameDay(b, day) {
			continue
		}
		d, _ := s.Duration.Int64()
		for off := 0; off < int(d); off += 30 {
			k := key{s.CourtName, minutes(b) + off}
			if !covered[k] {
				covered[k] = true
				order = append(order, k)
			}
		}
	}
	for _, k := range order {
		at := time.Date(day.Year(), day.Month(), day.Day(), k.min/60, k.min%60, 0, 0, Vienna).UnixMilli()
		var eurH *float64
		for _, t := range tariffs[k.court] {
			if t.start <= at && at < t.end {
				p := t.eurH
				eurH = &p
				break
			}
		}
		r.free.add(k.court, isoDay(day), unit{k.min, min(k.min+30, 24*60), eurH})
	}
}
