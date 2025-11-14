# Test Safety Documentation

## Overview

This document explains the safety measures implemented to prevent tests from accidentally running against production or staging environments. These measures ensure tests are isolated, safe, and don't interfere with live systems.

## Why Test Safety Matters

**Critical Problem**: Tests should NEVER default to production or staging environments because:

1. **Data Corruption**: Tests can create, modify, or delete real user data
2. **Service Disruption**: Test traffic can overwhelm staging services or trigger rate limits
3. **Cost Impact**: Unnecessary API calls to paid services (GitHub Actions, Cloudflare resources)
4. **Security Risk**: Accidental exposure of production credentials or data
5. **False Positives**: Tests may pass against staging but fail in local development

**Real Example**: Our tests were previously defaulting to `gpthost-builder-staging.gladden4work.workers.dev`, causing:
- Unnecessary GitHub Actions workflow dispatches during test runs
- Potential interference with staging environment state
- Developers unknowingly testing against live services

## Safety Measures Implemented

### 1. Safe Default URLs
Tests now default to `localhost:8787` (Wrangler dev server):

```javascript
// Before (DANGEROUS):
const baseUrl = process.env.WORKER_URL || 'https://gpthost-builder-staging.gladden4work.workers.dev';

// After (SAFE):
const baseUrl = process.env.WORKER_URL || 'http://localhost:8787';
```

### 2. Environment Guards
Tests include explicit guards against accidental staging usage:

```javascript
// Prevent accidental staging tests
if (baseUrl.includes('gpthost-builder-staging') && !process.env.ALLOW_STAGING_TESTS) {
  throw new Error('Staging tests require ALLOW_STAGING_TESTS=1 environment variable');
}
```

### 3. Clear Warning Messages
When staging tests are attempted without proper flags:

```
Error: Staging tests require ALLOW_STAGING_TESTS=1 environment variable.
This prevents accidental testing against live staging environment.
To run staging tests: ALLOW_STAGING_TESTS=1 WORKER_URL=https://... npm test
```

## How to Run Tests Safely

### Local Testing (Default & Recommended)

```bash
# Start Wrangler dev server first
wrangler dev --port 8787

# Run tests (automatically uses localhost:8787)
npm test

# Run specific test file
npm test -- basic-endpoints.test.js
```

**Benefits**:
- ✅ No network dependencies
- ✅ No staging interference
- ✅ Fast execution
- ✅ Safe for continuous development

### Staging Testing (When Needed)

```bash
# Only when explicitly needed for staging validation
ALLOW_STAGING_TESTS=1 WORKER_URL=https://gpthost-builder-staging.gladden4work.workers.dev npm test

# For specific staging test
ALLOW_STAGING_TESTS=1 WORKER_URL=https://gpthost-builder-staging.gladden4work.workers.dev npm test -- integration.test.js
```

**When to Use Staging Tests**:
- ✅ Pre-deployment validation
- ✅ Integration testing with external services
- ✅ Performance testing under realistic conditions
- ❌ NOT for regular development or CI/CD

### Production Testing (Strongly Discouraged)

Production testing should only be done through dedicated monitoring and health check endpoints, not through the general test suite.

## Test Environment Configuration

### Environment Variables

| Variable | Purpose | Default | Required For |
|----------|---------|---------|-------------|
| `WORKER_URL` | Target server URL | `http://localhost:8787` | Staging tests |
| `ALLOW_STAGING_TESTS` | Safety flag | `undefined` | Staging tests |
| `MVP_ACCESS_TOKEN` | API authentication | `test-valid-token-12345` | All tests |

### Test Categories

**Unit Tests** (`*.test.js`)
- Test individual functions and utilities
- No network dependencies
- Always safe to run

**Integration Tests** (`integration/*.test.js`)
- Test API endpoints and workflows
- Use safety guards
- Default to localhost

**End-to-End Tests** (`e2e/*.test.js`)
- Test complete user journeys
- Require explicit staging flag
- Should primarily use localhost

## What Was Fixed

