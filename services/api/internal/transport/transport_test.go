package transport_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/seburgi/burgstaller-platform/kit/go/gateway"
	"github.com/seburgi/burgstaller-platform/kit/go/gateway/gatewaytest"

	"github.com/seburgi/padel-kaernten/services/api/internal/invitations"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/localgateway"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/retention"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots/sites"
	"github.com/seburgi/padel-kaernten/services/api/internal/transport"
	"github.com/seburgi/padel-kaernten/services/api/internal/whatsnew"
)

const (
	gatewayAccount = "gateway@burgstaller-platform.iam.gserviceaccount.com"
	address        = "padel.burgstaller.me"
	seb            = "seb@example.at"
	anna           = "anna@example.at"
	reapAccount    = "padel-reap@burgstaller-platform.iam.gserviceaccount.com"
)

type fakeSites struct{ err error }

func (f *fakeSites) Take(context.Context) (sites.Snapshot, []error, error) {
	if f.err != nil {
		return sites.Snapshot{}, nil, f.err
	}
	return sites.Snapshot{TakenAt: time.Now().UTC().Truncate(time.Second), Days: []string{"2026-10-27"},
		Venues: []sites.Venue{{ID: "a", Name: "A", Courts: []sites.Court{}}}}, nil, nil
}

type fakePlatform struct{ err error }

func (f *fakePlatform) Invite(context.Context, string) error   { return f.err }
func (f *fakePlatform) Withdraw(context.Context, string) error { return f.err }

type app struct {
	t        *testing.T
	h        http.Handler
	signer   *gatewaytest.Signer
	sites    *fakeSites
	platform *fakePlatform
}

