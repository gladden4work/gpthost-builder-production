/**
 * GitHub Service Test Suite
 * Comprehensive tests for workflow triggering and monitoring
 * Following TDD approach - tests first, then implementation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GitHubService, GitHubServiceConfig } from '../../src/services/GitHubService';
import { GitHubErrorCode } from '../../src/lib/errors';
import { WorkflowDispatchParams } from '../../src/services/interfaces';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Use a global crypto stub so tests can control importKey/sign
let cryptoStub: any;

describe('GitHubService', () => {
  let service: GitHubService;
  const config: GitHubServiceConfig = {
    token: 'test-token',
    owner: 'test-owner',
    repo: 'test-repo',
    workflowFile: 'deploy.yml',
    webhookSecret: 'test-secret'
  };

  beforeEach(() => {
    service = new GitHubService(config);
    mockFetch.mockReset();
    vi.clearAllTimers();
    vi.useFakeTimers();
    // Stub global crypto so we can mock subtle methods
    cryptoStub = { subtle: { importKey: vi.fn(), sign: vi.fn() } };
    vi.stubGlobal('crypto', cryptoStub);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('triggerWorkflow', () => {
    const validParams: WorkflowDispatchParams = {
      workflowFile: 'deploy.yml',
      inputs: {
        source_files: JSON.stringify(['file1.js', 'file2.js']),
        project_id: 'test-project',
        build_config: '{}'
      }
    };

    it('should successfully trigger workflow with valid inputs', async () => {
      // Mock successful dispatch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers()
      });

      // Mock successful run retrieval with correlation_id
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workflow_runs: [{
            id: 12345,
            status: 'queued',
            conclusion: null,
            html_url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
            created_at: new Date(Date.now() - 1000).toISOString(), // Recent creation
            updated_at: new Date(Date.now() - 500).toISOString(),
            run_number: 42,
            head_sha: 'abc123'
          }]
        })
      });

      const resultPromise = service.triggerWorkflow(validParams);
      
      // Advance timers to handle the 2-second wait
      await vi.advanceTimersByTimeAsync(2000);
      
      const result = await resultPromise;
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(12345);
        expect(result.value.status).toBe('queued');
        expect(result.value.htmlUrl).toBe('https://github.com/test-owner/test-repo/actions/runs/12345');
      }

      // Verify dispatch call includes correlation_id
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/actions/workflows/deploy.yml/dispatches'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('correlation_id')
        })
      );
    });

    it('should handle authentication failures', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        statusText: 'Unauthorized'
      });

      const result = await service.triggerWorkflow(validParams);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(GitHubErrorCode.AUTHENTICATION_FAILED);
        expect(result.error.message).toContain('authentication failed');
      }
    });

    it('should handle workflow not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        statusText: 'Not Found'
      });

      const result = await service.triggerWorkflow(validParams);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(GitHubErrorCode.WORKFLOW_NOT_FOUND);
        expect(result.error.message).toContain('Workflow deploy.yml not found');
      }
    });

    it('should validate input JSON', async () => {
      const invalidParams: WorkflowDispatchParams = {
        workflowFile: 'deploy.yml',
        inputs: {
          source_files: 'not-valid-json{',
          project_id: 'test-project',
          build_config: '{}'
        }
      };

      const result = await service.triggerWorkflow(invalidParams);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(GitHubErrorCode.INVALID_INPUT);
        expect(result.error.message).toContain('Invalid source_files JSON');
      }
      
      // Should not make any API calls
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle rate limiting with exponential backoff', async () => {
      const resetTime = Math.floor(Date.now() / 1000) + 1; // 1 second from now
      
      // First call - rate limited
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({
          'x-ratelimit-reset': resetTime.toString()
        }),
        statusText: 'Forbidden'
      });

      // Second call after retry - success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers()
      });

      // Mock run retrieval
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workflow_runs: [{
            id: 12345,
            status: 'queued',
            conclusion: null,
            html_url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
            created_at: new Date(Date.now() - 1000).toISOString(),
            updated_at: new Date(Date.now() - 500).toISOString(),
            run_number: 42,
            head_sha: 'abc123'
          }]
        })
      });

      const resultPromise = service.triggerWorkflow(validParams);
      
      // Fast-forward timers for rate limit wait and then for run polling
      await vi.advanceTimersByTimeAsync(1000); // Rate limit wait
      await vi.advanceTimersByTimeAsync(2000); // Run polling wait
      
      const result = await resultPromise;
      
      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Rate limited, retry, get run
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const result = await service.triggerWorkflow(validParams);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(GitHubErrorCode.NETWORK_ERROR);
        expect(result.error.message).toContain('Network error');
      }
    });

    it('should handle correlation_id for preventing race conditions', async () => {
      // Mock successful dispatch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers()
      });

      // Mock run retrieval - should search with correlation_id
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workflow_runs: [
            {
              id: 99999,
              status: 'queued',
              conclusion: null,
              html_url: 'https://github.com/test-owner/test-repo/actions/runs/99999',
              created_at: new Date(Date.now() - 20000).toISOString(), // Old run
              updated_at: new Date(Date.now() - 19000).toISOString(),
              run_number: 40,
              head_sha: 'old123'
            },
            {
              id: 12345,
              status: 'queued',
              conclusion: null,
              html_url: 'https://github.com/test-owner/test-repo/actions/runs/12345',
              created_at: new Date(Date.now() - 1000).toISOString(), // Recent run
              updated_at: new Date(Date.now() - 500).toISOString(),
              run_number: 42,
              head_sha: 'abc123'
            }
          ]
        })
      });

      const resultPromise = service.triggerWorkflow(validParams);
      
      // Advance timers for the 2-second wait
      await vi.advanceTimersByTimeAsync(2000);
      
      const result = await resultPromise;
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(12345); // Should get the recent run
      }
      
      // Verify that correlation_id was added to inputs
      const dispatchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(dispatchCall[1].body);
      expect(body.inputs).toHaveProperty('correlation_id');
      expect(body.inputs.correlation_id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });
  });

  describe('getWorkflowStatus', () => {
    it('should retrieve workflow status successfully', async () => {
      // Mock run details
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 12345,
          status: 'completed',
          conclusion: 'success',
          run_started_at: '2025-01-15T10:00:00Z',
          updated_at: '2025-01-15T10:05:00Z',
          jobs_url: 'https://api.github.com/repos/test-owner/test-repo/actions/runs/12345/jobs'
        })
      });

      // Mock jobs details
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jobs: [
            {
              id: 1,
              name: 'build',
              status: 'completed',
              conclusion: 'success',
              started_at: '2025-01-15T10:00:10Z',
              completed_at: '2025-01-15T10:04:00Z',
              steps: [
                {
                  name: 'Checkout',
                  status: 'completed',
                  conclusion: 'success',
                  number: 1,
                  started_at: '2025-01-15T10:00:15Z',
                  completed_at: '2025-01-15T10:00:20Z'
                }
              ]
            }
          ]
        })
      });

      const result = await service.getWorkflowStatus(12345);
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.runId).toBe(12345);
        expect(result.value.status).toBe('completed');
        expect(result.value.conclusion).toBe('success');
        expect(result.value.jobs).toHaveLength(1);
        expect(result.value.jobs[0].name).toBe('build');
      }
    });

    it('should handle workflow not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        statusText: 'Not Found'
      });

      const result = await service.getWorkflowStatus(99999);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(GitHubErrorCode.API_ERROR);
        expect(result.error.message).toContain('Failed to get workflow status');
      }
    });
  });

  describe('validateWebhookSignatureAsync', () => {
    it('should validate correct webhook signature', async () => {
      const body = JSON.stringify({ action: 'completed' });
      const signature = 'sha256=abcdef1234567890'; // Mock signature
      
      // Mock crypto operations
      (global.crypto.subtle.importKey as any).mockResolvedValueOnce('mockKey');
      (global.crypto.subtle.sign as any).mockResolvedValueOnce(
        new Uint8Array([0xab, 0xcd, 0xef, 0x12, 0x34, 0x56, 0x78, 0x90])
      );

      const result = await service.validateWebhookSignatureAsync(signature, body);
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('should reject invalid signature format', async () => {
      const body = JSON.stringify({ action: 'completed' });
      const signature = 'invalid-signature';

      const result = await service.validateWebhookSignatureAsync(signature, body);
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });

    it('should handle missing webhook secret', async () => {
      const serviceNoSecret = new GitHubService({
        ...config,
        webhookSecret: undefined
      });
      
      const result = await serviceNoSecret.validateWebhookSignatureAsync('sha256=test', 'body');
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('handleWebhookCallback', () => {
    it('should process valid webhook callback', async () => {
      const payload = {
        action: 'completed',
        workflow_run: {
          id: 12345,
          conclusion: 'success'
        }
      };
      
      // Mock successful signature validation
      (global.crypto.subtle.importKey as any).mockResolvedValueOnce('mockKey');
      (global.crypto.subtle.sign as any).mockResolvedValueOnce(
        new Uint8Array([0xab, 0xcd, 0xef, 0x12, 0x34, 0x56, 0x78, 0x90])
      );
      
      const consoleSpy = vi.spyOn(console, 'log');
      
      const result = await service.handleWebhookCallback(
        payload as any,
        'sha256=abcdef1234567890'
      );
      
      expect(result.ok).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Workflow 12345 completed with success'
      );
      
      consoleSpy.mockRestore();
    });

    it('should reject invalid signature', async () => {
      const payload = {
        action: 'completed',
        workflow_run: {
          id: 12345,
          conclusion: 'success'
        }
      };
      
      // Mock failed signature validation
      (global.crypto.subtle.importKey as any).mockResolvedValueOnce('mockKey');
      (global.crypto.subtle.sign as any).mockResolvedValueOnce(
        new Uint8Array([0x00, 0x00]) // Wrong signature
      );
      
      const result = await service.handleWebhookCallback(
        payload as any,
        'sha256=wrongsignature'
      );
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(GitHubErrorCode.INVALID_SIGNATURE);
      }
    });
  });

  describe('cancelWorkflow', () => {
    it('should successfully cancel workflow', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: new Headers()
      });

      const result = await service.cancelWorkflow(12345);
      
      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/actions/runs/12345/cancel'),
        expect.objectContaining({
          method: 'POST'
        })
      );
    });

    it('should handle cancel failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        statusText: 'Not Found'
      });

      const result = await service.cancelWorkflow(99999);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(GitHubErrorCode.API_ERROR);
        expect(result.error.message).toContain('Failed to cancel workflow');
      }
    });
  });
});
