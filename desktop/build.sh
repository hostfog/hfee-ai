#!/usr/bin/env bash
# Builds the HFee AI desktop app for one platform into desktop/build/.
#
#   HFEE_SRC=../hfee bash desktop/build.sh linux amd64     # .tar.gz and .deb
#   HFEE_SRC=../hfee bash desktop/build.sh darwin arm64    # .dmg (on a Mac) or .zip
#   HFEE_SRC=../hfee bash desktop/build.sh windows amd64   # folder for Inno Setup, and .zip
set -euo pipefail

GOOS_=${1:?os: linux, darwin or windows}
ARCH=${2:?arch: amd64 or arm64}
NODE_VERSION=22.23.4

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HFEE_SRC="$(cd "${HFEE_SRC:-$ROOT/../hfee}" && pwd)"
VERSION="${VERSION:-$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")}"
BUILD="$ROOT/desktop/build"
STAGE="$BUILD/$GOOS_-$ARCH"
mkdir -p "$BUILD"
rm -rf "$STAGE"

# Where the launcher, runner, Node.js and site go inside the package.
case "$GOOS_" in
  darwin)
    APP="$STAGE/HFee AI.app"
    BIN="$APP/Contents/MacOS"
    RES="$APP/Contents/Resources"
    ;;
  linux | windows)
    BIN="$STAGE/hfee-ai"
    RES="$BIN"
    ;;
  *) echo "unknown os: $GOOS_" >&2; exit 1 ;;
esac
mkdir -p "$BIN" "$RES/node" "$RES/site"
ext=""
[[ "$GOOS_" == windows ]] && ext=.exe

echo "==> Website"
(cd "$ROOT" && npm ci --no-audit --no-fund --loglevel=error && npm run build >/dev/null)
cp -r "$ROOT/dist" "$ROOT/server" "$ROOT/package.json" "$ROOT/package-lock.json" "$RES/site/"
(cd "$RES/site" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)

echo "==> HFee runner and launcher"
export CGO_ENABLED=0 GOOS=$GOOS_ GOARCH=$ARCH
(cd "$HFEE_SRC" && go build -trimpath -ldflags="-s -w" -o "$RES/hfee$ext" ./cmd/hfee)
ldflags="-s -w"
[[ "$GOOS_" == windows ]] && ldflags="$ldflags -H=windowsgui"
(cd "$ROOT/desktop/launcher" && go build -trimpath -ldflags="$ldflags" -o "$BIN/hfee-ai$ext" .)
unset CGO_ENABLED GOOS GOARCH

echo "==> Node.js $NODE_VERSION"
node_arch=${ARCH/amd64/x64}
node_os=${GOOS_/windows/win}
dist="node-v$NODE_VERSION-$node_os-$node_arch"
tmp="$(mktemp -d)"
if [[ "$GOOS_" == windows ]]; then
  curl -fsSL -o "$tmp/node.zip" "https://nodejs.org/dist/v$NODE_VERSION/$dist.zip"
  unzip -q -j "$tmp/node.zip" "$dist/node.exe" -d "$RES/node"
else
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$dist.tar.gz" | tar -xz -C "$tmp" "$dist/bin/node"
  install -m 755 "$tmp/$dist/bin/node" "$RES/node/node"
fi
rm -rf "$tmp"

echo "==> Package"
cd "$BUILD"
case "$GOOS_" in
  linux)
    cp "$ROOT/desktop/assets/icon.png" "$BIN/icon.png"
    tar -czf "hfee-ai-$VERSION-linux-$ARCH.tar.gz" -C "$STAGE" hfee-ai

    deb="$STAGE/deb"
    mkdir -p "$deb/DEBIAN" "$deb/opt" "$deb/usr/bin" "$deb/usr/share/applications" "$deb/usr/share/icons/hicolor/512x512/apps"
    cp -r "$BIN" "$deb/opt/hfee-ai"
    ln -s /opt/hfee-ai/hfee-ai "$deb/usr/bin/hfee-ai"
    cp "$ROOT/desktop/linux/hfee-ai.desktop" "$deb/usr/share/applications/"
    cp "$ROOT/desktop/assets/icon.png" "$deb/usr/share/icons/hicolor/512x512/apps/hfee-ai.png"
    sed -e "s/@VERSION@/$VERSION/" -e "s/@ARCH@/$ARCH/" "$ROOT/desktop/linux/control" >"$deb/DEBIAN/control"
    dpkg-deb --root-owner-group -Zxz --build "$deb" "hfee-ai_${VERSION}_$ARCH.deb" >/dev/null
    rm -rf "$deb"
    ;;
  darwin)
    cp "$ROOT/desktop/assets/icon.icns" "$RES/icon.icns"
    sed "s/@VERSION@/$VERSION/g" "$ROOT/desktop/macos/Info.plist" >"$APP/Contents/Info.plist"
    out="hfee-ai-$VERSION-macos-$ARCH"
    if command -v codesign >/dev/null; then
      codesign --force --deep --sign - "$APP" # ad-hoc; a Developer ID removes the first-open warning
    fi
    if command -v hdiutil >/dev/null; then
      ln -s /Applications "$STAGE/Applications"
      hdiutil create -quiet -volname "HFee AI" -srcfolder "$STAGE" -ov -format UDZO "$out.dmg"
      rm "$STAGE/Applications"
    else
      (cd "$STAGE" && zip -qry "$BUILD/$out.zip" "HFee AI.app")
    fi
    ;;
  windows)
    cp "$ROOT/desktop/assets/icon.ico" "$BIN/icon.ico"
    out="$BUILD/hfee-ai-$VERSION-windows-$ARCH.zip"
    if command -v zip >/dev/null; then
      (cd "$STAGE" && zip -qr "$out" hfee-ai)
    else # Git Bash on Windows has no zip
      powershell -NoProfile -Command "Compress-Archive -Force -Path '$(cygpath -w "$BIN")' -DestinationPath '$(cygpath -w "$out")'"
    fi
    ;;
esac
echo "Done: $BUILD"