func setup(t *testing.T) *app {
	t.Helper()
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	signer := gatewaytest.NewSigner(t)
	dist := t.TempDir()
	for name, body := range map[string]string{"index.html": "<!doctype html>padel", "assets/app-1.js": "js", "icon.svg": "<svg/>"} {
		_ = os.MkdirAll(filepath.Dir(filepath.Join(dist, name)), 0o755)
		if err := os.WriteFile(filepath.Join(dist, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	a := &app{t: t, signer: signer, sites: &fakeSites{}, platform: &fakePlatform{}}
	news, err := whatsnew.NewService(context.Background(), pool, []whatsnew.Note{
		{Slug: "2026-10-27-older", Date: "2026-10-27", Area: "courts", Title: "Older", Paragraphs: []string{"Before."}},
		{Slug: "2026-10-28-newer", Date: "2026-10-28", Area: "app", Title: "Newer", Paragraphs: []string{"After."}, Link: "/whats-new"},
	})
	if err != nil {
		t.Fatal(err)
	}
	h := &transport.Handler{
		Slots:       slots.NewService(pool, a.sites, nil, log),
		Invitations: invitations.NewService(pool, a.platform),
		WhatsNew:    news,
		Gateway: &transport.Gateway{Caller: gatewayAccount, Address: address,
			Keys: &gateway.Keys{Audience: address, Audiences: []string{"padel"}, JWKS: signer.URL}},
		Owner:    seb,
		Revision: "abc123",
		Log:      log,
		Reap: func(ctx context.Context, dry bool) ([]retention.Result, error) {
			return retention.Run(ctx, pool, retention.Tables, dry)
		},
		ReapCaller: reapAccount,
	}
	a.h = transport.Router(h, dist)
	return a
}

// as is a request from the gateway with who's note; "" for none.
func (a *app) as(who, method, path, body string) *http.Request {
	note := ""
	if who != "" {
		note = a.signer.Assertion(a.t, who, address, time.Now().Add(time.Minute))
	}
	r := gatewaytest.From(gatewayAccount, method, path, note)
	if body != "" {
		r.Body = io.NopCloser(strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet {
		r.Header.Set("Sec-Fetch-Site", "same-origin")
	}
	return r
}

func (a *app) do(r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	a.h.ServeHTTP(w, r)
	return w
}

func problemType(w *httptest.ResponseRecorder) string {
	var p struct{ Type string }
	_ = json.Unmarshal(w.Body.Bytes(), &p)
	return p.Type[strings.LastIndex(p.Type, "/")+1:]
}

func withKey(r *http.Request, key string) *http.Request {
	r.Header.Set("Idempotency-Key", key)
	return r
}

func TestPublicPaths(t *testing.T) {
	a := setup(t)
	if w := a.do(httptest.NewRequest("GET", "/api/v1/version", nil)); !strings.Contains(w.Body.String(), `"abc123"`) {
		t.Errorf("version: %d %s", w.Code, w.Body)
	}
	if w := a.do(httptest.NewRequest("GET", "/api/v1/client-config", nil)); w.Code != 200 || !strings.Contains(w.Body.String(), `"features"`) {
		t.Errorf("client-config: %d %s", w.Code, w.Body)
	}
}

func TestWhoMayCall(t *testing.T) {
	a := setup(t)
	if w := a.do(httptest.NewRequest("GET", "/api/v1/me", nil)); w.Code != 403 || problemType(w) != "not-the-gateway" {
		t.Errorf("no caller: %d %s", w.Code, w.Body)
	}
	other := gatewaytest.From("someone@else.iam", "GET", "/api/v1/me", a.signer.Assertion(t, anna, address, time.Now().Add(time.Minute)))
	if w := a.do(other); w.Code != 403 {
		t.Errorf("another caller: %d", w.Code)
	}
	if w := a.do(a.as("", "GET", "/api/v1/me", "")); w.Code != 401 || problemType(w) != "not-signed-in" {
		t.Errorf("no note: %d %s", w.Code, w.Body)
	}
	expired := gatewaytest.From(gatewayAccount, "GET", "/api/v1/me", a.signer.Assertion(t, anna, address, time.Now().Add(-time.Hour)))
	if w := a.do(expired); w.Code != 401 {
		t.Errorf("expired: %d", w.Code)
	}
	cross := withKey(a.as(anna, "POST", "/api/v1/slots/refresh", ""), "6c9b2824-b0cd-4c0b-9052-83d9f457e001")
	cross.Header.Set("Sec-Fetch-Site", "cross-site")
	if w := a.do(cross); w.Code != 403 || problemType(w) != "cross-site" {
		t.Errorf("cross-site: %d %s", w.Code, w.Body)
	}
	evil := withKey(a.as(anna, "POST", "/api/v1/slots/refresh", ""), "6c9b2824-b0cd-4c0b-9052-83d9f457e001")
	evil.Header.Del("Sec-Fetch-Site")
	evil.Header.Set("Origin", "https://evil.example")
	if w := a.do(evil); w.Code != 403 {
		t.Errorf("another origin: %d", w.Code)
	}

	for who, can := range map[string]bool{seb: true, anna: false} {
		w := a.do(a.as(who, "GET", "/api/v1/me", ""))
		var me struct {
			Email     string
			CanInvite bool
		}
		if json.Unmarshal(w.Body.Bytes(), &me) != nil || me.Email != who || me.CanInvite != can {
			t.Errorf("me as %s: %s", who, w.Body)
		}
	}
}

func TestSlots(t *testing.T) {
	a := setup(t)
	if w := a.do(a.as(anna, "GET", "/api/v1/slots", "")); w.Code != 503 || problemType(w) != "no-snapshot" {
		t.Fatalf("before: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(anna, "POST", "/api/v1/slots/refresh", "")); w.Code != 400 {
		t.Errorf("no Idempotency-Key: %d", w.Code)
	}
	w := a.do(withKey(a.as(anna, "POST", "/api/v1/slots/refresh", ""), "6c9b2824-b0cd-4c0b-9052-83d9f457e001"))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"venues":[{`) {
		t.Fatalf("refresh: %d %s", w.Code, w.Body)
	}
	got := a.do(a.as(anna, "GET", "/api/v1/slots", ""))
	tag := got.Header().Get("ETag")
	if got.Code != 200 || tag == "" || tag != w.Header().Get("ETag") {
		t.Fatalf("slots: %d %q", got.Code, tag)
	}
	again := a.as(anna, "GET", "/api/v1/slots", "")
	again.Header.Set("If-None-Match", tag)
	if w := a.do(again); w.Code != 304 {
		t.Errorf("If-None-Match: %d", w.Code)
	}
	if w := a.do(withKey(a.as(seb, "POST", "/api/v1/slots/refresh", ""), "6c9b2824-b0cd-4c0b-9052-83d9f457e001")); w.Code != 409 {
		t.Errorf("another person's key: %d", w.Code)
	}
}

func TestSlots_sitesFailed(t *testing.T) {
	a := setup(t)
	a.sites.err = errors.New("down")
	w := a.do(withKey(a.as(anna, "POST", "/api/v1/slots/refresh", ""), "6c9b2824-b0cd-4c0b-9052-83d9f457e001"))
	if w.Code != 502 || problemType(w) != "sites-failed" {
		t.Errorf("got %d %s", w.Code, w.Body)
	}
}

func TestInvitations(t *testing.T) {
	a := setup(t)
	post := func(who, key, body string) *httptest.ResponseRecorder {
		return a.do(withKey(a.as(who, "POST", "/api/v1/invitations", body), key))
	}
	if w := post(anna, "6c9b2824-b0cd-4c0b-9052-83d9f457e001", `{"email":"bert@example.at"}`); w.Code != 403 || problemType(w) != "not-owner" {
		t.Errorf("not the owner: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(anna, "GET", "/api/v1/invitations", "")); w.Code != 403 {
		t.Errorf("list, not the owner: %d", w.Code)
	}
	if w := a.do(a.as(anna, "DELETE", "/api/v1/invitations/bert@example.at", "")); w.Code != 403 {
		t.Errorf("withdraw, not the owner: %d", w.Code)
	}
	if w := post(seb, "6c9b2824-b0cd-4c0b-9052-83d9f457e001", `{"email":"not an address"}`); w.Code != 400 || problemType(w) != "invalid-email" {
		t.Errorf("invalid: %d %s", w.Code, w.Body)
	}
	if w := post(seb, "6c9b2824-b0cd-4c0b-9052-83d9f457e002", `nope`); w.Code != 400 {
		t.Errorf("bad body: %d", w.Code)
	}
	for i, email := range []string{"Bert@Example.at", "carla@example.at", "dora@example.at"} {
		key := "6c9b2824-b0cd-4c0b-9052-83d9f457e10" + string(rune('0'+i))
		if w := post(seb, key, `{"email":"`+email+`"}`); w.Code != 201 || !strings.Contains(w.Body.String(), strings.ToLower(email)) {
			t.Fatalf("invite %s: %d %s", email, w.Code, w.Body)
		}
	}
	if w := post(seb, "6c9b2824-b0cd-4c0b-9052-83d9f457e100", `{"email":"erik@example.at"}`); w.Code != 409 {
		t.Errorf("key reused: %d", w.Code)
	}

	w := a.do(a.as(seb, "GET", "/api/v1/invitations?limit=2", ""))
	var page struct {
		Items      []struct{ Email string }
		NextCursor *string
	}
	if json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 2 || page.NextCursor == nil {
		t.Fatalf("page 1: %s", w.Body)
	}
	w = a.do(a.as(seb, "GET", "/api/v1/invitations?limit=2&cursor="+*page.NextCursor, ""))
	page.NextCursor = nil
	if json.Unmarshal(w.Body.Bytes(), &page) != nil || len(page.Items) != 1 || page.Items[0].Email != "dora@example.at" || page.NextCursor != nil {
		t.Fatalf("page 2: %s", w.Body)
	}
	for q, want := range map[string]int{"?limit=0": 400, "?limit=201": 400, "?cursor=***": 400} {
		if w := a.do(a.as(seb, "GET", "/api/v1/invitations"+q, "")); w.Code != want {
			t.Errorf("%s: %d", q, w.Code)
		}
	}

	if w := a.do(a.as(seb, "DELETE", "/api/v1/invitations/bert@example.at", "")); w.Code != 204 {
		t.Errorf("withdraw: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(seb, "DELETE", "/api/v1/invitations/nobody", "")); w.Code != 400 {
		t.Errorf("withdraw invalid: %d", w.Code)
	}

	a.platform.err = errors.New("502")
	if w := post(seb, "6c9b2824-b0cd-4c0b-9052-83d9f457e200", `{"email":"erik@example.at"}`); w.Code != 502 || problemType(w) != "platform-failed" {
		t.Errorf("platform failed: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(seb, "DELETE", "/api/v1/invitations/carla@example.at", "")); w.Code != 502 {
		t.Errorf("withdraw, platform failed: %d", w.Code)
	}
}

func TestTheApp(t *testing.T) {
	a := setup(t)
	for path, want := range map[string]string{"/": "padel", "/invitations": "padel", "/icon.svg": "<svg/>", "/assets/app-1.js": "js"} {
		w := a.do(httptest.NewRequest("GET", path, nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), want) {
			t.Errorf("GET %s: %d %q", path, w.Code, w.Body)
		}
		cache := w.Header().Get("Cache-Control")
		if strings.HasPrefix(path, "/assets/") != strings.Contains(cache, "immutable") {
			t.Errorf("GET %s: Cache-Control %q", path, cache)
		}
	}
	for _, r := range []*http.Request{
		httptest.NewRequest("POST", "/", nil),
		httptest.NewRequest("GET", "/api/v1/nothing", nil),
		httptest.NewRequest("GET", "/mcp", nil),
	} {
		w := a.do(r)
		if w.Code != 404 || w.Header().Get("Content-Type") != "application/problem+json" {
			t.Errorf("%s %s: %d %s", r.Method, r.URL.Path, w.Code, w.Header().Get("Content-Type"))
		}
	}
	if w := a.do(httptest.NewRequest("PUT", "/api/v1/me", nil)); w.Code != 405 {
		t.Errorf("PUT /api/v1/me: %d", w.Code)
	}
}

func TestReap_onlyTheScheduler(t *testing.T) {
	a := setup(t)
	if w := a.do(gatewaytest.From(gatewayAccount, "POST", "/reap", "")); w.Code != 403 || problemType(w) != "not-the-scheduler" {
		t.Errorf("the gateway: %d %s", w.Code, w.Body)
	}
	if w := a.do(httptest.NewRequest("POST", "/reap", nil)); w.Code != 403 {
		t.Errorf("nobody: %d", w.Code)
	}
	w := a.do(gatewaytest.From(reapAccount, "POST", "/reap?dry_run=true", ""))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"table":"idempotency_keys"`) || !strings.Contains(w.Body.String(), `"dryRun":true`) {
		t.Errorf("the scheduler: %d %s", w.Code, w.Body)
	}
	if w := a.do(gatewaytest.From(reapAccount, "POST", "/reap", "")); w.Code != 200 || !strings.Contains(w.Body.String(), `"dryRun":false`) {
		t.Errorf("a real run: %d %s", w.Code, w.Body)
	}
}

func TestReleaseNotes(t *testing.T) {
	a := setup(t)
	w := a.do(a.as(anna, "GET", "/api/v1/release-notes", ""))
	var list struct {
		Items []struct {
			Slug string
			Link *string
			Read bool
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); w.Code != 200 || err != nil || len(list.Items) != 2 {
		t.Fatalf("list: %d %s", w.Code, w.Body)
	}
	if list.Items[0].Slug != "2026-10-28-newer" || list.Items[0].Link == nil || list.Items[1].Link != nil || list.Items[0].Read {
		t.Errorf("newest first, unread: %s", w.Body)
	}

	read := `{"slugs":["2026-10-28-newer","gone-in-a-deploy"]}`
	if w := a.do(withKey(a.as(anna, "POST", "/api/v1/release-notes/read", read), "11111111-1111-4111-8111-111111111111")); w.Code != 204 {
		t.Fatalf("read: %d %s", w.Code, w.Body)
	}
	if w := a.do(withKey(a.as(anna, "POST", "/api/v1/release-notes/read", read), "11111111-1111-4111-8111-111111111111")); w.Code != 204 {
		t.Errorf("the same again: %d %s", w.Code, w.Body)
	}
	if w := a.do(withKey(a.as(anna, "POST", "/api/v1/release-notes/read", `{"slugs":[]}`), "11111111-1111-4111-8111-111111111111")); w.Code != 409 {
		t.Errorf("key reused: %d %s", w.Code, w.Body)
	}
	if w := a.do(withKey(a.as(anna, "POST", "/api/v1/release-notes/read", `[`), "22222222-2222-4222-8222-222222222222")); w.Code != 400 {
		t.Errorf("broken body: %d %s", w.Code, w.Body)
	}

	if w := a.do(a.as(anna, "GET", "/api/v1/release-notes", "")); !strings.Contains(w.Body.String(), `"read":true`) {
		t.Errorf("anna read it: %s", w.Body)
	}
	if w := a.do(a.as(seb, "GET", "/api/v1/release-notes", "")); strings.Contains(w.Body.String(), `"read":true`) {
		t.Errorf("seb did not: %s", w.Body)
	}
}

func TestLocalSignIn(t *testing.T) {
	a := setup(t)
	// Deployed, the stand-in's pages are not there and its cookie counts
	// for nothing.
	if w := a.do(httptest.NewRequest("GET", "/dev-gateway/token?as=seb", nil)); strings.HasPrefix(w.Body.String(), "eyJ") {
		t.Errorf("deployed /dev-gateway/: %d %s", w.Code, w.Body)
	}
	local, err := localgateway.New("local")
	if err != nil {
		t.Fatal(err)
	}
	note, _ := local.Note(seb, time.Now())
	r := httptest.NewRequest("GET", "/api/v1/me", nil)
	r.AddCookie(&http.Cookie{Name: localgateway.Cookie, Value: note})
	if w := a.do(r); w.Code != 403 {
		t.Errorf("a local cookie deployed: %d %s", w.Code, w.Body)
	}

	h := &transport.Handler{Gateway: &transport.Gateway{Address: "localhost", Keys: local.Keys(), Local: local},
		Owner: "seb@local.test", Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	router := transport.Router(h, "")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/dev-gateway/sign-in?as=seb&next=/invites", nil))
	if w.Code != 302 {
		t.Fatalf("sign-in: %d %s", w.Code, w.Body)
	}
	r = httptest.NewRequest("GET", "/api/v1/me", nil)
	for _, c := range w.Result().Cookies() {
		r.AddCookie(c)
	}
	w = httptest.NewRecorder()
	router.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"canInvite":true`) {
		t.Errorf("signed in locally: %d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/me", nil))
	if w.Code != 401 {
		t.Errorf("no note locally: %d %s", w.Code, w.Body)
	}
}
