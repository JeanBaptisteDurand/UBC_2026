#!/bin/sh
# install.sh — ON THE SERVER only: installs or updates the optional Arc testnet node in /opt/arc-node (state proofs for
# the Sealed Bounty's replay; it needs a disk of at least 450 GB). First run: downloads Arc's snapshot (about 84 GB
# compressed, several hours), then follows the chain.
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="${ARC_NODE_DIR:-/opt/arc-node}"
mkdir -p "$OUT/data/execution" "$OUT/data/consensus"
# the node's containers write as uid 999 (otherwise the snapshot fails with "Permission denied")
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
# detached from the terminal: "up" waits for the snapshot to finish (several hours on the first run)
nohup docker compose up -d > "$OUT/up.log" 2>&1 < /dev/null &
echo "started; follow: docker compose -f $OUT/docker-compose.yml logs -f arc-snapshots; status: curl -s http://172.17.0.1:8810/health"
