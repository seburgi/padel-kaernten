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
- **On a laptop there is no gateway.** With `ENVIRONMENT=local` (and
  only then; Terraform sets `prod`) the API mounts a stand-in at
  `/dev-gateway/` (`internal/platform/localgateway`;
  standards/auth/local-sign-in.md) with a button per test person: Seb
  (`seb@local.test`, the owner), Anna, Markus and Lisa. It signs notes
  with a fixed, public P-256 key for audience `localhost`, sets them in
  the HttpOnly cookie `padel_local_assertion`, and the API checks them
  like the gateway's; a plain `Authorization: Bearer` from
  `/dev-gateway/token?as=anna` works for curl. Locally the gateway
  settings are not needed, and without `PLATFORM_URL` an invitation is
  only logged. On a 401 the app sends a laptop to the stand-in's page and
  back. `services/app/tools/browse.mjs` drives a headless browser signed
  in this way.
- The service migrates at start-up and does not start on a failed
  migration, so Cloud Run keeps the revision before it.
- Every request from the app says which build sent it (`X-Client:
  web/<commit>`), and the service logs it.

## Deliberately not

- **No public page.** The old GitHub Pages site is gone; the address is
  the gateway's (Seb, 2026-10-27).
- **No `/mcp` connector yet.** It would come at `/mcp` on the same
  address when Seb wants Claude to look up courts.
- **No bypass flag for sign-in.** Locally the stand-in signs real notes
  and the API checks them with the same `gateway.Keys`; the tests make
  the gateway's notes with kit/go's `gatewaytest`.

## Traps

- **Local-only code refuses outside local.** `localgateway.New` builds
  nothing unless `ENVIRONMENT` is exactly `local`, and its pages and
  cookie count for nothing deployed (`TestLocalSignIn`).

- **Eversports sits behind Cloudflare**, which may treat Cloud Run's
  addresses differently from a laptop's. If it refuses, smash Pörtschach
  shows as not reachable and every other venue still works. The client is
  honest about who it is (`sites.UserAgent`); it never pretends to be a
  browser.
