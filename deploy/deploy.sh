#!/bin/sh
# deploy.sh — on the server: builds from the source code (build.sh), installs the configuration, restarts the services,
# then checks that the site answers. Secrets stay in /opt/archive/*.env (never in the code).
set -eu
SRC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ARCHIVE_OUT:-/opt/archive}"
PUBLIC_URL="${PUBLIC_URL:-https://archive.62-171-153-35.sslip.io}"

"$SRC/deploy/build.sh"
install -m 644 "$SRC/deploy/docker-compose.vps.yml" "$OUT/docker-compose.yml"
install -m 644 "$SRC/deploy/nginx.conf" "$OUT/nginx.conf"
# the nginx template needs the attested copilot's proxy token (kept outside the repository): without it, stop here
[ -s "$OUT/nginx.env" ] || { echo "!! $OUT/nginx.env is missing (COPILOT_PROXY_TOKEN=<hex>, 0600): deployment stopped"; exit 1; }
# Caddy rereads its Caddyfile only when it is recreated (a single mounted file: a replaced file is not seen by the
# running container), so it is recreated only when the Caddyfile changes
caddy_changed=0
cmp -s "$SRC/deploy/Caddyfile" "$OUT/Caddyfile" 2>/dev/null || caddy_changed=1
install -m 644 "$SRC/deploy/Caddyfile" "$OUT/Caddyfile"
cd "$OUT"
docker compose up -d --remove-orphans
docker compose restart api copilot copilot-site mcp registrar-inference registrar-x402 registrar-bounty registrar-copilot registrar-bounty-verified >/dev/null
# nginx rereads its template (and the token) only when its container starts, so it is recreated
docker compose up -d --force-recreate --no-deps web >/dev/null
[ "$caddy_changed" = 0 ] || docker compose up -d --force-recreate --no-deps caddy >/dev/null
sleep 6
echo "== checks"
fail=0
for u in / /use.html /console/ /datacenter/ /install.sh /api/health /api/index /copilot/health /copilot-site/health /mcp/health; do
  code=$(curl -s -o /dev/null -m 30 -w '%{http_code}' "$PUBLIC_URL$u" || true)
  echo "  $u -> $code"
  [ "$code" = "200" ] || fail=1
done
# the enclaves run in separate Intel TDX VMs at Phala Cloud: they are checked on their own, and the site keeps working when one is down
for u in /enclave/inference/pubkeys /enclave/x402/pubkeys /enclave/bounty/pubkeys /enclave/bounty-verified/pubkeys /enclave/copilot/pubkeys; do
  code=$(curl -s -o /dev/null -m 30 -w '%{http_code}' "$PUBLIC_URL$u" || true)
  echo "  $u -> $code (enclave: 200 only while its VM runs)"
done
docker compose ps --format '  {{.Service}} {{.State}}'
[ "$fail" = "0" ] && echo "== deployed: $PUBLIC_URL" || { echo "== WARNING: a site endpoint does not answer"; exit 1; }
