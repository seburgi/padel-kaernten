# Hilfe

## How it works

- **One page, `/help`**, a chapter per part of the app, each under an
  anchor in German like the words on screen: `#start`, `#plaetze`,
  `#zeiten`, `#gruppen`, `#spiele`, `#mitteilungen`, `#handy`, `#feedback`,
  `#privat`, `#fragen`. A table of contents at the top jumps to them; a
  link to `/help#spiele` scrolls to its chapter after the frame has
  scrolled to the top (`services/app/src/help`).
- **The text lives in the app's code** (`help/chapters.tsx`), in the
  words the screens use, and changes in the same commit as the screen it
  describes. No call to the API; the page works as soon as the app does.
- **Reached from** the round "Hilfe" button in the head (kit/web's `info`
  icon, beside Neu and the feedback button), and from a "So geht's" link
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

## Traps

- A chapter names buttons by their words on screen. Renaming a button
  means changing its chapter, or the Hilfe tells people to tap something
  that is not there.
- An anchor is a link other screens and release notes use. Renaming one
  breaks them silently; `Help.test.tsx` only checks they are unique.
