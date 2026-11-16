#!/bin/sh
# ArcHive: installs the operator agent "archive-node" (a single file, Node.js 20 or later).
#
#   curl -fsSL https://archive.62-171-153-35.sslip.io/install.sh | sh
#   ARCHIVE_API=https://host/api sh install.sh             another ArcHive API
#   ARCHIVE_NODE_URL=./archive-node.mjs sh install.sh      the agent from a local file or another URL
#   ARCHIVE_HOME=/opt/archive sh install.sh                another folder than ~/.archive
#   ARCHIVE_NODE_SHA256=<64 hex characters> sh install.sh  requires this SHA-256 fingerprint for the agent (refused if it differs)
#
# Running the script again simply updates the agent (nothing is duplicated, the key is left alone).
#
# What the fingerprint protects, honestly: the script always prints the SHA-256 fingerprint of the downloaded agent, and
# refuses to install it if ARCHIVE_NODE_SHA256 is given and doesn't match. That protects you ONLY if this fingerprint
# comes from SOMEWHERE ELSE than this server (code repository, team announcement, another channel): a compromised server
# can change the agent, the fingerprint it shows and this script itself. For a real check: download install.sh, read
# it, then run it with the fingerprint obtained through another channel, for example
#   curl -fsSLo install.sh https://archive.62-171-153-35.sslip.io/install.sh && less install.sh
#   ARCHIVE_NODE_SHA256=<fingerprint published elsewhere> sh install.sh
set -eu

BASE_URL="${ARCHIVE_BASE_URL:-https://archive.62-171-153-35.sslip.io}"
NODE_URL="${ARCHIVE_NODE_URL:-$BASE_URL/archive-node.mjs}"
ARCHIVE_HOME="${ARCHIVE_HOME:-$HOME/.archive}"
BIN_DIR="$ARCHIVE_HOME/bin"

info() { printf '%s\n' "$*"; }
fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

# SHA-256 fingerprint of a file: sha256sum (Linux), shasum (macOS), else Node.js (always present here)
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"
  fi
}

# required fingerprint (optional): 64 hexadecimal characters, "sha256:" and spaces tolerated
WANT_SHA=""
if [ -n "${ARCHIVE_NODE_SHA256:-}" ]; then
  WANT_SHA=$(printf '%s' "$ARCHIVE_NODE_SHA256" | tr 'A-F' 'a-f' | sed -e 's/^sha256://' -e 's/[[:space:]]//g')
  case "$WANT_SHA" in
    *[!0-9a-f]*) fail "ARCHIVE_NODE_SHA256 is not a SHA-256 fingerprint (64 hexadecimal characters expected)." ;;
  esac
  [ "${#WANT_SHA}" -eq 64 ] || fail "ARCHIVE_NODE_SHA256 is not a SHA-256 fingerprint (64 hexadecimal characters expected)."
fi

node_help() {
  info ""
  info "Install Node.js 20 or later, then run this command again:"
  case "$(uname -s)" in
    Darwin)
      info "  brew install node                (or the installer from https://nodejs.org)"
      ;;
    Linux)
      info "  Debian/Ubuntu: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
      info "  or, without sudo: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 22"
      ;;
    *)
      info "  https://nodejs.org"
      ;;
  esac
}

info "ArcHive: installing the operator agent archive-node"

# 1. Node.js 20 or later
if ! command -v node >/dev/null 2>&1; then
  info "Node.js is not installed."
  node_help
  exit 1
fi
NODE_MAJOR=$(node -e 'process.stdout.write(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
case "$NODE_MAJOR" in '' | *[!0-9]*) NODE_MAJOR=0 ;; esac
if [ "$NODE_MAJOR" -lt 20 ]; then
  info "Node.js $(node --version 2>/dev/null || echo '?') is too old: version 20 or later is required."
  node_help
  exit 1
fi
info "✓ Node.js $(node --version)"

