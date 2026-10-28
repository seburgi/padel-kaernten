package notify

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
)

const (
	anna = "anna@example.at"
	bert = "bert@example.at"
)

// browser is a subscription whose private half the test keeps, so the
// push service below can read what it was sent.
type browser struct {
	key    *ecdh.PrivateKey
	secret []byte
	sub    Subscription
}

func newBrowser(t *testing.T, endpoint string) browser {
	t.Helper()
	k, err := ecdh.P256().GenerateKey(randReader{})
	if err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 16)
	_, _ = randReader{}.Read(secret)
	return browser{key: k, secret: secret, sub: Subscription{
		Endpoint: endpoint, P256dh: b64.EncodeToString(k.PublicKey().Bytes()), Auth: b64.EncodeToString(secret)}}
}

// open is the browser's side of RFC 8291.
func (b browser) open(body []byte) ([]byte, error) {
	if len(body) < 86 {
		return nil, errors.New("short")
	}
	salt, asRaw, sealed := body[:16], body[21:86], body[86:]
	as, err := ecdh.P256().NewPublicKey(asRaw)
	if err != nil {
		return nil, err
	}
	shared, err := b.key.ECDH(as)
	if err != nil {
		return nil, err
	}
	info := append(append([]byte("WebPush: info\x00"), b.key.PublicKey().Bytes()...), asRaw...)
	ikm, _ := hkdf.Key(sha256.New, shared, b.secret, string(info), 32)
	cek, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return nil, err
	}
	return plain[:len(plain)-1], nil
}

// pushService answers by path: /ok takes it, /gone and /missing no longer
// know the browser, /broken fails.
type pushService struct {
	*httptest.Server
	mu       sync.Mutex
	browsers map[string]browser
	got      []string
	t        *testing.T
	key      *Key
}

