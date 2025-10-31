#!/usr/bin/env bash
set -euo pipefail

# Package the VS Code extension and archive any existing VSIX
# Usage: bash scripts/package-vsix.sh
# Options via env vars:
#   BUMP=patch|minor|major|prerelease   (default: patch)
#   PREID=<label>                        (used when BUMP=prerelease, e.g. PREID=alpha)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT_DIR/extensions/claude-throne"
ARCHIVE_DIR="$ROOT_DIR/.archive/tests/compiled"

mkdir -p "$ARCHIVE_DIR"

# Read name and version from extension package.json via node
NAME="$(node -e "console.log(require('$EXT_DIR/package.json').name)")"
VERSION_BEFORE="$(node -e "console.log(require('$EXT_DIR/package.json').version)")"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"

# Archive any existing VSIX files in the extension folder
shopt -s nullglob
for f in "$EXT_DIR"/*.vsix; do
  base="$(basename "$f" .vsix)"
  dest="$ARCHIVE_DIR/${base}-v${VERSION_BEFORE}-${TIMESTAMP}.vsix"
  echo "Archiving existing VSIX: $f -> $dest"
  mv "$f" "$dest"
done
shopt -u nullglob

# Optionally bump version
BUMP_MODE="${BUMP:-patch}"
echo "Bumping version: $BUMP_MODE"
if [[ "$BUMP_MODE" == "prerelease" ]]; then
  PREID_VAL="${PREID:-alpha}"
  (cd "$EXT_DIR" && npm version prerelease --preid "$PREID_VAL" --no-git-tag-version >/dev/null)
else
  (cd "$EXT_DIR" && npm version "$BUMP_MODE" --no-git-tag-version >/dev/null)
fi

VERSION_AFTER="$(node -e "console.log(require('$EXT_DIR/package.json').version)")"
echo "Extension version: $VERSION_BEFORE -> $VERSION_AFTER"

ROOT_VERSION_BEFORE="$(node -e "console.log(require('$ROOT_DIR/package.json').version)")"
if [[ "$ROOT_VERSION_BEFORE" != "$VERSION_AFTER" ]]; then
  echo "Syncing root package version: $ROOT_VERSION_BEFORE -> $VERSION_AFTER"
  (cd "$ROOT_DIR" && npm version "$VERSION_AFTER" --no-git-tag-version --allow-same-version >/dev/null)
fi

# Build new VSIX
echo "Installing dependencies..."
npm install --prefix "$EXT_DIR" >/dev/null

echo "Running prepublish script (bundles proxy and compiles TypeScript)..."
npm run --prefix "$EXT_DIR" vscode:prepublish

echo "Packaging VSIX..."
npm run --prefix "$EXT_DIR" package

NEW_VSIX=("$EXT_DIR"/*.vsix)
if [[ ${#NEW_VSIX[@]} -eq 0 ]]; then
  echo "Error: Packaging did not produce a VSIX file" >&2
  exit 1
fi

# Ensure VSIX is in the extensions/claude-throne directory specifically
VSIX_FILE="${NEW_VSIX[0]}"
VSIX_BASENAME=$(basename "$VSIX_FILE")
EXPECTED_PATH="$EXT_DIR/$VSIX_BASENAME"

if [[ "$VSIX_FILE" != "$EXPECTED_PATH" ]]; then
  echo "Moving VSIX to correct location: $VSIX_FILE -> $EXPECTED_PATH"
  mv "$VSIX_FILE" "$EXPECTED_PATH"
  VSIX_FILE="$EXPECTED_PATH"
fi

echo "Success: $VSIX_FILE"
echo "VSIX created at: extensions/claude-throne/$VSIX_BASENAME"

