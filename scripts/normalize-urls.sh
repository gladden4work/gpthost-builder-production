#!/usr/bin/env bash
set -euo pipefail

# One-time URL normalization script
# Rewrites old R2 links in project metadata to Worker URLs via API endpoint.

WORKER_BASE="${WORKER_BASE:-https://gpthost-builder-staging.gladden4work.workers.dev}"
TOKEN="${MVP_ACCESS_TOKEN:-}"

if [[ -z "$TOKEN" ]]; then
  echo "Error: MVP_ACCESS_TOKEN environment variable is required." >&2
  echo "Export it first, e.g.: export MVP_ACCESS_TOKEN=..." >&2
  exit 1
fi

URL="$WORKER_BASE/api/metadata/normalize-urls"
echo "Normalizing deployment URLs via: $URL"

HTTP_CODE=$(curl -sS -o /tmp/norm_out.json -w "%{http_code}" \
  -X POST "$URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

echo "HTTP $HTTP_CODE"
cat /tmp/norm_out.json | sed 's/\\n/\n/g' || true

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Normalization failed" >&2
  exit 1
fi

echo "Normalization completed successfully"

