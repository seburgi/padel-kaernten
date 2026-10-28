# Free courts: the snapshot and its refresh

## How it works

- **One snapshot** of every venue's free courts for the next 14 days is
  kept in Postgres (`snapshot`, one row, the JSON as the API hands it out,
  and when it was taken). `GET /api/v1/slots` returns it with an `ETag`,
  so an unchanged snapshot is a 304. Before the first one it is a 503
  `no-snapshot`.
- **No schedule** (Seb, 2026-10-27). The app asks for a refresh,
  `POST /api/v1/slots/refresh`, once when it opens or comes back to the
  front and the snapshot is five minutes old or older.
- **At most one look every five minutes** (`slots.MinAge`). A refresh on a
  snapshot younger than that returns it without asking anyone. One refresh
  asks at a time; the others wait for it and then find the fresh one.
- A refresh asks all seven venues at once (`sites.Client.Take`, at most
  90 seconds). A venue that fails is marked `failed` and the others still
  count. Only when **every** venue fails does the refresh fail (502
  `sites-failed`), and the last snapshot stays.
- The refresh carries an `Idempotency-Key`, claimed in the same
  transaction that saves the snapshot; a repeat returns the same answer.
- The app filters locally: day, from, until, how long, indoor or outdoor.
  It shows each fitting court with its price per hour and a link to the
  venue's booking page for that day.

## Deliberately not

- **No booking details.** Only free times leave a booking site: no names,
  no bookings (`booking-sites.md`).
- **No history.** A new snapshot replaces the old one.
- **No retry by itself.** A failed refresh says so with "Nochmal
  versuchen"; the app does not try again on its own.
- **No separate scraper service** (Seb, 2026-10-27): the API asks the
  sites itself.

## Traps

- **A refresh can take tens of seconds** when a site is slow (usually
  5 to 15). The app shows the old snapshot meanwhile and says it is
  refreshing. Nothing else waits for it: the boot screen counts only what
  is read, never a refresh (`main.tsx`; until 2026-10-28 it waited for the
  refresh after every release, up to ten seconds), and the sites are asked
  outside any transaction, so the refresh holds none of the pool's three
  connections meanwhile.
- The save replaces only an older snapshot (`taken_at <` the new one), so
  two instances could at worst ask twice, never go backwards. The service
  runs one instance.
