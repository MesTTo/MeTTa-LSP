#!/usr/bin/env bash
# Build the MeTTa language server so dist/server/server.js exists.
# Run from the repo root:  bash build-lsp-server.sh
set -euo pipefail

cd "$(dirname "$0")"

echo ">> Installing dependencies (npm install)..."
npm install

echo ">> Compiling TypeScript to dist/ (npm run compile)..."
npm run compile

echo ">> Done. Language server entry point:"
echo "   $(pwd)/dist/server/server.js"
ls -l dist/server/server.js
