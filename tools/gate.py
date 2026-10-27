"""The gate every push to main passes (tools/hooks/pre-push; burgstaller-platform
standards/workflow/hooks-and-gate.md).

    python3 tools/gate.py            # what HEAD adds to origin/main
    python3 tools/gate.py BASE       # what HEAD adds to BASE
    python3 tools/gate.py --all BASE # every part, whatever changed (CI)

It runs what CI runs for the change, picked the way CI picks
(tools/parts.py), on the commit being pushed:

    always   tools/checks.py
    tools    ruff, the tools' own tests
    go       gofmt, the generated code is what api/openapi.yaml makes, go
             vet, golangci-lint, go test -race against a real Postgres
             (testcontainers), coverage
    app      the types are what api/openapi.yaml makes, pnpm check
             (Prettier, ESLint, tsc, Vitest with coverage)

Coverage may fall at most ALLOWED points below tools/coverage.json, and only
while it stays at or above FLOOR (standards/quality/coverage.md); when it
rises, the gate writes the new number there, to be committed with the next
change.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools import parts  # noqa: E402

API = ROOT / "services" / "api"
APP = ROOT / "services" / "app"
COVERAGE = ROOT / "tools" / "coverage.json"
# Coverage moves a little between runs; less than this is not a drop.
SLACK = 0.1
# A part may fall this many points below its record, but not below FLOOR;
# a part already under FLOOR may not fall at all. The record stays, so
# drops never add up.
ALLOWED = 1.0
FLOOR = 85.0
VENV = ROOT / ".venv"
TMP = Path(os.environ.get("TMPDIR", "/tmp")) / "padel-gate"


class Failed(Exception):
    pass


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def sh(name: str, args: list[str], cwd: Path = ROOT, env: dict | None = None) -> str:
    """Run one step; its output is shown only when it fails."""
    started = time.monotonic()
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env={**os.environ, **(env or {})})
    took = time.monotonic() - started
    if result.returncode != 0:
        print(f"✗ {name} ({took:.0f}s)\n{result.stdout}{result.stderr}", flush=True)
        raise Failed(name)
    print(f"✓ {name} ({took:.0f}s)", flush=True)
    return result.stdout


def base_commit(argv: list[str]) -> str:
    if len(argv) > 1:
        return git("rev-parse", argv[1]).strip()
    try:
        return git("merge-base", "HEAD", "origin/main").strip()
    except subprocess.CalledProcessError:
        return git("hash-object", "-t", "tree", "/dev/null").strip()


def python_env() -> Path:
    """pytest and ruff in .venv (tools/dev/setup.sh)."""
    python = VENV / "bin" / "python"
    if not python.exists():
        sh("Python venv", [sys.executable, "-m", "venv", str(VENV)])
        sh("Python packages", [str(python), "-m", "pip", "install", "-q", "-r", "tools/requirements-dev.txt"])
    return python


def tools() -> None:
    py = str(python_env())
    sh("ruff check", [py, "-m", "ruff", "check", "tools", ".claude"])
    sh("ruff format", [py, "-m", "ruff", "format", "--check", "tools", ".claude"])
    sh("The tools' tests", [py, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tools"])


def go(coverage: dict) -> None:
    sh(
        "gofmt",
        ["sh", "-c", 'out="$(gofmt -l .)"; [ -z "$out" ] || { echo "Run gofmt -w on: $out"; exit 1; }'],
        cwd=API,
    )
    sh("The generated code is what api/openapi.yaml makes", ["go", "generate", "./internal/transport/gen"], cwd=API)
    stale = git("status", "--porcelain", "--", "services/api/internal/transport/gen").strip()
    if stale:
        print(f"✗ Generated code is stale: commit what go generate wrote\n{stale}")
        raise Failed("generated code")
    sh("go vet", ["go", "vet", "./..."], cwd=API)
    sh("golangci-lint", ["golangci-lint", "run"], cwd=API)
    TMP.mkdir(parents=True, exist_ok=True)
    profile = TMP / "go.cover"
    # Only packages with tests, and not the generated or test-only ones.
    tested = [
        p
        for p in sh(
            "Go packages with tests",
            ["go", "list", "-f", "{{if or .TestGoFiles .XTestGoFiles}}{{.ImportPath}}{{end}}", "./..."],
            cwd=API,
        ).split()
        if not p.endswith(("/gen", "test"))
    ]
    sh(
        "go test -race",
        ["go", "test", "-race", "-count=1", f"-coverprofile={profile}", *tested],
        cwd=API,
        env={"PLATFORM_REQUIRE_DB": "1"},
    )
    total = sh("Go coverage", ["go", "tool", "cover", f"-func={profile}"], cwd=API).strip().splitlines()[-1]
    coverage["go"] = float(total.split()[-1].rstrip("%"))


def app(coverage: dict) -> None:
    sh("pnpm install", ["pnpm", "install", "--frozen-lockfile", "--silent"], cwd=APP)
    sh("The types are what api/openapi.yaml makes", ["pnpm", "-s", "api"], cwd=APP)
    stale = git("status", "--porcelain", "--", "services/app/src/api").strip()
    if stale:
        print(f"✗ Generated types are stale: commit what pnpm api wrote\n{stale}")
        raise Failed("generated types")
    sh("pnpm check", ["pnpm", "-s", "check"], cwd=APP)
    summary = json.loads((APP / "coverage" / "coverage-summary.json").read_text())
    coverage["app"] = float(summary["total"]["lines"]["pct"])


def compare(measured: dict[str, float], recorded: dict[str, float]) -> tuple[list[str], dict[str, float]]:
    """(drops, what to record): a part that fell more than it may (ALLOWED
    above FLOOR, else SLACK) has dropped; one above its record is recorded."""
    drops, record = [], dict(recorded)
    for part, now in sorted(measured.items()):
        before = recorded.get(part)
        may = ALLOWED if now >= FLOOR else SLACK
        if before is not None and now < before - may:
            drops.append(f"{part} coverage fell from {before}% to {now}%: test what you changed")
        elif before is None or now > before:
            record[part] = now
    return drops, record


def main(argv: list[str]) -> int:
    everything = "--all" in argv
    argv = [a for a in argv if a != "--all"]
    if git("status", "--porcelain", "--untracked-files=no").strip():
        print("✗ Commit or stash your changes first: the gate tests the commit being pushed.")
        return 1
    base = base_commit(argv)
    changed = [p for p in git("diff", "--name-only", base, "HEAD").split("\n") if p]
    need = {part: True for part in parts.needed([])} if everything else parts.needed(changed)
    wanted = [p for p in ("tools", "go", "app") if need[p]]
    print(f"Gate for {len(changed)} changed files since {base[:9]}: {', '.join(wanted) or 'checks only'}", flush=True)
    failed, coverage = [], {}
    steps = [("checks", lambda: sh("Scripted checks", [sys.executable, "tools/checks.py", base, "HEAD"]))]
    if need["tools"]:
        steps.append(("tools", tools))
    if need["go"]:
        steps.append(("go", lambda: go(coverage)))
    if need["app"]:
        steps.append(("app", lambda: app(coverage)))
    for name, step in steps:
        try:
            step()
        except Failed as failure:
            failed.append(f"{name}: {failure}")
    recorded = json.loads(COVERAGE.read_text()) if COVERAGE.exists() else {}
    drops, record = compare(coverage, recorded)
    for drop in drops:
        print(f"✗ {drop}")
    if record != recorded and not failed and not drops:
        COVERAGE.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
        print(f"↑ coverage rose: {record}. tools/coverage.json now says so; commit it with your next change.")
    if failed or drops:
        print(f"\nThe gate failed ({', '.join(failed + [d.split(':')[0] for d in drops])}). Fix it and push again.")
        return 1
    print("\nThe gate passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
