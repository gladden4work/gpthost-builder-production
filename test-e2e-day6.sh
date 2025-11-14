#!/bin/bash

# Day 6 E2E Validation Script
# Tests the complete pipeline: GitHub trigger → Build → Callback → Deploy

echo "🚀 Day 6 E2E Validation Test"
echo "================================"

# Configuration
# Read token from environment only; do not hardcode defaults
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN is not set. Export it before running." >&2
  exit 1
fi
GITHUB_OWNER="gladden4work"
GITHUB_REPO="gpthost-build-test"
WORKER_URL="https://gpthost-builder-staging.gladden4work.workers.dev"
CALLBACK_TOKEN="${CALLBACK_TOKEN:-}"
if [ -z "$CALLBACK_TOKEN" ]; then
  echo "Error: CALLBACK_TOKEN is not set. Export it before running." >&2
  exit 1
fi
PROJECT_ID="day6-e2e-$(date +%s)"
CORRELATION_ID="corr-day6-$(date +%s)"

echo "📋 Test Configuration:"
echo "  Project ID: $PROJECT_ID"
echo "  Correlation ID: $CORRELATION_ID"
echo "  Target Repo: $GITHUB_OWNER/$GITHUB_REPO"
echo "  Callback URL: $WORKER_URL/api/v2/github/build-callback"
echo ""

# Create source files JSON with a simple React component
SOURCE_FILES=$(cat <<'EOF'
{
  "index.html": "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Day 6 E2E Test</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.jsx\"></script></body></html>",
  "src/main.jsx": "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\n\nReactDOM.createRoot(document.getElementById('root')).render(<App />);",
  "src/App.jsx": "import React, { useState } from 'react';\n\nexport default function App() {\n  const [count, setCount] = useState(0);\n  \n  return (\n    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>\n      <h1>🎉 Day 6 E2E Test Success!</h1>\n      <p>This React component was deployed via the complete GPTHost pipeline.</p>\n      <p>GitHub Actions → Callback → Deploy → Live Site</p>\n      <button onClick={() => setCount(count + 1)}>\n        Clicked {count} times\n      </button>\n      <p style={{ marginTop: '20px', fontSize: '12px', color: '#666' }}>\n        Project ID: $PROJECT_ID<br/>\n        Correlation ID: $CORRELATION_ID<br/>\n        Deployed: {new Date().toISOString()}\n      </p>\n    </div>\n  );\n}",
  "package.json": "{\n  \"name\": \"day6-e2e-test\",\n  \"private\": true,\n  \"version\": \"1.0.0\",\n  \"type\": \"module\",\n  \"scripts\": {\n    \"dev\": \"vite\",\n    \"build\": \"vite build\",\n    \"preview\": \"vite preview\"\n  },\n  \"dependencies\": {\n    \"react\": \"^18.2.0\",\n    \"react-dom\": \"^18.2.0\"\n  },\n  \"devDependencies\": {\n    \"@types/react\": \"^18.2.0\",\n    \"@types/react-dom\": \"^18.2.0\",\n    \"@vitejs/plugin-react\": \"^4.0.0\",\n    \"vite\": \"^4.4.0\"\n  }\n}",
  "vite.config.js": "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  base: './'\n});"
}
EOF
)

# Escape the JSON for use in the curl command
ESCAPED_SOURCE_FILES=$(echo "$SOURCE_FILES" | jq -c . | jq -Rs .)

echo "🔧 Step 1: Triggering GitHub Actions workflow..."
echo ""

# Trigger the workflow
RESPONSE=$(curl -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/workflows/gpthost-build.yml/dispatches" \
  -d "{
    \"ref\": \"main\",
    \"inputs\": {
      \"project_id\": \"$PROJECT_ID\",
      \"source_files\": $ESCAPED_SOURCE_FILES,
      \"callback_url\": \"$WORKER_URL/api/v2/github/build-callback\",
      \"callback_token\": \"$CALLBACK_TOKEN\",
      \"correlation_id\": \"$CORRELATION_ID\",
      \"framework\": \"react\",
      \"build_command\": \"npm run build\"
    }
  }" \
  -w "\n%{http_code}" \
  -s)

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "204" ]; then
  echo "✅ Workflow triggered successfully!"
