# Mitteilungen: Web Push

## How it works

- **What people hear of** (`internal/transport/push.go`, `gameMessage`):
  a proposed game (every member of the group but whoever proposed it), a
  game that is full (whoever proposed it: now book), moving up from
  reserve (whoever moved up), booked (whoever is in) and cancelled
  (whoever was in or a reserve). Nobody hears of what they did
  themselves. Texts are German, with the day, the time and the venue;
  a tap opens the game. A later message about the same game replaces the
  earlier one on the phone (`tag`).
- **The weekly reminder** (`transport/remind.go`; Seb, 2026-11-04): on
  Sundays at 18:00 Vienna Cloud Scheduler calls `POST /remind` on the
  service's own address, signed as `padel-remind`, the only caller it
  takes (`REMIND_CALLER`). Everyone in a group with at least 5 of the 14
  days of the window open (neither spans nor "Passt nicht") gets "Wann
  kannst du?" with how many are open; a tap opens Wann kann ich?, where
  "wie meistens füllen" does the rest. Each person's task is named by the
  day, so a second run that day tells nobody twice; one with no push on
  hears nothing. The app never fills days by itself instead (Seb,
  2026-11-04).
- **The games slice says what happened, transport says it to whom.**
  `games.Service.Changed` hears each event once the write is in; a
  retried request (same Idempotency-Key) changes nothing and tells
  nothing. The task's name carries the game, the event and the key's
  hash, so Cloud Tasks drops a second one too.
- **Through the queue** `padel-notify` (burgstaller-platform
  `infra/platform/app-padel.tf`): the request puts a task on it and
  answers; the task comes back to `POST /tasks/notify` on the service's
  own run.app address (`NOTIFY_URL`), signed as the api account, which
  is the only caller that path takes (`NOTIFY_CALLER`). Cloud Run takes
  the CPU away once a response is out, so nothing is sent from inside a
  request. On a laptop there is no queue and the API sends at once, in
  the background (`notify.Inline`).
- **Web Push without a library** (`internal/notify/webpush.go`): RFC 8291
  aes128gcm, one record, and a VAPID JWT (RFC 8292) signed with the key
  in the secret `padel-vapid-private-key` (`VAPID_PRIVATE_KEY`, P-256);
  the public key is derived from it. The key may be PEM (also with its
  line breaks written as `\n`), the raw 32 bytes in base64url as
  `web-push generate-vapid-keys` prints them, or that tool's JSON. The tests check the
  encryption against the RFC's own example, byte for byte.
- **Subscriptions** (`push_subscriptions`, migration 0005): one row per
  browser, the endpoint and its keys, no content. The API names a row by
  its endpoint's hash (first 32 hex digits of SHA-256), so the app can
  name its own without keeping anything. A browser that changes hands
  belongs to whoever subscribed last. The app sends its subscription
  again whenever it opens (`useKeepPush`), which keeps `seen_at`
  current; `/reap` drops rows not seen for 90 days, and a push service
  answering 404 or 410 drops its row at once. Other failures are counted
  and not retried, so nobody gets a message twice.
- **In the app** (`services/app/src/push`): the card "Mitteilungen" on
  Spielen, and "Erfahren, wer zusagt?" on a game for whoever is in. Once
  on, a line says so with "Ausschalten"; blocked in the browser, it says
  where to allow them. That line sits on the page Mitteilungen
  (`/notifications`, a row on Mehr; Seb, 2026-11-04) and, on a wide
  screen, which has no Mehr, on Spielen with "Auswählen" to that page. On an iPhone, push works only
  from the home screen, and the card says so. `src/sw.ts` shows the push
  and opens the game on a tap (`push/notification.ts`, kept apart so the
  worker takes nothing of the app with it).
- **Kinds** (`notify.Kinds`, Seb 2026-11-04): `game` (proposed, full,
  moved up, booked, cancelled), `before`, `stale`, `fits`, `missing` and
  `remind`. Each person turns kinds off on the page Mitteilungen, for all
  their browsers (`push_off`, migration 0009; `GET /api/v1/push/kinds`,
  `PUT /api/v1/push/kinds/{kind}`); no row means on. `Deliver` leaves out
  whoever turned the message's kind off; a message without a kind (a task
  queued before kinds) is `game`.
- **One a day** (Seb, 2026-11-04): of `fits`, `missing` and `remind`,
  which are not about a game of one's own, each person gets at most one a
  day in Vienna (`push_daily`, reaped after two days). `Deliver` claims
  the day for everyone it is about to send to, so the first such message
  wins and later ones that day leave that person out, even when the push
  service then fails.
- **Off without a key**: no `VAPID_PRIVATE_KEY`, or one the API cannot
  read (logged as an error at start-up, "push off"), and `GET /api/v1/push`
  has no key, the card shows nothing, subscribing answers 409 `push-off`
  and games tell no one.

## Deliberately not

- **No mail, no SMS.** Only the browsers people allowed.
- **No reminders before a game** yet: that needs a schedule.
- **No retries of a failed push**: a second try risks a second message,
  and a game's news is short-lived anyway (TTL a day).

## Traps

- `gatewaytest.From`'s fourth argument is the gateway's note, not a body.
- Safari on iOS has `PushManager` only in an installed app; the card
  checks for it rather than for the device.
- The secret must have a version before a revision that mounts it can
  start; until then the old revision keeps serving.
- A key the API could not read stopped the first revision with push from
  starting (2026-10-28): the secret held the raw base64url key, not PEM.
  Hence the shapes above, and push off rather than a crash.
