// Package sites asks the booking sites of the venues in venues.json which
// courts are free (docs/design/booking-sites.md). It reads free slots only:
// court, day, from and to, a price. Bookings and the names of the people
// who booked are never read or kept.
package sites

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"
	_ "time/tzdata" // the image has no zoneinfo
)

//go:embed venues.json
var venuesJSON []byte

// Vienna is the venues' time zone; every day and minute here is Vienna's.
var Vienna = mustZone("Europe/Vienna")

func mustZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

// Days is how far ahead a snapshot looks.
const Days = 14

// Snapshot is what the booking sites showed at TakenAt.
type Snapshot struct {
	TakenAt time.Time `json:"takenAt"`
	// Days are the calendar days asked for, YYYY-MM-DD, from today.
	Days   []string `json:"days"`
	Venues []Venue  `json:"venues"`
}

// Venue is one venue's free courts.
type Venue struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Place     string `json:"place"`
	Address   string `json:"address,omitempty"`
	Platform  string `json:"platform"`
	PriceNote string `json:"priceNote,omitempty"`
	// Failed means the booking site did not answer as expected; Courts is
	// then empty and the app links to the site instead.
	Failed bool `json:"failed"`
	// NotBookable are days the site does not take bookings for yet.
	NotBookable []string `json:"notBookable"`
	// Step is the grid of possible start times, in minutes.
	Step int `json:"step"`
	// Links is the booking page per day, YYYY-MM-DD.
	Links  map[string]string `json:"links"`
	Courts []Court           `json:"courts"`
}

// Court is one court's free slots.
type Court struct {
	Name string `json:"name"`
	// Area is halle, freiluft, ueberdacht or empty when unknown.
	Area string `json:"area,omitempty"`
	Free []Slot `json:"free"`
}

// Slot is a free stretch on one day, in minutes after midnight (To may be
// 1440), with the whole court's price per hour when it is known.
type Slot struct {
	Day          string `json:"day"`
	From         int    `json:"from"`
	To           int    `json:"to"`
	PricePerHour *Money `json:"pricePerHour,omitempty"`
}

// Money is an amount in minor units (cents) of Currency.
type Money struct {
	Amount   int    `json:"amount"`
	Currency string `json:"currency"`
}

// config is one entry of venues.json.
type config struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Place        string            `json:"ort"`
	Address      string            `json:"address"`
	Platform     string            `json:"platform"`
	Enabled      *bool             `json:"enabled"`
	PriceNote    string            `json:"price_note"`
	Area         string            `json:"area"`
	AreaByCourt  map[string]string `json:"area_by_court"`
	PriceClasses map[string]float64
	PriceRules   []priceRule `json:"price_rules"`

	BaseURL      string `json:"base_url"`    // etennis, wansport
	CategoryID   int    `json:"category_id"` // etennis
	SportID      int    `json:"sport_id"`    // wansport
	FacilityID   int    `json:"facility_id"` // eversports
	FacilitySlug string `json:"facility_slug"`
	Sport        struct {
		ID   int    `json:"id"`
		Slug string `json:"slug"`
		Name string `json:"name"`
		UUID string `json:"uuid"`
	} `json:"sport"`
	ClubID string `json:"club_id"` // padelmates
}

type priceRule struct {
	Weekdays []int   `json:"weekdays"` // 0 Monday … 6 Sunday
	From     string  `json:"from"`     // HH:MM
	To       string  `json:"to"`
	EurH     float64 `json:"eur_h"`
}