func newPushService(t *testing.T, key *Key) *pushService {
	p := &pushService{browsers: map[string]browser{}, t: t, key: key}
	p.Server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		token, k, _ := strings.Cut(strings.TrimPrefix(r.Header.Get("Authorization"), "vapid t="), ", k=")
		if !p.key.verify(token) || k != p.key.Public() || r.Header.Get("Content-Encoding") != "aes128gcm" || r.Header.Get("TTL") == "" {
			t.Errorf("push headers: %v", r.Header)
		}
		p.mu.Lock()
		defer p.mu.Unlock()
		switch {
		case strings.HasPrefix(r.URL.Path, "/ok"):
			plain, err := p.browsers[p.URL+r.URL.Path].open(body)
			if err != nil {
				t.Errorf("open: %v", err)
			}
			p.got = append(p.got, r.URL.Path+" "+string(plain))
			w.WriteHeader(http.StatusCreated)
		case r.URL.Path == "/gone":
			w.WriteHeader(http.StatusGone)
		case r.URL.Path == "/missing":
			w.WriteHeader(http.StatusNotFound)
		default:
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	t.Cleanup(p.Close)
	return p
}

func (p *pushService) browser(t *testing.T, path string) browser {
	b := newBrowser(t, p.URL+path)
	p.mu.Lock()
	p.browsers[b.sub.Endpoint] = b
	p.mu.Unlock()
	return b
}

func TestService(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := t.Context()
	key := testKey(t)
	push := newPushService(t, key)
	s := NewService(pool, key, "mailto:seb@local.test")
	s.HTTP = push.Client()
	s.Now = func() time.Time { return time.Unix(1_800_000_000, 0) }

	annaPhone, annaLaptop := push.browser(t, "/ok/1"), push.browser(t, "/ok/2")
	bertGone, bertMissing, bertBroken := push.browser(t, "/gone"), push.browser(t, "/missing"), push.browser(t, "/broken")
	for who, bs := range map[string][]browser{anna: {annaPhone, annaLaptop}, bert: {bertGone, bertMissing, bertBroken}} {
		for _, b := range bs {
			id, err := s.Subscribe(ctx, who, b.sub)
			if err != nil || id != ID(b.sub.Endpoint) {
				t.Fatalf("subscribe %s: %q %v", b.sub.Endpoint, id, err)
			}
		}
	}
	// Seeing the same browser again is one row.
	if _, err := s.Subscribe(ctx, anna, annaPhone.sub); err != nil {
		t.Fatal(err)
	}
	// A browser that is no longer reachable at all.
	if _, err := s.Subscribe(ctx, bert, newBrowser(t, "https://127.0.0.1:1/x").sub); err != nil {
		t.Fatal(err)
	}

	m := Message{To: []string{anna, bert, "nobody@example.at"}, Title: "Neues Spiel", Body: "Do 18:00", URL: "/games/1", Tag: "game-1"}
	rep, err := s.Deliver(ctx, m)
	if err != nil || rep != (Report{Sent: 2, Dropped: 2, Failed: 2}) {
		t.Fatalf("deliver: %+v %v", rep, err)
	}
	if len(push.got) != 2 {
		t.Fatalf("got %q", push.got)
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(strings.SplitN(push.got[0], " ", 2)[1]), &payload); err != nil ||
		payload["title"] != "Neues Spiel" || payload["url"] != "/games/1" || payload["tag"] != "game-1" {
		t.Errorf("payload %q", push.got[0])
	}
	// The gone ones are forgotten; the broken ones stay.
	var left int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM push_subscriptions`).Scan(&left); err != nil || left != 4 {
		t.Errorf("left %d %v", left, err)
	}

	// A browser that changes hands belongs to whoever subscribed last.
	if _, err := s.Subscribe(ctx, bert, annaLaptop.sub); err != nil {
		t.Fatal(err)
	}
	if err := s.Unsubscribe(ctx, anna, ID(annaLaptop.sub.Endpoint)); err != nil {
		t.Fatal(err)
	}
	if err := s.Unsubscribe(ctx, anna, ID(annaPhone.sub.Endpoint)); err != nil {
		t.Fatal(err)
	}
	push.got = nil
	if rep, err := s.Deliver(ctx, Message{To: []string{anna, bert}, Title: "x"}); err != nil || rep.Sent != 1 || push.got[0][:6] != "/ok/2 " {
		t.Errorf("after: %+v %v %q", rep, err, push.got)
	}

	for name, sub := range map[string]Subscription{
		"http":     {Endpoint: "http://push.example/x", P256dh: annaPhone.sub.P256dh, Auth: annaPhone.sub.Auth},
		"no host":  {Endpoint: "https:///x", P256dh: annaPhone.sub.P256dh, Auth: annaPhone.sub.Auth},
		"bad keys": {Endpoint: "https://push.example/x", P256dh: "AAAA", Auth: annaPhone.sub.Auth},
		"long":     {Endpoint: "https://push.example/" + strings.Repeat("x", 2048), P256dh: annaPhone.sub.P256dh, Auth: annaPhone.sub.Auth},
	} {
		if _, err := s.Subscribe(ctx, anna, sub); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}

	off := NewService(pool, nil, "")
	if _, err := off.Subscribe(ctx, anna, annaPhone.sub); !errors.Is(err, ErrOff) {
		t.Errorf("off: %v", err)
	}
	if rep, err := off.Deliver(ctx, m); err != nil || rep != (Report{}) {
		t.Errorf("off delivers: %+v %v", rep, err)
	}
	if rep, err := s.Deliver(ctx, Message{}); err != nil || rep != (Report{}) {
		t.Errorf("to nobody: %+v %v", rep, err)
	}
}

func TestDatabaseDown(t *testing.T) {
	pool := testdb.Pool(t)
	down, err := pgxpool.NewWithConfig(context.Background(), pool.Config())
	if err != nil {
		t.Fatal(err)
	}
	down.Close()
	s := NewService(down, testKey(t), "")
	ctx := t.Context()
	b := newBrowser(t, "https://push.example/x")
	if _, err := s.Subscribe(ctx, anna, b.sub); err == nil {
		t.Error("subscribe")
	}
	if err := s.Unsubscribe(ctx, anna, "x"); err == nil {
		t.Error("unsubscribe")
	}
	if _, err := s.Deliver(ctx, Message{To: []string{anna}}); err == nil {
		t.Error("deliver")
	}
}

func TestCloudTasks(t *testing.T) {
	var got []map[string]any
	status := http.StatusOK
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/projects/p/locations/l/queues/padel-notify/tasks" || r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("request %s %v", r.URL.Path, r.Header)
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		got = append(got, body)
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"error":"nope"}`)
	}))
	defer api.Close()
	q := &CloudTasks{Name: "projects/p/locations/l/queues/padel-notify", URL: "https://padel-api.run.app/", Caller: "padel-api@p.iam",
		API: api.URL, Token: func(context.Context) (string, error) { return "tok", nil }}
	m := Message{To: []string{anna}, Title: "Hallo", URL: "/games/1"}
	if err := q.Enqueue(t.Context(), "game-1-proposed-ab/cd", m); err != nil {
		t.Fatal(err)
	}
	task := got[0]["task"].(map[string]any)
	req := task["httpRequest"].(map[string]any)
	oidc := req["oidcToken"].(map[string]any)
	raw, _ := base64.StdEncoding.DecodeString(req["body"].(string))
	var back Message
	_ = json.Unmarshal(raw, &back)
	if task["name"] != q.Name+"/tasks/game-1-proposed-ab_cd" || req["url"] != "https://padel-api.run.app/tasks/notify" ||
		oidc["serviceAccountEmail"] != "padel-api@p.iam" || oidc["audience"] != "https://padel-api.run.app" || back.Title != "Hallo" {
		t.Errorf("task %v", got[0])
	}
	status = http.StatusConflict
	if err := q.Enqueue(t.Context(), "again", m); err != nil {
		t.Errorf("a task already there: %v", err)
	}
	status = http.StatusForbidden
	if err := q.Enqueue(t.Context(), "x", m); err == nil || !strings.Contains(err.Error(), "nope") {
		t.Errorf("refused: %v", err)
	}
	q.Token = func(context.Context) (string, error) { return "", errors.New("no token") }
	if err := q.Enqueue(t.Context(), "x", m); err == nil {
		t.Error("no token")
	}
	q.Token, q.API = func(context.Context) (string, error) { return "tok", nil }, "http://127.0.0.1:1"
	if err := q.Enqueue(t.Context(), "x", m); err == nil {
		t.Error("unreachable")
	}
}

