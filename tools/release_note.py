"""Does this push carry its release note? (tools/checks.py, on push and in CI)

A change a person can see adds a note to release_notes/ in the same push,
one file per change (docs/design/whats-new.md). A push that changes nothing
anyone can see or feel says so in one of its commit messages instead, on a
line of its own: "Release-note: none, <why>". The check covers only the React
app; its tests alone, the agents' browser scripts (services/app/tools/), and
everything else (the API in Go, docs, tools, CI) need neither here.
"""

from __future__ import annotations

import re

NOTES = "release_notes/"
APP = ("services/app/src/", "services/app/public/", "services/app/index.html")
# A test of the app, or what its tests share, is not a change to it.
TESTS = (".test.ts", ".test.tsx")
TEST_DIRS = ("services/app/src/test/",)
NONE = re.compile(r"^\s*release[ -]note:\s*none\b\W*(\S.*)?$", re.I | re.M)


def verdict(changed: list[str], body: str) -> tuple[bool, str]:
    """(passes, what to say), from the changed paths and the commit messages."""
    app = [
        path for path in changed if path.startswith(APP) and not path.endswith(TESTS) and not path.startswith(TEST_DIRS)
    ]
    notes = [path for path in changed if path.startswith(NOTES) and path.endswith(".md")]
    if notes:
        return True, "Release note: " + ", ".join(notes)
    if not app:
        return True, "Nothing in the React app changed; no release note needed."
    match = NONE.search(body or "")
    if match and match.group(1):
        return True, f"No release note: {match.group(1).strip()}"
    if match:
        return False, 'Say why after "Release-note: none", for example "Release-note: none, tests only".'
    return False, (
        f"This push changes the React app but adds no note to {NOTES}.\n"
        "Add one (docs/design/whats-new.md), or, if nothing changes that a person can\n"
        'see or feel, put a line "Release-note: none, <why>" in a commit message (git commit --amend).'
    )