# 2. the agent: downloaded next to the old one, checked, then put in place in one move
mkdir -p "$BIN_DIR"
chmod 700 "$ARCHIVE_HOME" 2>/dev/null || true
TMP="$BIN_DIR/.archive-node.mjs.$$"
trap 'rm -f "$TMP"' EXIT
trap 'rm -f "$TMP"; exit 130' INT TERM
case "$NODE_URL" in
  http://localhost* | http://127.0.0.1*) ;;
  http://*)
    fail "refusing to download the agent over plain HTTP ($NODE_URL): use an https:// address (the code could be changed on the way)."
    ;;
esac
case "$NODE_URL" in
  http://* | https://*)
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$NODE_URL" -o "$TMP" || fail "download failed: $NODE_URL"
    elif command -v wget >/dev/null 2>&1; then
      wget -q -O "$TMP" "$NODE_URL" || fail "download failed: $NODE_URL"
    else
      fail "curl or wget is needed to download the agent."
    fi
    ;;
  file://*)
    cp "${NODE_URL#file://}" "$TMP" 2>/dev/null || fail "file not found: ${NODE_URL#file://}"
    ;;
  *)
    cp "$NODE_URL" "$TMP" 2>/dev/null || fail "file not found: $NODE_URL"
    ;;
esac
# safeguard: this is really the agent, not an error page
head -n 1 "$TMP" | grep -q '^#!/usr/bin/env node' || fail "the file received is not the archive-node agent: $NODE_URL"
# fingerprint: always printed; required if ARCHIVE_NODE_SHA256 is given (nothing is replaced if it differs)
GOT_SHA=$(sha256_of "$TMP") || fail "could not compute the agent's SHA-256 fingerprint."
info "SHA-256 fingerprint of the downloaded agent: $GOT_SHA"
if [ -n "$WANT_SHA" ]; then
  if [ "$GOT_SHA" != "$WANT_SHA" ]; then
    fail "fingerprint differs from ARCHIVE_NODE_SHA256 (expected $WANT_SHA): agent NOT installed, the old one stays in place."
  fi
  info "✓ fingerprint matches ARCHIVE_NODE_SHA256"
else
  info "  (not checked: compare it with a fingerprint published SOMEWHERE ELSE than this server, or run again with ARCHIVE_NODE_SHA256=<fingerprint>)"
fi
chmod 755 "$TMP"
mv -f "$TMP" "$BIN_DIR/archive-node.mjs"
# "archive-node": a link to the .mjs (Node then reads it as an ES module, whatever its version)
ln -sf archive-node.mjs "$BIN_DIR/archive-node"
VERSION=$("$BIN_DIR/archive-node" --version 2>/dev/null) || fail "the agent doesn't start with Node.js $(node --version)."
info "✓ archive-node $VERSION installed: $BIN_DIR/archive-node"

# 3. the PATH (a hint only: the script doesn't modify your shell files)
case ":$PATH:" in
  *":$BIN_DIR:"*)
    CMD="archive-node"
    ;;
  *)
    CMD="$BIN_DIR/archive-node"
    case "${SHELL:-}" in
      */zsh) RC="$HOME/.zshrc" ;;
      */bash) if [ "$(uname -s)" = Darwin ]; then RC="$HOME/.bash_profile"; else RC="$HOME/.bashrc"; fi ;;
      */fish) RC="" ;;
      *) RC="$HOME/.profile" ;;
    esac
    info ""
    info "To simply type \"archive-node\", add $BIN_DIR to your PATH:"
    if [ -n "$RC" ]; then
      info "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> $RC && export PATH=\"$BIN_DIR:\$PATH\""
    else
      info "  fish_add_path $BIN_DIR"
    fi
    ;;
esac

# 4. checking the machine (does not stop the installation)
info ""
ARCHIVE_INSTALLING=1 "$BIN_DIR/archive-node" doctor </dev/null || true

# 5. what's next
API_OPT=""
if [ -n "${ARCHIVE_API:-}" ]; then API_OPT=" --api $ARCHIVE_API"; fi
info ""
info "Next step: pair this machine with your wallet"
info "  $CMD pair$API_OPT"
