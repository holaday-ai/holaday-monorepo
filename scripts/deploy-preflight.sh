#!/usr/bin/env bash
#
# Deploy preflight — SESSION_STATUS hard rule 7 (lesson ③: never assume the
# prod branch from memory/SESSION_STATUS — read the LIVE HEAD).
#
# Run ON the live server, inside the repo dir, BEFORE `git reset --hard`.
# It prints the current live HEAD + which origin branches contain it, then
# REFUSES (exit 1) if the current HEAD is NOT an ancestor of the intended
# deploy source — i.e. a reset would DISCARD commits currently live but
# absent from your source (someone else deployed something you'd clobber).
#
# Usage (on live server, in /opt/holaday-monorepo):
#   bash scripts/deploy-preflight.sh claude/musing-keller-ae1d05 && \
#     git reset --hard origin/claude/musing-keller-ae1d05
#
# Exit codes: 0 = safe fast-forward (proceed) · 1 = REFUSE (stop+report) ·
#             2 = cannot fetch the deploy source.
set -euo pipefail

SRC="${1:?usage: deploy-preflight.sh <deploy-source-branch, e.g. claude/musing-keller-ae1d05>}"

cur="$(git rev-parse HEAD)"
echo "=== DEPLOY PREFLIGHT (hard rule 7) ==="
echo "current LIVE HEAD : ${cur:0:12}  $(git log -1 --format='%s' "$cur" 2>/dev/null)"
echo "  contained in origin branches:"
git branch -r --contains "$cur" 2>/dev/null | sed 's/^/    /' || echo "    (none / not fetched)"

echo "fetching deploy source origin/$SRC ..."
git fetch origin "refs/heads/${SRC}:refs/remotes/origin/${SRC}" >/dev/null 2>&1 \
  || { echo "🛑 cannot fetch origin/$SRC — aborting."; exit 2; }
src="$(git rev-parse "origin/${SRC}")"
echo "deploy source     : origin/$SRC @ ${src:0:12}  $(git log -1 --format='%s' "$src" 2>/dev/null)"

if [ "$cur" = "$src" ]; then
  echo "✅ already at deploy source (no-op deploy). Safe."
  exit 0
fi
if git merge-base --is-ancestor "$cur" "$src"; then
  echo "✅ current HEAD IS an ancestor of origin/$SRC → fast-forward deploy is SAFE."
  echo "   proceed:  git reset --hard origin/$SRC"
  exit 0
fi

echo "🛑 REFUSE: current live HEAD (${cur:0:12}) is NOT an ancestor of origin/$SRC (${src:0:12})."
echo "   A reset would DISCARD commits currently live but absent from your source."
echo "   STOP and report — reconcile (merge the live HEAD into your source) before deploying."
exit 1
