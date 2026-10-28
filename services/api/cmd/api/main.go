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

	"github.com/seburgi/padel-kaernten/services/api/internal/invitations"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/config"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/database"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/platformsvc"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/retention"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots"
	"github.com/seburgi/padel-kaernten/services/api/internal/slots/sites"
	"github.com/seburgi/padel-kaernten/services/api/internal/transport"
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
	booking := &sites.Client{HTTP: &http.Client{Timeout: 25 * time.Second}}
	platform := &platformsvc.Client{URL: cfg.PlatformURL, HTTP: &http.Client{Timeout: 20 * time.Second}}
	h := &transport.Handler{
		Slots:       slots.NewService(pool, booking, nil, log),
		Invitations: invitations.NewService(pool, platform),
		Gateway: &transport.Gateway{Caller: cfg.GatewayCaller, Address: cfg.GatewayAudience, Keys: &gateway.Keys{
			Audience: cfg.GatewayAudience, Audiences: cfg.GatewayAudiences, JWKS: cfg.GatewayJWKS,
			Client: &http.Client{Timeout: 10 * time.Second},
		}},
		Owner:    cfg.Owner,
		Revision: buildRevision,
		Log:      log,
		Reap: func(ctx context.Context, dry bool) ([]retention.Result, error) {
			return retention.Run(ctx, pool, retention.Tables, dry)
		},
		ReapCaller: cfg.ReapCaller,
	}
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
