#!/bin/sh
# front-update.sh — sur le serveur, après chaque « git push » sur la branche GitHub « beta » (BRANCH=front pour l'ancienne) : récupère la branche,
# la fusionne dans /opt/archive/src/frontend (seul son dossier frontend/ compte), puis reconstruit le site seul
# (build.sh web : front, console, salle 3D ; les services ne sont pas touchés). S'arrête sans rien construire si le
# dossier a des changements non commités ou si la fusion a un conflit (un changement fait sur le serveur).
set -eu
REPO="${REPO:-https://github.com/JeanBaptisteDurand/UBC_2026.git}"
BRANCH="${BRANCH:-beta}"
FRONT="${FRONT:-/opt/archive/src/frontend}"
cd "$FRONT"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "!! $FRONT a des changements non commités : rien n'est fait (un changement du front passe par GitHub)"; git status --short; exit 1
fi
git fetch --no-tags "$REPO" "+refs/heads/$BRANCH:refs/remotes/github/$BRANCH"
TIP=$(git rev-parse --short "github/$BRANCH")
if git merge-base --is-ancestor "github/$BRANCH" HEAD; then echo "== déjà à jour ($BRANCH $TIP)"
else
  git merge --no-ff --no-edit -X subtree=frontend -m "Deploy GitHub branch $BRANCH ($TIP)" "github/$BRANCH" \
    || { git merge --abort; echo "!! conflit : rien n'est construit. Voir git log jb-front-2026-11-16.. et la branche $BRANCH"; exit 1; }
fi
[ "$(git rev-parse HEAD^{tree})" = "$(git rev-parse "github/$BRANCH:frontend")" ] \
  || echo "!! attention : src/frontend diffère de frontend/ de $BRANCH (un commit fait sur le serveur ?)"
[ "${BUILD:-1}" = 0 ] || "$(dirname "$FRONT")/deploy/build.sh" web
