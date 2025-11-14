#!/bin/bash

# GPTHost R2 Bucket Backup Script
# Purpose: Create full backup of all R2 buckets before refactoring
# Usage: ./backup-r2-buckets.sh

set -e  # Exit on error

# Configuration
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups/pre-refactor-$TIMESTAMP"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID}"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== GPTHost R2 Bucket Backup ===${NC}"
echo -e "Timestamp: $TIMESTAMP"
echo -e "Backup Directory: $BACKUP_DIR"
echo ""

# Check for required environment variables
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
    echo -e "${RED}Error: CLOUDFLARE_ACCOUNT_ID not set${NC}"
    echo "Please set: export CLOUDFLARE_ACCOUNT_ID=your-account-id"
    exit 1
fi

if [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ]; then
    echo -e "${RED}Error: R2 credentials not set${NC}"
    echo "Please set: export R2_ACCESS_KEY_ID=your-key"
    echo "           export R2_SECRET_ACCESS_KEY=your-secret"
    exit 1
fi

# Create backup directory
echo -e "${YELLOW}Creating backup directory...${NC}"
mkdir -p "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR/projects"
mkdir -p "$BACKUP_DIR/builds"
mkdir -p "$BACKUP_DIR/deployments"

# Export current configuration
echo -e "${YELLOW}Backing up configuration files...${NC}"
if [ -f "wrangler.jsonc" ]; then
    cp wrangler.jsonc "$BACKUP_DIR/"
    echo "  ✓ wrangler.jsonc"
fi

if [ -f ".env" ]; then
    cp .env "$BACKUP_DIR/.env.backup"
    echo "  ✓ .env (as .env.backup)"
fi

if [ -f "package.json" ]; then
    cp package.json "$BACKUP_DIR/"
    echo "  ✓ package.json"
fi

# Function to backup a bucket
backup_bucket() {
    local BUCKET_NAME=$1
    local BUCKET_DIR=$2
    
    echo -e "${YELLOW}Backing up $BUCKET_NAME...${NC}"
    
    # Use AWS CLI with R2 endpoint
    aws s3 sync \
        "s3://$BUCKET_NAME/" \
        "$BACKUP_DIR/$BUCKET_DIR/" \
        --endpoint-url "https://$ACCOUNT_ID.r2.cloudflarestorage.com" \
        --region auto \
        2>&1 | while read line; do
            echo "  $line"
        done
    
    # Count files backed up
    local FILE_COUNT=$(find "$BACKUP_DIR/$BUCKET_DIR" -type f | wc -l)
    echo -e "${GREEN}  ✓ Backed up $FILE_COUNT files from $BUCKET_NAME${NC}"
}

# Backup each bucket
echo ""
echo -e "${GREEN}Starting bucket backups...${NC}"

# Projects bucket
backup_bucket "gpthost-projects-staging" "projects"

# Builds bucket
backup_bucket "gpthost-builds-staging" "builds"

# Deployments bucket
backup_bucket "gpthost-deployments-staging" "deployments"

# Calculate backup size
echo ""
echo -e "${YELLOW}Calculating backup size...${NC}"
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
PROJECTS_SIZE=$(du -sh "$BACKUP_DIR/projects" 2>/dev/null | cut -f1 || echo "0")
BUILDS_SIZE=$(du -sh "$BACKUP_DIR/builds" 2>/dev/null | cut -f1 || echo "0")
DEPLOYMENTS_SIZE=$(du -sh "$BACKUP_DIR/deployments" 2>/dev/null | cut -f1 || echo "0")

# Create backup manifest
echo -e "${YELLOW}Creating backup manifest...${NC}"
cat > "$BACKUP_DIR/manifest.json" << EOF
{
  "timestamp": "$TIMESTAMP",
  "date": "$(date)",
  "environment": "staging",
  "account_id": "$ACCOUNT_ID",
  "buckets": {
    "projects": {
      "name": "gpthost-projects-staging",
      "size": "$PROJECTS_SIZE",
      "backed_up": true
    },
    "builds": {
      "name": "gpthost-builds-staging",
      "size": "$BUILDS_SIZE",
      "backed_up": true
    },
    "deployments": {
      "name": "gpthost-deployments-staging",
      "size": "$DEPLOYMENTS_SIZE",
      "backed_up": true
    }
  },
  "total_size": "$TOTAL_SIZE",
  "backup_location": "$BACKUP_DIR",
  "worker_version": "$(wrangler version 2>/dev/null || echo 'unknown')",
  "node_version": "$(node --version)",
  "status": "complete"
}
EOF

