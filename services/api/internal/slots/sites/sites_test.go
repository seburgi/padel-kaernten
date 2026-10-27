package sites

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// fixtures answers the booking sites' calls from testdata: one day (or
// week) as the site showed it, and empty answers for the rest.
type fixtures struct {
	t      *testing.T
	failOn string // a host that answers 503
}

func (f *fixtures) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.Header.Get("User-Agent") != UserAgent {
		f.t.Errorf("%s without our User-Agent", req.URL)
	}
	if req.URL.Host == f.failOn {
		return answer(http.StatusServiceUnavailable, ""), nil
	}
	q := req.URL.Query()
	switch {
	case strings.HasSuffix(req.URL.Host, "tennisplatz.info") || strings.HasSuffix(req.URL.Host, "padelbase.at"):
		// The fixture is the week of Monday 2026-11-02.
		if q.Get("t") == "1793617200" {
			return f.file("etennis-week.html"), nil
		}
		return answer(200, "<html>no days</html>"), nil
	case strings.HasSuffix(req.URL.Host, "wansport.com"):
		if q.Get("filtroData") == "2026-10-27" {
			return f.file("wansport-day.json"), nil
		}
		return f.file("wansport-past-window.json"), nil
	case req.URL.Host == "www.eversports.at" && req.URL.Path == "/api/booking/calendar/update":
		_ = req.ParseForm()
		if req.PostForm.Get("date") == "2026-10-27" {
			return f.file("eversports-week.html"), nil
		}
		return answer(200, "<table></table>"), nil
	case req.URL.Host == "www.eversports.at" && req.URL.Path == "/api/slot":
		return answer(200, `{"slots":{"slots":[{"date":"2026-10-27","start":"1800","court":1}]}}`), nil
	case strings.HasSuffix(req.URL.Host, "padelmates.io"):
		if q.Get("start_datetime") == "1793055600000" {
			return f.file("padelmates-day.json"), nil
		}
		return answer(200, `{"too_early_for_advance_booking":true,"originalCourts":[],"allSlots":[]}`), nil
	}
	f.t.Errorf("unexpected call %s", req.URL)
	return answer(404, ""), nil
}

func (f *fixtures) file(name string) *http.Response {
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		f.t.Fatal(err)
	}
	return answer(200, string(b))
}

func answer(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Status: http.StatusText(status), Body: io.NopCloser(bytes.NewBufferString(body)), Header: http.Header{}}
}

// 2026-10-27 08:00 in Vienna, the day the fixtures were taken.
var fixtureDay = time.Date(2026, 10, 27, 8, 0, 0, 0, Vienna)

func take(t *testing.T, f *fixtures) (Snapshot, []error, error) {
	t.Helper()
	c := &Client{HTTP: &http.Client{Transport: f}, Now: func() time.Time { return fixtureDay }}
	return c.Take(context.Background())
}

func byID(s Snapshot) map[string]Venue {
	m := map[string]Venue{}
	for _, v := range s.Venues {
		m[v.ID] = v
	}
	return m
}

func slots(v Venue, day string) int {
	n := 0
	for _, c := range v.Courts {
		for _, s := range c.Free {
			if s.Day == day {
				n++
			}
		}
	}
	return n
}

