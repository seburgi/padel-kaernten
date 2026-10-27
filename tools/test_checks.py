"""The scripted checks (tools/checks.py): each rule, and the problem it catches."""

from __future__ import annotations

import subprocess

import pytest

from tools import checks
from tools.checks import Change

ON_MAIN = [
    "3250_resort.sql",
    "3260_code_blocks.sql",
    "3260_resort_ungrouped.sql",
]  # numbers as a long-lived app has them


def change(status, old=None, head_migrations=None, files=None, messages="", staged=False):
    added = [
        p.removeprefix(checks.MIGRATIONS) for p, s in status.items() if s in "AR" and p.startswith(checks.MIGRATIONS)
    ]
    files = files or {}
    return Change(
        status=status,
        old=old or {},
        base_migrations=list(ON_MAIN),
        head_migrations=head_migrations if head_migrations is not None else ON_MAIN + added,
        messages=messages,
        read=lambda path: files.get(path, ""),
        staged=staged,
    )


def test_a_new_migration_takes_the_next_number():
    assert checks.migrations(change({"services/api/migrations/3270_new.sql": "A"})) == []


def test_two_migrations_with_one_number_are_refused():
    both = change(
        {"services/api/migrations/3270_mine.sql": "A"}, head_migrations=ON_MAIN + ["3270_mine.sql", "3270_theirs.sql"]
    )
    assert checks.migrations(both) == ["services/api/migrations/3270_mine.sql: 3270 is taken by 3270_theirs.sql"]


def test_a_migration_numbered_below_main_is_refused():
    problems = checks.migrations(change({"services/api/migrations/3255_late.sql": "A"}))
    assert problems == [
        "services/api/migrations/3255_late.sql: main's newest migration is 3260; a new one takes a higher number"
    ]


def test_main_s_old_shared_numbers_stay():
    # 3260 is on main twice; a change elsewhere does not trip over it.
    assert checks.migrations(change({"services/api/cmd/api/main.go": "M"})) == []


def test_the_go_beside_the_migrations_is_no_migration():
    assert checks.migrations(change({"services/api/migrations/apply.go": "A"})) == []


def test_a_migration_is_named_by_four_digits():
    assert "NNNN_some_words.sql" in checks.migrations(change({"services/api/migrations/327_x.sql": "A"}))[0]
    assert "NNNN_some_words.sql" in checks.migrations(change({"services/api/migrations/3270-X.sql": "A"}))[0]


def test_an_applied_migration_is_never_edited_renamed_or_deleted():
    path = "services/api/migrations/3260_code_blocks.sql"
    assert "cannot be edited" in checks.applied_migrations(change({path: "M"}))[0]
    assert "cannot be deleted" in checks.applied_migrations(change({path: "D"}))[0]
    renamed = change(
        {"services/api/migrations/3270_code_blocks.sql": "R"},
        old={"services/api/migrations/3270_code_blocks.sql": path},
    )
    assert "cannot be renamed" in checks.applied_migrations(renamed)[0]
    # One not yet on main may still change.
    assert checks.applied_migrations(change({"services/api/migrations/3270_new.sql": "M"})) == []


@pytest.mark.parametrize(
    "text, what",
    [
        ("-----BEGIN " + "PRIVATE KEY-----\nMIIE", "a private key"),
        ('{"private_key_id": "' + "a" * 40 + '"}', "a service account key"),
        ("key = AKIA" + "ABCDEFGHIJKLMNOP", "an AWS access key"),
        ("ANTHROPIC_API_KEY=sk-ant-" + "x" * 30, "an Anthropic API key"),
        ("token: ghp_" + "a" * 36, "a GitHub token"),
    ],
)
def test_a_pasted_secret_is_refused(text, what):
    assert checks.secrets(change({"services/api/main.go": "M"}, files={"services/api/main.go": text})) == [
        f"services/api/main.go: looks like it holds {what}"
    ]


@pytest.mark.parametrize("path", [".env", "deploy/sa-key.json", "infra/prod.tfvars", "certs/server.pem"])
def test_files_that_hold_secrets_are_refused(path):
    assert checks.secrets(change({path: "A"})) == [f"{path}: a file of this kind holds secrets and stays out of git"]


def test_ordinary_files_and_the_env_example_pass():
    files = {".env.example": "ANTHROPIC_API_KEY=", "services/api/cmd/api/main.go": "const key = 'private_key_id';"}
    assert checks.secrets(change({p: "M" for p in files}, files=files)) == []


def test_screenshots_stay_out_of_the_repository():
    assert checks.binaries(change({"docs/screenshot.png": "A", "after.jpg": "A"})) == [
        "after.jpg: screenshots and documents go to the project's shared files, not the repository",
        "docs/screenshot.png: screenshots and documents go to the project's shared files, not the repository",
    ]
    assert checks.binaries(change({"services/app/public/icon-192.png": "A"})) == []


def test_every_path_is_sorted_into_a_part():
    assert checks.sorted_folders(change({"services/api/go.mod": "M", "scratch/x.txt": "A", "gone/y.txt": "D"})) == [
        "scratch/x.txt: no part in tools/parts.py claims it, so nothing would test it"
    ]


