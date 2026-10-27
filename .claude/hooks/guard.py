"""Refuses the git commands that would get past the gate (burgstaller-platform standards/workflow/hooks-and-gate.md).

A Claude Code PreToolUse hook on Bash: the command arrives as JSON on
stdin; exit code 2 refuses it and tells Claude why.
"""

import json
import re
import sys

RULES = [
    (
        re.compile(r"\bgit\b[^;&|]*\s(--no-verify)\b"),
        "--no-verify skips the hooks, and the gate with them. Fix what the hook reports instead.",
    ),
    (
        re.compile(r"\bgit\b[^;&|]*\bcommit\b[^;&|]*\s-[a-zA-Z]*n[a-zA-Z]*\b"),
        "git commit -n skips the hooks. Fix what the hook reports instead.",
    ),
    (
        re.compile(r"\bgit\b[^;&|]*\bpush\b[^;&|]*\s(-f\b|--force\b|--force-with-lease\b|\+)"),
        "Never force-push: main is shared. Rebase onto origin/main and push normally.",
    ),
    (
        re.compile(r"\bgit\b[^;&|]*\bcore\.hooksPath\b(?!\s+tools/hooks)"),
        "The hooks live in tools/hooks; core.hooksPath stays pointed there.",
    ),
    (re.compile(r"\b(HUSKY|SKIP_GATE)=\S"), "The gate is not skipped."),
]


# Quoted words (a commit message saying "-n" or "--force") are not flags.
QUOTED = re.compile(r"'[^']*'|\"(?:[^\"\\]|\\.)*\"|<<-?\s*'?(\w+)'?.*?^\s*\1\s*$", re.S | re.M)


def refusal(command: str) -> str | None:
    command = QUOTED.sub("''", command)
    for pattern, why in RULES:
        if pattern.search(command):
            return why
    return None


def main() -> int:
    event = json.load(sys.stdin)
    why = refusal(event.get("tool_input", {}).get("command", ""))
    if why:
        print(why, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
