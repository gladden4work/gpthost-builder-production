#!/bin/bash
# Script to set GitHub repository secrets from .dev.vars

set -euo pipefail

echo "=== Setting GitHub Secrets for R2 Upload ==="
echo ""

# Configuration
REPO="gladden4work/gpthost-build-test"
DEV_VARS_FILE=".dev.vars"

# Check if .dev.vars exists
if [ ! -f "$DEV_VARS_FILE" ]; then
    echo "❌ Error: .dev.vars file not found"
    echo "Please run this script from the gpthost-builder-staging directory"
    exit 1
fi

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ Error: GitHub CLI (gh) is not installed"
    echo "Install it with: brew install gh"
    echo "Then authenticate with: gh auth login"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Error: Not authenticated with GitHub"
    echo "Run: gh auth login"
    exit 1
fi

echo "Reading secrets from .dev.vars..."
echo ""

# Extract values from .dev.vars
CLOUDFLARE_ACCOUNT_ID=$(grep "^CLOUDFLARE_ACCOUNT_ID=" "$DEV_VARS_FILE" | cut -d'=' -f2)
R2_ACCESS_KEY_ID=$(grep "^R2_ACCESS_KEY_ID=" "$DEV_VARS_FILE" | cut -d'=' -f2)
R2_SECRET_ACCESS_KEY=$(grep "^R2_SECRET_ACCESS_KEY=" "$DEV_VARS_FILE" | cut -d'=' -f2)
R2_BUCKET_NAME=$(grep "^R2_BUCKET_NAME=" "$DEV_VARS_FILE" | cut -d'=' -f2)

# Display what we found (masked for security)
echo "Found secrets:"
echo "  CLOUDFLARE_ACCOUNT_ID: ${CLOUDFLARE_ACCOUNT_ID:0:8}..."
echo "  R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID:0:8}..."
echo "  R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY:0:8}..."
echo "  R2_BUCKET_NAME: $R2_BUCKET_NAME"
echo ""

# Confirm before setting
echo "This will set the following secrets in repository: $REPO"
echo "  - CLOUDFLARE_ACCOUNT_ID"
echo "  - R2_ACCESS_KEY_ID"
echo "  - R2_SECRET_ACCESS_KEY"
echo "  - R2_BUCKET_NAME"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled"
    exit 0
fi

echo ""
echo "Setting GitHub secrets..."

# Set each secret
echo -n "$CLOUDFLARE_ACCOUNT_ID" | gh secret set CLOUDFLARE_ACCOUNT_ID --repo="$REPO" --body=-
echo "✅ Set CLOUDFLARE_ACCOUNT_ID"

echo -n "$R2_ACCESS_KEY_ID" | gh secret set R2_ACCESS_KEY_ID --repo="$REPO" --body=-
echo "✅ Set R2_ACCESS_KEY_ID"

echo -n "$R2_SECRET_ACCESS_KEY" | gh secret set R2_SECRET_ACCESS_KEY --repo="$REPO" --body=-
echo "✅ Set R2_SECRET_ACCESS_KEY"

echo -n "$R2_BUCKET_NAME" | gh secret set R2_BUCKET_NAME --repo="$REPO" --body=-
echo "✅ Set R2_BUCKET_NAME"

echo ""
echo "=== All secrets have been set successfully! ==="
echo ""
echo "You can verify them at:"
echo "https://github.com/$REPO/settings/secrets/actions"
echo ""
echo "Next steps:"
echo "1. Run the E2E test: npm run test:e2e:live"
echo "2. Check GitHub Actions: https://github.com/$REPO/actions"