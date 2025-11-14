#!/bin/bash
# Test R2 upload configuration and credentials

set -euo pipefail

echo "=== R2 Upload Configuration Tester ==="
echo ""

# Load environment variables
if [ -f ".env.staging" ]; then
    echo "Loading .env.staging..."
    export $(cat .env.staging | grep -v '^#' | xargs)
elif [ -f ".env" ]; then
    echo "Loading .env..."
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "No .env file found, using environment variables"
fi

# Check required variables
MISSING_VARS=()
[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] && MISSING_VARS+=("CLOUDFLARE_ACCOUNT_ID")
[ -z "${R2_ACCESS_KEY_ID:-}" ] && MISSING_VARS+=("R2_ACCESS_KEY_ID")
[ -z "${R2_SECRET_ACCESS_KEY:-}" ] && MISSING_VARS+=("R2_SECRET_ACCESS_KEY")
[ -z "${R2_BUCKET_NAME:-}" ] && MISSING_VARS+=("R2_BUCKET_NAME")

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo "❌ Missing required environment variables:"
    printf '   - %s\n' "${MISSING_VARS[@]}"
    exit 1
fi

echo "✅ All required environment variables are set"
echo ""
echo "Configuration:"
echo "  Account ID: ${CLOUDFLARE_ACCOUNT_ID:0:8}..."
echo "  Access Key: ${R2_ACCESS_KEY_ID:0:8}..."
echo "  Bucket: $R2_BUCKET_NAME"
echo ""

# Test AWS CLI configuration
echo "=== Testing AWS CLI with R2 ==="
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="us-east-1"

ENDPOINT_URL="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"

# Test 1: List buckets
echo "1. Testing bucket access..."
if aws s3 ls "s3://${R2_BUCKET_NAME}/" --endpoint-url "$ENDPOINT_URL" --no-paginate --max-items 1 >/dev/null 2>&1; then
    echo "   ✅ Can access bucket: $R2_BUCKET_NAME"
else
    echo "   ❌ Cannot access bucket: $R2_BUCKET_NAME"
    echo "   Trying to list all buckets..."
    aws s3 ls --endpoint-url "$ENDPOINT_URL" 2>&1 | head -5
    exit 1
fi

# Test 2: Create a test file
echo "2. Testing write permissions..."
TEST_FILE="/tmp/r2-test-${RANDOM}.txt"
TEST_KEY="test/r2-upload-test-${RANDOM}.txt"
echo "Test upload at $(date)" > "$TEST_FILE"

if aws s3 cp "$TEST_FILE" "s3://${R2_BUCKET_NAME}/${TEST_KEY}" \
    --endpoint-url "$ENDPOINT_URL" \
    --no-progress 2>&1; then
    echo "   ✅ Successfully uploaded test file"
    
    # Test 3: Read the file back
    echo "3. Testing read permissions..."
    if aws s3 cp "s3://${R2_BUCKET_NAME}/${TEST_KEY}" "${TEST_FILE}.download" \
        --endpoint-url "$ENDPOINT_URL" \
        --no-progress 2>&1; then
        echo "   ✅ Successfully downloaded test file"
    else
        echo "   ❌ Failed to download test file"
    fi
    
    # Cleanup
    echo "4. Cleaning up test file..."
    aws s3 rm "s3://${R2_BUCKET_NAME}/${TEST_KEY}" \
        --endpoint-url "$ENDPOINT_URL" 2>&1 >/dev/null
    echo "   ✅ Test file removed"
else
    echo "   ❌ Failed to upload test file"
    echo "   Error details:"
    aws s3 cp "$TEST_FILE" "s3://${R2_BUCKET_NAME}/${TEST_KEY}" \
        --endpoint-url "$ENDPOINT_URL" \
        --debug 2>&1 | grep -E "(Error|Exception|403|401)" | head -10
    exit 1
fi

# Cleanup local files
rm -f "$TEST_FILE" "${TEST_FILE}.download"

echo ""
echo "=== R2 Configuration Test Complete ==="
echo "✅ All tests passed! R2 is properly configured."
echo ""
echo "To use in GitHub Actions, ensure these secrets are set in the repository:"
echo "  - CLOUDFLARE_ACCOUNT_ID"
echo "  - R2_ACCESS_KEY_ID"
echo "  - R2_SECRET_ACCESS_KEY"
echo "  - R2_BUCKET_NAME"