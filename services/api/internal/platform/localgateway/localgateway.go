// Package localgateway is the sign-in gateway on a laptop
// (burgstaller-platform standards/auth/local-sign-in.md). There is no
// gateway locally, so this stands in for it: it signs notes like the
// gateway's for four test people, publishes the key they check against,
// and the API checks them with kit/go's gateway.Keys, as in the cloud.
//
// It exists only with ENVIRONMENT=local. New refuses anything else, and
// nothing outside local mounts its pages or trusts its key.
package localgateway

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/seburgi/burgstaller-platform/kit/go/gateway"
)

// Path is where the pages are. Vite proxies it to the API, beside /api.
const Path = "/dev-gateway/"

// Cookie carries the note in the browser; no gateway adds it on a laptop.
const Cookie = "padel_local_assertion"

// Audience is the address local notes are signed for.
const Audience = "localhost"

// keyID names the local key; only this package publishes it.
const keyID = "padel-local"

// key is P-256, fixed so a note survives a restart of the API. It signs
// only on a laptop and is public on purpose, like an emulator's.
const key = "4f1c9a7e2b6d03c8e5a19f7b2d4c6e80a1b3c5d7e9f1a2b4c6d8e0f2a4b6c8d1"

// Person is one test person.
type Person struct{ Key, Name, Email string }

// People are the test people: Seb owns the app, the others play.
var People = []Person{
	{"seb", "Seb", "seb@local.test"},
	{"anna", "Anna", "anna@local.test"},
	{"markus", "Markus", "markus@local.test"},
	{"lisa", "Lisa", "lisa@local.test"},
}

// Gateway signs local notes and serves the sign-in page.
type Gateway struct {
	key  *ecdsa.PrivateKey
	jwks []byte
}

// New builds the local gateway, and refuses unless environment is local.
func New(environment string) (*Gateway, error) {
	if environment != "local" {
		return nil, fmt.Errorf("localgateway: only with ENVIRONMENT=local, not %q", environment)
	}
	raw, err := hex.DecodeString(key)
	if err != nil {
		return nil, err
	}
	k, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), raw)
	if err != nil {
		return nil, err
	}
	jwks, err := json.Marshal(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
		{Key: k.Public(), KeyID: keyID, Algorithm: string(jose.ES256), Use: "sig"}}})
	if err != nil {
		return nil, err
	}
	return &Gateway{key: k, jwks: jwks}, nil
}

// Keys check local notes exactly as the gateway's are checked, fetching
// the key from here instead of over the network.
func (g *Gateway) Keys() *gateway.Keys {
	return &gateway.Keys{Audience: Audience, JWKS: "http://local-gateway/jwks.json", Client: &http.Client{Transport: g}}
}

// RoundTrip publishes the local key to Keys.
func (g *Gateway) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": {"application/json"}},
		Body:       io.NopCloser(bytes.NewReader(g.jwks)),
	}, nil
}

// NoteOf is the local note on r: the cookie the page set, or a plain
// Authorization: Bearer, so curl works.
func NoteOf(r *http.Request) string {
	if token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		return token
	}
	if c, err := r.Cookie(Cookie); err == nil {
		return c.Value
	}
	return ""
}

// Note names email, like the gateway's, valid for a day.
func (g *Gateway) Note(email string, now time.Time) (string, error) {
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.ES256, Key: g.key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", keyID))
	if err != nil {
		return "", err
	}
	return jwt.Signed(signer).Claims(jwt.Claims{
		Issuer:   Audience,
		Audience: jwt.Audience{Audience},
		IssuedAt: jwt.NewNumericDate(now),
		Expiry:   jwt.NewNumericDate(now.Add(24 * time.Hour)),
	}).Claims(map[string]any{"email": email}).Serialize()
}

func emailOf(key string) (string, bool) {
	for _, p := range People {
		if p.Key == key {
			return p.Email, true
		}
	}
	return "", false
}

// ServeHTTP answers the pages:
//
//	GET /dev-gateway/                  a button per person
//	GET /dev-gateway/sign-in?as=anna   set the cookie, back to ?next
//	GET /dev-gateway/sign-out          clear it, back to the buttons
//	GET /dev-gateway/token?as=anna     the note itself, for curl
func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch strings.TrimPrefix(r.URL.Path, Path) {
	case "":
		page(w, r)
	case "sign-in", "token":
		email, ok := emailOf(r.URL.Query().Get("as"))
		if !ok {
			http.Error(w, "as= is seb, anna, markus or lisa", http.StatusBadRequest)
			return
		}
		note, err := g.Note(email, time.Now())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if strings.HasSuffix(r.URL.Path, "token") {
			w.Header().Set("Content-Type", "text/plain")
			_, _ = io.WriteString(w, note)
			return
		}
		http.SetCookie(w, &http.Cookie{Name: Cookie, Value: note, Path: "/",
			HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 24 * 60 * 60})
		http.Redirect(w, r, next(r.URL.Query().Get("next")), http.StatusFound)
	case "sign-out":
		http.SetCookie(w, &http.Cookie{Name: Cookie, Value: "", Path: "/", MaxAge: -1})
		http.Redirect(w, r, Path, http.StatusFound)
	default:
		http.NotFound(w, r)
	}
}

// next keeps the redirect on this site: a path, never another host.
func next(to string) string {
	u, err := url.Parse(to)
	if err != nil || to == "" || u.IsAbs() || u.Host != "" || !strings.HasPrefix(to, "/") || strings.HasPrefix(to, "//") {
		return "/"
	}
	return to
}

func page(w http.ResponseWriter, r *http.Request) {
	to := html.EscapeString(url.QueryEscape(next(r.URL.Query().Get("next"))))
	var buttons strings.Builder
	for _, p := range People {
		fmt.Fprintf(&buttons, `<p><a href="%ssign-in?as=%s&amp;next=%s">Anmelden als %s</a> <small>%s</small></p>`,
			Path, p.Key, to, html.EscapeString(p.Name), html.EscapeString(p.Email))
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprintf(w, `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`+
		`<title>Padel Kärnten, lokale Anmeldung</title><body style="font:17px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 20px">`+
		`<h1 style="font-size:1.4rem">Lokale Anmeldung</h1><p>Auf dem Laptop steht diese Seite für die Anmeldung.</p>%s</body></html>`,
		buttons.String())
}
