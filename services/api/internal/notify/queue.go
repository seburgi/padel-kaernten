package notify

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Queue takes a message to send later. name is unique per event: the same
// name twice is one message, so a retried request does not push twice.
type Queue interface {
	Enqueue(ctx context.Context, name string, m Message) error
}

// Path is where the queue's tasks come back to the API.
const Path = "/tasks/notify"

const metadataToken = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"

// CloudTasks puts each message on the queue padel-notify (Name, the full
// queue name) as a task that POSTs it to URL+Path with an ID token for
// Caller, the API's own account, with URL as the audience.
type CloudTasks struct {
	Name   string
	URL    string
	Caller string
	HTTP   *http.Client
	// Token is the API account's access token; the metadata server's when nil.
	Token func(ctx context.Context) (string, error)
	// API is Cloud Tasks' address; tests change it.
	API string
}

var unsafe = regexp.MustCompile(`[^A-Za-z0-9_-]`)

// Enqueue adds the task. A task of that name already there is fine.
func (q *CloudTasks) Enqueue(ctx context.Context, name string, m Message) error {
	body, err := json.Marshal(m)
	if err != nil {
		return err
	}
	base := strings.TrimSuffix(q.URL, "/")
	task := map[string]any{"task": map[string]any{
		"name": q.Name + "/tasks/" + unsafe.ReplaceAllString(name, "_"),
		"httpRequest": map[string]any{
			"url":        base + Path,
			"httpMethod": "POST",
			"headers":    map[string]string{"Content-Type": "application/json"},
			"body":       base64.StdEncoding.EncodeToString(body),
			"oidcToken":  map[string]string{"serviceAccountEmail": q.Caller, "audience": base},
		},
	}}
	payload, err := json.Marshal(task)
	if err != nil {
		return err
	}
	token := q.Token
	if token == nil {
		token = q.metadataToken
	}
	tok, err := token(ctx)
	if err != nil {
		return fmt.Errorf("notify: access token: %w", err)
	}
	api := q.API
	if api == "" {
		api = "https://cloudtasks.googleapis.com"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, api+"/v2/"+q.Name+"/tasks", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	resp, err := q.client().Do(req)
	if err != nil {
		return fmt.Errorf("notify: enqueue: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusConflict || resp.StatusCode/100 == 2 {
		return nil
	}
	msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return fmt.Errorf("notify: enqueue: %s: %s", resp.Status, bytes.TrimSpace(msg))
}

func (q *CloudTasks) client() *http.Client {
	if q.HTTP != nil {
		return q.HTTP
	}
	return &http.Client{Timeout: 10 * time.Second}
}

func (q *CloudTasks) metadataToken(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, metadataToken, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Metadata-Flavor", "Google")
	resp, err := q.client().Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("metadata server: %s", resp.Status)
	}
	var t struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&t); err != nil {
		return "", err
	}
	return t.AccessToken, nil
}

// Inline sends at once, in the background, for a laptop without a queue.
type Inline struct {
	Deliver func(ctx context.Context, m Message) (Report, error)
}

// Enqueue starts the delivery and returns.
func (q Inline) Enqueue(ctx context.Context, _ string, m Message) error {
	go func() { _, _ = q.Deliver(context.WithoutCancel(ctx), m) }()
	return nil
}
