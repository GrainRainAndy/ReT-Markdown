#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="0.2.0-alpha.1"
APP="$ROOT/build/rewrite/$VERSION/ReT Markdown Preview.app"
npm run build
swift build --package-path native -c release
BIN_DIR="$(swift build --package-path native -c release --show-bin-path)"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp "$BIN_DIR/ReTPreview" "$APP/Contents/MacOS/ReTPreview"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$APP/Contents/Resources/THIRD_PARTY_NOTICES.md"
# Only the isolated preview bundle is regenerated; historical output is never touched.
rsync -a --delete "$ROOT/dist/web/" "$APP/Contents/Resources/web/"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.retmarkdown.rewrite.preview</string>
<key>CFBundleName</key><string>ReT Markdown Preview</string>
<key>CFBundleDisplayName</key><string>ReT Markdown Preview</string>
<key>CFBundleExecutable</key><string>ReTPreview</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.2.0-alpha.1</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
<key>NSHumanReadableCopyright</key><string>ReT Markdown Preview</string>
<key>CFBundleDocumentTypes</key><array><dict>
<key>CFBundleTypeName</key><string>Markdown</string>
<key>CFBundleTypeRole</key><string>Editor</string>
<key>LSHandlerRank</key><string>Alternate</string>
<key>LSItemContentTypes</key><array><string>net.daringfireball.markdown</string><string>public.plain-text</string></array>
<key>NSDocumentClass</key><string>MarkdownDocument</string>
</dict></array>
<key>UTImportedTypeDeclarations</key><array><dict>
<key>UTTypeIdentifier</key><string>net.daringfireball.markdown</string>
<key>UTTypeDescription</key><string>Markdown</string>
<key>UTTypeConformsTo</key><array><string>public.plain-text</string></array>
<key>UTTypeTagSpecification</key><dict><key>public.filename-extension</key><array><string>md</string><string>markdown</string></array><key>public.mime-type</key><string>text/markdown</string></dict>
</dict></array>
</dict></plist>
PLIST
plutil -lint "$APP/Contents/Info.plist"
codesign --force --sign - "$APP"
codesign --verify --deep --strict "$APP"
printf '%s\n' "$APP"