def test_collect_reads_a_range_from_git(tmp_path, monkeypatch):
    def git(*args):
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)

    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    (tmp_path / "services/api/migrations").mkdir(parents=True)
    (tmp_path / "services/api/migrations/0010_a.sql").write_text("SELECT 1;\n")
    git("add", ".")
    git("commit", "-q", "-m", "first")
    (tmp_path / "services/api/migrations/0010_a.sql").write_text("SELECT 2;\n")
    (tmp_path / "services/api/migrations/0010_b.sql").write_text("SELECT 3;\n")
    git("add", ".")
    git("commit", "-q", "-m", "second\n\nRelease-note: none, test")
    monkeypatch.setattr(checks, "ROOT", tmp_path)

    found = checks.collect("HEAD~1", "HEAD")
    assert found.status == {"services/api/migrations/0010_a.sql": "M", "services/api/migrations/0010_b.sql": "A"}
    assert found.base_migrations == ["0010_a.sql"]
    assert found.head_migrations == ["0010_a.sql", "0010_b.sql"]
    assert "Release-note: none, test" in found.messages
    assert found.read("services/api/migrations/0010_b.sql") == "SELECT 3;\n"
    assert checks.migrations(found) and checks.applied_migrations(found)

    (tmp_path / "services/api/migrations/0020_c.sql").write_text("SELECT 4;\n")
    git("add", ".")
    staged = checks.collect("HEAD", None)
    assert staged.staged and staged.status == {"services/api/migrations/0020_c.sql": "A"}
    assert staged.head_migrations == ["0010_a.sql", "0010_b.sql", "0020_c.sql"]
    assert checks.migrations(staged) == []


GOOD = """Topics without unread articles leave the sidebar

Why: Seb scrolls past empty topics every morning (note 55).

What: The sidebar lists a topic only while it has unread articles;
Hidden sits behind Edit.

Checked: The gate; a test for a topic going empty.

Thread: https://claude.ai/code/project/chan_01HG2ZQCFtzqk4FnvMmXuvEj?thread=cmsg_01HG2ZQCFtzqk4FnvMmXuvEjVD7UALyvd6DvztAELUvf5x
"""


def test_a_message_that_says_what_a_pull_request_said_passes():
    assert checks.message_problems(GOOD) == []
    assert checks.message_problems(GOOD.replace(GOOD.splitlines()[-1], "Thread: none, Seb by hand")) == []
    # The template's comment lines are dropped.
    assert checks.message_problems("# Subject: ...\n" + GOOD) == []


@pytest.mark.parametrize(
    "message, problem",
    [
        ("", "the message is empty"),
        (GOOD.replace("Topics without unread articles leave the sidebar", "x" * 73), "at most 72"),
        (GOOD.replace("Topics without", "WIP topics without"), "work-in-progress"),
        (GOOD.replace("sidebar\n\nWhy", "sidebar\nWhy"), "blank line"),
        (GOOD.replace("Why:", "Because"), 'no "Why:" paragraph'),
        (GOOD.replace("What:", "Changes"), 'no "What:" paragraph'),
        (GOOD.replace("Checked:", "Tested"), 'no "Checked:" paragraph'),
        (GOOD.replace("Thread: https", "See https"), 'no "Thread:'),
        (GOOD + "Co-Authored-By: Claude <noreply@anthropic.com>\n", "no Claude attribution"),
        (GOOD + "Claude-Session: https://claude.ai/code/session_1\n", "no Claude attribution"),
        (GOOD + "\U0001f916 Generated with [Claude Code](https://claude.com/claude-code)\n", "no Claude attribution"),
    ],
)
def test_a_message_missing_what_a_pull_request_said_is_refused(message, problem):
    assert any(problem in p for p in checks.message_problems(message))


def test_every_pushed_commit_s_message_is_checked():
    pushed = change({}, files={})
    pushed.commits = [("a" * 40, GOOD), ("b" * 40, "fix\n")]
    problems = checks.commit_messages(pushed)
    assert problems[0].startswith("commit bbbbbbbbb (fix): ")
    assert not any("aaaaaaaaa" in p for p in problems)
    assert "commit-template.txt" in problems[-1]


def test_the_commit_msg_hook_reads_the_message_file(tmp_path, capsys):
    message = tmp_path / "COMMIT_EDITMSG"
    message.write_text(GOOD)
    assert checks.main(["checks.py", "--message", str(message)]) == 0
    message.write_text("fix stuff\n")
    assert checks.main(["checks.py", "--message", str(message)]) == 1
    assert "commit-template.txt" in capsys.readouterr().out


def test_the_template_itself_passes_once_filled_in():
    template = (checks.ROOT / "tools/hooks/commit-template.txt").read_text()
    filled = "A subject\n" + template.replace("chan_...?thread=cmsg_...", "chan_x?thread=cmsg_y")
    assert checks.message_problems(filled) == []


def test_collect_reads_a_first_push_against_the_empty_tree(tmp_path, monkeypatch):
    def git(*args):
        return subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True, text=True).stdout

    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@example.com")
    git("config", "user.name", "t")
    (tmp_path / "services/api/migrations").mkdir(parents=True)
    (tmp_path / "services/api/migrations/0001_a.sql").write_text("SELECT 1;\n")
    git("add", ".")
    git("commit", "-q", "-m", "first")
    monkeypatch.setattr(checks, "ROOT", tmp_path)

    empty = git("hash-object", "-t", "tree", "/dev/null").strip()
    found = checks.collect(empty, "HEAD")
    assert found.status == {"services/api/migrations/0001_a.sql": "A"}
    assert found.base_migrations == []
    assert [m.strip() for _, m in found.commits] == ["first"]
    assert checks.migrations(found) == []
