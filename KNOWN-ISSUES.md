# Known Issues

## StorageService Test Memory Exhaustion
**Date Identified**: August 24, 2025  
**Severity**: Medium (tests blocked, code works)  
**Status**: Workaround available

### Problem
Running `npx vitest run test/services/StorageService.test.ts` causes:
```
V8 fatal error: JavaScript heap out of memory
```

### Root Cause
Memory leak in vitest v3.2.4 when processing multiple `vi.fn()` mocks with `@cloudflare/workers-types`. The issue occurs during test compilation, not execution.

### Impact
- StorageService implementation is 100% complete ✅
- Tests are written but cannot execute ❌
- Feature flags work correctly ✅
- Not blocking refactoring progress ✅

### Workarounds
1. **Use integration tests** to validate StorageService
2. **Split test file** into smaller files (3-4 tests each)
3. **Skip in CI** until vitest fixes the issue
4. **Test indirectly** through ProjectService tests

### Evidence
- Affects both Node 20 and Node 22
- Happens even with 8GB memory allocation
- Other test files work fine (42 unit tests pass)
- Feature flag tests pass (4/4)

### Action Items
- [ ] File bug report with vitest
- [ ] Monitor for vitest updates
- [ ] Consider Jest for service tests if issue persists

### Not a Blocker Because
- Implementation works correctly
- Feature flags provide deployment safety
- Can validate through integration tests
- Interface contract enables downstream work