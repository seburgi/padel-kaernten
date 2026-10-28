// Command api is Padel Kärnten's one service: the app, the free courts and
// Seb's invitations, behind the platform's sign-in gateway. It brings its
// schema up to date before it serves and refuses to start when a migration
// fails, so the revision before it keeps serving.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/seburgi/burgstaller-platform/kit/go/gateway"

	"github.com/seburgi/padel-kaernten/services/api/internal/availability"
	"github.com/seburgi/padel-kaernten/services/api/internal/games"
	"github.com/seburgi/padel-kaernten/services/api/internal/groups"
	"github.com/seburgi/padel-kaernten/services/api/internal/invitations"
	"github.com/seburgi/padel-kaernten/services/api/internal/notify"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/config"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/database"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/localgateway"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/platformsvc"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/retention"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots/sites"
	"github.com/seburgi/padel-kaernten/services/api/internal/transport"
	"github.com/seburgi/padel-kaernten/services/api/internal/whatsnew"
)

// buildRevision is set at build time (-ldflags -X).
var buildRevision = "dev"

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := logger().With("revision", buildRevision)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := database.Open(ctx, cfg.DatabaseURL, func(format string, args ...any) {
		log.Info(fmt.Sprintf(format, args...))
	})
	if err != nil {
		return err
	}
	defer pool.Close()
	notes, err := whatsnew.Load(cfg.ReleaseNotesDir)
	if err != nil {
		return err
	}
	news, err := whatsnew.NewService(ctx, pool, notes)
	if err != nil {
		return err
	}
	booking := &sites.Client{HTTP: &http.Client{Timeout: 25 * time.Second}}
	var platform interface {
		invitations.Platform
		groups.Platform
	} = &platformsvc.Client{URL: cfg.PlatformURL, HTTP: &http.Client{Timeout: 20 * time.Second}}
	gw := &transport.Gateway{Caller: cfg.GatewayCaller, Address: cfg.GatewayAudience, Keys: &gateway.Keys{
		Audience: cfg.GatewayAudience, Audiences: cfg.GatewayAudiences, JWKS: cfg.GatewayJWKS,
		Client: &http.Client{Timeout: 10 * time.Second},
	}}
	if cfg.IsLocal() {
		local, err := localgateway.New(cfg.Environment)
		if err != nil {
			return err
		}
		gw = &transport.Gateway{Address: "localhost", Keys: local.Keys(), Local: local}
		if cfg.PlatformURL == "" {
			platform = loggedPlatform{log}
		}
		log.Info("local sign-in", "at", "http://localhost:5173"+localgateway.Path)
	}
	groupsSvc := groups.NewService(pool, platform)
	if err := groupsSvc.EnsureFirst(ctx, cfg.Owner); err != nil {
		return fmt.Errorf("the first group: %w", err)
	}
	gamesSvc := games.NewService(pool)
	var push *notify.Service
	if cfg.VapidKey != "" {
		key, err := notify.ParseKey(cfg.VapidKey)
		if err != nil {
			return err
		}
		push = notify.NewService(pool, key, cfg.PushContact)
	}
	var queue notify.Queue
	switch {
	case push == nil:
	case cfg.NotifyQueue != "":
		queue = &notify.CloudTasks{Name: cfg.NotifyQueue, URL: cfg.NotifyURL, Caller: cfg.NotifyCaller}
	default:
		queue = notify.Inline{Deliver: push.Deliver}
	}
	log.Info("push", "on", push != nil, "queue", cfg.NotifyQueue)
	h := &transport.Handler{
		Slots:        slots.NewService(pool, booking, nil, log),
		Invitations:  invitations.NewService(pool, platform),
		WhatsNew:     news,
		Groups:       groupsSvc,
		Availability: availability.NewService(pool, sites.Known),
		Games:        gamesSvc,
		Gateway:      gw,
		Owner:        cfg.Owner,
		Revision:     buildRevision,
		Log:          log,
		Reap: func(ctx context.Context, dry bool) ([]retention.Result, error) {
			return retention.Run(ctx, pool, retention.Tables, dry)
		},
		ReapCaller:   cfg.ReapCaller,
		Push:         push,
		Queue:        queue,
		NotifyCaller: cfg.NotifyCaller,
	}
	gamesSvc.Changed = h.GameChanged
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           transport.Router(h, cfg.Dist),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	log.Info("serving", "port", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// logger writes JSON that Cloud Logging reads: "severity" and "message".
func logger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			switch a.Key {
			case slog.LevelKey:
				a.Key = "severity"
			case slog.MessageKey:
				a.Key = "message"
			}
			return a
		},
	}))
}

// loggedPlatform stands in for the platform service on a laptop without
// PLATFORM_URL: an invitation is only logged, nobody joins a sign-in group.
type loggedPlatform struct{ log *slog.Logger }

func (p loggedPlatform) Invite(ctx context.Context, email string) error {
	p.log.InfoContext(ctx, "local: would invite", "email", email)
	return nil
}

func (p loggedPlatform) Withdraw(ctx context.Context, email string) error {
	p.log.InfoContext(ctx, "local: would withdraw", "email", email)
	return nil
}

func (p loggedPlatform) InviteAs(ctx context.Context, email, ref string) error {
	p.log.InfoContext(ctx, "local: would invite", "email", email, "ref", ref)
	return nil
}

func (p loggedPlatform) WithdrawAs(ctx context.Context, email, ref string) error {
	p.log.InfoContext(ctx, "local: would withdraw", "email", email, "ref", ref)
	return nil
}
