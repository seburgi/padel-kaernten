import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("guard", Path(__file__).parent.parent / ".claude/hooks/guard.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


def test_commands_that_skip_the_gate_are_refused():
    for command in [
        "git commit --no-verify -m x",
        "git commit -nm x",
        "git push -f origin HEAD:main",
        "git push --force-with-lease",
        "git config core.hooksPath /dev/null",
        "SKIP_GATE=1 git push",
    ]:
        assert guard.refusal(command), command


def test_ordinary_commands_pass():
    for command in [
        "git push origin HEAD:main",
        "git commit -m 'no -n here, nor --force'",
        "git config core.hooksPath tools/hooks",
    ]:
        assert guard.refusal(command) is None, command
