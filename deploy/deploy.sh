#!/bin/sh
# deploy.sh — sur le serveur : construit depuis le code source (build.sh), installe la configuration, relance les
# services, puis vérifie que le site répond. Les secrets restent dans /opt/archive/*.env (jamais dans le code).
set -eu
SRC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ARCHIVE_OUT:-/opt/archive}"
PUBLIC_URL="${PUBLIC_URL:-https://archive.62-171-153-35.sslip.io}"

"$SRC/deploy/build.sh"
install -m 644 "$SRC/deploy/docker-compose.vps.yml" "$OUT/docker-compose.yml"
install -m 644 "$SRC/deploy/nginx.conf" "$OUT/nginx.conf"
# le gabarit nginx a besoin du jeton de proxy du copilote attesté (hors dépôt) : sans lui, on s'arrête ici
[ -s "$OUT/nginx.env" ] || { echo "!! $OUT/nginx.env manque (COPILOT_PROXY_TOKEN=<hex>, 0600) : déploiement arrêté"; exit 1; }
# Caddy ne relit son Caddyfile qu'à sa recréation (fichier monté seul : un fichier remplacé n'est pas vu par le conteneur
# en marche) : on le recrée seulement si le Caddyfile change
caddy_changed=0
cmp -s "$SRC/deploy/Caddyfile" "$OUT/Caddyfile" 2>/dev/null || caddy_changed=1
install -m 644 "$SRC/deploy/Caddyfile" "$OUT/Caddyfile"
cd "$OUT"
docker compose up -d --remove-orphans
docker compose restart api copilot copilot-site mcp registrar-inference registrar-x402 registrar-bounty registrar-copilot registrar-bounty-verified >/dev/null
# nginx relit son gabarit (et le jeton) seulement au démarrage du conteneur : on le recrée
docker compose up -d --force-recreate --no-deps web >/dev/null
[ "$caddy_changed" = 0 ] || docker compose up -d --force-recreate --no-deps caddy >/dev/null
sleep 6
echo "== vérification"
fail=0
for u in / /use.html /console/ /datacenter/ /install.sh /api/health /api/index /copilot/health /copilot-site/health /mcp/health; do
  code=$(curl -s -o /dev/null -m 30 -w '%{http_code}' "$PUBLIC_URL$u" || true)
  echo "  $u -> $code"
  [ "$code" = "200" ] || fail=1
done
# les enclaves tournent dans des VM chez Phala, à part : sans elles (en pause depuis le 14/11), le site marche quand même
for u in /enclave/inference/pubkeys /enclave/x402/pubkeys /enclave/bounty/pubkeys /enclave/bounty-verified/pubkeys /enclave/copilot/pubkeys; do
  code=$(curl -s -o /dev/null -m 30 -w '%{http_code}' "$PUBLIC_URL$u" || true)
  echo "  $u -> $code (enclave : 200 seulement si sa VM tourne)"
done
docker compose ps --format '  {{.Service}} {{.State}}'
[ "$fail" = "0" ] && echo "== déployé : $PUBLIC_URL" || { echo "== ATTENTION : un point d'entrée du site ne répond pas"; exit 1; }
