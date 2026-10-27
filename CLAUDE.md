# Working in this repository

Padel Kärnten: free padel courts in Carinthia, for the people Seb invites.
It follows the platform's rules in `seburgi/burgstaller-platform`
`standards/` (start at `standards/README.md`); this file names only how
they apply here. A change to a rule edits its note there.

## Read the design docs first

`docs/design/` describes how the app works today, one file per area:
`platform.md` (where it runs, who may call it), `slots.md` (the snapshot
and its refresh), `booking-sites.md` (how each booking site is read, and
how to add a venue), `invitations.md`. Each says what is true, what is
**deliberately not** done, and the traps. A change to behaviour edits its
file in the same commit.

## Changes go straight to main

No pull requests (standards/workflow/trunk-based.md). Every change is
committed and pushed to `main`, and every push to `main` deploys.

- Claude Code sessions set the hooks up at start (`.claude/settings.json`
  runs `tools/dev/setup.sh`, which also starts Docker for the tests).
  Anywhere else, run `bash tools/dev/setup.sh` once.
- Start from fresh main: `git pull --rebase origin main`. Push with
  `git push origin HEAD:main`, as a command of its own. If main moved,
  rebase and push again.
- The commit hook formats what is staged and runs `tools/checks.py`; the
  push hook runs the gate (`tools/gate.py`: generated code, vet,
  golangci-lint, Go tests with `-race` against a real Postgres, `pnpm
  check`, coverage). Never `--no-verify`, `git commit -n` or a force push.
- About 6 minutes after a push, check the `deploy` run for the commit. Red
  deploys nothing; fix forward at once.
- Commit messages: subject, `Why:`, `What:`, `Checked:`, `Thread:` (the
  template is `tools/hooks/commit-template.txt`). No Claude attribution.

## Commands

```bash
cd services/api
go generate ./internal/transport/gen   # after changing api/openapi.yaml
go test -race ./...                    # needs Docker (testcontainers); skips without
golangci-lint run
go run ./cmd/sites                     # ask the booking sites once
cd ../app
pnpm api                               # the types, after changing api/openapi.yaml
pnpm check                             # Prettier, ESLint, tsc, Vitest with coverage
pnpm dev                               # Vite; /api goes to localhost:8080
python3 tools/gate.py                  # what the push hook runs (from the root)
```

Go 1.27; the Dockerfile's base image tracks `go.mod`. `GOPRIVATE=github.com/seburgi/*`
lets Go and pnpm fetch the platform's private kit (`kit/go`, `kit/web`)
with the session's own GitHub access; CI gets a token from the GitHub App
in the secrets `KIT_APP_ID` and `KIT_APP_KEY`.

## Layout

- `api/openapi.yaml`: the contract. `services/api/internal/transport/gen/`
  and `services/app/src/api/schema.d.ts` are generated from it and
  committed.
- `services/api/internal/<slice>/`: `slots` (with `slots/sites`, the
  booking sites and `venues.json`) and `invitations`, which never import
  each other (depguard).
- `services/api/internal/platform/`: config, database, idempotency,
  problem+json, the platform service's invitation calls (`platformsvc`),
  the test database.
- `services/api/migrations/`: `NNNN_some_words.sql`, applied at start-up.
- `services/app/src/<slice>/`: `courts` and `invitations`, which never
  import each other (ESLint).

The cloud side is `infra/platform/app-padel.tf` in
`seburgi/burgstaller-platform`: plan on a pull request there, Seb merges.
