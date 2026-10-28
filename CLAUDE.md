# Working in this repository

Padel Kärnten: free padel courts in Carinthia, for the people Seb invites.
It follows the platform's rules in `seburgi/burgstaller-platform`
`standards/` (start at `standards/README.md`); this file names only how
they apply here. A change to a rule edits its note there.

## Read the design docs first

`docs/design/` describes how the app works today, one file per area:
`platform.md` (where it runs, who may call it), `slots.md` (the snapshot
and its refresh), `booking-sites.md` (how each booking site is read, and
how to add a venue), `invitations.md` (Seb's invitations into the app),
`groups.md`, `availability.md`, `games.md`, `whats-new.md` (release notes). Each says what is true, what is
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
- A change to the app (`services/app/src`, `public`, `index.html`; tests
  aside) adds its note to `release_notes/` (What's new, below) or says
  `Release-note: none, <why>` in its message; the push hook and CI refuse
  it otherwise.
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
pnpm dev                               # Vite; /api and /dev-gateway go to localhost:8080
python3 tools/gate.py                  # what the push hook runs (from the root)
```

On a laptop the API runs with `ENVIRONMENT=local` and signs people in at
`/dev-gateway/` (Seb, Anna, Markus, Lisa; `docs/design/platform.md`). To
see a change in a browser, drive it with `services/app/tools/browse.mjs`
(Playwright, a dev dependency for it alone) and put screenshots in the
project's shared files, never in the repository.

Go 1.27; the Dockerfile's base image tracks `go.mod`. `GOPRIVATE=github.com/seburgi/*`
lets Go and pnpm fetch the platform's private kit (`kit/go`, `kit/web`)
with the session's own GitHub access; CI gets a token from the GitHub App
in the secrets `KIT_APP_ID` and `KIT_APP_KEY`.

## Layout

- `api/openapi.yaml`: the contract. `services/api/internal/transport/gen/`
  and `services/app/src/api/schema.d.ts` are generated from it and
  committed.
- `services/api/internal/<slice>/`: `slots` (with `slots/sites`, the
  booking sites and `venues.json`), `invitations`, `groups`,
  `availability`, `games` and `whatsnew`, which never import each other
  (depguard); `transport` is where they meet.
- `services/api/internal/platform/`: config, database, idempotency,
  problem+json, the platform service's invitation calls (`platformsvc`),
  the test database.
- `services/api/migrations/`: `NNNN_some_words.sql`, applied at start-up.
- `services/app/src/<slice>/`: `courts`, `invitations`, `groups`,
  `availability`, `games` and `whatsnew`, which never import each other (ESLint).
- `release_notes/`: What's new, one file per change (below).

## What's new

The page **Neu** (`/whats-new`) and the card under the head are fed by
`release_notes/`, one file per change (platform
`standards/workflow/release-notes.md`; how it works is
`docs/design/whats-new.md`). Every change a person can see or feel adds
one in the same push, named `YYYY-MM-DD-a-few-words.md` and dated the day
it is pushed (Vienna):

```
---
date: 2026-10-28
area: app
title: Hier steht ab jetzt, was neu ist
link: /whats-new
---
One to three short paragraphs in German, for the people who play: what
they will notice and where. No file names or commit ids.
```

`area` is one of `courts` (Plätze), `play` (Spielen: groups and times),
`invites` (Einladen) or `app` (Überall); `link` is optional, a path in the app. A new area goes into
`whatsnew.Areas` and the page's names in the same commit.

The cloud side is `infra/platform/app-padel.tf` in
`seburgi/burgstaller-platform`: plan on a pull request there, Seb merges.
