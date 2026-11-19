#!/bin/sh
# build.sh — builds ArcHive FROM THE SOURCE CODE on this server (/opt/archive/src), in a Node 22 container. One project:
# the marketplace site at the root, the console under /console/, the 3D server room under /datacenter/, the API, both
# copilots (console and site), the MCP server over HTTP and the registrars.
#   build.sh       everything: dependencies, the api / copilot / registrar / mcp-http bundles, the archive-node agent,
#                  then the site
#   build.sh web   the site only (front, console, 3D room, operator files): running services are not touched, and nginx
#                  serves the new files at once (mounted folder): no restart
# Output: /opt/archive/{api,copilot,registrar,mcp-http}.mjs and /opt/archive/web/ (what docker-compose.yml runs).
set -eu
SRC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ARCHIVE_OUT:-/opt/archive}"
PUBLIC_URL="${PUBLIC_URL:-https://archive.62-171-153-35.sslip.io}"
ONLY="${1:-all}"
case "$ONLY" in all|web) ;; *) echo "usage: build.sh [web]"; exit 1 ;; esac

# Guard: the site is rebuilt only if it is the one this script built last time (fingerprint of web/index.html kept in
# $OUT/.web-front-build). Otherwise a site placed by hand would be erased: stop before building anything, and say what
# to do. FORCE_WEB=1 overrides it, on purpose (after a backup of web/).
MARK="$OUT/.web-front-build"
if [ -f "$OUT/web/index.html" ] && [ "${FORCE_WEB:-0}" != 1 ]; then
  now=$(sha256sum "$OUT/web/index.html" | cut -c1-64)
  if [ ! -f "$MARK" ] || [ "$(cut -d' ' -f1 "$MARK")" != "$now" ]; then
    echo "!! $OUT/web was changed outside build.sh (a site placed by hand?): nothing is built or replaced."
    echo "   First put that work in the sources (the GitHub branch, then deploy/front-update.sh),"
    echo "   or run again with FORCE_WEB=1 to overwrite it on purpose (back it up first: cp -a $OUT/web $OUT/web.before)."
    exit 1
  fi
fi

echo "== build ($ONLY) from $SRC (output $OUT, site $PUBLIC_URL)"
docker run --rm -v "$SRC":/src -w /src -e PUBLIC_URL="$PUBLIC_URL" -e ONLY="$ONLY" node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d sh -ec '
  DEPS="packages/sdk services/api services/copilot services/registrar services/mcp packages/node web frontend"
  [ "$ONLY" = web ] && DEPS="packages/sdk web frontend"
  for d in $DEPS; do
    # the front follows a GitHub branch (deploy/front-update.sh): npm ci never rewrites its package-lock.json (clean git folder)
    if [ "$d" = frontend ]; then I=ci; else I=install; fi
    echo "-- dependencies ($I): $d"; (cd "$d" && npm $I --no-audit --no-fund --loglevel=error)
  done
  mkdir -p /src/.build
  if [ "$ONLY" = all ]; then
    SDK=/src/packages/sdk/src/index.ts
    BANNER="--banner:js=import { createRequire as _cr } from \"module\"; const require = _cr(import.meta.url);"
    for s in api copilot registrar; do
      echo "-- bundle: $s"
      (cd "services/$s" && npx esbuild src/server.ts --bundle --platform=node --format=esm --log-level=warning \
        --outfile="/src/.build/$s.mjs" --alias:@arcvault/sdk="$SDK" "$BANNER")
    done
    echo "-- bundle: mcp-http (MCP server over HTTP, stateless)"
    (cd services/mcp && npx esbuild src/http.ts --bundle --platform=node --format=esm --log-level=warning \
      --outfile="/src/.build/mcp-http.mjs" --alias:@arcvault/sdk="$SDK" "$BANNER")
    echo "-- archive-node agent (served by the site: install.sh + archive-node.mjs)"
    (cd packages/node && npm run -s build)
  fi
  echo "-- console (under /console/)"
  (cd web && VITE_API_URL="$PUBLIC_URL/api" VITE_COPILOT_URL="$PUBLIC_URL/copilot" \
    VITE_ENCLAVE_URL="$PUBLIC_URL/enclave/inference" VITE_O3_URL="$PUBLIC_URL/enclave/bounty" \
    VITE_X402_URL="$PUBLIC_URL/enclave/x402" VITE_COPILOT_SITE_ENCLAVE_URL="$PUBLIC_URL/enclave/copilot-site" \
    npx vite build --base /console/ --logLevel warn --emptyOutDir --outDir /src/.build/web-console)
  echo "-- front (site root): the marketplace pages and AskHive, profile frontend/.env.jb (every URL on this origin)"
  (cd frontend && node scripts/sizes.mjs && npx vite build --mode jb --logLevel warn --emptyOutDir --outDir /src/.build/web-front)
'
if [ "$ONLY" = all ]; then
  for s in api copilot registrar mcp-http; do install -m 644 "$SRC/.build/$s.mjs" "$OUT/$s.mjs"; done
fi

# the site: the front at the root; the console, the 3D room and the operator files in their places (nothing else is erased)
W="$OUT/web"
mkdir -p "$W/console" "$W/datacenter" "$W/manifests"
rsync -a --delete --exclude console/ --exclude datacenter/ --exclude install.sh --exclude archive-node.mjs --exclude manifests/ \
  "$SRC/.build/web-front/" "$W/"
rsync -a --delete --exclude datacenter/ "$SRC/.build/web-console/" "$W/console/"
# the small 404 page nginx shows for unknown paths (deploy/nginx.conf, error_page)
install -m 644 "$SRC/deploy/404.html" "$W/404.html"
rsync -a --delete "$SRC/web/public/datacenter/" "$W/datacenter/"
# the 3D room's "console" button leads to /console/ (the page is built for the site root)
sed -i 's#id="btn-console" href="/"#id="btn-console" href="/console/"#' "$W/datacenter/index.html"
install -m 755 "$SRC/web/public/install.sh" "$W/install.sh"
install -m 755 "$SRC/web/public/archive-node.mjs" "$W/archive-node.mjs"
rsync -a "$SRC/web/public/manifests/" "$W/manifests/"
rsync -a "$SRC/.build/web-front/manifests/" "$W/manifests/"
# the built site's fingerprint, for the next run's guard (and the front's commit, for audits)
echo "$(sha256sum "$W/index.html" | cut -c1-64) front=$(git -C "$SRC/frontend" rev-parse --short HEAD 2>/dev/null || echo unknown) $(date -u +%Y-%m-%dT%H:%MZ)" > "$MARK"
if [ "$ONLY" = all ]; then echo "== built: $(ls -1 "$OUT"/*.mjs | wc -l) bundles, site $(du -sh "$W" | cut -f1)"
else echo "== built: the site only ($(du -sh "$W" | cut -f1)), services unchanged"; fi
