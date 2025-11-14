#!/bin/bash

# GPTHost Rollback Monitor Script
# Purpose: Monitor metrics and trigger rollback if thresholds exceeded
# Usage: ./rollback-monitor.sh

set -e

# Configuration
ERROR_RATE_THRESHOLD=5      # Percentage
RESPONSE_TIME_THRESHOLD=2000 # Milliseconds
SUCCESS_RATE_THRESHOLD=80    # Percentage
MEMORY_USAGE_THRESHOLD=80    # Percentage

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Monitoring interval (seconds)
MONITOR_INTERVAL=30

echo -e "${BLUE}=== GPTHost Rollback Monitor ===${NC}"
echo "Monitoring production metrics..."
echo "Thresholds:"
echo "  • Error Rate: <${ERROR_RATE_THRESHOLD}%"
echo "  • Response Time: <${RESPONSE_TIME_THRESHOLD}ms"
echo "  • Success Rate: >${SUCCESS_RATE_THRESHOLD}%"
echo "  • Memory Usage: <${MEMORY_USAGE_THRESHOLD}%"
echo ""

# Function to get current metrics
get_metrics() {
    # This would normally query your monitoring system
    # For now, using mock data - replace with actual API calls
    
    # Example: Query Cloudflare Analytics API
    # METRICS=$(curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
    #   "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics")
    
    # Mock metrics for demonstration
    ERROR_RATE=$(( RANDOM % 10 ))
    RESPONSE_TIME=$(( 500 + RANDOM % 2000 ))
    SUCCESS_RATE=$(( 75 + RANDOM % 25 ))
    MEMORY_USAGE=$(( 40 + RANDOM % 50 ))
}