# Create restore script
echo -e "${YELLOW}Creating restore script...${NC}"
cat > "$BACKUP_DIR/restore.sh" << 'EOF'
#!/bin/bash

# GPTHost R2 Bucket Restore Script
# Auto-generated during backup

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "=== GPTHost R2 Bucket Restore ==="
echo "Restoring from: $SCRIPT_DIR"
echo ""

# Check for AWS CLI
if ! command -v aws &> /dev/null; then
    echo "Error: AWS CLI not found. Please install it first."
    exit 1
fi

# Confirm restore
read -p "This will restore R2 buckets from this backup. Continue? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Restore cancelled."
    exit 0
fi

# Restore each bucket
echo "Restoring projects bucket..."
aws s3 sync \
    "$SCRIPT_DIR/projects/" \
    "s3://gpthost-projects-staging/" \
    --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" \
    --region auto

echo "Restoring builds bucket..."
aws s3 sync \
    "$SCRIPT_DIR/builds/" \
    "s3://gpthost-builds-staging/" \
    --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" \
    --region auto

echo "Restoring deployments bucket..."
aws s3 sync \
    "$SCRIPT_DIR/deployments/" \
    "s3://gpthost-deployments-staging/" \
    --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" \
    --region auto

echo ""
echo "✓ Restore complete!"
EOF

chmod +x "$BACKUP_DIR/restore.sh"

# Create verification script
cat > "$BACKUP_DIR/verify.sh" << 'EOF'
#!/bin/bash

# Verify backup integrity

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "=== Backup Verification ==="
echo ""

# Check manifest
if [ -f "$SCRIPT_DIR/manifest.json" ]; then
    echo "✓ Manifest found"
    cat "$SCRIPT_DIR/manifest.json" | python -m json.tool > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✓ Manifest valid JSON"
    else
        echo "✗ Manifest JSON invalid"
    fi
else
    echo "✗ Manifest not found"
fi

# Check directories
for DIR in projects builds deployments; do
    if [ -d "$SCRIPT_DIR/$DIR" ]; then
        FILE_COUNT=$(find "$SCRIPT_DIR/$DIR" -type f | wc -l)
        echo "✓ $DIR: $FILE_COUNT files"
    else
        echo "✗ $DIR directory not found"
    fi
done

# Check config files
for FILE in wrangler.jsonc package.json .env.backup; do
    if [ -f "$SCRIPT_DIR/$FILE" ]; then
        echo "✓ $FILE present"
    else
        echo "⚠ $FILE not found (may be optional)"
    fi
done

echo ""
echo "Verification complete!"
EOF

chmod +x "$BACKUP_DIR/verify.sh"

# Final summary
echo ""
echo -e "${GREEN}=== Backup Complete ===${NC}"
echo -e "Location: ${GREEN}$BACKUP_DIR${NC}"
echo -e "Total Size: ${GREEN}$TOTAL_SIZE${NC}"
echo ""
echo "Backup Contents:"
echo "  • Projects: $PROJECTS_SIZE"
echo "  • Builds: $BUILDS_SIZE"
echo "  • Deployments: $DEPLOYMENTS_SIZE"
echo ""
echo "Next Steps:"
echo "  1. Verify backup: $BACKUP_DIR/verify.sh"
echo "  2. To restore later: $BACKUP_DIR/restore.sh"
echo ""
echo -e "${GREEN}✓ Backup successful!${NC}"

# Create a symlink to latest backup
ln -sfn "$BACKUP_DIR" "./backups/latest"
echo "Created symlink: ./backups/latest -> $BACKUP_DIR"