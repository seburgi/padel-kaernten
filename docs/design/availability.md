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
- **"Wie meistens"**: spans per weekday (`PUT
  /api/v1/availability/templates`, 1 Monday to 7 Sunday), which the app
  offers for days with nothing entered yet; it never fills days by
  itself.
- **Where one drives to**: venue ids from `venues.json` (`PUT
  /api/v1/availability/venues`); none chosen means every venue. An id
  that is not a venue answers 400 `unknown-venue`.
- The nightly `/reap` deletes spans of days two days gone
  (`internal/platform/retention`).

## Deliberately not

- **No groups here.** Groups read the counts through transport; matching
  people against free courts comes with games (phase 2).
- **No hourly slots.** Courts open at different times (some at 7:00), so
  the grid is half hours and a span can start at any of them (Seb,
  2026-10-28).
- **Spans are minutes, not "HH:MM"**, like the snapshot's `Slot`, so the
  app compares them with free courts directly.

## Traps

- "Today" is Vienna's: just after midnight UTC it is already tomorrow
  there. Tests set `Service.Now`.
