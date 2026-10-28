// Package config reads the API's settings from its environment, which
// Terraform sets (burgstaller-platform infra/platform/app-padel.tf).
package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

// Config is everything the API needs to start.
type Config struct {
	// Environment is ENVIRONMENT: prod when deployed, local on a laptop,
	// where the local gateway stands in for sign-in (localgateway).
	Environment string
	Port        string
	DatabaseURL string
	// Dist is the built app the API serves.
	Dist string

	// The gateway's note (standards/auth/checking-the-note.md).
	GatewayCaller    string
	GatewayAudience  string
	GatewayAudiences []string
	GatewayJWKS      string

	// PlatformURL is the platform service's Cloud Run address.
	PlatformURL string
	// Owner is the one address that may invite.
	Owner string
	// ReapCaller is the account the Cloud Scheduler job signs POST /reap
	// with. Nobody else may call it; empty means nobody can.
	ReapCaller string
	// Web Push (docs/design/notify.md), all optional: without the VAPID
	// key push is off. VapidKey is a P-256 private key in PEM; NotifyQueue
	// the Cloud Tasks queue, NotifyURL the service's own address the tasks
	// go to, NotifyCaller the account they are signed as. Without a queue
	// the API sends at once (a laptop).
	VapidKey     string
	PushContact  string
	NotifyQueue  string
	NotifyURL    string
	NotifyCaller string
	// ReleaseNotesDir holds the What's new notes; the image copies them to
	// /release_notes.
	ReleaseNotesDir string
}

// Load reads the environment. It refuses to start without the gateway's
// settings, the database or the owner: a crash loop is loud, a half-set
// gateway is not.
func Load() (Config, error) {
	c := Config{
		Environment:     os.Getenv("ENVIRONMENT"),
		Port:            env("PORT", "8080"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		Dist:            env("APP_DIST", "/app"),
		GatewayCaller:   strings.ToLower(os.Getenv("GATEWAY_CALLER")),
		GatewayAudience: os.Getenv("GATEWAY_AUDIENCE"),
		GatewayJWKS:     os.Getenv("GATEWAY_JWKS"),
		PlatformURL:     os.Getenv("PLATFORM_URL"),
		Owner:           strings.ToLower(strings.TrimSpace(os.Getenv("OWNER_EMAIL"))),
		ReapCaller:      strings.ToLower(strings.TrimSpace(os.Getenv("REAP_CALLER"))),
		ReleaseNotesDir: env("RELEASE_NOTES_DIR", "../../release_notes"),
		VapidKey:        os.Getenv("VAPID_PRIVATE_KEY"),
		PushContact:     env("PUSH_CONTACT", "mailto:sburgstaller@gmail.com"),
		NotifyQueue:     os.Getenv("NOTIFY_QUEUE"),
		NotifyURL:       os.Getenv("NOTIFY_URL"),
		NotifyCaller:    strings.ToLower(strings.TrimSpace(os.Getenv("NOTIFY_CALLER"))),
	}
	for _, a := range strings.Split(os.Getenv("GATEWAY_AUDIENCES"), ",") {
		if a = strings.TrimSpace(a); a != "" {
			c.GatewayAudiences = append(c.GatewayAudiences, a)
		}
	}
	if c.IsLocal() {
		// No gateway and no platform service on a laptop: the local
		// gateway signs the test people in, and Seb's is the owner.
		if c.Owner == "" {
			c.Owner = "seb@local.test"
		}
		if c.DatabaseURL == "" {
			return c, errors.New("missing settings: DATABASE_URL")
		}
		return c, nil
	}
	var missing []string
	for _, s := range []struct{ name, value string }{
		{"DATABASE_URL", c.DatabaseURL}, {"GATEWAY_CALLER", c.GatewayCaller}, {"GATEWAY_AUDIENCE", c.GatewayAudience},
		{"GATEWAY_JWKS", c.GatewayJWKS}, {"PLATFORM_URL", c.PlatformURL}, {"OWNER_EMAIL", c.Owner},
	} {
		if s.value == "" {
			missing = append(missing, s.name)
		}
	}
	if len(missing) > 0 {
		return c, fmt.Errorf("missing settings: %s", strings.Join(missing, ", "))
	}
	if len(c.GatewayAudiences) == 0 {
		return c, errors.New("missing settings: GATEWAY_AUDIENCES")
	}
	return c, nil
}

// IsLocal is a laptop.
func (c Config) IsLocal() bool { return c.Environment == "local" }

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
