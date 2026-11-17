#!/bin/sh
# install.sh — SUR LE SERVEUR seulement : installe ou met à jour le nœud d'Arc testnet d'ArcHive dans /opt/arc-node.
# Premier lancement : télécharge l'instantané d'Arc (≈ 84 Go compressés, plusieurs heures) puis suit la chaîne.
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="${ARC_NODE_DIR:-/opt/arc-node}"
mkdir -p "$OUT/data/execution" "$OUT/data/consensus"
# les conteneurs du nœud écrivent sous l'uid 999 (sinon « Permission denied » à l'instantané)
chown -R 999:999 "$OUT/data"
install -m 644 "$SRC/docker-compose.yml" "$OUT/docker-compose.yml"
install -m 644 "$SRC/rpc-gate.mjs" "$OUT/rpc-gate.mjs"
[ -f "$OUT/.env" ] || cat > "$OUT/.env" <<ENV
ARC_VERSION=0.8.4
ARC_HOME=$OUT/data
ARC_EXECUTION_IMAGE=docker.cloudsmith.io/circle/arc-network/arc-execution:0.8.4
ARC_CONSENSUS_IMAGE=docker.cloudsmith.io/circle/arc-network/arc-consensus:0.8.4
ENV
cd "$OUT"
# détaché du terminal : « up » attend la fin de l'instantané (plusieurs heures au premier lancement)
nohup docker compose up -d > "$OUT/up.log" 2>&1 < /dev/null &
echo "lancé ; suivre : docker compose -f $OUT/docker-compose.yml logs -f arc-snapshots ; état : curl -s http://172.17.0.1:8810/health"