func TestTake(t *testing.T) {
	snap, failed, err := take(t, &fixtures{t: t})
	if err != nil || len(failed) != 0 {
		t.Fatalf("take: %v %v", err, failed)
	}
	if len(snap.Days) != Days || snap.Days[0] != "2026-10-27" || snap.Days[13] != "2026-11-09" {
		t.Errorf("days = %v", snap.Days)
	}
	if !snap.TakenAt.Equal(fixtureDay) || snap.TakenAt.Location() != time.UTC {
		t.Errorf("takenAt = %v", snap.TakenAt)
	}
	v := byID(snap)
	if len(v) != 7 {
		t.Fatalf("%d venues", len(v))
	}

	// eTennis: Padel Ten's week of 2026-11-02, prices from the legend and
	// price_classes.
	ten := v["padel-ten-villach"]
	if ten.Failed || len(ten.Courts) != 3 || ten.Step != 30 || slots(ten, "2026-11-03") == 0 || slots(ten, "2026-10-27") != 0 {
		t.Fatalf("padel ten: failed %v, %d courts, step %d, %d slots", ten.Failed, len(ten.Courts), ten.Step, slots(ten, "2026-11-03"))
	}
	if ten.Courts[0].Area != "halle" || ten.Links["2026-11-03"] != "https://villach-padel.tennisplatz.info/reservierung?c=5191&d=1793660400" {
		t.Errorf("padel ten: area %q, link %q", ten.Courts[0].Area, ten.Links["2026-11-03"])
	}
	priced := 0
	for _, s := range ten.Courts[0].Free {
		if s.PricePerHour != nil {
			priced++
		}
	}
	if priced == 0 {
		t.Error("padel ten: no prices")
	}

	// Wansport: free is the grid minus the bookings; prices from price_rules;
	// days past the window have no courts but are no error.
	arena := v["arena-one"]
	if arena.Failed || len(arena.Courts) != 2 || slots(arena, "2026-10-27") == 0 || slots(arena, "2026-11-07") != 0 {
		t.Errorf("arena one: failed %v, %d courts, %d slots", arena.Failed, len(arena.Courts), slots(arena, "2026-10-27"))
	}
	for _, s := range arena.Courts[0].Free {
		if s.PricePerHour == nil || (s.PricePerHour.Amount != 4000 && s.PricePerHour.Amount != 4800) {
			t.Errorf("arena one: price %v at %d", s.PricePerHour, s.From)
		}
	}

	// Eversports: the taken 18:00 and the closed cell are not free, the
	// 19:00 cell has no price, the area comes from the site.
	smash := v["smash-poertschach"]
	if smash.Step != 60 || len(smash.Courts) != 2 {
		t.Fatalf("smash: step %d, %d courts", smash.Step, len(smash.Courts))
	}
	c1, c2 := smash.Courts[0], smash.Courts[1]
	if c1.Name != "Court 1" || c2.Name != "Court & 2" || c1.Area != "freiluft" || c2.Area != "halle" {
		t.Errorf("smash courts: %+v %+v", c1, c2)
	}
	if got, _ := json.Marshal(c1.Free); string(got) != `[{"day":"2026-10-27","from":1020,"to":1080,"pricePerHour":{"amount":3600,"currency":"EUR"}},{"day":"2026-10-27","from":1140,"to":1200}]` {
		t.Errorf("court 1: %s", got)
	}
	if len(c2.Free) != 1 || c2.Free[0].From != 1020 {
		t.Errorf("court 2: %+v", c2.Free)
	}

	// Padelmates: only padel courts, the area from the site, the days it
	// does not take yet.
	moos := v["padel-campus-moosburg"]
	if len(moos.Courts) != 2 || moos.Courts[0].Area != "freiluft" || slots(moos, "2026-10-27") == 0 {
		t.Errorf("moosburg: %+v", moos.Courts)
	}
	if len(moos.NotBookable) != 13 || moos.NotBookable[0] != "2026-10-28" {
		t.Errorf("moosburg not bookable: %v", moos.NotBookable)
	}
}

func TestTakeKeepsTheOthersWhenOneFails(t *testing.T) {
	snap, failed, err := take(t, &fixtures{t: t, failOn: "arenaone.wansport.com"})
	if err != nil || len(failed) != 1 || !strings.HasPrefix(failed[0].Error(), "arena-one:") {
		t.Fatalf("got %v %v", failed, err)
	}
	arena := byID(snap)["arena-one"]
	if !arena.Failed || len(arena.Courts) != 0 || arena.Links == nil {
		t.Errorf("arena one: %+v", arena)
	}
	if byID(snap)["padel-ten-villach"].Failed {
		t.Error("one site's failure failed another")
	}
}

type down struct{}

func (down) RoundTrip(*http.Request) (*http.Response, error) { return nil, errors.New("no network") }

func TestTakeFailsWhenEverySiteFails(t *testing.T) {
	c := &Client{HTTP: &http.Client{Transport: down{}}, Now: func() time.Time { return fixtureDay }}
	if _, failed, err := c.Take(context.Background()); err == nil || len(failed) != 7 {
		t.Fatalf("got %v %v", len(failed), err)
	}
}

func TestMerge(t *testing.T) {
	p := func(v float64) *float64 { return &v }
	got := merge([]unit{{60, 90, p(20)}, {0, 30, nil}, {30, 60, p(20)}, {30, 60, p(20)}, {90, 120, p(30)}, {150, 180, p(30)}})
	want := []unit{{0, 30, nil}, {30, 90, p(20)}, {90, 120, p(30)}, {150, 180, p(30)}}
	if len(got) != len(want) {
		t.Fatalf("got %d units: %+v", len(got), got)
	}
	for i := range got {
		if got[i].from != want[i].from || got[i].to != want[i].to || !samePrice(got[i].eurH, want[i].eurH) {
			t.Errorf("%d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestEversportsTakenShapes(t *testing.T) {
	for raw, want := range map[string]int{
		`[{"date":"2026-10-27","start":"1800","court":1}]`:           1,
		`{"slots":[{"date":"2026-10-27","start":"1800","court":1}]}`: 1,
		`null`: 0,
	} {
		got, err := eversportsTaken(json.RawMessage(raw))
		if err != nil || len(got) != want {
			t.Errorf("%s: %d %v", raw, len(got), err)
		}
	}
	if _, err := eversportsTaken(json.RawMessage(`"no"`)); err == nil {
		t.Error("a string passed")
	}
}

func TestHelpers(t *testing.T) {
	if hhmm("0930") != 570 || hhmm("9:30") != -1 || hhmm("ab12") != -1 {
		t.Error("hhmm")
	}
	if _, err := localTime(""); err == nil {
		t.Error("empty time passed")
	}
	if tm, err := localTime("2026-10-27T18:00:00"); err != nil || tm.Hour() != 18 {
		t.Errorf("localTime: %v %v", tm, err)
	}
	if hm("16:30") != 990 {
		t.Error("hm")
	}
}
