package sites

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Wansport answers JSON per day: the court's grid and its bookings. Free is
// the grid minus the bookings. The bookings carry the names of the people
// who booked; only their times are read (docs/design/booking-sites.md).
type wansportDay struct {
	Success bool `json:"success"`
	Dati    struct {
		Sedi []struct {
			Risorse []struct {
				Nome                     string `json:"nome"`
				IsFuoriFinestraTemporale bool   `json:"isFuoriFinestraTemporale"`
				ListaPrenotazioni        []struct {
					StartDate string `json:"startdate"`
					StartTime string `json:"starttime"`
					EndDate   string `json:"enddate"`
					EndTime   string `json:"endtime"`
				} `json:"listaPrenotazioni"`
				TSlots []struct {
					Published   *bool       `json:"published"`
					Disabled    bool        `json:"is_inizio_prenotazioni_disabilitato"`
					DurataTSlot json.Number `json:"durata_tslot"`
					TSStart     string      `json:"ts_start"`
					TSEnd       string      `json:"ts_end"`
				} `json:"tslots"`
			} `json:"risorse"`
		} `json:"sedi"`
	} `json:"dati"`
}

func wansport(ctx context.Context, c *Client, v config, days []time.Time) (result, error) {
	r := result{free: newFree(), links: map[string]string{}, step: 30}
	for _, day := range days {
		url := fmt.Sprintf("%s/de-de/index.php?option=com_wsinit&task=prenotazioni.getPannelloPrenotazioni&format=raw&filtroData=%s&filtroSport=%d",
			v.BaseURL, isoDay(day), v.SportID)
		resp, err := c.get(ctx, url, nil)
		if err != nil {
			return r, err
		}
		var data wansportDay
		err = json.NewDecoder(resp.Body).Decode(&data)
		_ = resp.Body.Close()
		if err != nil {
			return r, err
		}
		if !data.Success {
			return r, errors.New("the site reports no success")
		}
		if err := wansportDayInto(data, day, &r); err != nil {
			return r, err
		}
	}
	link := v.BaseURL + "/de-de/bookingspanel"
	for _, d := range days {
		r.links[isoDay(d)] = link
	}
	return r, nil
}

func wansportDayInto(data wansportDay, day time.Time, r *result) error {
	for _, sede := range data.Dati.Sedi {
		for _, res := range sede.Risorse {
			court := strings.TrimSpace(res.Nome)
			if court == "" {
				// Past the booking window the site lists empty resources
				// with markers but no court and no grid.
				continue
			}
			r.free.day(court, isoDay(day))
			if res.IsFuoriFinestraTemporale {
				continue
			}
			type span struct{ b, e time.Time }
			var booked []span
			for _, p := range res.ListaPrenotazioni {
				if p.StartDate == "" || p.EndDate == "" {
					continue // a colour marker, not a booking
				}
				b, err1 := localTime(p.StartDate + " " + p.StartTime)
				e, err2 := localTime(p.EndDate + " " + p.EndTime)
				if err := errors.Join(err1, err2); err != nil {
					return err
				}
				booked = append(booked, span{b, e})
			}
			for _, ts := range res.TSlots {
				if (ts.Published != nil && !*ts.Published) || ts.Disabled {
					continue
				}
				if n, err := strconv.Atoi(ts.DurataTSlot.String()); err == nil && n > 0 {
					r.step = n
				}
				b, err1 := localTime(ts.TSStart)
				e, err2 := localTime(ts.TSEnd)
				if err := errors.Join(err1, err2); err != nil {
					return err
				}
				taken := false
				for _, s := range booked {
					if s.b.Before(e) && s.e.After(b) {
						taken = true
						break
					}
				}
				if !taken {
					r.free.addTimes(court, day, b, e, nil)
				}
			}
		}
	}
	return nil
}

// localTime reads "2026-10-27 18:00[:00]" or "2026-10-27T18:00:00" as
// Vienna time.
func localTime(s string) (time.Time, error) {
	s = strings.Replace(strings.TrimSpace(s), "T", " ", 1)
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02 15:04"} {
		if t, err := time.ParseInLocation(layout, s, Vienna); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("not a time: %q", s)
}