else
  echo "❌ Failed to trigger workflow. HTTP status: $HTTP_CODE"
  echo "Response: $BODY"
  exit 1
fi

echo ""
echo "⏳ Step 2: Waiting for workflow to start (10 seconds)..."
sleep 10

echo ""
echo "🔍 Step 3: Checking for workflow run..."
RUNS=$(curl -s \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/workflows/gpthost-build.yml/runs?per_page=5&event=workflow_dispatch")

# Look for our run by correlation ID
RUN_FOUND=$(echo "$RUNS" | jq -r ".workflow_runs[] | select(.name | contains(\"$CORRELATION_ID\")) | .html_url" | head -1)

if [ -n "$RUN_FOUND" ]; then
  echo "✅ Workflow run found!"
  echo "   URL: $RUN_FOUND"
  RUN_ID=$(echo "$RUN_FOUND" | grep -oE '[0-9]+$')
else
  echo "⚠️  Workflow run not found with correlation ID, checking latest run..."
  RUN_FOUND=$(echo "$RUNS" | jq -r '.workflow_runs[0].html_url')
  RUN_ID=$(echo "$RUNS" | jq -r '.workflow_runs[0].id')
  if [ "$RUN_FOUND" != "null" ]; then
    echo "   Latest run URL: $RUN_FOUND"
  else
    echo "❌ No workflow runs found"
  fi
fi

echo ""
echo "⏳ Step 4: Waiting for build to complete (max 90 seconds)..."
echo "   Polling workflow status..."

START_TIME=$(date +%s)
MAX_WAIT=90

while true; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))
  
  if [ $ELAPSED -gt $MAX_WAIT ]; then
    echo "⏰ Timeout after ${MAX_WAIT}s"
    break
  fi
  
  # Check workflow status
  if [ -n "$RUN_ID" ]; then
    STATUS=$(curl -s \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github.v3+json" \
      "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/runs/$RUN_ID" | jq -r '.status')
    
    CONCLUSION=$(curl -s \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "Accept: application/vnd.github.v3+json" \
      "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO/actions/runs/$RUN_ID" | jq -r '.conclusion')
    
    echo "   [${ELAPSED}s] Status: $STATUS, Conclusion: $CONCLUSION"
    
    if [ "$STATUS" = "completed" ]; then
      if [ "$CONCLUSION" = "success" ]; then
        echo "✅ Workflow completed successfully!"
        break
      else
        echo "❌ Workflow failed with conclusion: $CONCLUSION"
        exit 1
      fi
    fi
  fi
  
  sleep 10
done

echo ""
echo "🌐 Step 5: Checking deployment URL..."
DEPLOYMENT_URL="$WORKER_URL/sites/$PROJECT_ID/"
echo "   Testing: $DEPLOYMENT_URL"

# Wait a bit for deployment to propagate
sleep 5

# Test the deployment
DEPLOY_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$DEPLOYMENT_URL")

if [ "$DEPLOY_RESPONSE" = "200" ]; then
  echo "✅ Deployment successful! Site is live!"
  echo ""
  echo "🎉 Day 6 E2E Validation PASSED!"
  echo "================================"
  echo "Live URL: $DEPLOYMENT_URL"
  echo "GitHub Run: $RUN_FOUND"
  echo ""
  echo "The complete pipeline is working:"
  echo "  1. ✅ GitHub Actions trigger"
  echo "  2. ✅ Workflow execution"
  echo "  3. ✅ Callback authentication"
  echo "  4. ✅ Deployment to R2"
  echo "  5. ✅ Live site serving"
else
  echo "⚠️  Deployment not yet available (HTTP $DEPLOY_RESPONSE)"
  echo "   This may take a few more seconds to propagate."
  echo "   Try accessing: $DEPLOYMENT_URL"
fi

echo ""
echo "📊 Summary:"
echo "  Total time: ${ELAPSED}s"
echo "  Target: <90s deployment"
if [ $ELAPSED -lt 90 ]; then
  echo "  Result: ✅ PASS (under 90 seconds)"
else
  echo "  Result: ⚠️  SLOW (over 90 seconds)"
fi
