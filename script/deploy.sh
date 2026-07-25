#!/usr/bin/env bash
#
# Replit deploy — force-sync to GitHub, then build. Does NOT serve.
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
# WHY it does NOT start the server: Replit's SUPERVISOR owns port 5000 (via the
# Run button / Deploy config), not the shell. A manual `node dist/index.cjs` from
# the shell races the supervisor and loses with EADDRINUSE. So this script only
# syncs + builds. To START the freshly-built server, use the workspace buttons:
#
#     Stop ■   →   Run ▶     (supervisor restarts and owns port 5000 cleanly)
#
# or, for the production Reserved VM, the Deploy panel's Redeploy button.
#
# Usage (Replit shell):  bash script/deploy.sh   then click Stop ■ → Run ▶
#
set -euo pipefail

echo ">>> fetching origin..."
git fetch origin

echo ">>> force-syncing workspace to origin/main (discarding any local/Published commits)..."
git reset --hard origin/main
echo ">>> now at: $(git log --oneline -1)"

# Install BEFORE building. The reset --hard above can bring in a package.json that
# needs deps this workspace doesn't have yet — the build then dies with a Rollup
# "failed to resolve import" that reads like a code error but is just a missing
# module (happened with exceljs: dep was in package.json, absent from node_modules).
# `npm ci` when the lockfile is in sync (exact, reproducible), else fall back to
# `npm install` so a lock/manifest mismatch can't block the deploy.
echo ">>> installing dependencies..."
if ! npm ci --no-audit --no-fund; then
  echo ">>> npm ci failed (lockfile out of sync?) — falling back to npm install"
  npm install --no-audit --no-fund
fi

echo ">>> building..."
npm run build

echo ""
echo ">>> BUILD COMPLETE. New bundle is in dist/."
echo ">>> Now click  Stop ■  then  Run ▶  in the Replit workspace to serve it"
echo ">>> (the supervisor owns port 5000 — don't start node from the shell)."
