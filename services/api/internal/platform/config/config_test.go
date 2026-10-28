package config

import (
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("GATEWAY_CALLER", "Gateway@Example.iam")
	t.Setenv("GATEWAY_AUDIENCE", "padel.burgstaller.me")
	t.Setenv("GATEWAY_AUDIENCES", "padel, https://padel.burgstaller.me/mcp")
	t.Setenv("GATEWAY_JWKS", "https://auth/certs")
	t.Setenv("PLATFORM_URL", "https://platform")
	t.Setenv("OWNER_EMAIL", " Seb@Example.at ")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.GatewayCaller != "gateway@example.iam" || c.Owner != "seb@example.at" || len(c.GatewayAudiences) != 2 ||
		c.GatewayAudiences[1] != "https://padel.burgstaller.me/mcp" || c.Port != "8080" || c.Dist != "/app" {
		t.Errorf("got %+v", c)
	}

	t.Setenv("OWNER_EMAIL", "")
	t.Setenv("GATEWAY_JWKS", "")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "GATEWAY_JWKS, PLATFORM_URL") && !strings.Contains(err.Error(), "GATEWAY_JWKS, OWNER_EMAIL") {
		t.Errorf("missing settings: %v", err)
	}
	t.Setenv("OWNER_EMAIL", "a@b.at")
	t.Setenv("GATEWAY_JWKS", "x")
	t.Setenv("GATEWAY_AUDIENCES", " , ")
	if _, err := Load(); err == nil {
		t.Error("no audiences passed")
	}
}

func TestLoad_local(t *testing.T) {
	t.Setenv("ENVIRONMENT", "local")
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Error("no database passed")
	}
	t.Setenv("DATABASE_URL", "postgres://x")
	c, err := Load()
	if err != nil || !c.IsLocal() || c.Owner != "seb@local.test" {
		t.Errorf("local needs no gateway: %+v %v", c, err)
	}
	// Anything else is deployed, and needs every setting.
	t.Setenv("ENVIRONMENT", "Local")
	if _, err := Load(); err == nil {
		t.Error("ENVIRONMENT=Local passed as local")
	}
}
