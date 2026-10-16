#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# package.json is the canonical release version, including prerelease metadata.
RELEASE_VERSION="$(node -p "require('./package.json').version")"
if [[ ! "$RELEASE_VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
  printf 'Invalid package.json release version: %s\n' "$RELEASE_VERSION" >&2
  exit 1
fi
SHORT_VERSION="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.${BASH_REMATCH[3]}"
APP="${RET_APP_OUTPUT:-$ROOT/build/releases/$RELEASE_VERSION/ReT Markdown.app}"
export npm_config_cache=/private/tmp/ret-markdown-npm
export CLANG_MODULE_CACHE_PATH=/private/tmp/ret-clang
export SWIFTPM_MODULECACHE_OVERRIDE=/private/tmp/ret-clang
npm run build:web
mkdir -p Sources/ReTMarkdown/Resources/Web
rsync -a --delete build/web/ Sources/ReTMarkdown/Resources/Web/
CONFIGURATION="${CONFIGURATION:-release}"
swift build --disable-sandbox --scratch-path build/swift --cache-path /private/tmp/ret-swiftpm -c "$CONFIGURATION"
BIN_PATH="$(swift build --disable-sandbox --scratch-path build/swift --cache-path /private/tmp/ret-swiftpm -c "$CONFIGURATION" --show-bin-path)"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Resources/Info.plist "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $SHORT_VERSION" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :ReTReleaseVersion string $RELEASE_VERSION" "$APP/Contents/Info.plist"
# CFBundleVersion remains the numeric build number from Resources/Info.plist.
cp "$BIN_PATH/ReTMarkdown" "$APP/Contents/MacOS/ReTMarkdown"
# SwiftPM Bundle.module searches Bundle.main.resourceURL first.
# Remove the redundant resource copy produced by earlier development assemblies.
rm -rf "$APP/Contents/MacOS/ReTMarkdown_ReTMarkdown.bundle"
for bundle in "$BIN_PATH"/*.bundle; do
  [ -d "$bundle" ] || continue
  ditto "$bundle" "$APP/Contents/Resources/$(basename "$bundle")"
done
codesign --force --deep --sign - "$APP"
printf '%s\n' "$APP"
