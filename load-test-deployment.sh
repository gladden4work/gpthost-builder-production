#!/bin/bash

# Day 7: Load Testing Script for Automatic Deployment
# Tests system performance under concurrent deployment load

set -e

echo "🔨 Day 7: Load Testing Automatic Deployment"
echo "==========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
CONCURRENT_DEPLOYS=${CONCURRENT_DEPLOYS:-10}
WORKER_URL="${WORKER_URL:-http://localhost:8787}"
CALLBACK_TOKEN="${GITHUB_CALLBACK_TOKEN:-gpthost-test-token-2025}"
BASE_PROJECT_ID="load-test-$(date +%s)"

echo -e "${BLUE}Load Test Configuration:${NC}"
echo "  Concurrent Deployments: $CONCURRENT_DEPLOYS"
echo "  Worker URL: $WORKER_URL"
echo "  Base Project ID: $BASE_PROJECT_ID"
echo ""

# Arrays to track results
declare -a PROJECT_IDS
declare -a DEPLOYMENT_URLS
declare -a RESPONSE_TIMES
declare -a STATUSES

# Function to create project and trigger deployment
test_deployment() {
  local index=$1
  local project_id="${BASE_PROJECT_ID}-${index}"
  local start_time=$(date +%s%N)
  
  echo -e "${YELLOW}[Project $index] Creating project: $project_id${NC}"
  
  # Create project
  curl -s -X POST "$WORKER_URL/api/v2/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer test-mvp-token-2025" \
    -d '{
      "projectId": "'"$project_id"'",
      "name": "Load Test Project '"$index"'",
      "framework": "react",
      "sourceFiles": {
        "App.tsx": "export default function App() { return <div><h1>Load Test '"$index"'</h1><p>Deployment '"$project_id"'</p></div>; }",
        "main.tsx": "import React from \"react\"; import ReactDOM from \"react-dom/client\"; import App from \"./App\"; ReactDOM.createRoot(document.getElementById(\"root\")!).render(<App />);"
      }
    }' > /dev/null 2>&1
  
  # Simulate GitHub callback with build success
  local callback_response=$(curl -s -X POST "$WORKER_URL/api/v2/github/callback" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $CALLBACK_TOKEN" \
    -H "X-Request-ID: load-test-$project_id" \
    -d '{
      "project_id": "'"$project_id"'",
      "status": "success",
      "github_run_id": "'"$(date +%s)$index"'",
      "github_run_url": "https://github.com/test/actions/runs/'"$(date +%s)$index"'",
      "r2_build_path": "builds/'"$project_id"'/dist/",
      "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
    }')
  
  local end_time=$(date +%s%N)
  local elapsed_ms=$(( ($end_time - $start_time) / 1000000 ))
  
  # Extract deployment URL
  local deployment_url=$(echo "$callback_response" | grep -o '"deployment_url":"[^"]*' | sed 's/"deployment_url":"//')
  
  # Check if deployment was successful
  if [ ! -z "$deployment_url" ]; then
    echo -e "${GREEN}[Project $index] ✓ Deployed in ${elapsed_ms}ms - $deployment_url${NC}"
    echo "$project_id:SUCCESS:$elapsed_ms:$deployment_url"
  else
    echo -e "${RED}[Project $index] ✗ Failed after ${elapsed_ms}ms${NC}"
    echo "$project_id:FAILED:$elapsed_ms:NONE"
  fi
}

# Run concurrent deployments
echo -e "${BLUE}Starting $CONCURRENT_DEPLOYS concurrent deployments...${NC}"
echo ""

# Create a temporary directory for results
RESULTS_DIR="/tmp/load-test-results-$(date +%s)"
mkdir -p "$RESULTS_DIR"

# Launch all deployments in parallel
for i in $(seq 1 $CONCURRENT_DEPLOYS); do
  test_deployment $i > "$RESULTS_DIR/result-$i.txt" 2>&1 &
done

# Wait for all background jobs to complete
echo "Waiting for all deployments to complete..."
wait

echo ""
echo -e "${BLUE}Processing results...${NC}"
echo ""