# Function to trigger rollback
trigger_rollback() {
    local REASON=$1
    
    echo ""
    echo -e "${RED}🚨 ROLLBACK TRIGGERED!${NC}"
    echo -e "Reason: ${REASON}"
    echo ""
    
    # Step 1: Disable feature flags
    echo -e "${YELLOW}Step 1: Disabling feature flags...${NC}"
    wrangler secret put FEATURE_FLAGS \
        --value '{"USE_NEW_GITHUB_SERVICE":false,"USE_NEW_BUILD_SERVICE":false,"USE_NEW_STORAGE_SERVICE":false,"USE_NEW_ROUTES":false}' \
        2>&1 | sed 's/^/  /'
    
    # Step 2: Get last stable deployment
    echo -e "${YELLOW}Step 2: Finding last stable deployment...${NC}"
    LAST_STABLE=$(wrangler deployments list --json | python -c "
import json, sys
data = json.load(sys.stdin)
stable = [d for d in data if 'stable' in d.get('message', '').lower()]
if stable:
    print(stable[0]['id'])
else:
    print(data[1]['id'] if len(data) > 1 else '')
" 2>/dev/null || echo "")
    
    if [ ! -z "$LAST_STABLE" ]; then
        echo -e "${YELLOW}Step 3: Rolling back to deployment: $LAST_STABLE${NC}"
        wrangler rollback "$LAST_STABLE" \
            --message "Automatic rollback: $REASON" \
            2>&1 | sed 's/^/  /'
    else
        echo -e "${RED}Warning: Could not find stable deployment ID${NC}"
        echo "Please run manual rollback:"
        echo "  wrangler deployments list"
        echo "  wrangler rollback [deployment-id]"
    fi
    
    # Step 4: Clear caches (optional)
    echo -e "${YELLOW}Step 4: Clearing caches...${NC}"
    # wrangler kv:namespace flush --namespace-id [your-namespace-id]
    
    # Step 5: Send notifications
    echo -e "${YELLOW}Step 5: Sending notifications...${NC}"
    
    # Slack notification (if configured)
    if [ ! -z "$SLACK_WEBHOOK" ]; then
        curl -X POST "$SLACK_WEBHOOK" \
            -H 'Content-Type: application/json' \
            -d "{\"text\":\"🚨 GPTHost Automatic Rollback\\nReason: $REASON\\nTime: $(date)\"}" \
            2>/dev/null
        echo "  ✓ Slack notification sent"
    fi
    
    # Log to file
    echo "$(date): Rollback triggered - $REASON" >> rollback.log
    echo "  ✓ Logged to rollback.log"
    
    echo ""
    echo -e "${GREEN}✓ Rollback complete!${NC}"
    echo "Please verify system stability and investigate the issue."
    
    exit 1
}

# Function to check thresholds
check_thresholds() {
    local TRIGGER_ROLLBACK=false
    local REASONS=""
    
    # Check error rate
    if [ "$ERROR_RATE" -gt "$ERROR_RATE_THRESHOLD" ]; then
        TRIGGER_ROLLBACK=true
        REASONS="${REASONS}Error rate ${ERROR_RATE}% exceeds ${ERROR_RATE_THRESHOLD}%. "
        echo -e "  ${RED}✗ Error Rate: ${ERROR_RATE}% (threshold: ${ERROR_RATE_THRESHOLD}%)${NC}"
    else
        echo -e "  ${GREEN}✓ Error Rate: ${ERROR_RATE}%${NC}"
    fi
    
    # Check response time
    if [ "$RESPONSE_TIME" -gt "$RESPONSE_TIME_THRESHOLD" ]; then
        TRIGGER_ROLLBACK=true
        REASONS="${REASONS}Response time ${RESPONSE_TIME}ms exceeds ${RESPONSE_TIME_THRESHOLD}ms. "
        echo -e "  ${RED}✗ Response Time: ${RESPONSE_TIME}ms (threshold: ${RESPONSE_TIME_THRESHOLD}ms)${NC}"
    else
        echo -e "  ${GREEN}✓ Response Time: ${RESPONSE_TIME}ms${NC}"
    fi
    
    # Check success rate
    if [ "$SUCCESS_RATE" -lt "$SUCCESS_RATE_THRESHOLD" ]; then
        TRIGGER_ROLLBACK=true
        REASONS="${REASONS}Success rate ${SUCCESS_RATE}% below ${SUCCESS_RATE_THRESHOLD}%. "
        echo -e "  ${RED}✗ Success Rate: ${SUCCESS_RATE}% (threshold: >${SUCCESS_RATE_THRESHOLD}%)${NC}"
    else
        echo -e "  ${GREEN}✓ Success Rate: ${SUCCESS_RATE}%${NC}"
    fi
    
    # Check memory usage
    if [ "$MEMORY_USAGE" -gt "$MEMORY_USAGE_THRESHOLD" ]; then
        echo -e "  ${YELLOW}⚠ Memory Usage: ${MEMORY_USAGE}% (warning at ${MEMORY_USAGE_THRESHOLD}%)${NC}"
        # Don't trigger rollback for memory alone, just warn
    else
        echo -e "  ${GREEN}✓ Memory Usage: ${MEMORY_USAGE}%${NC}"
    fi
    
    # Trigger rollback if needed
    if [ "$TRIGGER_ROLLBACK" = true ]; then
        trigger_rollback "$REASONS"
    fi
}

# Function to display metrics dashboard
display_dashboard() {
    clear
    echo -e "${BLUE}=== GPTHost Metrics Dashboard ===${NC}"
    echo -e "Time: $(date)"
    echo -e "Status: ${GREEN}MONITORING${NC}"
    echo ""
    echo "Current Metrics:"
    check_thresholds
    echo ""
    echo "Press Ctrl+C to stop monitoring"
    echo "Next check in ${MONITOR_INTERVAL} seconds..."
}

# Signal handler for graceful shutdown
cleanup() {
    echo ""
    echo -e "${YELLOW}Monitoring stopped.${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Main monitoring loop
while true; do
    get_metrics
    display_dashboard
    sleep "$MONITOR_INTERVAL"
done