#!/bin/bash

# E2E Timing Test - Measure actual pipeline performance
# This will test the real end-to-end flow with GitHub Actions

set -e

echo "🚀 Testing Actual E2E Deployment Pipeline"
echo "========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
PROJECT_ID="e2e-timing-test-$(date +%s)"
WORKER_URL="http://localhost:8787"
API_TOKEN="test-valid-token-12345"  # From .dev.vars
GITHUB_REPO="gladden4work/gpthost-build-test"
GITHUB_WORKFLOW="gpthost-build.yml"
GITHUB_TOKEN="${GITHUB_TOKEN}"

echo -e "${BLUE}Test Configuration:${NC}"
echo "  Project ID: $PROJECT_ID"
echo "  Worker URL: $WORKER_URL"
echo "  GitHub Repo: $GITHUB_REPO"
echo ""

# Track timing
TIMING_LOG=""
START_TIME=$(date +%s%N)

# Function to record timing
record_time() {
    local phase=$1
    local current_time=$(date +%s%N)
    local elapsed=$(( ($current_time - $START_TIME) / 1000000 ))
    TIMING_LOG="${TIMING_LOG}${phase}:${elapsed}ms\n"
    echo -e "${GREEN}✓ $phase completed in ${elapsed}ms${NC}"
}

# Step 1: Create Project
echo -e "${YELLOW}Step 1: Creating project via API...${NC}"
PHASE_START=$(date +%s%N)

CREATE_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/v2/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "X-Request-ID: e2e-test-$(date +%s)" \
  -d '{
    "projectId": "'"$PROJECT_ID"'",
    "name": "E2E Timing Test",
    "framework": "react",
    "sourceFiles": {
      "App.tsx": "import React from \"react\";\n\nexport default function App() {\n  return (\n    <div style={{ padding: \"20px\", fontFamily: \"Arial\" }}>\n      <h1>E2E Pipeline Test</h1>\n      <p>Testing actual deployment timing</p>\n      <p>Timestamp: '"$(date +%s)"'</p>\n    </div>\n  );\n}",
      "main.tsx": "import React from \"react\";\nimport ReactDOM from \"react-dom/client\";\nimport App from \"./App\";\n\nReactDOM.createRoot(document.getElementById(\"root\")!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);"
    }
  }')

record_time "Project Creation"
echo "Response: $CREATE_RESPONSE" | head -c 200
echo "..."
echo ""

# Step 2: Trigger GitHub Actions Build
echo -e "${YELLOW}Step 2: Triggering GitHub Actions workflow...${NC}"
PHASE_START=$(date +%s%N)

# Check if we have a GitHub token
if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${RED}❌ GITHUB_TOKEN not set. Cannot trigger workflow.${NC}"
    echo "Please set: export GITHUB_TOKEN=your_github_pat_token"
    exit 1
fi

# Prepare source files as JSON for GitHub Actions
SOURCE_FILES_JSON=$(echo '{
  "App.tsx": "import React from \"react\";\n\nexport default function App() {\n  return (\n    <div style={{ padding: \"20px\", fontFamily: \"Arial\" }}>\n      <h1>E2E Pipeline Test</h1>\n      <p>Testing actual deployment timing</p>\n      <p>Timestamp: '"$(date +%s)"'</p>\n    </div>\n  );\n}",
  "main.tsx": "import React from \"react\";\nimport ReactDOM from \"react-dom/client\";\nimport App from \"./App\";\n\nReactDOM.createRoot(document.getElementById(\"root\")!).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);"
}' | jq -c .)

# Trigger the workflow
WORKFLOW_RESPONSE=$(curl -s -X POST \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$GITHUB_REPO/actions/workflows/$GITHUB_WORKFLOW/dispatches" \
  -d '{
    "ref": "main",
    "inputs": {
      "project_id": "'"$PROJECT_ID"'",
      "source_files": '"$SOURCE_FILES_JSON"',
      "callback_url": "'"$WORKER_URL"'/api/v2/github/callback",
      "callback_token": "gpthost-test-token-2025",
      "correlation_id": "e2e-timing-'"$(date +%s)"'",
      "framework": "react"
    }
  }')

record_time "GitHub API Trigger"
echo ""

# Step 3: Wait for GitHub Actions to start
echo -e "${YELLOW}Step 3: Waiting for GitHub Actions to start...${NC}"
sleep 3

