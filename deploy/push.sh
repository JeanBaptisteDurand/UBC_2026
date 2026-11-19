#!/bin/sh
# push.sh — depuis un poste de dev : envoie le code source sur le serveur (sans secrets ni dépendances), puis lance
# le déploiement LÀ-BAS (construction depuis le code du serveur). Usage : ./deploy/push.sh  [hôte ssh, défaut ubc-vps]
set -eu
HOST="${1:-ubc-vps}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rsync -az --no-o --no-g --delete --filter="merge $ROOT/deploy/rsync-filter.txt" "$ROOT/" "$HOST:/opt/archive/src/"
ssh "$HOST" 'chmod +x /opt/archive/src/deploy/*.sh && /opt/archive/src/deploy/deploy.sh'
