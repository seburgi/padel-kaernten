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
  (`internal/platform/retention`; standards/data/retention.md): the
  idempotency answers after 7 days, spans of days gone by after 2, push
  subscriptions not seen for 90. Only `REAP_CALLER`, the scheduler's
  account `padel-reap`, may call it; the gateway's account is refused like
  anyone else's. `?dry_run=true` counts and deletes nothing.
- **`POST /tasks/notify`** is the queue `padel-notify` coming back with a
  message to push (`notify.md`). Only `NOTIFY_CALLER`, the API's own
  account, may call it.
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
- **The app never follows the gateway to sign-in.** Every call goes out
  with `redirect: "manual"` (`send` in `services/app/src/api/client.ts`).
  With the 30-minute login token run out, the calls at start race to swap
  the one refresh token; the losers get a 302 to Rauthy, which fetch would
  follow into a CORS failure that the screens show as a lost connection
  ("Die freien Plätze konnten nicht geladen werden", Seb's feedback #64,
  2026-10-29). Such a call asks again after 1.5, 2, 3 and 3.5 s, ten
  seconds in all, and only a redirect after that counts as a 401: the app
  reloads once and the gateway signs the person in again. The ten seconds
  are for a sleeping gateway (Seb, 2026-10-30): after about 15 minutes
  unused it scales to zero, and Rauthy, which swaps the token, takes about
  seven seconds to wake (two fixed waits of 2.5 s while its cache starts);
  until then every call is sent to sign-in.
- **The boot screen stays until the first screen's data are there**, on
  every start (`services/app/src/main.tsx`; Seb, 2026-10-30), not only on
  the reload for a new release as kit/web's `appReady` does: a cold
  gateway and API take up to ten seconds, and the app stood there empty
  meanwhile. It still never shows when the data come within 0.3 s, and
  goes after ten seconds at most.
- The service migrates at start-up and does not start on a failed
  migration, so Cloud Run keeps the revision before it.
- Every request from the app says which build sent it (`X-Client:
  web/<commit>`), and the service logs it.
- **Every sheet is the same** (Seb, 2026-10-30: a rule for the whole
  app): `services/app/src/Sheet.tsx`. On a phone it slides up from the
  bottom over the tab bar, as high as its content and at most 85% of the
  screen, over the page dimmed and blurred; a tap on that page, Escape or
  its own Abbrechen/Schließen closes it. Wider it is either "inline" (a
  day in its row) or "float" (a card at the bottom over the same dimmed
  page). Today: a day under Wann kann ich? and Gruppe fragen on Plätze.
  A new sheet or dialog uses it, never its own.

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