# Collect results
SUCCESS_COUNT=0
FAILURE_COUNT=0
TOTAL_TIME=0
MIN_TIME=999999
MAX_TIME=0

for i in $(seq 1 $CONCURRENT_DEPLOYS); do
  if [ -f "$RESULTS_DIR/result-$i.txt" ]; then
    # Get the last line which contains the summary
    RESULT=$(tail -n 1 "$RESULTS_DIR/result-$i.txt")
    
    # Parse result: project_id:status:time:url
    IFS=':' read -r proj_id status time_ms url <<< "$RESULT"
    
    if [ "$status" = "SUCCESS" ]; then
      ((SUCCESS_COUNT++))
      ((TOTAL_TIME+=time_ms))
      
      if [ $time_ms -lt $MIN_TIME ]; then
        MIN_TIME=$time_ms
      fi
      if [ $time_ms -gt $MAX_TIME ]; then
        MAX_TIME=$time_ms
      fi
    else
      ((FAILURE_COUNT++))
    fi
  fi
done

# Calculate statistics
if [ $SUCCESS_COUNT -gt 0 ]; then
  AVG_TIME=$(( TOTAL_TIME / SUCCESS_COUNT ))
else
  AVG_TIME=0
fi

SUCCESS_RATE=$(( (SUCCESS_COUNT * 100) / CONCURRENT_DEPLOYS ))

# Display results
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}        LOAD TEST RESULTS              ${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""
echo -e "Total Deployments:    $CONCURRENT_DEPLOYS"
echo -e "${GREEN}Successful:           $SUCCESS_COUNT${NC}"
echo -e "${RED}Failed:               $FAILURE_COUNT${NC}"
echo -e "Success Rate:         ${SUCCESS_RATE}%"
echo ""

if [ $SUCCESS_COUNT -gt 0 ]; then
  echo -e "${BLUE}Performance Metrics:${NC}"
  echo -e "Average Time:         ${AVG_TIME}ms"
  echo -e "Minimum Time:         ${MIN_TIME}ms"
  echo -e "Maximum Time:         ${MAX_TIME}ms"
  echo ""
fi

# Performance evaluation against targets
echo -e "${BLUE}Target Compliance:${NC}"

# Target: 95% success rate
if [ $SUCCESS_RATE -ge 95 ]; then
  echo -e "${GREEN}✅ Success Rate: ${SUCCESS_RATE}% (Target: ≥95%)${NC}"
else
  echo -e "${RED}❌ Success Rate: ${SUCCESS_RATE}% (Target: ≥95%)${NC}"
fi

# Target: <90 seconds (90000ms) average deployment time
if [ $AVG_TIME -le 90000 ] && [ $SUCCESS_COUNT -gt 0 ]; then
  echo -e "${GREEN}✅ Avg Deploy Time: ${AVG_TIME}ms (Target: <90000ms)${NC}"
else
  echo -e "${RED}❌ Avg Deploy Time: ${AVG_TIME}ms (Target: <90000ms)${NC}"
fi

# Target: Handle 100 concurrent builds (we're testing with subset)
if [ $SUCCESS_RATE -ge 80 ]; then
  echo -e "${GREEN}✅ Concurrency: System handled $CONCURRENT_DEPLOYS concurrent deployments${NC}"
else
  echo -e "${YELLOW}⚠️  Concurrency: System struggled with $CONCURRENT_DEPLOYS concurrent deployments${NC}"
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════${NC}"

# Cleanup
rm -rf "$RESULTS_DIR"

# Overall assessment
if [ $SUCCESS_RATE -ge 95 ] && [ $AVG_TIME -le 90000 ]; then
  echo ""
  echo -e "${GREEN}🎉 LOAD TEST PASSED!${NC}"
  echo "The automatic deployment system meets performance requirements."
  exit 0
else
  echo ""
  echo -e "${RED}⚠️  LOAD TEST NEEDS IMPROVEMENT${NC}"
  echo "Consider optimizing:"
  [ $SUCCESS_RATE -lt 95 ] && echo "  - Error handling and retry logic"
  [ $AVG_TIME -gt 90000 ] && echo "  - Deployment pipeline performance"
  exit 1
fi