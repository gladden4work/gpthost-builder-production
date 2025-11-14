# GitHub Integration Architecture

## Critical Architecture Decision

**Build workflows run in a SEPARATE repository** (`gpthost-build-test`), not in the main codebase repository.

## Why Separate Repositories?

### Security Benefits
- **Isolation**: Build environment isolated from main codebase
- **Permissions**: Different access controls for builds vs development
- **Secrets**: Build secrets separate from development secrets

### Operational Benefits
- **Clean Separation**: Build workflows don't clutter main repo
- **Independent Scaling**: Can scale build infrastructure separately
- **Easier Debugging**: Build issues isolated from code issues

## Repository Structure

```
gladden4work/hello-peek (Main Repository)
├── gpthost-builder-staging/     # Worker code
├── src/                         # Frontend code
└── .github/workflows/           # Testing workflows only
    ├── api-contracts.yml       # API testing
    └── integration-tests.yml   # Integration testing

gladden4work/gpthost-build-test (Build Repository)
└── .github/workflows/
    └── deploy-final.yml        # Actual build workflow
```

## Configuration Requirements

### Worker Environment (.dev.vars / wrangler.jsonc)
```bash
# CRITICAL: Must point to build repository
GITHUB_OWNER=gladden4work
GITHUB_REPO=gpthost-build-test  # NOT hello-peek!
GITHUB_WORKFLOW=deploy-final.yml

# CRITICAL: Must enable feature flags
FEATURE_FLAGS={"useNewGitHubService":true,...}
```

## Data Flow

1. **User** submits code to Worker API
2. **Worker** (in hello-peek repo) processes request
3. **GitHubService** triggers workflow in `gpthost-build-test` repo
4. **GitHub Actions** (in build repo) builds project
5. **Build** uploads artifacts to R2
6. **Callback** notifies Worker of completion
7. **Worker** deploys to production

## Common Configuration Errors

### Error 1: Wrong Repository
```bash
# ❌ WRONG - This will fail
# Build repository (BY DESIGN)
GITHUB_REPO=gpthost-build-test

# ✅ CORRECT
GITHUB_REPO=gpthost-build-test
```

### Error 2: Missing Feature Flags
```bash
# ❌ WRONG - Services use broken mocks
# (no FEATURE_FLAGS set)

# ✅ CORRECT
FEATURE_FLAGS={"useNewGitHubService":true,...}
```

### Error 3: Workflow in Wrong Repo
```bash
# ❌ WRONG - Creating workflows in main repo
.github/workflows/gpthost-build.yml (in gpthost-build-test)

# ✅ CORRECT - Workflows in build repo
.github/workflows/deploy-final.yml (in gpthost-build-test)
```

## Testing

Always test after configuration changes:
```bash
cd gpthost-builder-staging
./test-github-trigger.sh
```

Success indicator:
```
✅ GitHub workflow trigger is WORKING!
   - Workflow dispatched successfully
   - GitHub Actions run created
   - View run at: https://github.com/gladden4work/gpthost-build-test/actions/runs/...
```

## Migration History

### Day 6 (August 28, 2025)
- Discovered 0% success rate due to wrong repo configuration
- Fixed by pointing to `gpthost-build-test` repository
- Archived 4 outdated workflow files from main repo
- Success rate improved from 0% to 100%

## Key Takeaways

1. **Separation of Concerns**: Build workflows belong in build repository
2. **Configuration is Critical**: Wrong repo = 0% success rate
3. **Feature Flags Required**: Without flags, services use broken mocks
4. **Test Everything**: Use test-github-trigger.sh to validate

---

**This architecture is intentional and must be maintained for security and operational reasons.**