func TestMetadataToken(t *testing.T) {
	answer := `{"access_token":"tok"}`
	code := http.StatusOK
	meta := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Metadata-Flavor") != "Google" {
			t.Error("flavor")
		}
		w.WriteHeader(code)
		_, _ = io.WriteString(w, answer)
	}))
	defer meta.Close()
	// The metadata server's address is fixed; the client sends it here.
	q := &CloudTasks{HTTP: &http.Client{Transport: redirect{to: meta.URL}}}
	if tok, err := q.metadataToken(t.Context()); err != nil || tok != "tok" {
		t.Errorf("token %q %v", tok, err)
	}
	answer = "{"
	if _, err := q.metadataToken(t.Context()); err == nil {
		t.Error("bad json")
	}
	code = http.StatusNotFound
	if _, err := q.metadataToken(t.Context()); err == nil {
		t.Error("404")
	}
	q.HTTP = &http.Client{Transport: redirect{to: "http://127.0.0.1:1"}}
	if _, err := q.metadataToken(t.Context()); err == nil {
		t.Error("unreachable")
	}
	if (&CloudTasks{}).client() == nil {
		t.Error("default client")
	}
}

type redirect struct{ to string }

func (r redirect) RoundTrip(req *http.Request) (*http.Response, error) {
	u := *req.URL
	u.Scheme, u.Host = "http", strings.TrimPrefix(r.to, "http://")
	out := req.Clone(req.Context())
	out.URL = &u
	return http.DefaultTransport.RoundTrip(out)
}

func TestInline(t *testing.T) {
	done := make(chan Message, 1)
	q := Inline{Deliver: func(_ context.Context, m Message) (Report, error) { done <- m; return Report{}, nil }}
	ctx, cancel := context.WithCancel(t.Context())
	if err := q.Enqueue(ctx, "x", Message{Title: "Hallo"}); err != nil {
		t.Fatal(err)
	}
	cancel()
	if m := <-done; m.Title != "Hallo" {
		t.Errorf("got %+v", m)
	}
}
