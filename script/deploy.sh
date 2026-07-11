#!/usr/bin/env bash
#
# Replit deploy — force-sync to GitHub, then build & serve.
#
# WHY reset --hard instead of pull: Replit auto-commits "Published your App"
# onto the workspace's own `main`, which forks it from GitHub. A `git pull`
# (even --rebase) negotiates with that forked history and loses — you end up
# building Replit's commits, not your pushed code. This script makes GitHub the
# single source of truth: it discards whatever the workspace committed and force-
# matches origin/main every time. The "Published your App" commits carry no real
# file changes (verified via `git diff --stat origin/main HEAD` = empty), so
# nothing is lost. If you ever edit code DIRECTLY in the Replit shell, push it to
# GitHub FIRST — this script will blow away un-pushed local work by design.
#
# Usage (Replit shell):  bash script/deploy.sh
#
set -euo pipefail

echo ">>> fetching origin..."
git fetch origin

echo ">>> force-syncing workspace to origin/main (discarding any local/Published commits)..."
git reset --hard origin/main
echo ">>> now at: $(git log --oneline -1)"

echo ">>> building..."
npm run build

echo ">>> freeing port 5000..."
fuser -k 5000/tcp 2>/dev/null || true
kill -9 "$(lsof -t -i:5000)" 2>/dev/null || true
while lsof -i:5000 >/dev/null 2>&1; do sleep 0.5; done

echo ">>> port 5000 free — starting new build"
node dist/index.cjs
