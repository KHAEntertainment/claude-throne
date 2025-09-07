#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3000}"
BASE_URL="http://localhost:${PORT}"

echo "Starting smoke test against ${BASE_URL}..." >&2

curl -s "${BASE_URL}/v1/messages" \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hi"}],"stream":false}' | jq .

echo "\nSmoke test completed." >&2

