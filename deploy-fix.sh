#!/bin/bash

# Emergency deployment script for P0 deployment fix
# This deploys the critical fix for 404 errors in production

echo "🚨 EMERGENCY DEPLOYMENT - P0 FIX FOR 404 ERRORS"
echo "================================================"
echo ""
echo "This script will deploy the critical fix for deployment failures"
echo "that are causing all sites to return 404 errors."
echo ""
echo "Changes included:"
echo "✅ Added comprehensive logging throughout deployment process"
echo "✅ Fixed silent failures when files can't be retrieved"  
echo "✅ Added validation to ensure files are actually deployed"
echo "✅ Made status update conditional on deployment success"
echo "✅ Added detailed error tracking and recovery"
echo ""

# Check if we're in the right directory
if [ ! -f "wrangler.jsonc" ]; then
    echo "❌ Error: Not in the gpthost-builder-staging directory"
    echo "Please run this script from: gpthost-builder-staging/"
    exit 1
fi

echo "📦 Current directory: $(pwd)"
echo ""

# Show what will be deployed
echo "🔍 Files modified in this fix:"
echo "- src/routes/github.ts (deployGitHubBuildArtifacts function)"
echo ""

# Confirm deployment
read -p "Deploy to PRODUCTION? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "❌ Deployment cancelled"
    exit 1
fi

echo ""
echo "🚀 Starting deployment..."
echo ""

# Deploy to production
wrangler deploy --env production

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ DEPLOYMENT SUCCESSFUL!"
    echo ""
    echo "Next steps:"
    echo "1. Test with project: 92118771-5d61-4e71-9e78-667f2d104100 (test21)"
    echo "2. Test with project: 53ef2911-d1d9-462e-8572-ae65cd544e00 (test22)"
    echo "3. Test with project: a2494ecd-9ea1-403a-bcdc-0328340bce71 (UAT test)"
    echo ""
    echo "Run test script: node test-deployment-fix.js"
    echo ""
    echo "Monitor logs with: wrangler tail --env production"
else
    echo ""
    echo "❌ DEPLOYMENT FAILED!"
    echo "Please check the error messages above and try again."
    exit 1
fi