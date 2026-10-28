// Package notify is Web Push (docs/design/notify.md): the browsers that
// allowed notifications, and sending them a message. What happened and who
// hears of it is decided elsewhere (transport); a message reaches the API
// again through the queue padel-notify and is sent from there, because
// Cloud Run takes the CPU away once a response is out.
package notify

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrInvalid means a subscription without an https endpoint or with keys
// that are not a P-256 point and a 16-byte secret.
var ErrInvalid = errors.New("invalid subscription")

// Subscription is what the browser's pushManager.subscribe hands out.
type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// Message is one notification for some people. URL is a path in the app;
// Tag makes a later message about the same thing replace the earlier one.
type Message struct {
	To    []string `json:"to"`
	Title string   `json:"title"`
	Body  string   `json:"body"`
	URL   string   `json:"url"`
	Tag   string   `json:"tag,omitempty"`
}

// Service keeps the subscriptions and sends. Key nil means push is off:
// subscribing is refused and sending does nothing.
type Service struct {
	pool    *pgxpool.Pool
	Key     *Key
	Contact string
	HTTP    *http.Client
	Now     func() time.Time
}

// NewService is the service; key may be nil.
func NewService(pool *pgxpool.Pool, key *Key, contact string) *Service {
	return &Service{pool: pool, Key: key, Contact: contact, HTTP: &http.Client{Timeout: 10 * time.Second}, Now: time.Now}
}

// ID is a subscription's name in the API: the endpoint's hash, so the
// browser can name its own without keeping anything.
func ID(endpoint string) string {
	sum := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(sum[:16])
}

// Subscribe keeps a browser's subscription for who, or sees it again. A
// browser that changes hands belongs to whoever subscribed last.
func (s *Service) Subscribe(ctx context.Context, who string, sub Subscription) (string, error) {
	if s.Key == nil {
		return "", ErrOff
	}
	u, err := url.Parse(sub.Endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || len(sub.Endpoint) > 2048 {
		return "", ErrInvalid
	}
	if _, err := encrypt(nil, sub.P256dh, sub.Auth, rand.Reader); err != nil {
		return "", ErrInvalid
	}
	id := ID(sub.Endpoint)
	_, err = s.pool.Exec(ctx, `
		INSERT INTO push_subscriptions (id, email, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (endpoint) DO UPDATE SET email = $2, p256dh = $4, auth = $5, seen_at = now()`,
		id, who, sub.Endpoint, sub.P256dh, sub.Auth)
	return id, err
}

// ErrOff means the API has no VAPID key.
var ErrOff = errors.New("push is off")

// Unsubscribe forgets one of who's browsers; one already gone is fine.
func (s *Service) Unsubscribe(ctx context.Context, who, id string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE id = $1 AND email = $2`, id, who)
	return err
}

// Report is what one Deliver did.
type Report struct {
	Sent    int `json:"sent"`
	Dropped int `json:"dropped"`
	Failed  int `json:"failed"`
}

// Deliver sends m to every browser of its people. A browser the push
// service no longer knows (404, 410) is forgotten; other failures are
// counted and not retried, so nobody gets a message twice.
func (s *Service) Deliver(ctx context.Context, m Message) (Report, error) {
	var rep Report
	if s.Key == nil || len(m.To) == 0 {
		return rep, nil
	}
	payload, err := json.Marshal(map[string]string{"title": m.Title, "body": m.Body, "url": m.URL, "tag": m.Tag})
	if err != nil {
		return rep, err
	}
	rows, err := s.pool.Query(ctx, `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE email = ANY($1) ORDER BY id`, m.To)
	if err != nil {
		return rep, err
	}
	type target struct {
		id string
		Subscription
	}
	var targets []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.id, &t.Endpoint, &t.P256dh, &t.Auth); err != nil {
			rows.Close()
			return rep, err
		}
		targets = append(targets, t)
	}
	if err := rows.Err(); err != nil {
		return rep, err
	}
	for _, t := range targets {
		status, err := s.send(ctx, t.Subscription, payload)
		switch {
		case err == nil && status/100 == 2:
			rep.Sent++
		case status == http.StatusNotFound || status == http.StatusGone:
			if _, err := s.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE id = $1`, t.id); err != nil {
				return rep, err
			}
			rep.Dropped++
		default:
			rep.Failed++
		}
	}
	return rep, nil
}

func (s *Service) send(ctx context.Context, sub Subscription, payload []byte) (int, error) {
	body, err := encrypt(payload, sub.P256dh, sub.Auth, rand.Reader)
	if err != nil {
		return 0, err
	}
	auth, err := s.Key.authorization(sub.Endpoint, s.Contact, s.Now())
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Content-Type", "application/octet-stream")
	// A day: a game is rarely news after that.
	req.Header.Set("TTL", "86400")
	req.Header.Set("Urgency", "normal")
	resp, err := s.HTTP.Do(req)
	if err != nil {
		return 0, fmt.Errorf("notify: push: %w", err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode, nil
}
