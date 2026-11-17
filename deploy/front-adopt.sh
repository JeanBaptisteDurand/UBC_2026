#!/bin/sh
# front-adopt.sh — À LANCER UNE SEULE FOIS sur le serveur. /opt/archive/src/frontend (dépôt git imbriqué, racine = le
# front) suit désormais la branche GitHub « front » de Florent (dépôt monorepo : le front y est sous frontend/).
# Les deux historiques n'ont aucun ancêtre commun : un seul commit de fusion, dont le contenu est l'arbre frontend/ de la
# branche et dont les parents sont notre 1cd3c51 (nos 27 commits) et le commit GitHub. Rien n'est effacé : nos commits
# restent dans l'historique, plus une étiquette et un paquet git de sauvegarde.
set -eu
REPO="${REPO:-https://github.com/JeanBaptisteDurand/UBC_2026.git}"
BRANCH="${BRANCH:-front}"
FRONT="${FRONT:-/opt/archive/src/frontend}"
BACKUP="${BACKUP:-/root/backups}"
cd "$FRONT"
# 1. seul package-lock.json peut avoir bougé (réécrit par le « npm install » de build.sh) ; tout autre changement arrête
other=$(git status --porcelain --untracked-files=no | grep -v ' package-lock\.json$' || true)
[ -z "$other" ] || { echo "!! changements locaux autres que package-lock.json, rien n'est fait :"; echo "$other"; exit 1; }
git checkout -- package-lock.json
# 2. nos commits gardés à jamais : une étiquette et un paquet git
git tag -a jb-front-2026-11-16 -m "Front de JB (correctifs + copilote du site) avant d'adopter la branche front de Florent" HEAD
mkdir -p "$BACKUP" && git bundle create "$BACKUP/front-jb-$(git rev-parse --short HEAD)-$(date +%Y%m%d).bundle" --all
# 3. la branche de Florent
git fetch --no-tags "$REPO" "+refs/heads/$BRANCH:refs/remotes/github/$BRANCH"
TIP=$(git rev-parse --short "github/$BRANCH")
# 4. un commit de fusion : contenu = frontend/ de la branche, parents = notre HEAD et le commit GitHub
git merge --no-ff --no-commit --allow-unrelated-histories -s ours "github/$BRANCH" >/dev/null
git read-tree -u --reset "github/$BRANCH:frontend"
git commit -q -m "Adopt GitHub branch $BRANCH ($TIP) as the site front; JB's 27 commits stay in history (tag jb-front-2026-11-16)"
[ "$(git rev-parse HEAD^{tree})" = "$(git rev-parse "github/$BRANCH:frontend")" ] && echo "== src/frontend = frontend/ de $BRANCH $TIP"
