// Package platformsvc calls the platform service (seburgi/platform-service)
// on its Cloud Run address with the api account's own ID token, which Cloud
// Run checks. The service works out the app from the account, so Padel can
// only ever change the group padel (burgstaller-platform
// standards/auth/who-may-use-an-app.md).
package platformsvc

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Ref is Padel's key for its one invitation per person.
const Ref = "padel"

// metadataIdentity hands out an ID token for the service's own account.
const metadataIdentity = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"

// Client calls the platform service at URL.
type Client struct {
	URL string
	// HTTP makes the calls; nil is http.DefaultClient.
	HTTP *http.Client
	// Token is the ID token for URL; nil asks the metadata server.
	Token func(ctx context.Context) (string, error)
	// Metadata is where the metadata server answers, for tests.
	Metadata string
}

// Invite puts email into the group padel (PUT /v1/invitations/{email}/padel).
func (c *Client) Invite(ctx context.Context, email string) error {
	return c.call(ctx, http.MethodPut, email)
}

// Withdraw takes Padel's invitation of email back.
func (c *Client) Withdraw(ctx context.Context, email string) error {
	return c.call(ctx, http.MethodDelete, email)
}

func (c *Client) call(ctx context.Context, method, email string) error {
	if c.URL == "" {
		return errors.New("PLATFORM_URL is not set")
	}
	token := c.Token
	if token == nil {
		token = c.idToken
	}
	tok, err := token(ctx)
	if err != nil {
		return fmt.Errorf("ID token: %w", err)
	}
	u := strings.TrimSuffix(c.URL, "/") + "/v1/invitations/" + url.PathEscape(email) + "/" + Ref
	req, err := http.NewRequestWithContext(ctx, method, u, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := c.client().Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusNoContent {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("platform service answered %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return nil
}

func (c *Client) client() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return http.DefaultClient
}

func (c *Client) idToken(ctx context.Context) (string, error) {
	base := metadataIdentity
	if c.Metadata != "" {
		base = c.Metadata
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?format=full&audience="+url.QueryEscape(c.URL), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Metadata-Flavor", "Google")
	resp, err := c.client().Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("metadata server answered %s", resp.Status)
	}
	return strings.TrimSpace(string(body)), nil
}
