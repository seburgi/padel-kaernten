# Free courts: the snapshot and its refresh

## How it works

- **One snapshot** of every venue's free courts for the next 14 days is
  kept in Postgres (`snapshot`, one row, the JSON as the API hands it out,
  and when it was taken). `GET /api/v1/slots` returns it with an `ETag`,
  so an unchanged snapshot is a 304. Before the first one it is a 503
  `no-snapshot`.
- **A schedule every 30 minutes** (Seb, 2026-10-29, replacing "no
  schedule" of 2026-10-27, so the app opens on fresh courts without
  waiting): Cloud Scheduler `padel-refresh` (`*/30 * * * *`, Vienna) calls
  `POST /refresh` on the service's own address, signed as `padel-refresh`;
  only `REFRESH_CALLER` may call it (`transport/refresh.go`,
  `infra/platform/app-padel.tf` in burgstaller-platform). It is outside
  the contract, like `/reap`, and runs the same `Refresh` with a key of
  its own (owner `scheduler`).
- **Opening the app only reads.** It asks for a refresh by itself only
  when there is no snapshot or the snapshot is an hour old
  (`MISSED_MINUTES`: the schedule missed), once per opening or return to
  the front. The same holds on Wann passt es für vier? (`Fits.tsx`).
- **Aktualisieren** under the search on Plätze asks now,
  `POST /api/v1/slots/refresh`. On a snapshot younger than five minutes
  it shows "aktuell, wieder abfragen ab HH:MM" instead; the API enforces
  the five minutes anyway, for everyone together.
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
  venue's booking page for that day. For someone in a group a start time
  opens "Gruppe fragen" instead (Seb, 2026-10-29; `games/AskGroup`, handed
  to `Courts` by `App.tsx`; the app's sheet, `platform.md`): who of each group can then, from the group's
  fits and near misses, "In … vorschlagen", and "Selbst buchen ↗".
- Someone who chose the venues they drive to (Mehr › Deine Plätze, the
  availability slice's venues, handed to `Courts` by `App.tsx` as `only`)
  sees only those, with "Nur deine Plätze. Ändern" (Seb, 2026-10-30).
  None chosen, or none of them in the snapshot any more, shows every venue.

## Deliberately not

- **No booking details.** Only free times leave a booking site: no names,
  no bookings (`booking-sites.md`).
- **No history.** A new snapshot replaces the old one.
- **No retry by itself.** A failed refresh says so with "Nochmal
  versuchen"; the app does not try again on its own. A failed scheduled
  refresh answers 502 and waits for the next half hour.
- **No warm instance.** The schedule does not keep Cloud Run awake
  (it scales to zero after about 15 minutes); an opening can still meet
  a cold start of about a second.
- **No separate scraper service** (Seb, 2026-10-27): the API asks the
  sites itself.

## Traps

- **A refresh can take tens of seconds** when a site is slow (usually
  5 to 15). The app shows the old snapshot meanwhile and says it is
  refreshing; the scheduled one is why an opening seldom has to. Nothing else waits for it: the boot screen counts only what
  is read, never a refresh (`main.tsx`; until 2026-10-28 it waited for the
  refresh after every release, up to ten seconds), and the sites are asked
  outside any transaction, so the refresh holds none of the pool's three
  connections meanwhile.
- The save replaces only an older snapshot (`taken_at <` the new one), so
  two instances could at worst ask twice, never go backwards. The service
  runs one instance.
