# What's new

## How it works

- **The notes are files**, `release_notes/YYYY-MM-DD-a-few-words.md`, one
  per change (the format and the areas are in `CLAUDE.md`; platform
  `standards/workflow/release-notes.md`). The image copies them to
  `/release_notes` (`RELEASE_NOTES_DIR`; on a laptop `../../release_notes`
  from `services/api`).
- **The API reads them at start-up** (`internal/whatsnew`, `Load`), and a
  broken one stops the revision starting; `whatsnew_test.go` parses the
  shipped ones, so the gate refuses it first. Start-up also records each
  note it has not met in `release_notes` with the time it arrived, which
  orders the notes of one day (the last to arrive first).
- **The database keeps only who read what**: `release_note_reads`, one
  row per address and note. `GET /api/v1/release-notes` lists every note,
  newest day first, each saying whether the caller read it;
  `POST /api/v1/release-notes/read` (with an `Idempotency-Key`) records a
  list of slugs, and leaves out one the API does not ship (the page may
  be older than the deploy).
- **The app** shows the page **Neu** at `/whats-new` (a link in the head
  on a wide screen; on a phone a row on Mehr, and the tab Mehr carries a
  dot while a note is unread) and, while a note is unread, a small card under the head on
  the two first screens, Plätze and Spielen, only (Seb, 2026-10-29: it
  pushed every other screen down). Opening the page or putting the card away marks every unread
  note read, at once on screen; a failed write is not reported, and the
  card comes back on the next load.
- **The check**: `tools/release_note.py`, run by `tools/checks.py` on push
  and in CI, refuses a change to the React app (tests aside) without a
  note, unless a commit says `Release-note: none, <why>`.

## Deliberately not

- **Notes in German**, not English as the standard says: Padel's people
  read German, and so does the rest of the app (Seb, 2026-10-28).
- **No "only since you joined" filter.** Billomatic hides notes dated
  before the account existed; here the welcome marks every note read
  instead (`help.md`), so someone new never sees the card for the past.
- **No release notes in code.** Two threads adding to one list collide;
  two files do not. No number on a note either.

## Traps

- A note's slug is its file name. Renaming a shipped note makes it new
  again for everyone.
- `release_notes/` belongs to the Go part (`tools/parts.py`): a note alone
  deploys, because it ships in the image.
