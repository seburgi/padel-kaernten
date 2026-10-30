# Willkommen and Hilfe

## How it works

- **Someone new sees `/welcome` once**, whatever address they opened;
  the address waits in `?next=` (a path in the app only, never another
  site) and they go on to it, or to Spielen. Someone who opened only the
  app's address (`next=/`) goes to Spielen too, where an invitation waits
  (on Plätze it went unseen: Gernot, 2026-10-28). The page says what the app
  is, asks for the name the others see when there is none, shows three
  steps to a first game with a glimpse of each screen, and has one
  primary button, "Los geht's". "Alles erklärt" opens the Hilfe instead.
- **"Dein erstes Spiel"** (`FirstSteps`, Seb 2026-10-29): on Spielen, the
  welcome's three steps as a card (a name, some times, a group), with one
  button to the next step that leads elsewhere; none for a group while an
  invitation waits above. It reads `/me`, `/availability` and `/groups`
  itself and is gone once all three are done; it comes back when every
  time has run out or one left every group.
- **Either records it at the server**: `people.welcomed_at` (migration
  0006, which counts everyone already in as welcomed), set by
  `POST /api/v1/me/welcomed`; `GET /api/v1/me` says `welcomed`. So a
  person is welcomed once, not once per phone. `/help` and `/feedback`
  stay open before it; `/welcome` stays reachable later as "Kurzer
  Rundgang" on the Hilfe and then sends nobody anywhere.
- **Someone new has nothing to catch up on**: while not welcomed, the
  Neu card stays away, and the welcome marks every note read (the app
  hands it `markRead` from whatsnew; the slices stay apart).
- **One page, `/help`**, a chapter per part of the app, each under an
  anchor in German like the words on screen: `#start`, `#plaetze`,
  `#zeiten`, `#gruppen`, `#spiele`, `#mitteilungen`, `#handy`, `#feedback`,
  `#privat`, `#fragen`. A table of contents at the top jumps to them; a
  link to `/help#spiele` scrolls to its chapter after the frame has
  scrolled to the top (`services/app/src/help`).
- **The text lives in the app's code** (`help/chapters.tsx`), in the
  words the screens use, and changes in the same commit as the screen it
  describes. No call to the API; the page works as soon as the app does.
- **Pictures** of the screens sit under their chapter, from
  `services/app/public/help/` (WebP, 780 px wide, about 20 to 60 KB),
  each light and dark (`<name>.webp`, `<name>-dark.webp`): the device's
  choice picks one with `<picture>`, unless a theme was chosen in the app.
  `src/help/shots.json` holds their sizes, so the page does not jump while
  they load, and they load only when scrolled to.
- **`services/app/tools/help-shots.mjs` makes every picture**, never a
  hand: it empties the local database (it refuses one that is not on this
  machine), writes a fixed snapshot of every venue in `venues.json`, signs
  in Seb, Anna, Markus and Lisa through the local gateway, builds the
  group "Dienstagsrunde" with their times and two games (everyone marked
  welcomed, so the welcome stays out of the way), and photographs
  each screen on an iPhone 13, cut to the part the chapter is about. How
  to run it is at its top.
- **Reached from** the round "Hilfe" button in the head (kit/web's `info`
  icon, beside Neuigkeiten and the feedback button) on a wide screen, Mehr in
  the tab bar at the bottom of a phone (`/more`), and from a "So geht's" link
  where people get stuck: "Wann kannst du?" (`#zeiten`), Gruppen finden
  and the empty "Deine Gruppen" (`#gruppen`), "Wann passt es für vier?"
  (`#spiele`) and the Mitteilungen card (`#mitteilungen`). The slices
  link by path only; none imports `help` (ESLint).

## Deliberately not

- **No tour of bubbles over the app**, no video: one page that stays
  where it is, which people can read again (Seb, 2026-10-28).
- **No help text from the server.** It would be one more thing to
  deploy apart from the screens it describes.
- **No search.** Ten short chapters and a table of contents are enough.
- **No pictures of Mitteilungen, the home screen or feedback**: a headless
  browser cannot show them as a phone does, and the words say enough.
- **No real people, venues' real times or prices in a picture.** The
  snapshot is made up; the venues' names are real.

## Traps

- A chapter names buttons by their words on screen. Renaming a button
  means changing its chapter, or the Hilfe tells people to tap something
  that is not there.
- **A screen changed, its picture did not.** No test notices; run
  `help-shots.mjs` again in the same commit as a change to a screen the
  Hilfe shows (`plaetze`, `zeiten`, `zeiten-tag`, `gruppen-finden`,
  `gruppe`, `spiele-passt`, `spiele-fast`, `spiel`, `spielen`), and look
  at the pictures before pushing. `Help.test.tsx` checks only that every
  named picture exists, light and dark.
- A picture is cut from one locator's top to another's bottom; a screen
  whose structure changes can make the script fail or cut wrongly.
- An anchor is a link other screens and release notes use. Renaming one
  breaks them silently; `Help.test.tsx` only checks they are unique.