# Get the run ID (most recent run for our project)
RUN_INFO=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/$GITHUB_REPO/actions/runs?per_page=1" | jq -r '.workflow_runs[0]')

RUN_ID=$(echo "$RUN_INFO" | jq -r '.id')
RUN_URL=$(echo "$RUN_INFO" | jq -r '.html_url')

echo "GitHub Actions Run: $RUN_URL"
echo "Run ID: $RUN_ID"
record_time "GitHub Actions Started"
echo ""

# Step 4: Monitor GitHub Actions progress
echo -e "${YELLOW}Step 4: Monitoring GitHub Actions build...${NC}"
MAX_WAIT=180  # 3 minutes max
ELAPSED=0
INTERVAL=5

while [ $ELAPSED -lt $MAX_WAIT ]; do
    STATUS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
      "https://api.github.com/repos/$GITHUB_REPO/actions/runs/$RUN_ID" | jq -r '.status')
    
    CONCLUSION=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
      "https://api.github.com/repos/$GITHUB_REPO/actions/runs/$RUN_ID" | jq -r '.conclusion')
    
    echo -ne "\rStatus: $STATUS | Conclusion: $CONCLUSION | Elapsed: ${ELAPSED}s    "
    
    if [ "$STATUS" = "completed" ]; then
        echo ""
        if [ "$CONCLUSION" = "success" ]; then
            record_time "GitHub Actions Build Complete"
            echo -e "${GREEN}✅ Build successful!${NC}"
        else
            echo -e "${RED}❌ Build failed with conclusion: $CONCLUSION${NC}"
            exit 1
        fi
        break
    fi
    
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo ""
    echo -e "${RED}❌ Timeout waiting for build to complete${NC}"
    exit 1
fi
echo ""

# Step 5: Check if callback triggered deployment
echo -e "${YELLOW}Step 5: Checking if automatic deployment was triggered...${NC}"
sleep 2  # Give callback time to process

# Check project status (try both v2 and legacy endpoints)
STATUS_RESPONSE=$(curl -s -X GET "$WORKER_URL/api/projects/$PROJECT_ID/status" \
  -H "Authorization: Bearer $API_TOKEN")

echo "Project Status: $STATUS_RESPONSE" | head -c 200
echo "..."

DEPLOYMENT_URL=$(echo "$STATUS_RESPONSE" | jq -r '.data.deploymentUrl // .data.deployment_url // ""')

if [ ! -z "$DEPLOYMENT_URL" ] && [ "$DEPLOYMENT_URL" != "null" ]; then
    record_time "Automatic Deployment Triggered"
    echo -e "${GREEN}✅ Deployment URL: $DEPLOYMENT_URL${NC}"
else
    echo -e "${YELLOW}⚠️  No deployment URL found in project status${NC}"
fi
echo ""

# Step 6: Try to access the deployed site
echo -e "${YELLOW}Step 6: Verifying deployed site is accessible...${NC}"
SITE_URL="$WORKER_URL/sites/$PROJECT_ID/"

SITE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SITE_URL")

if [ "$SITE_STATUS" = "200" ]; then
    record_time "Site Accessible"
    echo -e "${GREEN}✅ Site is live at: $SITE_URL${NC}"
    
    # Get actual content
    CONTENT=$(curl -s "$SITE_URL")
    if echo "$CONTENT" | grep -q "E2E Pipeline Test"; then
        echo -e "${GREEN}✅ Content verified!${NC}"
    else
        echo -e "${YELLOW}⚠️  Site accessible but content unexpected${NC}"
    fi
else
    echo -e "${RED}❌ Site returned HTTP $SITE_STATUS${NC}"
    echo "The deployment may not have completed."
fi
echo ""

# Final timing report
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}          TIMING REPORT                 ${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""

TOTAL_TIME=$(( ($(date +%s%N) - $START_TIME) / 1000000 ))

echo -e "${BLUE}Phase Timings:${NC}"
echo -e "$TIMING_LOG"

echo -e "${BLUE}Total E2E Time: ${TOTAL_TIME}ms ($(($TOTAL_TIME / 1000))s)${NC}"
echo ""

echo ""
if [ $TOTAL_TIME -lt 90000 ]; then
    echo -e "${GREEN}✅ Met target: <90 seconds${NC}"
else
    echo -e "${YELLOW}⚠️  Exceeded target: >90 seconds (actual: $(($TOTAL_TIME / 1000))s)${NC}"
fi

echo ""
echo -e "${BLUE}Test Complete!${NC}"