#!/bin/sh
# front-update.sh — on the server, after each push to the GitHub branch "main" (the served version; BRANCH=beta for the
# beta): fetches the branch, merges it into /opt/archive/src/frontend (only its frontend/ folder counts), then rebuilds
# the site only (build.sh web: front, console, 3D room; services are not touched). Stops without building anything if
# the folder has uncommitted changes or if the merge has a conflict (a change made on the server).
set -eu
REPO="${REPO:-https://github.com/JeanBaptisteDurand/UBC_2026.git}"
BRANCH="${BRANCH:-main}"
FRONT="${FRONT:-/opt/archive/src/frontend}"
cd "$FRONT"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "!! $FRONT has uncommitted changes: nothing is done (front-end changes go through GitHub)"; git status --short; exit 1
fi
git fetch --no-tags "$REPO" "+refs/heads/$BRANCH:refs/remotes/github/$BRANCH"
TIP=$(git rev-parse --short "github/$BRANCH")
if git merge-base --is-ancestor "github/$BRANCH" HEAD; then echo "== already up to date ($BRANCH $TIP)"
else
  git merge --no-ff --no-edit -X subtree=frontend -m "Deploy GitHub branch $BRANCH ($TIP)" "github/$BRANCH" \
    || { git merge --abort; echo "!! merge conflict: nothing is built. Resolve it on GitHub (branch $BRANCH), then run this script again"; exit 1; }
fi
[ "$(git rev-parse HEAD^{tree})" = "$(git rev-parse "github/$BRANCH:frontend")" ] \
  || echo "!! warning: src/frontend differs from $BRANCH's frontend/ (a commit made on the server?)"
[ "${BUILD:-1}" = 0 ] || "$(dirname "$FRONT")/deploy/build.sh" web
