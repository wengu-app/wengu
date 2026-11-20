#!/usr/bin/env bash
# Local macOS signed + notarized build, verification, and GitHub Release publisher (wengu-app/downloads).
# Mirrors the macOS + release jobs in .github/workflows/desktop.yml without consuming GitHub Actions minutes.
#
# Required env (Keychain certificate + notarization):
#   CSC_NAME="kaixiang li (W3ZB9MVRQ3)"   (defaults to the Developer ID Application identity in your login keychain)
#   Either:
#     APPLE_API_KEY="/abs/path/AuthKey_XXXX.p8"
#     APPLE_API_KEY_ID="XXXX"
#     APPLE_API_ISSUER="uuid"
#   Or:
#     APPLE_KEYCHAIN_PROFILE="wengu-notary"
#
# Usage:
#   ./apps/desktop/scripts/release-mac-local.sh [--publish | --no-publish] [--notes "..."]
set -euo pipefail

PUBLISH=1
RELEASE_NOTES=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-publish) PUBLISH=0; shift ;;
    --publish) PUBLISH=1; shift ;;
    --notes) RELEASE_NOTES="${2:-}"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DESKTOP="$ROOT/apps/desktop"
DIST="$DESKTOP/dist"
VERSION="$(node -p "require('$DESKTOP/package.json').version")"
TAG="v$VERSION"

if [[ "$PUBLISH" -eq 1 ]] && gh release view "$TAG" -R wengu-app/downloads >/dev/null 2>&1; then
  echo "Release $TAG already exists in wengu-app/downloads; bump apps/desktop/package.json version first." >&2
  exit 1
fi

if [[ -z "${CSC_LINK:-}" && -z "${CSC_NAME:-}" ]]; then
  CSC_NAME="$(security find-identity -v -p codesigning | sed -n 's/.*"Developer ID Application: \([^"]*\)".*/\1/p' | head -1)"
  if [[ -z "$CSC_NAME" ]]; then
    echo "No Developer ID Application certificate found in Keychain; set CSC_NAME or CSC_LINK." >&2
    exit 1
  fi
  export CSC_NAME
fi
echo "== Signing identity: ${CSC_NAME:-CSC_LINK}"

# Ensure electron-builder's internal `pnpm list` finds a working pnpm even if the corepack shim is broken.
if ! pnpm --version >/dev/null 2>&1; then
  for cand in "$HOME"/.cache/node/corepack/v1/pnpm/*/pnpm; do
    if [[ -x "$cand" ]]; then
      export PATH="$(dirname "$cand"):$PATH"
      break
    fi
  done
fi

echo "== Testing Go MCP proxy"
(cd "$DESKTOP/mcp" && go test -v .)

echo "== Building web + desktop ($VERSION)"
(cd "$ROOT/apps/web" && ./node_modules/.bin/vite build)
(cd "$DESKTOP" && node scripts/build.mjs)

echo "== Packaging, signing and notarizing macOS (arm64 + x64)"
rm -rf "$DIST"
(cd "$DESKTOP" && WENGU_NOTARIZE=1 node scripts/package.mjs --mac)

echo "== Verifying signatures and MCP architectures"
for app in "$DIST/mac-arm64/Wengu.app" "$DIST/mac/Wengu.app"; do
  codesign --verify --deep --strict --verbose=2 "$app"
  mcp="$app/Contents/Resources/wengu-mcp"
  test -x "$mcp"
  codesign --verify --strict --verbose=2 "$mcp"
done
lipo -archs "$DIST/mac-arm64/Wengu.app/Contents/Resources/wengu-mcp" | grep -Fx 'arm64'
lipo -archs "$DIST/mac/Wengu.app/Contents/Resources/wengu-mcp" | grep -Fx 'x86_64'

echo "== Verifying notarization of distributables"
TMP_VERIFY="$(mktemp -d)"
trap 'rm -rf "$TMP_VERIFY"' EXIT

check_notary() {
  echo "  -> $1"
  xcrun stapler validate "$2"
  local assessment
  assessment="$(spctl --assess --type execute --verbose=4 "$2" 2>&1)"
  echo "$assessment"
  grep -Fxq 'source=Notarized Developer ID' <<< "$assessment"
}

for arch in arm64 x64; do
  dmg="$DIST/Wengu-$VERSION-mac-$arch.dmg"
  zip="$DIST/Wengu-$VERSION-mac-$arch.zip"
  mnt="$TMP_VERIFY/dmg-$arch"
  hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mnt" "$dmg" >/dev/null
  status=0
  check_notary "$(basename "$dmg")" "$mnt/Wengu.app" || status=$?
  hdiutil detach "$mnt" >/dev/null
  [[ "$status" -eq 0 ]] || { echo "Notarization check failed: $dmg" >&2; exit 1; }

  out="$TMP_VERIFY/zip-$arch"
  mkdir -p "$out"
  ditto -x -k "$zip" "$out"
  check_notary "$(basename "$zip")" "$out/Wengu.app"
done

ASSETS=(
  "$DIST/Wengu-$VERSION-mac-arm64.dmg"
  "$DIST/Wengu-$VERSION-mac-arm64.dmg.blockmap"
  "$DIST/Wengu-$VERSION-mac-arm64.zip"
  "$DIST/Wengu-$VERSION-mac-arm64.zip.blockmap"
  "$DIST/Wengu-$VERSION-mac-x64.dmg"
  "$DIST/Wengu-$VERSION-mac-x64.dmg.blockmap"
  "$DIST/Wengu-$VERSION-mac-x64.zip"
  "$DIST/Wengu-$VERSION-mac-x64.zip.blockmap"
  "$DIST/latest-mac.yml"
)
for f in "${ASSETS[@]}"; do
  test -f "$f" || { echo "Missing asset: $f" >&2; exit 1; }
done
head -1 "$DIST/latest-mac.yml" | tr -d '\r' | grep -Fx "version: $VERSION" >/dev/null

if [[ "$PUBLISH" -eq 0 ]]; then
  echo "== Dry run (--no-publish): verified all ${#ASSETS[@]} macOS assets in $DIST"
  exit 0
fi

NOTES_FILE="$TMP_VERIFY/release-notes.md"
if [[ -n "$RELEASE_NOTES" ]]; then
  printf '%s\n' "$RELEASE_NOTES" > "$NOTES_FILE"
else
  prev_commit="$(git -C "$ROOT" log -n 2 --format=%H -- apps/desktop/package.json | tail -1)"
  {
    echo "## 更新内容"
    echo ""
    if [[ -n "$prev_commit" && "$prev_commit" != "$(git -C "$ROOT" rev-parse HEAD)" ]]; then
      git -C "$ROOT" log --format='- %s' "${prev_commit}..HEAD"
    else
      git -C "$ROOT" log -n 1 --format='- %s' HEAD
    fi
    echo ""
    echo "本版本由本机 macOS 构建、签名并公证发布（仅含 macOS arm64 / x64）。已安装 0.1.1 及以后版本的 macOS 用户会在应用内收到更新。"
  } > "$NOTES_FILE"
fi

echo "== Publishing $TAG to wengu-app/downloads"
gh release create "$TAG" -R wengu-app/downloads \
  --title "温故 $VERSION" \
  --notes-file "$NOTES_FILE" \
  --latest \
  "${ASSETS[@]}"

published="$(curl -fsSL "https://github.com/wengu-app/downloads/releases/latest/download/latest-mac.yml" | head -1 | tr -d '\r')"
echo "== Published latest-mac.yml -> $published"
[[ "$published" == "version: $VERSION" ]] || { echo "Unexpected latest-mac.yml header: $published" >&2; exit 1; }
