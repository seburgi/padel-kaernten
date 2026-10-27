"""Problems a script rules out, so no change reaches main with them.

    python tools/checks.py --staged           # the commit hook: what is staged
    python tools/checks.py --message FILE     # the commit-msg hook: the message
    python tools/checks.py BASE HEAD          # the push hook and CI: BASE..HEAD

Changes go straight to main (CLAUDE.md; burgstaller-platform
standards/workflow/trunk-based.md). What a reviewer used to
catch on a pull request, and what a thread could forget, is checked here:
in the commit hook, again in the push hook, and once more in CI before
anything deploys, so a commit made without the hooks cannot go live either.

Each check is a function from what changed to a list of problems, with a
test in tools/test_checks.py showing the problem it catches. A new rule is
one more function in CHECKS and its test.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools import parts  # noqa: E402

MIGRATIONS = "services/api/migrations/"
MIGRATION_NAME = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")

# What a key looks like when it is pasted into a file.
SECRETS = [
    (re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----"), "a private key"),
    (re.compile(r'"private_key_id"\s*:\s*"[0-9a-f]{40}"'), "a service account key"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "an AWS access key"),
    (re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}"), "an Anthropic API key"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), "a Google API key"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"), "a GitHub token"),
]
# Files that hold secrets by their nature, whatever is in them.
SECRET_FILES = re.compile(r"(^|/)(\.env|sa-key\.json|[^/]*\.(pem|key|p12|tfvars))$")
# Pictures, documents and archives. Screenshots go to the project's shared
# files; only test pictures live here.
BINARY = re.compile(r"\.(png|jpe?g|gif|webp|ico|pdf|epub|mobi|azw3?|zip|gz|tgz|mp3|wav|m4a)$", re.I)
BINARY_HOMES = ("services/app/public/", "services/api/internal/slots/sites/testdata/")

# A commit message carries what a pull request did (standards/workflow/
# commit-messages.md; the template is tools/hooks/commit-template.txt): a subject,
# why, what and how it was checked, and the thread it came from.
SUBJECT_MAX = 72
SECTIONS = ("Why:", "What:", "Checked:")
THREAD = re.compile(r"^Thread: (https://claude\.ai/code/project/chan_\w+\?thread=cmsg_\w+|none, \S.*)$", re.M)
ATTRIBUTION = re.compile(
    r"^co-authored-by:.*(claude|anthropic)|^claude-session:|generated with \[?claude|\U0001F916", re.I | re.M
)


@dataclass
class Change:
    """What a check sees: the paths changed between BASE and HEAD with how
    (A added, M modified, D deleted, R renamed: the old path is in `old`),
    the migrations BASE already has, the commit messages and a way to read
    a file as HEAD has it."""

    status: dict[str, str]
    old: dict[str, str] = field(default_factory=dict)
    base_migrations: list[str] = field(default_factory=list)
    head_migrations: list[str] = field(default_factory=list)
    messages: str = ""
    commits: list[tuple[str, str]] = field(default_factory=list)  # (sha, message), oldest first
    read: object = None  # read(path) -> str, the file as HEAD has it
    staged: bool = False  # the commit hook: no commit message yet

    def added(self) -> list[str]:
        return [p for p, s in self.status.items() if s in "AR"]

    def present(self) -> list[str]:
        return [p for p, s in self.status.items() if s != "D"]


def migrations(change: Change) -> list[str]:
    """A new migration has a number of its own, higher than every one main
    already has: production runs them in name order and remembers each by
    name, so one sorting before an applied one runs in another order on a
    fresh database than in production. Main's earlier shared numbers stay."""
    problems = []
    newest = max((int(m[:4]) for m in change.base_migrations if MIGRATION_NAME.match(m)), default=-1)
    numbers: dict[str, list[str]] = {}
    for name in change.head_migrations:
        numbers.setdefault(name[:4], []).append(name)
    for path in sorted(change.added()):
        # The folder also holds the Go that embeds and applies them.
        if not path.startswith(MIGRATIONS) or "/" in path[len(MIGRATIONS) :] or path.endswith(".go"):
            continue
        name = path[len(MIGRATIONS) :]
        match = MIGRATION_NAME.match(name)
        if not match:
            problems.append(f"{path}: a migration is named NNNN_some_words.sql (four digits, lower case)")
            continue
        if int(match.group(1)) <= newest:
            problems.append(f"{path}: main's newest migration is {newest:04d}; a new one takes a higher number")
        others = [n for n in numbers.get(match.group(1), []) if n != name]
        if others:
            problems.append(f"{path}: {match.group(1)} is taken by {', '.join(others)}")
    return problems


def applied_migrations(change: Change) -> list[str]:
    """A migration main has is never edited, renamed or deleted: production
    already ran it and will not run it again. A change is a new migration."""
    base = set(change.base_migrations)
    problems = []
    for path, how in sorted(change.status.items()):
        gone = change.old.get(path) if how == "R" else path
        if how in "MDR" and gone and gone.startswith(MIGRATIONS) and gone[len(MIGRATIONS) :] in base:
            verb = {"M": "edited", "D": "deleted", "R": "renamed"}[how]
            problems.append(
                f"{gone}: is on main and has run in production, so it cannot be {verb}; write a new migration instead"
            )
    return problems


def secrets(change: Change) -> list[str]:
    """No keys, tokens or files that hold them."""
    problems = []
    for path in sorted(change.present()):
        if SECRET_FILES.search(path):
            problems.append(f"{path}: a file of this kind holds secrets and stays out of git")
            continue
        if BINARY.search(path):
            continue
        try:
            text = change.read(path)
        except (OSError, UnicodeDecodeError, subprocess.CalledProcessError):
            continue
        for pattern, what in SECRETS:
            if pattern.search(text):
                problems.append(f"{path}: looks like it holds {what}")
    return problems


