#!/bin/sh
# build.sh — construit ArcHive À PARTIR DU CODE SOURCE présent sur ce serveur (/opt/archive/src), dans un conteneur
# Node 22. Depuis le 16/11, un seul projet : le front de Florent à la racine du site, la console de JB sous /console/, la
# salle 3D sous /datacenter/, l'API, les deux copilotes (console et site), le serveur MCP en HTTP et les registrars.
#   build.sh       tout : dépendances, bundles api / copilot / registrar / mcp-http, agent archive-node, puis le site
#   build.sh web   le site seul (front, console, salle 3D, fichiers d'opérateur) : les services qui tournent ne sont pas
#                  touchés, et nginx sert les nouveaux fichiers aussitôt (dossier monté) : aucun redémarrage
# Sortie : /opt/archive/{api,copilot,registrar,mcp-http}.mjs et /opt/archive/web/ (ce que docker-compose.yml fait tourner).
set -eu
SRC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ARCHIVE_OUT:-/opt/archive}"
PUBLIC_URL="${PUBLIC_URL:-https://archive.62-171-153-35.sslip.io}"
ONLY="${1:-all}"
case "$ONLY" in all|web) ;; *) echo "usage : build.sh [web]"; exit 1 ;; esac

# Garde-fou : le site n'est reconstruit que s'il est celui que ce script a construit la dernière fois (empreinte
# de web/index.html notée dans $OUT/.web-front-build). Sinon, un site déposé à la main serait effacé : on s'arrête avant de rien construire, et on dit quoi faire.
# FORCE_WEB=1 passe outre, exprès (après une sauvegarde de web/).
MARK="$OUT/.web-front-build"
if [ -f "$OUT/web/index.html" ] && [ "${FORCE_WEB:-0}" != 1 ]; then
  now=$(sha256sum "$OUT/web/index.html" | cut -c1-64)
  if [ ! -f "$MARK" ] || [ "$(cut -d' ' -f1 "$MARK")" != "$now" ]; then
    echo "!! $OUT/web a été modifié hors de build.sh (un site déposé à la main ?) : rien n'est construit ni remplacé."
    echo "   Mettez d'abord ce travail dans les sources (branche GitHub front, puis deploy/front-update.sh),"
    echo "   ou relancez avec FORCE_WEB=1 pour l'écraser exprès (sauvegarde d'abord : cp -a $OUT/web $OUT/web.avant)."
    exit 1
  fi
fi

echo "== construction ($ONLY) depuis $SRC (sortie $OUT, site $PUBLIC_URL)"
docker run --rm -v "$SRC":/src -w /src -e PUBLIC_URL="$PUBLIC_URL" -e ONLY="$ONLY" node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d sh -ec '
  DEPS="packages/sdk services/api services/copilot services/registrar services/mcp packages/node web frontend"
  [ "$ONLY" = web ] && DEPS="packages/sdk web frontend"
  for d in $DEPS; do
    # le front suit la branche GitHub « front » : npm ci ne réécrit jamais son package-lock.json (dossier git propre)
    if [ "$d" = frontend ]; then I=ci; else I=install; fi
    echo "-- dépendances ($I) : $d"; (cd "$d" && npm $I --no-audit --no-fund --loglevel=error)
  done
  mkdir -p /src/.build
  if [ "$ONLY" = all ]; then
    SDK=/src/packages/sdk/src/index.ts
    BANNER="--banner:js=import { createRequire as _cr } from \"module\"; const require = _cr(import.meta.url);"
    for s in api copilot registrar; do
      echo "-- bundle : $s"
      (cd "services/$s" && npx esbuild src/server.ts --bundle --platform=node --format=esm --log-level=warning \
        --outfile="/src/.build/$s.mjs" --alias:@arcvault/sdk="$SDK" "$BANNER")
    done
    echo "-- bundle : mcp-http (serveur MCP en HTTP, sans état)"
    (cd services/mcp && npx esbuild src/http.ts --bundle --platform=node --format=esm --log-level=warning \
      --outfile="/src/.build/mcp-http.mjs" --alias:@arcvault/sdk="$SDK" "$BANNER")
    echo "-- agent archive-node (servi par le site : install.sh + archive-node.mjs)"
    (cd packages/node && npm run -s build)
  fi
  echo "-- console (sous /console/)"
  (cd web && VITE_API_URL="$PUBLIC_URL/api" VITE_COPILOT_URL="$PUBLIC_URL/copilot" \
    VITE_ENCLAVE_URL="$PUBLIC_URL/enclave/inference" VITE_O3_URL="$PUBLIC_URL/enclave/bounty" \
    VITE_X402_URL="$PUBLIC_URL/enclave/x402" VITE_COPILOT_SITE_ENCLAVE_URL="$PUBLIC_URL/enclave/copilot-site" \
    npx vite build --base /console/ --logLevel warn --emptyOutDir --outDir /src/.build/web-console)
  echo "-- front (à la racine) : pages de Florent et copilote du site, profil jb (frontend/.env.jb : tout sur cette origine)"
  (cd frontend && node scripts/sizes.mjs && npx vite build --mode jb --logLevel warn --emptyOutDir --outDir /src/.build/web-front)
'
if [ "$ONLY" = all ]; then
  for s in api copilot registrar mcp-http; do install -m 644 "$SRC/.build/$s.mjs" "$OUT/$s.mjs"; done
fi

# le site : le front à la racine ; la console, la salle 3D et les fichiers d'opérateur à leur place (rien d'autre n'est effacé)
W="$OUT/web"
mkdir -p "$W/console" "$W/datacenter" "$W/manifests"
rsync -a --delete --exclude console/ --exclude datacenter/ --exclude install.sh --exclude archive-node.mjs --exclude manifests/ \
  "$SRC/.build/web-front/" "$W/"
rsync -a --delete --exclude datacenter/ "$SRC/.build/web-console/" "$W/console/"
# 20/11 : the small 404 page nginx shows for unknown paths (deploy/nginx.conf, error_page)
install -m 644 "$SRC/deploy/404.html" "$W/404.html"
rsync -a --delete "$SRC/web/public/datacenter/" "$W/datacenter/"
# le bouton « console » de la salle 3D mène à /console/ (la page est construite pour la racine : T-salle-serveurs-3d/site)
sed -i 's#id="btn-console" href="/"#id="btn-console" href="/console/"#' "$W/datacenter/index.html"
install -m 755 "$SRC/web/public/install.sh" "$W/install.sh"
install -m 755 "$SRC/web/public/archive-node.mjs" "$W/archive-node.mjs"
rsync -a "$SRC/web/public/manifests/" "$W/manifests/"
rsync -a "$SRC/.build/web-front/manifests/" "$W/manifests/"
# l'empreinte du site construit, pour le garde-fou du prochain passage (et le commit du front, pour les audits)
echo "$(sha256sum "$W/index.html" | cut -c1-64) front=$(git -C "$SRC/frontend" rev-parse --short HEAD 2>/dev/null || echo inconnu) $(date -u +%Y-%m-%dT%H:%MZ)" > "$MARK"
if [ "$ONLY" = all ]; then echo "== construit : $(ls -1 "$OUT"/*.mjs | wc -l) bundles, site $(du -sh "$W" | cut -f1)"
else echo "== construit : le site seul ($(du -sh "$W" | cut -f1)), services inchangés"; fi
