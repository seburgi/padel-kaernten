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
}

// Load reads the environment. It refuses to start without the gateway's
// settings, the database or the owner: a crash loop is loud, a half-set
// gateway is not.
func Load() (Config, error) {
	c := Config{
		Port:            env("PORT", "8080"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		Dist:            env("APP_DIST", "/app"),
		GatewayCaller:   strings.ToLower(os.Getenv("GATEWAY_CALLER")),
		GatewayAudience: os.Getenv("GATEWAY_AUDIENCE"),
		GatewayJWKS:     os.Getenv("GATEWAY_JWKS"),
		PlatformURL:     os.Getenv("PLATFORM_URL"),
		Owner:           strings.ToLower(strings.TrimSpace(os.Getenv("OWNER_EMAIL"))),
		ReapCaller:      strings.ToLower(strings.TrimSpace(os.Getenv("REAP_CALLER"))),
	}
	for _, a := range strings.Split(os.Getenv("GATEWAY_AUDIENCES"), ",") {
		if a = strings.TrimSpace(a); a != "" {
			c.GatewayAudiences = append(c.GatewayAudiences, a)
		}
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

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