def binaries(change: Change) -> list[str]:
    """Pictures and documents only where the app or the tests use them."""
    return [
        f"{path}: screenshots and documents go to the project's shared files, not the repository"
        for path in sorted(change.added())
        if BINARY.search(path) and not path.startswith(BINARY_HOMES)
    ]


def sorted_folders(change: Change) -> list[str]:
    """Every path is sorted into tools/parts.py, so CI never skips the
    tests of a new folder."""
    return parts.unsorted(change.present())


def message_problems(message: str) -> list[str]:
    """What a commit message lacks, or has that it must not."""
    lines = [line for line in message.split("\n") if not line.startswith("#")]
    text = "\n".join(lines).strip()
    subject = text.split("\n", 1)[0].strip()
    problems = []
    if not subject:
        return ["the message is empty"]
    if len(subject) > SUBJECT_MAX:
        problems.append(f"the subject is {len(subject)} characters; at most {SUBJECT_MAX}")
    if re.match(r"(wip|fixup!|squash!|amend!)\b", subject, re.I):
        problems.append("a work-in-progress subject: say what the commit does")
    if len(text.split("\n")) > 1 and text.split("\n")[1].strip():
        problems.append("a blank line goes between the subject and the body")
    for section in SECTIONS:
        if not re.search(rf"^{section}\s*\S", text, re.M):
            problems.append(f'no "{section}" paragraph')
    if not THREAD.search(text):
        problems.append('no "Thread: <link to the thread>" line (or "Thread: none, <why>")')
    if ATTRIBUTION.search(text):
        problems.append("no Claude attribution (Co-Authored-By, Claude-Session, Generated with)")
    return problems


def commit_messages(change: Change) -> list[str]:
    """Every commit pushed says what a pull request would have said."""
    problems = []
    for sha, message in change.commits:
        subject = message.strip().split("\n", 1)[0][:50]
        problems.extend(f"commit {sha[:9]} ({subject}): {p}" for p in message_problems(message))
    if problems:
        problems.append(
            "Reword with git rebase -i origin/main or git commit --amend; template: tools/hooks/commit-template.txt"
        )
    return problems


CHECKS = [migrations, applied_migrations, secrets, binaries, sorted_folders, commit_messages]


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def _is_commit(ref: str) -> bool:
    found = subprocess.run(["git", "cat-file", "-e", f"{ref}^{{commit}}"], cwd=ROOT, capture_output=True)
    return found.returncode == 0


def _migrations_at(tree: str | None) -> list[str]:
    if tree is None:  # the index
        out = _git("ls-files", "--", MIGRATIONS)
    else:
        try:
            out = _git("ls-tree", "--name-only", f"{tree}:{MIGRATIONS}")
        except subprocess.CalledProcessError:  # no migrations there yet
            return []
        return [n for n in out.split("\n") if n.endswith(".sql")]
    return [p[len(MIGRATIONS) :] for p in out.split("\n") if p.endswith(".sql") and "/" not in p[len(MIGRATIONS) :]]


def collect(base: str, head: str | None) -> Change:
    """What changed from BASE to HEAD, or to the index when HEAD is None."""
    diff = ["diff", "--name-status", "-M"] + (["--cached", base] if head is None else [base, head])
    status, old = {}, {}
    for line in _git(*diff).split("\n"):
        if not line:
            continue
        parts = line.split("\t")
        how = parts[0][0]
        if how == "R":
            old[parts[2]] = parts[1]
            status[parts[2]] = "R"
        else:
            status[parts[-1]] = "A" if how == "C" else how
    if head is None:
        read = lambda path: _git("show", f":{path}")  # noqa: E731
        messages, commits = "", []
    else:
        read = lambda path: _git("show", f"{head}:{path}")  # noqa: E731
        # The first push has no commit before it, only the empty tree.
        span = f"{base}..{head}" if _is_commit(base) else head
        messages = _git("log", "--format=%B", span)
        log = _git("log", "--reverse", "--no-merges", "--format=%H%x00%B%x1e", span)
        commits = [tuple(entry.strip("\n").split("\0", 1)) for entry in log.split("\x1e") if entry.strip()]
    return Change(
        status=status,
        old=old,
        base_migrations=_migrations_at(base),
        head_migrations=_migrations_at(head),
        messages=messages,
        commits=commits,
        read=read,
        staged=head is None,
    )


def run(change: Change) -> list[str]:
    return [problem for check in CHECKS for problem in check(change)]


def main_base() -> str:
    """Where main is: what the commit hook compares the index with, so an
    unpushed migration of one's own may still change."""
    for ref in ("origin/main", "HEAD"):
        found = subprocess.run(["git", "merge-base", "HEAD", ref], cwd=ROOT, capture_output=True, text=True)
        if found.returncode == 0:
            return found.stdout.strip()
    return _git("hash-object", "-t", "tree", "/dev/null").strip()  # a first commit


def main(argv: list[str]) -> int:
    if argv[1:2] == ["--message"] and len(argv) == 3:
        problems = message_problems(Path(argv[2]).read_text())
        for problem in problems:
            print(f"✗ commit message: {problem}")
        if problems:
            print('  Template: tools/hooks/commit-template.txt (CLAUDE.md, "Commit messages")')
        return 1 if problems else 0
    if argv[1:] == ["--staged"]:
        change = collect(main_base(), None)
    elif len(argv) == 3:
        change = collect(argv[1], argv[2])
    else:
        print(__doc__)
        return 2
    problems = run(change)
    for problem in problems:
        print(f"✗ {problem}")
    if not problems:
        print(f"✓ checks: {len(CHECKS)} rules, {len(change.status)} changed files")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
