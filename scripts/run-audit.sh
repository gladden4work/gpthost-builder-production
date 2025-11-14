#!/bin/bash
# Run Project Owner ID Audit
# This script deploys a temporary Worker to audit projects in R2

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "🔍 Project Owner ID Audit"
echo "================================"
echo ""

# Create temporary worker config for audit
TEMP_WORKER_DIR=$(mktemp -d)
TEMP_CONFIG="$TEMP_WORKER_DIR/wrangler.toml"

# Copy the audit script
cp scripts/audit-projects.ts "$TEMP_WORKER_DIR/index.ts"

# Create minimal wrangler.toml
cat > "$TEMP_CONFIG" << 'EOF'
name = "gpthost-audit-temp"
main = "index.ts"
compatibility_date = "2025-08-09"

[[r2_buckets]]
binding = "PROJECTS_BUCKET"
bucket_name = "gpthost-projects-staging"
EOF

echo "📦 Deploying temporary audit worker..."
cd "$TEMP_WORKER_DIR"
wrangler deploy --config "$TEMP_CONFIG" > /dev/null 2>&1

echo "🚀 Running audit..."
WORKER_URL=$(wrangler deployments list --name gpthost-audit-temp 2>/dev/null | grep -oE 'https://[^[:space:]]+' | head -1)

if [ -z "$WORKER_URL" ]; then
  # Fallback: construct URL from worker name
  WORKER_URL="https://gpthost-audit-temp.gladden4work.workers.dev"
fi

echo "📊 Fetching audit report from $WORKER_URL..."
REPORT=$(curl -s "$WORKER_URL")

# Save report to file
REPORT_FILE="$PROJECT_DIR/migration-audit-$(date +%Y%m%d-%H%M%S).json"
echo "$REPORT" > "$REPORT_FILE"

echo "✅ Audit complete!"
echo "📄 Report saved to: $REPORT_FILE"
echo ""

# Pretty print summary
echo "$REPORT" | node -e "
const report = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log('📊 SUMMARY:');
console.log('  Total Projects:       ', report.totalProjects);
console.log('  ✅ Has Owner ID:      ', report.hasOwner);
console.log('  🔄 Needs Migration:   ', report.needsMigration);
console.log('  ❌ Errors:            ', report.errors);
console.log('  ⚠️  Malformed:         ', report.malformed);
console.log('');
if (report.needsMigration > 0) {
  console.log('🔄 Projects needing migration:');
  report.summary.needsMigrationList.forEach((id, i) => {
    if (i < 10) console.log('  -', id);
  });
  if (report.needsMigration > 10) {
    console.log('  ... and', report.needsMigration - 10, 'more');
  }
}
"

# Cleanup
echo ""
echo "🧹 Cleaning up temporary worker..."
cd "$TEMP_WORKER_DIR"
wrangler delete --name gpthost-audit-temp --force > /dev/null 2>&1 || true

# Remove temp directory
rm -rf "$TEMP_WORKER_DIR"

echo "✨ Done!"
echo ""
echo "💡 Next step: Run migration with 'npm run migrate:owner-id'"