### Before (Unsafe)
```javascript
// Tests defaulted to staging
const baseUrl = process.env.WORKER_URL || 'https://gpthost-builder-staging.gladden4work.workers.dev';

// Results in:
❌ Tests ran against staging by default
❌ Unintentional GitHub Actions triggers
❌ Staging environment pollution
❌ Hidden network dependencies
```

### After (Safe)
```javascript
// Tests default to localhost
const baseUrl = process.env.WORKER_URL || 'http://localhost:8787';

// With explicit guards:
if (baseUrl.includes('gpthost-builder-staging') && !process.env.ALLOW_STAGING_TESTS) {
  throw new Error('Staging tests require ALLOW_STAGING_TESTS=1');
}

// Results in:
✅ Safe local testing by default
✅ Explicit staging test opt-in
✅ Clear error messages
✅ No accidental staging usage
```

## Guidelines for Writing New Tests

### 1. Always Assume Localhost
```javascript
// ✅ Good: Write tests that work with localhost
test('should upload component', async () => {
  const response = await fetch(`${baseUrl}/api/upload`, { ... });
  expect(response.ok).toBe(true);
});

// ❌ Bad: Hardcode staging URLs
test('should upload component', async () => {
  const response = await fetch('https://gpthost-builder-staging.gladden4work.workers.dev/api/upload', { ... });
});
```

### 2. Use Environment-Agnostic Assertions
```javascript
// ✅ Good: Test behavior, not environment
expect(response.status).toBe(200);
expect(result.data.project_id).toMatch(/^[a-f0-9-]+$/);

// ❌ Bad: Environment-specific assumptions
expect(result.url).toContain('gpthost-builder-staging');
```

### 3. Handle External Dependencies Gracefully
```javascript
// ✅ Good: Conditional tests for external services
const isStaging = baseUrl.includes('gpthost-builder-staging');
const testTimeout = isStaging ? 60000 : 10000;

test('should complete build', async () => {
  if (!isStaging) {
    // Mock external service for localhost
    mockGitHubActions();
  }
  // Test implementation...
}, testTimeout);
```

### 4. Document Environment Requirements
```javascript
/**
 * Integration test for complete deployment pipeline
 *
 * Local: Uses mocked GitHub Actions
 * Staging: Requires ALLOW_STAGING_TESTS=1, may trigger real builds
 */
describe('Deployment Pipeline', () => {
  // Test implementation...
});
```

## Troubleshooting

### Common Issues

**"Tests are failing with connection errors"**
- Ensure `wrangler dev` is running on port 8787
- Check that localhost is accessible
- Verify no firewall blocking local connections

**"Need to test against staging but getting safety error"**
- Use explicit staging command: `ALLOW_STAGING_TESTS=1 WORKER_URL=https://... npm test`
- Verify you actually need staging (most tests should work locally)

**"Tests pass locally but fail in CI"**
- Ensure CI uses same test environment configuration
- Check that CI doesn't accidentally use staging URLs
- Verify all external dependencies are properly mocked

### Best Practices

1. **Default to Local**: Always develop and test locally first
2. **Explicit Staging**: Only use staging when absolutely necessary
3. **Document Dependencies**: Clear comments about external service requirements
4. **Environment Parity**: Keep localhost behavior as close to staging as possible
5. **Fast Feedback**: Optimize for quick local test cycles

## Security Considerations

- Never commit staging credentials to test files
- Use environment variables for sensitive configuration
- Ensure test tokens are clearly marked as test-only
- Regularly audit test configurations for hardcoded URLs
- Monitor staging environment for unexpected test traffic

## Migration Checklist

When updating existing tests to follow these safety guidelines:

- [ ] Replace hardcoded staging URLs with `baseUrl` variable
- [ ] Add environment guards for staging-specific tests
- [ ] Update test documentation to explain environment requirements
- [ ] Verify tests pass with localhost (wrangler dev)
- [ ] Test staging behavior with explicit flag
- [ ] Update CI configuration if needed

This safety system ensures tests remain fast, reliable, and safe while still allowing necessary staging validation when explicitly requested.