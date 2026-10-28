# Where it runs and who may call it

## How it works

- One private Cloud Run service, `padel-api`, in the platform's project
  (`burgstaller-platform`, `europe-west1`), defined by
  `infra/platform/app-padel.tf` in `seburgi/burgstaller-platform`.
  min-instances 0, max 1, database `padel` on the shared Postgres with at
  most 3 connections. One image: the Go API serves the React app's
  `dist/` (`APP_DIST=/app`).
- **People come through the gateway** at `padel.burgstaller.me` (Envoy
  with Rauthy, group `padel`). The service trusts a request only when the
  gateway's own account called it (`GATEWAY_CALLER`), it is not
  cross-site, and the gateway's note verifies against `GATEWAY_JWKS` for
  `GATEWAY_AUDIENCE`; the note's lower-cased email is the person.
  `internal/transport/person.go` checks it, with kit/go's `gateway`.
- **`/api/v1/version` and `/api/v1/client-config`** need no person; the
  deploy's smoke test calls them on the `run.app` address with the deploy
  account's ID token, and checks the version names the commit just
  deployed.
- **The owner is `OWNER_EMAIL`** (Seb). Only the owner sees and uses the
  invitation page (`invitations.md`).
- **A nightly `POST /reap`** (03:30 Vienna, Cloud Scheduler) deletes what
  grows forever, table by table, in chunks under an advisory lock
  (`internal/platform/retention`; standards/data/retention.md): today the
  idempotency answers after 7 days. Only `REAP_CALLER`, the scheduler's
  account `padel-reap`, may call it; the gateway's account is refused like
  anyone else's. `?dry_run=true` counts and deletes nothing.
- The service migrates at start-up and does not start on a failed
  migration, so Cloud Run keeps the revision before it.
- Every request from the app says which build sent it (`X-Client:
  web/<commit>`), and the service logs it.

## Deliberately not

- **No public page.** The old GitHub Pages site is gone; the address is
  the gateway's (Seb, 2026-10-27).
- **No `/mcp` connector yet.** It would come at `/mcp` on the same
  address when Seb wants Claude to look up courts.
- **No local sign-in.** Locally the API needs a note like the gateway's;
  the tests make one with kit/go's `gatewaytest`.

## Traps

- **Eversports sits behind Cloudflare**, which may treat Cloud Run's
  addresses differently from a laptop's. If it refuses, smash Pörtschach
  shows as not reachable and every other venue still works. The client is
  honest about who it is (`sites.UserAgent`); it never pretends to be a
  browser.
