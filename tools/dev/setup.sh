#!/usr/bin/env bash
# Everything the hooks and the gate need, once per machine or session
# (burgstaller-platform standards/workflow/hooks-and-gate.md). Safe to run
# again. Claude Code sessions run it at start (.claude/settings.json).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

git config core.hooksPath tools/hooks
git config commit.template tools/hooks/commit-template.txt

if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
.venv/bin/python -m pip install -q -r tools/requirements-dev.txt

# The platform's kit is private; git reaches it with the session's own
# GitHub access.
go env -w GOPRIVATE='github.com/seburgi/*'

# Docker for testcontainers (the Go tests' Postgres) and the Go modules, in
# the background so the session need not wait. A thread's container does
# not start Docker by itself.
nohup sh -c '
  docker info >/dev/null 2>&1 || { (dockerd >/tmp/dockerd.log 2>&1 &); for _ in $(seq 30); do docker info >/dev/null 2>&1 && break; sleep 1; done; }
  docker image inspect postgres:18 >/dev/null 2>&1 || docker pull -q postgres:18
  (cd services/api && go mod download)
  (cd services/app && corepack enable >/dev/null 2>&1; pnpm install --frozen-lockfile --silent)
' >/tmp/padel-setup.log 2>&1 &
echo "padel-kaernten: hooks on (tools/hooks), gate ready (tools/gate.py)."
