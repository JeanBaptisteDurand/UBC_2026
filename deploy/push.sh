#!/bin/sh
# push.sh — from a dev machine: sends the source code to the server (no secrets, no dependencies), then runs the
# deployment THERE (built from the server's copy of the source). Usage: ./deploy/push.sh [ssh host, default ubc-vps]
set -eu
HOST="${1:-ubc-vps}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rsync -az --no-o --no-g --delete --filter="merge $ROOT/deploy/rsync-filter.txt" "$ROOT/" "$HOST:/opt/archive/src/"
ssh "$HOST" 'chmod +x /opt/archive/src/deploy/*.sh && /opt/archive/src/deploy/deploy.sh'
