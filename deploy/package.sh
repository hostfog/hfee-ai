#!/usr/bin/env bash
# Builds hfee-ai-server.tar.gz: the website, Linux builds of HFee and the installer.
#
#   HFEE_SRC=../hfee bash deploy/package.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HFEE_SRC="$(cd "${HFEE_SRC:-$ROOT/../hfee}" && pwd)"
OUT="$ROOT/hfee-ai-server"

rm -rf "$OUT"
mkdir -p "$OUT/bin" "$OUT/site"

(cd "$ROOT" && npm ci --no-audit --no-fund --loglevel=error && npm run build)
cp -r "$ROOT/dist" "$ROOT/server" "$ROOT/package.json" "$ROOT/package-lock.json" "$OUT/site/"

for arch in amd64 arm64; do
  (cd "$HFEE_SRC" && CGO_ENABLED=0 GOOS=linux GOARCH=$arch go build -trimpath -ldflags="-s -w" -o "$OUT/bin/hfee-linux-$arch" ./cmd/hfee)
done

cp "$ROOT/deploy/install.sh" "$ROOT/deploy/engines.sh" "$OUT/"
tar -czf "$ROOT/hfee-ai-server.tar.gz" -C "$ROOT" hfee-ai-server
rm -rf "$OUT"
echo "Created $ROOT/hfee-ai-server.tar.gz"
