#!/usr/bin/env bash
set -euo pipefail

# Package the VS Code extension and archive any existing VSIX
# Usage: bash scripts/package-vsix.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$ROOT_DIR/extensions/claude-throne"
ARCHIVE_DIR="$ROOT_DIR/.archive/tests/compiled"

mkdir -p "$ARCHIVE_DIR"

# Read name and version from extension package.json via node
NAME="$(node -e "console.log(require('$EXT_DIR/package.json').name)")"
VERSION="$(node -e "console.log(require('$EXT_DIR/package.json').version)")"
TIMESTAMP="$(date +%Y%m%d%H%M%S)"

# Archive any existing VSIX files in the extension folder
shopt -s nullglob
for f in "$EXT_DIR"/*.vsix; do
  base="$(basename "$f" .vsix)"
  dest="$ARCHIVE_DIR/${base}-v${VERSION}-${TIMESTAMP}.vsix"
  echo "Archiving existing VSIX: $f -> $dest"
  mv "$f" "$dest"
done
shopt -u nullglob

# Build new VSIX
echo "Installing dependencies..."
npm install --prefix "$EXT_DIR"

echo "Compiling TypeScript..."
npm run --prefix "$EXT_DIR" compile

echo "Packaging VSIX..."
npm run --prefix "$EXT_DIR" package

NEW_VSIX=("$EXT_DIR"/*.vsix)
if [[ ${#NEW_VSIX[@]} -eq 0 ]]; then
  echo "Error: Packaging did not produce a VSIX file" >&2
  exit 1
fi

echo "Success: ${NEW_VSIX[0]}"

