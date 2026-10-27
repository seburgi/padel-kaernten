# The booking sites, and how to add a venue

## How it works

- The venues are `services/api/internal/slots/sites/venues.json`, embedded
  in the binary. Each names its `platform` and what that platform needs.
  A venue with `"enabled": false` is skipped.
- Every site is read with one honest client: the User-Agent
  `PadelKaernten/1.0 (+https://padel.burgstaller.me)`, 25 seconds per
  request, anything but a 200 is a failure of that venue.
- Only free times are kept: court, day, from, to and, where known, the
  price per hour (euro cents). Times are Europe/Vienna.
- `go run ./cmd/sites` in `services/api` asks every site once and prints
  the snapshot, to try a new venue.

| Venue | Courts | Price (court/hour) | Price from |
|---|---|---|---|
| Padelbase Annenheim | 4 × outdoor | 16–32 € (winter 16–24 €) | booking site |
| Padel Ten Villach | 3 × indoor | 20–36 € | booking site + padelten.at |
| Sportunion Klagenfurt | 3 × outdoor | 22 € / 30 € from 16:00 | booking site |
| Arena One | 6 × indoor | 40 € / 48 € | arenaone.at |
| smash Pörtschach | 3 × outdoor | 28 € / 36 € | booking plan |
| Padel Campus Moosburg | 2 × outdoor | 28 € / 32 € | Padelmates (9 days ahead) |
| Padel Campus St. Veit | 3 × outdoor | 28 € / 32 € | Padelmates (9 days ahead) |

Fields every venue may have besides its platform's:

| Field | What for |
|---|---|
| `area` / `area_by_court` | `halle`, `freiluft` or `ueberdacht` (Eversports says so itself) |
| `price_classes` | eTennis price classes missing from its legend, e.g. `{"price38510": 34}` |
| `price_rules` | fixed prices in €/h when the site shows none (weekdays 0=Mon … 6=Sun) |
| `price_note` | a note shown under the venue |
| `address` | for the map link |
| `sources` | where the court type and prices come from |

### eTennis (`etennis.go`)

Recognised by "powered by eTennis.at" in the page title, on domains like
`*.tennisplatz.info` or their own (buchung-padelbase.at).

- `GET {base_url}/reservierung?c={category_id}&d={unix midnight}`: server
  rendered HTML, one request per week.
- `category_id` is `c=` from the booking URL; a venue can have several
  (sand, padel, kids), all linked in the menu. Take the padel one.
- Per day a `day-courts` block (court names) and a `day-body` with one
  `<div class="court" data-cid=…>` per court. Free cells are
  `class="slot av …" data-begin="<unix>" data-size="<units>"`; booked ones
  carry `res`, past ones `pastSlot`. A unit is the spacing of the time
  scale on the left (`time-schedule-left`), mostly 30 minutes.
- Depending on the client 1 or 7 days are rendered; the header's `data-dt`
  per day is in the order of the `day-body` blocks.
- Padelbase has venues all over Austria under one domain: only the
  Carinthian ones belong here.

### Wansport (`wansport.go`)

Italian, on `<venue>.wansport.com`.

- `GET {base_url}/de-de/index.php?option=com_wsinit&task=prenotazioni.getPannelloPrenotazioni&format=raw&filtroData=YYYY-MM-DD&filtroSport={sport_id}`:
  JSON, no sign-in, one request per day.
- `sport_id` is `filtroSport=` in the requests of `/de-de/bookingspanel`;
  padel at Arena One is `15`.
- `dati.sedi[].risorse[]` are the courts, `tslots` the opening grid (30
  minutes), `listaPrenotazioni` the bookings. Free is the grid minus the
  bookings. `isFuoriFinestraTemporale: true` means the day is outside the
  booking window.

### Eversports (`eversports.go`)

`www.eversports.at/s/<slug>` (overview), `/sb/<slug>` (booking plan).
Behind Cloudflare.

- Grid and prices: `POST /api/booking/calendar/update` (form encoded) with
  `facilityId, facilitySlug, sport[id], sport[slug], sport[name],
  sport[uuid], date, type=user`: HTML with `<td data-state="free"
  data-date data-start="HHMM" data-end data-price data-court>`. Everything
  there is marked free.
- Booked: `GET /api/slot?facilityId=…&startDate=YYYY-MM-DD&courts[]=…`,
  a list of `{date, start, court}` (sometimes wrapped as `{"slots": […]}`).
  Free is the grid minus that list.
- The ids: open `/sb/<slug>` in a browser, click "next week" and read the
  body of `calendar/update`. The court ids come from the HTML.
- At most 21 days ahead (`data-max-calendar-days`).

### Padelmates (`padelmates.go`)

The club's page is `https://padelmates.se/club/<club_id>` (the id is in
share links like `padelmates.co/share/app/club_info/<club_id>`).

- `GET https://fastapi-production-fargate.padelmates.io/player/player_booking/all_courts_slot_prices_v3?club_id=…&start_datetime=<ms>&end_datetime=<ms>&lang=de`:
  JSON, no sign-in, one request per day.
- `originalCourts[]`: courts with `sport_type`, `court_type_enum`
  (INDOOR/OUTDOOR) and their prices per time window.
- `allSlots[]`: every bookable option (30–120 minutes) with
  `reservedIntersection` when taken. Free is what a free option covers.
- Mostly 9 days ahead (`future_booking_days`), then
  `too_early_for_advance_booking: true`.

## Deliberately not

- **No names, ever.** Wansport's bookings carry the bookers' names
  (`lista_organizzazioni`) and Padelmates' `reservedBookings` details;
  neither is read beyond the times.
- **No pretending to be a browser.** The old script impersonated Chrome to
  get past Cloudflare; the API does not. If Eversports refuses it, that
  venue shows as not reachable.
- **No guessing.** A booking without a start or end, or a court without a
  name, is skipped rather than shown.

## Traps

- **The sites change without notice.** Eversports' `/api/slot` changed its
  shape once already. The tests read saved pages (`testdata/`, names
  removed); when a site changes, save a new page there and fix the reader.
- Arena One's bookings include markers without dates; the old Python
  script fell over them (KeyError) and lost the venue.
