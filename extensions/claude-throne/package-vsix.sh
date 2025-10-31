#!/bin/bash
set -e
set -x

cd "$(dirname "$0")"

VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "Starting VSIX packaging for version $VERSION..."
echo "Current directory: $(pwd)"
echo "Version in package.json: $VERSION"

echo "Step 1: Bundling proxy..."
npm run bundle:proxy

echo "Step 2: Compiling TypeScript..."
npm run compile

echo "Step 3: Packaging VSIX..."
npx vsce package

echo "Step 4: Verifying VSIX created..."
# VSIX filename is derived from package.json "name" field (now "thronekeeper")
if ls thronekeeper-$VERSION.vsix 2>/dev/null; then
    ls -lh thronekeeper-$VERSION.vsix
    echo "✅ VSIX created successfully!"
else
    echo "❌ VSIX not found!"
    ls -lh *.vsix | tail -3
    exit 1
fi

