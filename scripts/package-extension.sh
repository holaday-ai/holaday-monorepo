#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT_DIR/apps/extension"
DIST_DIR="$EXT_DIR/dist"
RELEASE_DIR="$EXT_DIR/release"
STAGING_DIR="$RELEASE_DIR/chrome-extension"

cd "$ROOT_DIR"

echo "→ Building extension"
pnpm --filter @holaday/extension build

if [[ ! -f "$DIST_DIR/manifest.json" ]]; then
  echo "manifest.json missing from $DIST_DIR" >&2
  exit 1
fi

VERSION="$(node -e "console.log(require('$DIST_DIR/manifest.json').version)")"
ZIP_PATH="$RELEASE_DIR/holaday-extension-$VERSION.zip"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$RELEASE_DIR"

echo "→ Staging Chrome Web Store package"
rsync -a --delete \
  --exclude='*.map' \
  --exclude='.vite/' \
  "$DIST_DIR/" "$STAGING_DIR/"

node <<'NODE'
const fs = require('fs');
const path = require('path');

const staging = path.resolve(process.cwd(), 'apps/extension/release/chrome-extension');
const promoSmallPath = path.resolve(process.cwd(), 'apps/extension/store-assets/promo-small.png');
const screenshotPath = path.resolve(
  process.cwd(),
  'apps/extension/store-assets/screenshot-browser-connection.png',
);
const manifestPath = path.join(staging, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const requiredIcons = ['16', '32', '48', '128'];

if (!manifest.name || !manifest.description || !manifest.version) {
  throw new Error('manifest is missing name, description, or version');
}

for (const size of requiredIcons) {
  const iconPath = manifest.icons?.[size];
  if (!iconPath) {
    throw new Error(`manifest is missing ${size}px icon`);
  }
  if (!fs.existsSync(path.join(staging, iconPath))) {
    throw new Error(`icon file missing from package: ${iconPath}`);
  }
}

function readPngSize(filePath) {
  const body = fs.readFileSync(filePath);
  if (body.length < 24 || body.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`not a PNG file: ${filePath}`);
  }
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

const promoSize = readPngSize(promoSmallPath);
if (promoSize.width !== 440 || promoSize.height !== 280) {
  throw new Error(
    `small promotional image must be 440x280, got ${promoSize.width}x${promoSize.height}`,
  );
}

const screenshotSize = readPngSize(screenshotPath);
const validScreenshot =
  (screenshotSize.width === 1280 && screenshotSize.height === 800) ||
  (screenshotSize.width === 640 && screenshotSize.height === 400);
if (!validScreenshot) {
  throw new Error(
    `store screenshot must be 1280x800 or 640x400, got ${screenshotSize.width}x${screenshotSize.height}`,
  );
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.name.endsWith('.map')) {
      throw new Error(`source map leaked into release package: ${fullPath}`);
    }
    if (entry.name.endsWith('.js')) {
      const body = fs.readFileSync(fullPath, 'utf8');
      if (/sourceMappingURL=/.test(body)) {
        throw new Error(`sourceMappingURL leaked into release package: ${fullPath}`);
      }
    }
  }
}

walk(staging);
NODE

rm -f "$ZIP_PATH"
(
  cd "$STAGING_DIR"
  zip -qr "$ZIP_PATH" .
)

echo "✓ Chrome Web Store package ready: $ZIP_PATH"
