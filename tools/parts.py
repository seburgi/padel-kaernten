"""Which part of the repository a path belongs to, so the gate and CI test
what a change touches and nothing a change cannot have broken.

    python3 tools/parts.py BASE HEAD     # prints the parts BASE..HEAD needs

Every tracked path must fall into one part; tools/checks.py refuses a
folder no part claims, because its tests would never run.
"""

from __future__ import annotations

import subprocess
import sys

# Prefixes, first match wins.
PARTS: dict[str, tuple[str, ...]] = {
    # The Go service and its contract; a change deploys it.
    "go": ("services/api/", "api/"),
    # The React app the service serves; a change deploys it too.
    "app": ("services/app/",),
    # The scripts behind the hooks, the gate and CI.
    "tools": ("tools/", ".claude/", "ruff.toml"),
    # Workflows and what the image is built from.
    "ci": (".github/", ".dockerignore", "Dockerfile"),
    # Words only.
    "docs": ("docs/", "README.md", "CLAUDE.md", "PRODUCT.md", ".gitignore"),
}


def part_of(path: str) -> str | None:
    for part, prefixes in PARTS.items():
        if path.startswith(prefixes):
            return part
    return None


def unsorted(paths: list[str]) -> list[str]:
    """Problems for paths no part claims."""
    return [f"{p}: no part in tools/parts.py claims it, so nothing would test it" for p in paths if part_of(p) is None]


def needed(changed: list[str]) -> dict[str, bool]:
    """Which parts to check for the changed paths. A change to CI or to the
    tools checks Go and the app too: it may change how they are tested or
    built. The contract (api/) is both sides'."""
    touched = {part_of(p) for p in changed}
    contract = any(p.startswith("api/") for p in changed)
    return {
        "go": bool(touched & {"go", "ci", "tools"}),
        "app": contract or bool(touched & {"app", "ci", "tools"}),
        "tools": bool(touched & {"tools", "ci"}),
        "deploy": bool(touched & {"go", "app", "ci"}),
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    out = subprocess.run(["git", "diff", "--name-only", argv[1], argv[2]], check=True, capture_output=True, text=True)
    for part, need in needed([p for p in out.stdout.split("\n") if p]).items():
        print(f"{part}={'true' if need else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
