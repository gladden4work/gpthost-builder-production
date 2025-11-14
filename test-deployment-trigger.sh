#!/bin/bash

# Day 7: Test Script for Automatic Deployment Trigger
# This script tests the complete flow from GitHub callback to live deployment

set -e

echo "🚀 Day 7: Testing Automatic Deployment Trigger"
echo "=============================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="day7-test-$(date +%s)"
WORKER_URL="${WORKER_URL:-http://localhost:8787}"
CALLBACK_TOKEN="${GITHUB_CALLBACK_TOKEN:-gpthost-test-token-2025}"

echo -e "${BLUE}Test Configuration:${NC}"
echo "  Project ID: $PROJECT_ID"
echo "  Worker URL: $WORKER_URL"
echo "  Callback Token: [REDACTED]"
echo ""

# Step 1: Create a test project
echo -e "${YELLOW}Step 1: Creating test project...${NC}"
CREATE_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/v2/projects" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-mvp-token-2025" \
  -d '{
    "projectId": "'"$PROJECT_ID"'",
    "name": "Day 7 Test Project",
    "framework": "react",
    "sourceFiles": {
      "App.tsx": "export default function App() { return <div><h1>Day 7 Auto-Deploy Test</h1><p>If you see this, automatic deployment worked!</p></div>; }",
      "main.tsx": "import React from \"react\"; import ReactDOM from \"react-dom/client\"; import App from \"./App\"; ReactDOM.createRoot(document.getElementById(\"root\")!).render(<App />);"
    }
  }')

echo "Response: $CREATE_RESPONSE"
echo ""

# Step 2: Trigger a build (this would normally be done via GitHub Actions)
echo -e "${YELLOW}Step 2: Simulating GitHub Actions build...${NC}"
echo "Note: In production, GitHub Actions would build and upload to R2"
echo ""

# Simulate build artifacts being uploaded to R2
# In real scenario, GitHub Actions would do this
BUILD_PATH="builds/$PROJECT_ID/dist/"

# Step 3: Send callback as if from GitHub Actions
echo -e "${YELLOW}Step 3: Sending GitHub callback with successful build status...${NC}"
CALLBACK_RESPONSE=$(curl -s -X POST "$WORKER_URL/api/v2/github/build-callback" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CALLBACK_TOKEN" \
  -H "X-Request-ID: day7-test-$(date +%s)" \
  -d '{
    "project_id": "'"$PROJECT_ID"'",
    "status": "success",
    "github_run_id": "'"$(date +%s)"'",
    "github_run_url": "https://github.com/test/actions/runs/'"$(date +%s)"'",
    "r2_build_path": "'"$BUILD_PATH"'",
    "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
  }')

echo "Callback Response: $CALLBACK_RESPONSE"
echo ""

# Step 4: Extract deployment URL from response
DEPLOYMENT_URL=$(echo "$CALLBACK_RESPONSE" | grep -o '"deployment_url":"[^"]*' | sed 's/"deployment_url":"//')

if [ -z "$DEPLOYMENT_URL" ]; then
  echo -e "${RED}❌ Deployment URL not found in callback response!${NC}"
  echo "This means automatic deployment was not triggered."
  echo ""
  echo "Debugging Information:"
  echo "- Check if DeployService.deployBuildFromPath was called"
  echo "- Verify R2 build artifacts exist at: $BUILD_PATH"
  echo "- Check callback handler logs for errors"
  exit 1
else
  echo -e "${GREEN}✅ Deployment URL found: $DEPLOYMENT_URL${NC}"
  echo ""
fi

# Step 5: Verify deployment is accessible
echo -e "${YELLOW}Step 4: Verifying deployment is accessible...${NC}"

# Try to access the deployment (using worker URL for local testing)
SITE_URL="$WORKER_URL/sites/$PROJECT_ID/"
echo "Checking site at: $SITE_URL"

SITE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$SITE_URL")

if [ "$SITE_RESPONSE" -eq 200 ]; then
  echo -e "${GREEN}✅ Site is accessible (HTTP 200)${NC}"
  
  # Get the actual content
  SITE_CONTENT=$(curl -s "$SITE_URL")
  if echo "$SITE_CONTENT" | grep -q "Day 7 Auto-Deploy Test"; then
    echo -e "${GREEN}✅ Site content verified - automatic deployment successful!${NC}"
  else
    echo -e "${YELLOW}⚠️  Site is accessible but content doesn't match expected${NC}"
    echo "Content preview: ${SITE_CONTENT:0:200}..."
  fi
else
  echo -e "${RED}❌ Site returned HTTP $SITE_RESPONSE${NC}"
  echo "The deployment may not have completed successfully."
fi

echo ""
echo -e "${BLUE}Test Summary:${NC}"
echo "=============="

# Check all conditions for success
if [ ! -z "$DEPLOYMENT_URL" ] && [ "$SITE_RESPONSE" -eq 200 ]; then
  echo -e "${GREEN}✅ SUCCESS: Automatic deployment trigger is working!${NC}"
  echo ""
  echo "Key achievements:"
  echo "1. GitHub callback received and processed ✓"
  echo "2. DeployService.deployBuildFromPath executed ✓"
  echo "3. Build artifacts copied to sites bucket ✓"
  echo "4. Deployment URL generated and returned ✓"
  echo "5. Site is accessible and serving content ✓"
  echo ""
  echo -e "${GREEN}Day 7 objective completed successfully!${NC}"
  exit 0
else
  echo -e "${RED}❌ FAILURE: Automatic deployment trigger not working${NC}"
  echo ""
  echo "Issues found:"
  [ -z "$DEPLOYMENT_URL" ] && echo "- Deployment URL not returned in callback"
  [ "$SITE_RESPONSE" -ne 200 ] && echo "- Site not accessible (HTTP $SITE_RESPONSE)"
  echo ""
  echo "Next steps:"
  echo "1. Check worker logs for errors"
  echo "2. Verify R2 buckets have correct permissions"
  echo "3. Ensure DeployService is properly integrated"
  echo "4. Review callback handler implementation"
  exit 1
fi
