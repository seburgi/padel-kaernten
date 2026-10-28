package transport

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/localgateway"
	"github.com/seburgi/padel-kaernten/services/api/internal/platform/problem"
	"github.com/seburgi/padel-kaernten/services/api/internal/transport/gen"
)

// Router is every route of the contract, and the app's files at every GET
// or HEAD no route claims (burgstaller-platform
// standards/architecture/one-image.md). dist is the built app; "" serves
// none. Every request is logged with the app's X-Client.
func Router(h *Handler, dist string) http.Handler {
	r := chi.NewRouter()
	r.Use(h.logClient)
	notFound := func(w http.ResponseWriter, _ *http.Request) {
		problem.Write(w, problem.New(http.StatusNotFound, "not-found", "Not found", ""))
	}
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		if dist == "" || (req.Method != http.MethodGet && req.Method != http.MethodHead) ||
			strings.HasPrefix(req.URL.Path, "/api/") || req.URL.Path == "/api" || strings.HasPrefix(req.URL.Path, "/mcp") {
			notFound(w, req)
			return
		}
		serveApp(w, req, dist)
	})
	// The nightly retention run, outside the contract: only Cloud Scheduler
	// calls it (standards/architecture/background-work.md).
	r.Post("/reap", h.reap)
	// The sign-in stand-in, on a laptop only (localgateway).
	if h.Gateway != nil && h.Gateway.Local != nil {
		r.Handle(localgateway.Path+"*", h.Gateway.Local)
	}
	r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
		problem.Write(w, problem.New(http.StatusMethodNotAllowed, "method-not-allowed", "Method not allowed", ""))
	})
	return gen.HandlerWithOptions(h, gen.ChiServerOptions{
		BaseRouter: r,
		ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
			problem.Write(w, problem.New(http.StatusBadRequest, "bad-request", "Bad request", err.Error()))
		},
	})
}

// serveApp answers the file, or index.html when the path is not a file.
// assets/ carry their hash in the name and are cached for a year; the rest
// is checked again every time, so a deploy shows at once.
func serveApp(w http.ResponseWriter, r *http.Request, dist string) {
	clean := path.Clean("/" + r.URL.Path)
	name := filepath.Join(dist, filepath.FromSlash(clean))
	if info, err := os.Stat(name); err != nil || info.IsDir() {
		name = filepath.Join(dist, "index.html")
		clean = "/index.html"
	}
	if strings.HasPrefix(clean, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFile(w, r, name)
}

func (h *Handler) logClient(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Log.InfoContext(r.Context(), "request", "method", r.Method, "path", r.URL.Path, "client", r.Header.Get("X-Client"))
		}
		next.ServeHTTP(w, r)
	})
}
