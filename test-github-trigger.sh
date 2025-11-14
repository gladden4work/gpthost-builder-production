#!/bin/bash

# Test GitHub Workflow Trigger - Day 6 System Integration
# This script tests the GitHub API integration end-to-end

set -e

echo "🔍 Testing GitHub Workflow Trigger Integration..."
echo "================================================"

# Configuration
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN is not set. Export it before running." >&2
  exit 1
fi
CALLBACK_TOKEN="${CALLBACK_TOKEN:-}"
if [ -z "$CALLBACK_TOKEN" ]; then
  echo "Error: CALLBACK_TOKEN is not set. Export it before running." >&2
  exit 1
fi
GITHUB_OWNER="gladden4work"
GITHUB_REPO="gpthost-build-test"
WORKFLOW_FILE="gpthost-build.yml"
PROJECT_ID="test-$(date +%s)"
CORRELATION_ID="corr-$(date +%s)"

echo "📋 Test Configuration:"
echo "  - Owner: $GITHUB_OWNER"
echo "  - Repo: $GITHUB_REPO"
echo "  - Workflow: $WORKFLOW_FILE"
echo "  - Project ID: $PROJECT_ID"
echo "  - Correlation ID: $CORRELATION_ID"
echo ""

# Step 1: Verify GitHub Token Permissions
echo "1️⃣ Verifying GitHub Token Permissions..."
SCOPES=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/user \
  -I | grep -i "x-oauth-scopes:" || echo "")
echo "   Token Scopes: $SCOPES"
echo ""

# Step 2: Check if workflow file exists
echo "2️⃣ Checking if workflow file exists..."
WORKFLOW_CHECK=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/contents/.github/workflows/$WORKFLOW_FILE" \
  | jq -r '.name // "not found"')

if [ "$WORKFLOW_CHECK" == "not found" ]; then
  echo "   ❌ Workflow file not found: $WORKFLOW_FILE"
  echo "   Please ensure .github/workflows/$WORKFLOW_FILE exists"
  exit 1
else
  echo "   ✅ Workflow file found: $WORKFLOW_CHECK"
fi
echo ""

# Step 3: Create test source files and build config JSON
echo "3️⃣ Creating test source files and build config..."
SOURCE_FILES=$(cat <<EOF
{
  "App.jsx": "export default function App() { return <div><h1>Test Project $PROJECT_ID</h1><p>Generated at $(date)</p></div>; }"
}
EOF
)
BUILD_CONFIG=$(cat <<EOF
{
  "framework": "react",
  "build_command": "npm run build",
  "node_version": "20"
}
EOF
)
echo "   Source files and build config created"
echo ""

# Step 4: Trigger workflow via GitHub API
echo "4️⃣ Triggering GitHub workflow..."
DISPATCH_RESPONSE=$(curl -s -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/workflows/$WORKFLOW_FILE/dispatches" \
  -d "{
    \"ref\": \"main\",
    \"inputs\": {
      \"project_id\": \"$PROJECT_ID\",
      \"source_files\": $(echo "$SOURCE_FILES" | jq -Rs .),
      \"build_config\": $(echo "$BUILD_CONFIG" | jq -Rs .),
      \"callback_url\": \"https://gpthost-builder-staging.gladden4work.workers.dev/api/v2/github/build-callback\",
      \"callback_token\": \"$CALLBACK_TOKEN\"
    }
  }" \
  -w "\nHTTP_STATUS:%{http_code}")

HTTP_STATUS=$(echo "$DISPATCH_RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

if [ "$HTTP_STATUS" == "204" ]; then
  echo "   ✅ Workflow dispatch successful (HTTP 204)"
else
  echo "   ❌ Workflow dispatch failed (HTTP $HTTP_STATUS)"
  echo "   Response: $DISPATCH_RESPONSE"
  exit 1
fi
echo ""

# Step 5: Wait and check for workflow run
echo "5️⃣ Waiting for workflow to start (5 seconds)..."
sleep 5

echo "   Checking for workflow runs..."
RUNS=$(curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/workflows/$WORKFLOW_FILE/runs?event=workflow_dispatch&per_page=5")

LATEST_RUN=$(echo "$RUNS" | jq -r '.workflow_runs[0] // {}')
RUN_ID=$(echo "$LATEST_RUN" | jq -r '.id // "not found"')
RUN_STATUS=$(echo "$LATEST_RUN" | jq -r '.status // "not found"')
RUN_URL=$(echo "$LATEST_RUN" | jq -r '.html_url // "not found"')

if [ "$RUN_ID" != "not found" ]; then
  echo "   ✅ Workflow run started!"
  echo "   - Run ID: $RUN_ID"
  echo "   - Status: $RUN_STATUS"
  echo "   - URL: $RUN_URL"
else
  echo "   ❌ No workflow run found"
  echo "   This might indicate the workflow didn't trigger"
fi
echo ""

# Step 6: Test via Worker API (if local server is running)
echo "6️⃣ Testing via Worker API (optional)..."
if curl -s http://localhost:8787/health > /dev/null 2>&1; then
  echo "   Local worker detected, testing API..."
  
  API_RESPONSE=$(curl -s -X POST http://localhost:8787/api/v2/projects \
    -H "Authorization: Bearer test-valid-token-12345" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"api-test-$PROJECT_ID\",
      \"framework\": \"react\",
      \"files\": [{
        \"path\": \"App.jsx\",
        \"content\": \"export default function App() { return <h1>API Test</h1>; }\"
      }],
      \"auto_build\": true
    }")
  
  SUCCESS=$(echo "$API_RESPONSE" | jq -r '.success // false')
  if [ "$SUCCESS" == "true" ]; then
    echo "   ✅ Worker API test successful"
    echo "   Response: $(echo "$API_RESPONSE" | jq -c .)"
  else
    echo "   ❌ Worker API test failed"
    echo "   Response: $API_RESPONSE"
  fi
else
  echo "   ⏭️  Skipping (worker not running locally)"
fi
echo ""

# Summary
echo "📊 Test Summary:"
echo "=================="
if [ "$RUN_ID" != "not found" ]; then
  echo "✅ GitHub workflow trigger is WORKING!"
  echo "   - Workflow dispatched successfully"
  echo "   - GitHub Actions run created"
  echo "   - View run at: $RUN_URL"
  echo ""
  echo "🎉 Day 6 Phase 1 Fix SUCCESSFUL!"
else
  echo "❌ GitHub workflow trigger FAILED"
  echo "   - Workflow dispatch returned 204 but no run created"
  echo "   - Check GitHub Actions tab for errors"
  echo "   - Verify workflow file and permissions"
fi
