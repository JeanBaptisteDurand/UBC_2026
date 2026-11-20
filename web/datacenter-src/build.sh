#!/bin/sh
# Build the 3D server room that the ArcHive site serves at /datacenter/.
#   sh web/datacenter-src/build.sh web/public/datacenter
#
# 1. make_room.py turns the engine page (base.template.html) into the server room with the blocks in room/.
# 2. copy_room.py writes the room's words over the engine's (base-copy.json, English and French). The words and the
#    recorded network (hive-data.json) go into the page as two JSON blocks.
# 3. make_site.py reshapes the page for the site's strict CSP (script-src 'self'), and esbuild bundles its script with
#    three.js r160 into room.js. The model packs and their licences go beside it.
#
# Needs python3, Node.js and npm. three and esbuild are installed once, at exact versions, in a cache outside the repo.
# The model packs are read from web/public/datacenter/m, where they are kept (ARCHIVE_ROOM_MODELS overrides it).
set -eu
SRC=$(cd "$(dirname "$0")" && pwd)
OUT="${1:?usage: build.sh <out dir>}"
MODELS="${ARCHIVE_ROOM_MODELS:-$SRC/../public/datacenter/m}"
CACHE="${ARCHIVE_ROOM_CACHE:-$HOME/.cache/archive-room-site}"
if [ -d "$OUT" ] && [ -n "$(ls -A "$OUT")" ] && [ ! -f "$OUT/room.js" ]; then
  echo "refused: $OUT is not empty and holds no earlier build (room.js)"; exit 1
fi
[ -f "$MODELS/racks.json" ] || { echo "failed: no model packs in $MODELS"; exit 1; }
sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -c1-64; else shasum -a 256 "$1" | cut -c1-64; fi; }

# three r160 (the version the page imports) and esbuild, at exact versions
if [ ! -f "$CACHE/node_modules/three/package.json" ] || [ ! -f "$CACHE/node_modules/esbuild/package.json" ]; then
  mkdir -p "$CACHE"
  [ -f "$CACHE/package.json" ] || printf '{"private":true}\n' > "$CACHE/package.json"
  (cd "$CACHE" && npm install --no-audit --no-fund --loglevel=error --save-exact three@0.160.0 esbuild@0.24.2)
fi
node -e 'const v = require(process.argv[1]).version; if (v !== "0.160.0") { console.error("three " + v + ", expected 0.160.0"); process.exit(1); }' "$CACHE/node_modules/three/package.json"

# 1 and 2: the room page, with its data and its words
WORK="$CACHE/work"; BUILD="$CACHE/build"
rm -rf "$WORK" "$BUILD" "$CACHE/src"
mkdir -p "$WORK"
python3 -I "$SRC/make_room.py" "$SRC" "$WORK/room.template.html" >/dev/null
python3 -I "$SRC/copy_room.py" "$SRC/base-copy.json" "$WORK/copy.json" >/dev/null
python3 -I - "$WORK" "$SRC/hive-data.json" <<'PY'
import json, os, sys
work, data_path = sys.argv[1:3]
tpl = open(os.path.join(work, 'room.template.html'), encoding='utf-8').read()
emb = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/').replace('<!--', '<\\!--')
data = json.load(open(data_path, encoding='utf-8'))
copy = json.load(open(os.path.join(work, 'copy.json'), encoding='utf-8'))
assert tpl.count('/*__DATA__*/') == 1 and tpl.count('/*__COPY__*/') == 1
out = tpl.replace('/*__DATA__*/', emb(data)).replace('/*__COPY__*/', emb(copy))
open(os.path.join(work, 'archive-datacenter.html'), 'w', encoding='utf-8').write(out)
PY

# 3: the site's version, one local script file
python3 -I "$SRC/make_site.py" "$WORK/archive-datacenter.html" "$MODELS" "$CACHE/src" "$BUILD"
"$CACHE/node_modules/.bin/esbuild" "$CACHE/src/room.src.js" --bundle --format=esm --minify --target=es2022 \
  --legal-comments=eof --log-level=warning --outfile="$BUILD/room.js"
V=$(sha256 "$BUILD/room.js" | cut -c1-10)
python3 -I - "$BUILD/index.html" "$V" <<'PY'
import sys
p, v = sys.argv[1:3]
s = open(p, encoding='utf-8').read()
assert s.count('__ROOM_V__') == 1
open(p, 'w', encoding='utf-8').write(s.replace('__ROOM_V__', v))
PY

# checks: no CDN, no import map, exactly one script file (plus the two JSON data blocks), the six packs
if grep -q 'cdn.jsdelivr' "$BUILD/index.html" "$BUILD/room.js" || grep -q 'type="importmap"' "$BUILD/index.html"; then
  echo "failed: a CDN or an import map is left"; exit 1
fi
if [ "$(grep -o '<script' "$BUILD/index.html" | wc -l | tr -d ' ')" != 3 ]; then echo "failed: unexpected script tags"; exit 1; fi
for p in factory station shop space chars racks; do
  [ -s "$BUILD/m/$p.json" ] || { echo "failed: m/$p.json missing"; exit 1; }
done

# the new build replaces the old one
mkdir -p "$OUT"
find "$OUT" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -R "$BUILD/." "$OUT/"
echo "built $OUT: room.js $(wc -c < "$OUT/room.js" | tr -d ' ') bytes (v $V, sha256 $(sha256 "$OUT/room.js"))"
