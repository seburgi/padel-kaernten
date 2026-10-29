# When people can play

## How it works

- **Availability belongs to the person, not to a group**: every group they
  are in sees the same (`internal/availability`).
- **Spans on calendar days**, in minutes after midnight in Vienna, on a
  30-minute grid from 6:00 (360) to 24:00 (1440), for today and the 13
  days after it (`GET /api/v1/availability` says the window). As many
  spans a day as one likes; `PUT /api/v1/availability/days/{day}`
  replaces a day's, and overlapping or touching spans become one. A day
  with no spans means "can't" (Seb, 2026-10-28).
- **Three kinds of day**: with spans; **declined** ("Passt nicht",
  `{"spans": [], "declined": true}`, table `availability_declined`,
  migration 0008), which someone has thought about and does not suit;
  and **open**, with neither, not thought about yet. Both declined and
  open mean "can't" for the fits, but only an open day makes someone
  worth asking in a near miss (`games.md`). Spans with `declined` answer
  400 `invalid-spans`; spans replace a decline, and neither opens the day
  again (Seb, 2026-10-29: "einfacher den Überblick zu behalten").
  `daysEntered` on a group's members counts both kinds of entered day.
- **"Wie meistens"**: spans per weekday (`PUT
  /api/v1/availability/templates`, 1 Monday to 7 Sunday), which the app
  offers for open days; it never fills days by itself, and never a
  declined one.
- **Where one drives to**: venue ids from `venues.json` (`PUT
  /api/v1/availability/venues`); none chosen means every venue. An id
  that is not a venue answers 400 `unknown-venue`.
- **In the app** (`services/app/src/availability`, `/availability`, "Wann
  kannst du?"; on a phone a tab of its own, "Wann kann ich?", right after
  Plätze, Seb 2026-10-29; on a wide screen under Spielen): the 14 days as rows, each a line from 6 to 24 with its
  spans filled in. A row opens an editor (on a phone a sheet from the bottom, just above
  the tab bar; Seb, 2026-10-29): quick choices (Früh 7–9, Mittag
  12–14, Abend ab 18, Ganzer Tag), from–to selects per span on the half
  hour, "+ Noch eine Zeit", "Passt nicht" to decline the day, "Wieder
  offen" to clear it, and "So ist es meistens am …" to keep the day as its
  weekday's usual. A declined row is hatched and says "Passt nicht"; an
  open one says "offen · antippen" in the warning colour (Seb,
  2026-10-29), and above the rows "Noch offen: n von 14 Tagen" says
  what is left to think about. Speichern with no times keeps a declined
  day declined. A button fills the open days that have a usual time, one
  day after another, on request. Venues are chips from the latest
  snapshot.
- The nightly `/reap` deletes spans and declined days two days gone
  (`internal/platform/retention`).

## Deliberately not

- **No groups here.** Groups read the counts through transport; matching
  people against free courts is the games slice's (`games.md`), which
  gets everyone's spans through `Of`.
- **No hourly slots.** Courts open at different times (some at 7:00), so
  the grid is half hours and a span can start at any of them (Seb,
  2026-10-28).
- **No dragging on the line yet**: spans are set with selects and quick
  choices; drawing them on the line may come later.
- **Spans are minutes, not "HH:MM"**, like the snapshot's `Slot`, so the
  app compares them with free courts directly.

## Traps

- "Today" is Vienna's: just after midnight UTC it is already tomorrow
  there. Tests set `Service.Now`.
