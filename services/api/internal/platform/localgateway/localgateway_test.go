package localgateway

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNew_onlyLocally(t *testing.T) {
	for _, env := range []string{"", "prod", "staging", "Local"} {
		if _, err := New(env); err == nil {
			t.Errorf("ENVIRONMENT=%q built a local gateway", env)
		}
	}
}

func TestSignInAndVerify(t *testing.T) {
	g, err := New("local")
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	g.ServeHTTP(w, httptest.NewRequest("GET", "/dev-gateway/sign-in?as=anna&next=/whats-new", nil))
	if w.Code != http.StatusFound || w.Header().Get("Location") != "/whats-new" {
		t.Fatalf("sign-in: %d %v", w.Code, w.Header())
	}
	r := httptest.NewRequest("GET", "/api/v1/me", nil)
	for _, c := range w.Result().Cookies() {
		r.AddCookie(c)
	}
	email, err := g.Keys().Verify(context.Background(), NoteOf(r))
	if err != nil || email != "anna@local.test" {
		t.Errorf("the cookie's note: %q %v", email, err)
	}

	w = httptest.NewRecorder()
	g.ServeHTTP(w, httptest.NewRequest("GET", "/dev-gateway/token?as=lisa", nil))
	r = httptest.NewRequest("GET", "/api/v1/me", nil)
	r.Header.Set("Authorization", "Bearer "+w.Body.String())
	if email, err := g.Keys().Verify(context.Background(), NoteOf(r)); err != nil || email != "lisa@local.test" {
		t.Errorf("a bearer note: %q %v", email, err)
	}

	old, _ := g.Note("seb@local.test", time.Now().Add(-25*time.Hour))
	if _, err := g.Keys().Verify(context.Background(), old); err == nil {
		t.Error("a day-old note passed")
	}
	if NoteOf(httptest.NewRequest("GET", "/", nil)) != "" {
		t.Error("a note from nowhere")
	}
}

func TestPages(t *testing.T) {
	g, _ := New("local")
	for _, c := range []struct {
		path string
		code int
		has  string
	}{
		{"/dev-gateway/?next=/invites", 200, "next=%2Finvites"},
		{"/dev-gateway/", 200, "Anmelden als Markus"},
		{"/dev-gateway/sign-in?as=nobody", 400, "seb, anna"},
		{"/dev-gateway/token?as=", 400, ""},
		{"/dev-gateway/elsewhere", 404, ""},
	} {
		w := httptest.NewRecorder()
		g.ServeHTTP(w, httptest.NewRequest("GET", c.path, nil))
		if w.Code != c.code || !strings.Contains(w.Body.String(), c.has) {
			t.Errorf("%s: %d %s", c.path, w.Code, w.Body)
		}
	}
	w := httptest.NewRecorder()
	g.ServeHTTP(w, httptest.NewRequest("GET", "/dev-gateway/sign-out", nil))
	if w.Code != http.StatusFound || !strings.Contains(w.Header().Get("Set-Cookie"), "Max-Age=0") {
		t.Errorf("sign-out: %d %v", w.Code, w.Header())
	}
}

func TestNext_staysOnThisSite(t *testing.T) {
	for in, want := range map[string]string{
		"":                      "/",
		"/courts?x=1":           "/courts?x=1",
		"https://evil.example/": "/",
		"//evil.example/":       "/",
		"evil":                  "/",
		"%zz":                   "/",
	} {
		if got := next(in); got != want {
			t.Errorf("next(%q) = %q, want %q", in, got, want)
		}
	}
}
