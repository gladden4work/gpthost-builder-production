/**
 * Test to verify GitHubService error codes are properly defined
 */
import { describe, it, expect } from 'vitest';
import { GitHubErrorCode, GitHubError } from '../src/lib/errors';

describe('GitHubErrorCode enum', () => {
  it('should have all required error codes', () => {
    // Verify all error codes used by GitHubService exist
    expect(GitHubErrorCode.AUTHENTICATION_FAILED).toBeDefined();
    expect(GitHubErrorCode.WORKFLOW_NOT_FOUND).toBeDefined();
    expect(GitHubErrorCode.INVALID_INPUT).toBeDefined();
    expect(GitHubErrorCode.API_ERROR).toBeDefined();
    expect(GitHubErrorCode.NETWORK_ERROR).toBeDefined();
    expect(GitHubErrorCode.INVALID_SIGNATURE).toBeDefined();
    expect(GitHubErrorCode.RATE_LIMIT).toBeDefined();
  });

  it('should create GitHubError with correct error codes', () => {
    const error1 = new GitHubError(
      GitHubErrorCode.RATE_LIMIT,
      'Rate limit exceeded'
    );
    expect(error1.code).toBe('GITHUB_RATE_LIMITED');
    expect(error1.message).toBe('Rate limit exceeded');

    const error2 = new GitHubError(
      GitHubErrorCode.AUTHENTICATION_FAILED,
      'Invalid token'
    );
    expect(error2.code).toBe('GITHUB_AUTH_FAILED');
    
    const error3 = new GitHubError(
      GitHubErrorCode.WORKFLOW_NOT_FOUND,
      'Workflow not found'
    );
    expect(error3.code).toBe('GITHUB_WORKFLOW_NOT_FOUND');
  });

  it('should handle Result type correctly in GitHubService context', async () => {
    // Simulate the pattern used in GitHubService handleWebhookCallback
    type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
    
    const errorResult: Result<boolean, GitHubError> = {
      ok: false,
      error: new GitHubError(GitHubErrorCode.INVALID_SIGNATURE, 'Invalid signature')
    };

    // This should compile without issues after our fix
    if (!errorResult.ok) {
      const typedError = errorResult as { ok: false; error: GitHubError };
      expect(typedError.error.code).toBe('GITHUB_INVALID_SIGNATURE');
    }
  });
});