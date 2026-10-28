# Padel Kärnten

Wo in Kärnten zu einer bestimmten Zeit noch ein Padel-Platz frei ist, über
sieben Anlagen und vier Buchungsseiten hinweg. Privat: nur wer von Seb
eingeladen ist, kommt hinein, unter **https://padel.burgstaller.me**.

It runs on the Burgstaller Platform (`seburgi/burgstaller-platform`):

- `services/api/`: the Go API. It asks the booking sites itself, on demand
  and at most every five minutes, keeps the latest snapshot in Postgres and
  serves the React app.
- `services/app/`: the React app (Vite, kit/web).
- `api/openapi.yaml`: the contract between them.

What it is for: `PRODUCT.md`. How it works: `docs/design/`. How to work
here: `CLAUDE.md`.

Locally, with Docker running:

```bash
cd services/api && go test -race ./...     # the API, against a real Postgres
cd services/api && go run ./cmd/sites      # ask the booking sites once, print the snapshot
cd services/app && pnpm check              # the app
```

To use it on a laptop, with a Postgres of your own:

```bash
cd services/api && ENVIRONMENT=local DATABASE_URL=postgres://… APP_DIST= go run ./cmd/api
cd services/app && pnpm dev                # http://localhost:5173/dev-gateway/ signs you in
```
