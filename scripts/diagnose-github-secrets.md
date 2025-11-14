# GitHub Secrets Diagnostic Guide

## Problem Summary
The GitHub Actions workflow is failing at the R2 upload step. The workflow file has the correct parameters, but the upload is still failing.

## Required GitHub Repository Secrets

You need to verify these secrets are set in the `gladden4work/gpthost-build-test` repository:

1. **CLOUDFLARE_ACCOUNT_ID**
   - Your Cloudflare account ID (32 character hex string)
   - Example: `a1b2c3d4e5f6789012345678901234567`
   - Find it at: https://dash.cloudflare.com/ → Right sidebar

2. **R2_ACCESS_KEY_ID**
   - R2 API token access key ID
   - NOT a Cloudflare API token - must be R2-specific credentials
   - Create at: Cloudflare Dashboard → R2 → Manage R2 API tokens

3. **R2_SECRET_ACCESS_KEY**
   - R2 API token secret access key
   - Paired with the R2_ACCESS_KEY_ID above
   - Only shown once when creating the token

4. **R2_BUCKET_NAME**
   - Should be: `gpthost-builds-staging`
   - Based on your wrangler.jsonc configuration

## How to Check/Set GitHub Secrets

1. Go to: https://github.com/gladden4work/gpthost-build-test/settings/secrets/actions
2. Check if all 4 secrets above are listed
3. If missing, click "New repository secret" and add them

## Creating R2 API Credentials

If you don't have R2 credentials:

1. Go to Cloudflare Dashboard
2. Navigate to R2 → Manage R2 API tokens
3. Click "Create API token"
4. Configure:
   - Token name: `gpthost-github-actions`
   - Permissions: `Object Read & Write`
   - Specify bucket: `gpthost-builds-staging`
   - TTL: Leave blank for permanent
5. Click "Create API Token"
6. **IMPORTANT**: Save the Access Key ID and Secret Access Key immediately

## Testing the Credentials Locally

```bash
# Set environment variables
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export R2_ACCESS_KEY_ID="your-access-key"
export R2_SECRET_ACCESS_KEY="your-secret-key"
export R2_BUCKET_NAME="gpthost-builds-staging"

# Test with AWS CLI
aws s3 ls s3://gpthost-builds-staging/ \
  --endpoint-url "https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --region us-east-1
```

## Common Issues and Solutions

### Issue 1: "NoSuchBucket"
- The bucket name in secrets doesn't match the actual R2 bucket
- Solution: Verify R2_BUCKET_NAME is exactly `gpthost-builds-staging`

### Issue 2: "AccessDenied" or "InvalidAccessKeyId"
- The R2 credentials are incorrect or expired
- Solution: Create new R2 API credentials as described above

### Issue 3: "SignatureDoesNotMatch"
- The secret access key has special characters that aren't properly escaped
- Solution: Ensure no extra spaces or newlines when pasting the secret

### Issue 4: Action fails silently
- The ryand56/r2-upload-action might have compatibility issues
- Solution: Use the AWS CLI fallback workflow (gpthost-build-aws-cli.yml)

## Quick Fix: AWS CLI Fallback

If the R2 upload action continues to fail, update the workflow to use AWS CLI directly:

```yaml
- name: Upload dist to R2 (AWS CLI)
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
  run: |
    aws s3 cp \
      "artifacts/${{ inputs.project_id }}/" \
      "s3://${{ secrets.R2_BUCKET_NAME }}/builds/${{ inputs.project_id }}/dist/" \
      --recursive \
      --endpoint-url "https://${{ secrets.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com" \
      --region us-east-1 \
      --no-progress
```

## Verification Steps

1. Check GitHub repository secrets are set
2. Verify R2 bucket exists and is accessible
3. Test credentials locally with AWS CLI
4. Update workflow if needed to use AWS CLI fallback
5. Re-run the E2E test

## Expected Outcome After Fix

- GitHub Actions workflow completes successfully
- Files are uploaded to R2 at: `builds/<project_id>/dist/`
- Worker receives success callback with `r2_build_path`
- Site is accessible via the deployment URL