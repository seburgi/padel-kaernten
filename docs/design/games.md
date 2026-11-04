# Games: when it fits for four, and who is in

## How it works

- **Fits are computed on request, never stored** (`internal/games`,
  `Fits`). `GET /api/v1/groups/{groupId}/fits?minutes=60|90|120` takes the
  latest snapshot's free slots, the members' spans (`availability.Of`)
  and where each drives to, and returns every start, on the venue's step
  (30 minutes unless the site says otherwise), where a court is free for
  the whole game and at least four members are free for all of it. Touching
  slots on one court join into one block first, so a 90-minute game can
  span two half-hour slots. Failed venues, days a site cannot book and
  starts already past in Vienna are left out. Only the courts of the
  group's area count (`groups.md`): transport drops the others before
  `Fits` sees them. Überdacht counts as Halle, as on the courts page; a
  court whose area nobody knows counts only for a group playing anywhere.
- **Near misses** ("Fast: eine Person fehlt"): three can, and someone who
  drives there entered nothing for that day, so they might be the fourth.
  A day with no entry still means "can't" for fits (`availability.md`);
  it only makes someone worth asking. Someone who said the day does not
  suit ("Passt nicht") is never asked for it (Seb, 2026-10-29). A near
  miss can be proposed like a fit (Seb, 2026-10-30): the same `POST`, and
  the game waits with one place open until someone says Bin dabei.
- **Why it does not fit** (`Fours`, `GET
  /api/v1/groups/{groupId}/fours`, for Wer kann wann in `groups.md`; Seb,
  2026-11-04, feedback #73): every half hour of the window where four
  members can, wherever they drive, with `fits` when a fit of 60, 90 or
  120 minutes covers it. Otherwise `why`, checked over the games of every
  length on the half hour that cover it and that four are free for:
  `short` when there is none (never the same four for an hour), `venues`
  when a court of the group's area is free for one but fewer than four of
  them drive there, `area` when only courts outside the group's area are
  free, `none` when nothing is; `venues` names those venues, or for
  `none` the venues of the area that take no bookings for the day yet.
  Past starts are left out, as in the fits. Computed on request, from the
  same snapshot; 503 `no-snapshot` without one.
- **Order**: most people first, then day, start and price. At most 40
  fits and 10 near misses; the price per head is the prorated court price
  over four, and none when any part of the game has no price.
- **A game** (`games`, `game_players`, migration 0004) is proposed from a
  fit: `POST /api/v1/groups/{groupId}/games` checks the court is still
  free in the latest snapshot (409 `court-gone` otherwise) and puts the
  proposer in. States: `proposed`, `booked`, `cancelled`.
- **Answers** (`PUT /api/v1/games/{gameId}/players/me`, `in` or `out`):
  four are in; an `in` once it is full becomes a reserve, and when someone
  who was in says `out`, the earliest reserve moves up. A cancelled game or
  one whose day has passed answers 409 `game-closed`.
- **Only the proposer books and cancels** (`PATCH
  /api/v1/games/{gameId}`): booking happens on the venue's own page (the
  app links to it), and "Gebucht" tells the others. Anyone else gets 403.
- **Who sees a game**: the members of its group, through the view
  `game_visibility`, like `group_visibility`; anyone else gets 404.
- **In the app** (`services/app/src/games`): "Wann passt es für vier?" on
  a group's page (`/groups/:id/fits`, duration chips, fits by day, one card
  per time and people with every venue free then, cheapest first, each
  with its own Vorschlagen (Seb, 2026-11-04: the same time once per venue
  was noise), near misses below with their own Vorschlagen); the game (`/games/:id`, its places as rounds with a line that says
  what is next, "So geht es weiter" with Vorgeschlagen, Vier sagen zu and
  who books where, Dabei n von 4,
  Ersatz, Können nicht, Noch keine Antwort, and for the proposer Zur
  Buchung, Gebucht, Spiel absagen). Those without an answer are sorted by
  what they entered in "Wann kann ich?" for the game's day (Seb,
  2026-10-31, feedback #69; `byTime`): Hätte Zeit (spans cover the whole
  game), Da nicht frei (declined, or part of the game left out) and
  Nichts eingetragen; while the game still wants people, the card on top
  names who would have time. It reads `GET /groups/{id}/availability`, the
  query Wer kann wann uses; without it the names stay one plain list; on the group's page "Passt für vier" (`BestFits` for that group alone,
  with Alle Zeiten to its fits) above its coming games. On Spielen (Seb,
  2026-10-29): "Wartet auf dich" (`Waiting`) holds every proposed game the
  person has not answered, with Bin dabei and Kann nicht on its card and
  the places as rounds (`Seats`); "Deine nächsten Spiele" (`Upcoming`)
  only those they are in or a reserve for; "Passt für vier" (`BestFits`)
  the three soonest 90-minute times from all their groups (one row a
  time, its cheapest venue and "noch n Anlagen frei"), leaving out
  times already a game, with Vorschlagen. Alle Zeiten (shown only when
  there are more than three) opens all of them, by day and from every
  group, in the app's sheet; never one group's page, which made no sense
  on Spielen (Seb, 2026-10-30). Each group's own fits (other lengths,
  near misses) are linked from the bottom of the sheet. Nothing new in the API: the
  lineup says who answered, and the fits are asked per group. A snapshot older than five minutes is refreshed once when
  the fits open, as on the courts. The group screens get the games as
  props from `App.tsx`, so the slices stay apart.
- **What happened** (`Service.Changed`): proposed, full, moved up, booked
  and cancelled, once per write; Mitteilungen tell people (`notify.md`).

## Deliberately not

- **Spielen never refreshes the snapshot** for "Passt für vier": the
  schedule keeps it within 30 minutes, and proposing checks the court
  again. Only the group's own fits page asks when it is an hour old.

- **No booking in the app.** The venues' sites take the money and the
  booking; the app links there and is told afterwards.
- **Leaving a group does not take back one's answers** to its games yet.
- **Old games are not reaped yet**; past days simply drop out of the
  lists.
- **No fits for more or fewer than four.** `players` is stored so it can
  change later, but everything assumes four.

## Traps

- Proposing does not check the group's area: a fit was shown, so the
  court is fine, and a game proposed before the area changed stays.

- A fit is only as fresh as the snapshot. Proposing checks the court
  again against the latest snapshot, never against the site itself, so a
  court booked elsewhere in the last minutes can still be proposed.
- "Today" and "now" are Vienna's (`Service.Window`); tests set
  `Service.Now`.
- Answers lock the game row (`FOR UPDATE`) so two people saying yes at
  once cannot both take the fourth place.
