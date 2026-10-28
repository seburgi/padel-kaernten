"""The release note check (tools/release_note.py, run by tools/checks.py)."""

from __future__ import annotations

import pytest

from tools.release_note import NOTES, verdict


@pytest.mark.parametrize(
    "changed, body, passes",
    [
        (["services/app/src/courts/Courts.tsx", "release_notes/2026-10-27-a-change.md"], "", True),
        # A file in the folder that is not a note is not one.
        (["services/app/src/courts/Courts.tsx", "release_notes/README.txt"], "", False),
        (["docs/design/slots.md", "tools/parts.py", "Dockerfile"], "", True),
        (["services/app/src/courts/Courts.tsx"], "", False),
        (["services/app/public/icon-512.png"], "", False),
        (["services/app/index.html"], "", False),
        # Only the React app is checked: not the API in Go or the schema.
        (["services/api/internal/slots/service.go", "services/api/migrations/0003_x.sql"], "", True),
        # Its tests and the agents' browser scripts change nothing anyone sees.
        (["services/app/src/ui/Button.test.tsx", "services/app/src/test/render.tsx"], "", True),
        (["services/app/tools/browse.mjs", "services/app/package.json"], "", True),
        (["services/app/src/courts/Courts.tsx"], "Fixes a typo.\n\nRelease note: none, tests only", True),
        # The commit trailer's spelling.
        (["services/app/src/courts/Courts.tsx"], "Fixes a typo.\n\nRelease-note: none, tests only", True),
        (["services/app/src/courts/Courts.tsx"], "release note: none", False),  # says nothing about why
        (["release_notes/2026-10-27-a-change.md"], "", True),
    ],
)
def test_ci_wants_a_note_for_every_change_to_the_app(changed, body, passes):
    assert verdict(changed, body)[0] is passes


def test_a_missing_note_says_where_it_goes():
    ok, message = verdict(["services/app/src/App.tsx"], "")
    assert not ok and NOTES in message
    ok, message = verdict(["services/app/src/App.tsx"], "Release note: none")
    assert not ok and "Say why" in message


def test_what_passes_says_why():
    assert verdict(["release_notes/2026-10-27-a.md"], "")[1] == "Release note: release_notes/2026-10-27-a.md"
    assert verdict(["README.md"], "")[1].startswith("Nothing in the React app changed")
    assert verdict(["services/app/src/App.tsx"], "Release note: none, a refactor")[1] == "No release note: a refactor"