func (c *config) UnmarshalJSON(b []byte) error {
	type plain config
	var raw struct {
		plain
		PriceClasses map[string]float64 `json:"price_classes"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	*c = config(raw.plain)
	c.PriceClasses = raw.PriceClasses
	return nil
}

func venues() ([]config, error) {
	var file struct {
		Venues []config `json:"venues"`
	}
	if err := json.Unmarshal(venuesJSON, &file); err != nil {
		return nil, fmt.Errorf("venues.json: %w", err)
	}
	var on []config
	for _, v := range file.Venues {
		if v.Enabled == nil || *v.Enabled {
			on = append(on, v)
		}
	}
	return on, nil
}

// unit is a free stretch while a site is read: minutes and euro per hour.
type unit struct {
	from, to int
	eurH     *float64
}

// free is what a fetcher found: per court (in the order the site lists
// them) and day, the free units. A court with no free unit on a day still
// has the day, so the app can tell "booked out" from "unknown".
type free struct {
	courts []string
	days   map[string]map[string][]unit
}

func newFree() *free { return &free{days: map[string]map[string][]unit{}} }

func (f *free) court(name string) map[string][]unit {
	if d, ok := f.days[name]; ok {
		return d
	}
	f.courts = append(f.courts, name)
	f.days[name] = map[string][]unit{}
	return f.days[name]
}

func (f *free) day(court, day string) {
	d := f.court(court)
	if _, ok := d[day]; !ok {
		d[day] = []unit{}
	}
}

func (f *free) add(court, day string, u unit) {
	d := f.court(court)
	d[day] = append(d[day], u)
}

// addTimes adds b to e on day; a stretch past midnight ends at 1440.
func (f *free) addTimes(court string, day time.Time, b, e time.Time, eurH *float64) {
	end := minutes(e)
	if !sameDay(e, day) {
		end = 24 * 60
	}
	f.add(court, isoDay(day), unit{minutes(b), end, eurH})
}

// result is one fetcher's answer.
type result struct {
	free        *free
	links       map[string]string
	step        int
	areas       map[string]string // what the site says about each court
	notBookable []string
}

type fetcher func(ctx context.Context, c *Client, v config, days []time.Time) (result, error)

var fetchers = map[string]fetcher{
	"etennis":    etennis,
	"wansport":   wansport,
	"eversports": eversports,
	"padelmates": padelmates,
}

// Client asks the booking sites.
type Client struct {
	HTTP *http.Client
	// Now is the clock; nil is time.Now.
	Now func() time.Time
}

// UserAgent says who is asking, with an address to reach Seb.
const UserAgent = "PadelKaernten/1.0 (+https://padel.burgstaller.me)"

func (c *Client) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// Take asks every enabled venue for the next Days days, all at once. A
// venue that fails is marked Failed and the others still count; the error
// is non-nil only when every venue failed.
func (c *Client) Take(ctx context.Context) (Snapshot, []error, error) {
	list, err := venues()
	if err != nil {
		return Snapshot{}, nil, err
	}
	now := c.now().In(Vienna)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, Vienna)
	days := make([]time.Time, Days)
	snap := Snapshot{TakenAt: now.UTC().Truncate(time.Second), Venues: make([]Venue, len(list))}
	for i := range days {
		days[i] = today.AddDate(0, 0, i)
		snap.Days = append(snap.Days, isoDay(days[i]))
	}
	errs := make([]error, len(list))
	var wg sync.WaitGroup
	for i, v := range list {
		wg.Add(1)
		go func() {
			defer wg.Done()
			snap.Venues[i], errs[i] = c.venue(ctx, v, days)
		}()
	}
	wg.Wait()
	var failed []error
	for i, e := range errs {
		if e != nil {
			failed = append(failed, fmt.Errorf("%s: %w", list[i].ID, e))
		}
	}
	if len(failed) == len(list) {
		return snap, failed, fmt.Errorf("every venue failed: %v", failed)
	}
	return snap, failed, nil
}

func (c *Client) venue(ctx context.Context, v config, days []time.Time) (Venue, error) {
	out := Venue{ID: v.ID, Name: v.Name, Place: v.Place, Address: v.Address, Platform: v.Platform,
		PriceNote: v.PriceNote, NotBookable: []string{}, Step: 30, Links: map[string]string{}, Courts: []Court{}}
	fetch, ok := fetchers[v.Platform]
	if !ok {
		out.Failed = true
		return out, fmt.Errorf("unknown platform %q", v.Platform)
	}
	r, err := fetch(ctx, c, v, days)
	if err != nil {
		out.Failed = true
		return out, err
	}
	applyPriceRules(v, r.free)
	out.Step, out.Links = r.step, r.links
	nb := map[string]bool{}
	for _, d := range r.notBookable {
		nb[d] = true
	}
	for d := range nb {
		out.NotBookable = append(out.NotBookable, d)
	}
	sort.Strings(out.NotBookable)
	for _, name := range r.free.courts {
		court := Court{Name: name, Area: areaOf(v, r.areas, name), Free: []Slot{}}
		perDay := r.free.days[name]
		dayKeys := make([]string, 0, len(perDay))
		for d := range perDay {
			dayKeys = append(dayKeys, d)
		}
		sort.Strings(dayKeys)
		for _, d := range dayKeys {
			for _, u := range merge(perDay[d]) {
				court.Free = append(court.Free, Slot{Day: d, From: u.from, To: u.to, PricePerHour: euro(u.eurH)})
			}
		}
		out.Courts = append(out.Courts, court)
	}
	return out, nil
}

// areaOf is the court's area: venues.json per court or venue first, then
// what the booking site says.
func areaOf(v config, fromSite map[string]string, court string) string {
	if a := v.AreaByCourt[court]; a != "" {
		return a
	}
	if v.Area != "" {
		return v.Area
	}
	return fromSite[court]
}

// merge joins adjacent units of the same price and drops duplicates.
func merge(units []unit) []unit {
	seen := map[[3]float64]bool{}
	var sorted []unit
	for _, u := range units {
		k := [3]float64{float64(u.from), float64(u.to), price(u.eurH)}
		if !seen[k] {
			seen[k] = true
			sorted = append(sorted, u)
		}
	}
	sort.Slice(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		if a.from != b.from {
			return a.from < b.from
		}
		if a.to != b.to {
			return a.to < b.to
		}
		return price(a.eurH) < price(b.eurH)
	})
	var out []unit
	for _, u := range sorted {
		if n := len(out); n > 0 && out[n-1].to == u.from && samePrice(out[n-1].eurH, u.eurH) {
			out[n-1].to = u.to
			continue
		}
		out = append(out, u)
	}
	return out
}

func price(p *float64) float64 {
	if p == nil {
		return -1
	}
	return *p
}

func samePrice(a, b *float64) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

func euro(eurH *float64) *Money {
	if eurH == nil {
		return nil
	}
	return &Money{Amount: int(*eurH*100 + 0.5), Currency: "EUR"}
}

// applyPriceRules fills in fixed court prices from venues.json for sites
// that show none. Units are not split at a rule's edge; the sites' 30 minute
// grid lies on them anyway.
func applyPriceRules(v config, f *free) {
	if len(v.PriceRules) == 0 {
		return
	}
	for _, perDay := range f.days {
		for day, units := range perDay {
			d, err := time.ParseInLocation("2006-01-02", day, Vienna)
			if err != nil {
				continue
			}
			weekday := (int(d.Weekday()) + 6) % 7 // Monday 0
			for i, u := range units {
				if u.eurH != nil {
					continue
				}
				for _, r := range v.PriceRules {
					if contains(r.Weekdays, weekday) && hm(r.From) <= u.from && u.from < hm(r.To) {
						p := r.EurH
						units[i].eurH = &p
						break
					}
				}
			}
		}
	}
}

func contains(list []int, x int) bool {
	for _, v := range list {
		if v == x {
			return true
		}
	}
	return false
}

// hm is minutes after midnight of "HH:MM".
func hm(s string) int {
	var h, m int
	_, _ = fmt.Sscanf(s, "%d:%d", &h, &m)
	return h*60 + m
}

func minutes(t time.Time) int { return t.Hour()*60 + t.Minute() }

func isoDay(t time.Time) string { return t.Format("2006-01-02") }

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	return ay == by && am == bm && ad == bd
}

// get fetches url as the venues' sites expect a browser-less client to.
func (c *Client) get(ctx context.Context, url string, header http.Header) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	return c.do(req, header)
}

func (c *Client) do(req *http.Request, header http.Header) (*http.Response, error) {
	for k, v := range header {
		req.Header[k] = v
	}
	req.Header.Set("User-Agent", UserAgent)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		return nil, fmt.Errorf("%s answered %s", req.URL.Host, resp.Status)
	}
	return resp, nil
}
