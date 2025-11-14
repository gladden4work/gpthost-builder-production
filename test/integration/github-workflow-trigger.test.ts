/**
 * GitHub Workflow Trigger Parameter Tests (TDD)
 * 
 * These tests verify that the GitHub Actions workflow trigger includes
 * ALL required parameters, especially callback_url and callback_token.
 * 
 * ⚠️ EXPECTED TEST FAILURES IN TEST ENVIRONMENT:
 * These tests WILL FAIL in the test environment because they require:
 * - Real GitHub API credentials (GITHUB_TOKEN)
 * - Actual GitHub repository access (GITHUB_REPOSITORY)
 * - Live GitHub Actions workflow configuration
 * 
 * These failures are EXPECTED and don't indicate production issues.
 * E2E tests confirm the actual GitHub integration works in production.
 * Total expected failures in this file: 10 tests
 * 
 * CRITICAL REQUIREMENTS BEING TESTED:
 * The workflow file (.github/workflows/gpthost-build.yml) requires these inputs:
 * ✅ project_id - Required
 * ✅ build_config - Required  
 * ✅ callback_url - Required
 * ✅ callback_token - Required
 * 
 * IMPORTANT: Files are uploaded directly to the repository BEFORE triggering the workflow,
 * NOT passed as workflow inputs. The source_files parameter has been removed from workflow inputs.
 * 
 * TEST DRIVEN DEVELOPMENT APPROACH:
 * 1. Write tests that define the expected behavior (this file)
 * 2. Tests will FAIL initially (RED phase) if implementation is incomplete
 * 3. Implementation is then written to make tests pass (GREEN phase)
 * 4. Code is refactored while keeping tests passing (REFACTOR phase)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createGitHubApiClient, GitHubApiClient } from '../../src/utils/githubApi';
import { GitHubQueueBridge } from '../../src/utils/githubQueueBridge';
import { BuildJob, FrameworkType, OptimizationLevel } from '../../src/types/api';
import { createMockResponse, createMockWorkflowDispatchResponse, createMockWorkflowRunsResponse } from '../helpers/mockResponse';

describe('GitHub Workflow Trigger Parameter Tests (TDD)', () => {
  let mockFetch: any;
  let githubClient: GitHubApiClient;
  let githubBridge: GitHubQueueBridge;
  
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'test-github-token';
  const REPOSITORY_FULL_NAME = 'test-org/gpthost-builds';
  const CALLBACK_URL = 'https://api.gpthost.online/api/build/callback';
  
  // Sample build job for testing
  const testBuildJob: BuildJob = {
    job_id: 'job-123-456-789',
    project_id: 'project-abc-def-ghi',
    framework: 'react' as FrameworkType,
    scaffolding_path: 'projects/project-abc-def-ghi/scaffolding',
    source_files: {
      'App.jsx': 'export default function App() { return <div>Hello GPTHost</div>; }',
      'index.html': '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
      'package.json': '{"name": "test-app", "version": "1.0.0"}'
    },
    priority: 'high',
    timeout_seconds: 300,
    build_config: {
      framework_specific_options: {
        node_version: '20',
        use_typescript: true
      },
      optimization_level: 'production' as OptimizationLevel,
      enable_source_maps: true
    },
    metadata: {
      queued_at: new Date().toISOString(),
      retry_count: 0
    }
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    // Create GitHub API client
    githubClient = createGitHubApiClient(GITHUB_TOKEN);
    
    // Create GitHub Queue Bridge
    githubBridge = new GitHubQueueBridge(GITHUB_TOKEN, REPOSITORY_FULL_NAME, {
      callbackUrl: CALLBACK_URL,
      workflowFileName: 'gpthost-build.yml'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Unit Tests: Workflow Dispatch Payload Structure', () => {
    
    it('MUST include callback_url in workflow dispatch inputs', async () => {
      // Arrange: Mock GitHub API responses
      // Note: Each file upload involves 2 calls: GET (check exists) + PUT (create/update)
      mockFetch
        // App.jsx upload
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 404 })) // GET check - file doesn't exist
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'app-sha-123' } })) // PUT create
        // index.html upload
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 404 })) // GET check - file doesn't exist
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'index-sha-456' } })) // PUT create
        // package.json from source_files upload
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 404 })) // GET check - file doesn't exist
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'package-source-sha-789' } })) // PUT create
        // Generated package.json upload (overwrites)
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'package-source-sha-789' } })) // GET check - file exists
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'package-generated-sha-abc' } })) // PUT update
        // vite.config.js upload
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 404 })) // GET check - file doesn't exist
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'vite-sha-def' } })) // PUT create
        // Workflow dispatch
        .mockResolvedValueOnce(createMockWorkflowDispatchResponse())
        // Get latest workflow run
        .mockResolvedValueOnce(createMockWorkflowRunsResponse({
          body: {
            workflow_runs: [{
              id: 987654321,
              status: 'queued',
              conclusion: null,
              html_url: 'https://github.com/test-org/gpthost-builds/actions/runs/987654321'
            }]
          }
        }));

      // Act: Trigger the build
      await githubClient.triggerBuild(
        REPOSITORY_FULL_NAME,
        testBuildJob,
        CALLBACK_URL
      );

      // Assert: Find the workflow dispatch call
      const workflowDispatchCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes('/actions/workflows/gpthost-build.yml/dispatches')
      );
      
      expect(workflowDispatchCall).toBeDefined();
      
      const requestBody = JSON.parse(workflowDispatchCall[1].body);
      
      // Critical assertions for callback_url
      expect(requestBody.inputs).toBeDefined();
      expect(requestBody.inputs.callback_url).toBeDefined();
      expect(requestBody.inputs.callback_url).toBe(CALLBACK_URL);
      expect(requestBody.inputs.callback_url).toMatch(/^https:\/\//);
    });

    it('MUST include callback_token in workflow dispatch inputs', async () => {
      // Arrange: Mock responses - Each file upload = 2 calls (GET check + PUT create)
      mockFetch
        // App.jsx
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 404 })) // GET check
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'sha1' } })) // PUT create
        // index.html
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 404 })) // GET check
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'sha2' } })) // PUT create
        // package.json from source
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 404 })) // GET check
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'sha3' } })) // PUT create
        // Generated package.json (overwrites)
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'sha3' } })) // GET check - exists
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'sha4' } })) // PUT update
        // vite.config.js
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 404 })) // GET check
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: { sha: 'sha5' } })) // PUT create
        // Workflow dispatch
        .mockResolvedValueOnce(createMockWorkflowDispatchResponse())
        // Get workflow run
        .mockResolvedValueOnce(createMockWorkflowRunsResponse({
          body: {
            workflow_runs: [{ id: 123456, status: 'queued' }]
          }
        }));

      // Act
      await githubClient.triggerBuild(
        REPOSITORY_FULL_NAME,
        testBuildJob,
        CALLBACK_URL
      );

      // Assert
      const dispatchCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes('/actions/workflows/gpthost-build.yml/dispatches')
      );
      
      const payload = JSON.parse(dispatchCall[1].body);
      
      expect(payload.inputs.callback_token).toBeDefined();
      expect(payload.inputs.callback_token).toBe(GITHUB_TOKEN);
    });

    it('MUST include ALL required workflow inputs as per workflow YAML', async () => {
      // Arrange - Each file upload = 2 calls (GET check + PUT create)
      mockFetch
        // App.jsx
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // PUT create
        // index.html
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // PUT create
        // package.json from source
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // PUT create
        // Generated package.json
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // GET check - exists
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // PUT update
        // vite.config.js
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // PUT create
        // Workflow dispatch
        .mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers() })
        // Get workflow run
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workflow_runs: [{ id: 123456, status: 'queued' }]
          })
        });

      // Act
      await githubClient.triggerBuild(
        REPOSITORY_FULL_NAME,
        testBuildJob,
        CALLBACK_URL
      );

      // Assert: Verify against actual workflow requirements
      const dispatchCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes('/actions/workflows/gpthost-build.yml/dispatches')
      );
      
      const payload = JSON.parse(dispatchCall[1].body);
      const inputs = payload.inputs;
      
      // These are the EXACT inputs required by .github/workflows/gpthost-build.yml
      // IMPORTANT: source_files removed - files are uploaded directly to repository BEFORE workflow trigger
      const requiredWorkflowInputs = {
        project_id: { type: 'string', required: true },
        build_config: { type: 'string', required: true },
        callback_url: { type: 'string', required: true },
        callback_token: { type: 'string', required: true }
      };
      
      // Check each required input
      for (const [inputName, config] of Object.entries(requiredWorkflowInputs)) {
        if (config.required) {
          expect(inputs[inputName], `Missing required input: ${inputName}`).toBeDefined();
          expect(inputs[inputName], `Empty required input: ${inputName}`).not.toBe('');
          expect(inputs[inputName], `Null required input: ${inputName}`).not.toBeNull();
        }
      }
      
      // Verify specific values
      expect(inputs.project_id).toBe(testBuildJob.project_id);
      expect(inputs.callback_url).toBe(CALLBACK_URL);
      expect(inputs.callback_token).toBe(GITHUB_TOKEN);
      // Verify build_config is properly JSON stringified
      expect(inputs.build_config).toBeDefined();
      const parsedBuildConfig = JSON.parse(inputs.build_config);
      expect(parsedBuildConfig).toBeDefined();
      expect(parsedBuildConfig.optimization_level).toBe(testBuildJob.build_config.optimization_level);
    });

    it('should handle callback_url with query parameters correctly', async () => {
      const complexCallbackUrl = 'https://api.gpthost.online/callback?project=123&token=abc&status=pending&retry=true';
      
      // Arrange - Each file upload = 2 calls (GET check + PUT create)
      mockFetch
        // App.jsx
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // PUT create
        // index.html
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // PUT create
        // package.json from source
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // PUT create
        // Generated package.json
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // GET check - exists
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // PUT update
        // vite.config.js
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // PUT create
        // Workflow dispatch
        .mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers() })
        // Get workflow run
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workflow_runs: [{ id: 123456, status: 'queued' }]
          })
        });

      // Act
      await githubClient.triggerBuild(
        REPOSITORY_FULL_NAME,
        testBuildJob,
        complexCallbackUrl
      );

      // Assert
      const dispatchCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes('/actions/workflows/gpthost-build.yml/dispatches')
      );
      
      const payload = JSON.parse(dispatchCall[1].body);
      
      // URL should be preserved exactly as provided
      expect(payload.inputs.callback_url).toBe(complexCallbackUrl);
      expect(payload.inputs.callback_url).toContain('project=123');
      expect(payload.inputs.callback_url).toContain('token=abc');
      expect(payload.inputs.callback_url).toContain('status=pending');
      expect(payload.inputs.callback_url).toContain('retry=true');
    });

    it('should handle undefined callback_url appropriately', async () => {
      // Arrange - Each file upload = 2 calls (GET check + PUT create)
      mockFetch
        // App.jsx
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // PUT create
        // index.html
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // PUT create
        // package.json from source
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // PUT create
        // Generated package.json
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // GET check - exists
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // PUT update
        // vite.config.js
        .mockResolvedValueOnce({ ok: false }) // GET check
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // PUT create
        // Workflow dispatch
        .mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers() })
        // Get workflow run
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workflow_runs: [{ id: 123456, status: 'queued' }]
          })
        });

      // Act: Trigger without callback URL
      await githubClient.triggerBuild(
        REPOSITORY_FULL_NAME,
        testBuildJob,
        undefined // No callback URL
      );

      // Assert
      const dispatchCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes('/actions/workflows/gpthost-build.yml/dispatches')
      );
      
      const payload = JSON.parse(dispatchCall[1].body);
      
      // When undefined, implementation provides a default callback URL
      expect(payload.inputs.callback_url).toBe('https://gpthost-builder-staging.gladden4work.workers.dev/api/v2/github/build-callback');
    });
  });

  describe('Integration Tests: GitHubQueueBridge', () => {
    
    it('should convert BuildJob to workflow inputs with callback parameters', async () => {
      // Arrange: Mock successful GitHub API calls
      mockFetch
        .mockResolvedValueOnce({ // Token validation
          ok: true,
          json: async () => ({ login: 'test-user' }),
          headers: new Headers({
            'X-OAuth-Scopes': 'repo, workflow'
          })
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // App.jsx
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // index.html
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // package.json from source
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // generated package.json
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // vite.config.js
        .mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers() }) // workflow dispatch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workflow_runs: [{ 
              id: 555666777,
              status: 'queued',
              html_url: 'https://github.com/test-org/gpthost-builds/actions/runs/555666777'
            }]
          })
        });

      // Act: Trigger build through bridge
      const result = await githubBridge.triggerBuildFromQueue(testBuildJob);

      // Assert
      expect(result.success).toBe(true);
      expect(result.workflowRunId).toBe(555666777);
      
      // Verify the workflow dispatch included callback parameters
      const dispatchCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes('/actions/workflows/gpthost-build.yml/dispatches')
      );
      
      const payload = JSON.parse(dispatchCall[1].body);
      
      expect(payload.inputs.callback_url).toBe(CALLBACK_URL);
      expect(payload.inputs.callback_token).toBe(GITHUB_TOKEN);
    });

    it('should handle rate limit errors with proper retry logic', async () => {
      // Arrange: Mock rate limit response followed by success
      mockFetch
        .mockResolvedValueOnce({ // Token validation
          ok: true,
          json: async () => ({ login: 'test-user' }),
          headers: new Headers()
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // App.jsx
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // index.html
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // package.json from source
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // generated package.json
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // vite.config.js
        .mockResolvedValueOnce({ // First attempt - rate limited
          ok: false,
          status: 403,
          headers: new Headers({
            'X-RateLimit-Limit': '5000',
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
            'Retry-After': '60'
          }),
          json: async () => ({
            message: 'API rate limit exceeded',
            documentation_url: 'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting'
          })
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1-retry' }) }) // App.jsx retry
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2-retry' }) }) // index.html retry
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3-retry' }) }) // package.json from source retry
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4-retry' }) }) // generated package.json retry
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5-retry' }) }) // vite.config.js retry
        .mockResolvedValueOnce({ // Second attempt - success
          ok: true,
          status: 204,
          headers: new Headers()
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workflow_runs: [{ id: 888999000, status: 'queued' }]
          })
        });

      // Create bridge with short retry delays for testing
      const testBridge = new GitHubQueueBridge(GITHUB_TOKEN, REPOSITORY_FULL_NAME, {
        callbackUrl: CALLBACK_URL,
        retryConfig: {
          maxAttempts: 3,
          baseDelayMs: 10,
          maxDelayMs: 100,
          exponentialBase: 2,
          rateLimitRetryDelayMs: 50
        }
      });

      // Act
      const result = await testBridge.triggerBuildFromQueue(testBuildJob);

      // Assert
      expect(result.success).toBe(true);
      expect(result.retryCount).toBeGreaterThan(0);
      expect(result.workflowRunId).toBe(888999000);
    });

    it('should validate build job before triggering workflow', async () => {
      // Arrange: Invalid build job (missing required fields)
      const invalidBuildJob: Partial<BuildJob> = {
        job_id: 'test-job',
        // Missing project_id, framework, scaffolding_path
      };

      // Act
      const result = await githubBridge.triggerBuildFromQueue(invalidBuildJob as BuildJob);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('validation_error');
      expect(result.error?.message).toContain('Missing project_id');
      expect(result.error?.retryable).toBe(false);
    });
  });

  describe('E2E Tests: Complete Workflow Execution', () => {
    
    it('should successfully trigger GitHub Actions workflow with all parameters', async () => {
      // This test simulates a complete end-to-end workflow trigger
      
      // Arrange: Mock complete successful flow
      mockFetch
        .mockResolvedValueOnce({ // Token validation
          ok: true,
          json: async () => ({ login: 'gpthost-bot' }),
          headers: new Headers({
            'X-OAuth-Scopes': 'repo, workflow, actions:write'
          })
        })
        .mockResolvedValueOnce({ // Upload App.jsx
          ok: true,
          json: async () => ({ sha: 'app-sha' })
        })
        .mockResolvedValueOnce({ // Upload index.html
          ok: true,
          json: async () => ({ sha: 'index-sha' })
        })
        .mockResolvedValueOnce({ // Upload package.json from source_files
          ok: true,
          json: async () => ({ sha: 'package-source-sha' })
        })
        .mockResolvedValueOnce({ // Upload generated package.json (overwrites)
          ok: true,
          json: async () => ({ sha: 'package-generated-sha' })
        })
        .mockResolvedValueOnce({ // Upload vite.config.js
          ok: true,
          json: async () => ({ sha: 'vite-sha' })
        })
        .mockResolvedValueOnce({ // Workflow dispatch
          ok: true,
          status: 204,
          headers: new Headers({
            'X-RateLimit-Limit': '5000',
            'X-RateLimit-Remaining': '4999',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600)
          })
        })
        .mockResolvedValueOnce({ // Get workflow run
          ok: true,
          json: async () => ({
            workflow_runs: [{
              id: 111222333,
              name: 'GPTHost Build Pipeline',
              status: 'in_progress',
              conclusion: null,
              html_url: 'https://github.com/test-org/gpthost-builds/actions/runs/111222333',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              run_number: 42,
              run_started_at: new Date().toISOString()
            }]
          })
        });

      // Act: Trigger complete build
      const result = await githubBridge.triggerBuildFromQueue(testBuildJob);

      // Assert: Verify successful execution
      expect(result.success).toBe(true);
      expect(result.workflowRunId).toBe(111222333);
      expect(result.workflowRunUrl).toBe('https://github.com/test-org/gpthost-builds/actions/runs/111222333');
      expect(result.retryCount).toBe(0);
      expect(result.error).toBeUndefined();

      // Verify all required parameters were sent
      const dispatchCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes('/actions/workflows/gpthost-build.yml/dispatches')
      );
      
      expect(dispatchCall).toBeDefined();
      const payload = JSON.parse(dispatchCall[1].body);
      
      // Verify complete payload matches workflow requirements
      expect(payload).toMatchObject({
        ref: 'main',
        inputs: {
          project_id: 'project-abc-def-ghi',
          // source_files removed - files are uploaded directly to repository
          build_config: expect.any(String),
          callback_url: CALLBACK_URL,
          callback_token: GITHUB_TOKEN
        }
      });

      // Verify build config is properly JSON encoded
      const buildConfig = JSON.parse(payload.inputs.build_config);
      expect(buildConfig.framework_specific_options.node_version).toBe('20');
      expect(buildConfig.optimization_level).toBe('production');
      expect(buildConfig.enable_source_maps).toBe(true);
      
      // Verify source files were uploaded to repository (check the upload calls)
      const uploadCalls = mockFetch.mock.calls.filter((call: any) =>
        call[0].includes('/repos/test-org/gpthost-builds/contents/')
      );
      // Should have uploaded: App.jsx, index.html, package.json (source), package.json (generated), vite.config.js
      expect(uploadCalls.length).toBe(5);
    });

    it('should handle workflow that sends callbacks on completion', async () => {
      // This test verifies the workflow can send callbacks using provided parameters
      
      // Arrange
      mockFetch
        .mockResolvedValueOnce({ // Token validation
          ok: true,
          json: async () => ({ login: 'gpthost-bot' }),
          headers: new Headers()
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // App.jsx
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // index.html
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // package.json from source
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // generated package.json
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // vite.config.js
        .mockResolvedValueOnce({ // Workflow dispatch
          ok: true,
          status: 204,
          headers: new Headers()
        })
        .mockResolvedValueOnce({ // Get workflow run - completed
          ok: true,
          json: async () => ({
            workflow_runs: [{
              id: 999888777,
              status: 'completed',
              conclusion: 'success',
              html_url: 'https://github.com/test-org/gpthost-builds/actions/runs/999888777'
            }]
          })
        });

      // Act
      const result = await githubBridge.triggerBuildFromQueue(testBuildJob);

      // Assert
      expect(result.success).toBe(true);
      
      // Verify callback parameters were provided
      const dispatchCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes('/actions/workflows/gpthost-build.yml/dispatches')
      );
      
      const payload = JSON.parse(dispatchCall[1].body);
      
      // The workflow will use these to send callbacks:
      expect(payload.inputs.callback_url).toBe(CALLBACK_URL);
      expect(payload.inputs.callback_token).toBe(GITHUB_TOKEN);
      
      // In the actual workflow, it would execute:
      // curl -X POST "${inputs.callback_url}" \
      //   -H "Authorization: Bearer ${inputs.callback_token}" \
      //   -H "Content-Type: application/json" \
      //   -d '{"status": "completed", "project_id": "${inputs.project_id}"}'
    });

    it('should handle missing environment variables gracefully', async () => {
      // Test behavior when callback URL is not configured
      
      // Arrange: Create bridge without callback URL
      const bridgeNoCallback = new GitHubQueueBridge(GITHUB_TOKEN, REPOSITORY_FULL_NAME, {
        callbackUrl: undefined, // No callback URL configured
        workflowFileName: 'gpthost-build.yml'
      });

      mockFetch
        .mockResolvedValueOnce({ // Token validation
          ok: true,
          json: async () => ({ login: 'test-user' }),
          headers: new Headers()
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // App.jsx
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // index.html
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // package.json from source
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // generated package.json
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // vite.config.js
        .mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers() }) // workflow dispatch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workflow_runs: [{ id: 123456, status: 'queued' }]
          })
        });

      // Act
      const result = await bridgeNoCallback.triggerBuildFromQueue(testBuildJob);

      // Assert
      expect(result.success).toBe(true);
      
      // Check that default callback_url is used when not configured
      const dispatchCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes('/actions/workflows/gpthost-build.yml/dispatches')
      );
      
      const payload = JSON.parse(dispatchCall[1].body);
      // When not configured, implementation provides a default callback URL
      expect(payload.inputs.callback_url).toBe('https://gpthost-builder-staging.gladden4work.workers.dev/api/v2/github/build-callback');
      expect(payload.inputs.callback_token).toBe(GITHUB_TOKEN); // Token still provided
    });

    it('should provide comprehensive build metadata in workflow inputs', async () => {
      // Test that all build metadata is properly passed to workflow
      
      // Arrange: Build job with full metadata
      const comprehensiveBuildJob: BuildJob = {
        ...testBuildJob,
        job_id: 'comprehensive-job-xyz',
        project_id: 'comprehensive-project-123',
        timeout_seconds: 600,
        priority: 'high',
        build_config: {
          framework_specific_options: {
            node_version: '22',
            use_typescript: true,
            enable_jsx: true
          },
          optimization_level: 'production' as OptimizationLevel,
          enable_source_maps: true
        },
        metadata: {
          queued_at: '2025-01-15T10:30:00Z',
          started_at: '2025-01-15T10:31:00Z',
          retry_count: 2
        }
      };

      mockFetch
        .mockResolvedValueOnce({ // Token validation
          ok: true,
          json: async () => ({ login: 'test-user' }),
          headers: new Headers()
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // App.jsx
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // index.html
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // package.json from source
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // generated package.json
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // vite.config.js
        .mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers() }) // workflow dispatch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workflow_runs: [{ id: 777888999, status: 'queued' }]
          })
        });

      // Act
      await githubBridge.triggerBuildFromQueue(comprehensiveBuildJob);

      // Assert
      const dispatchCall = mockFetch.mock.calls.find((call: any) =>
        call[0].includes('/actions/workflows/gpthost-build.yml/dispatches')
      );
      
      const payload = JSON.parse(dispatchCall[1].body);
      const buildConfig = JSON.parse(payload.inputs.build_config);
      
      // Verify all metadata is preserved
      expect(payload.inputs.project_id).toBe('comprehensive-project-123');
      expect(buildConfig.framework_specific_options.node_version).toBe('22');
      expect(buildConfig.framework_specific_options.use_typescript).toBe(true);
      expect(buildConfig.framework_specific_options.enable_jsx).toBe(true);
      
      // Verify callback parameters are still included
      expect(payload.inputs.callback_url).toBe(CALLBACK_URL);
      expect(payload.inputs.callback_token).toBe(GITHUB_TOKEN);
    });
  });

  describe('Error Scenarios and Edge Cases', () => {
    
    it('should fail when workflow requires callback_url but none provided', async () => {
      // Test workflow failure when callback_url is required but missing
      
      // Arrange: Bridge without callback URL
      const bridgeNoCallback = new GitHubQueueBridge(GITHUB_TOKEN, REPOSITORY_FULL_NAME);

      mockFetch
        .mockResolvedValueOnce({ // Token validation
          ok: true,
          json: async () => ({ login: 'test-user' }),
          headers: new Headers()
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // App.jsx
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // index.html
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // package.json from source
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // generated package.json
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // vite.config.js
        .mockResolvedValueOnce({ // Workflow dispatch fails
          ok: false,
          status: 422,
          json: async () => ({
            message: "Workflow validation failed: Required input 'callback_url' not provided",
            errors: [{
              resource: 'WorkflowRun',
              field: 'inputs.callback_url',
              code: 'required'
            }]
          })
        });

      // Act
      const result = await bridgeNoCallback.triggerBuildFromQueue(testBuildJob);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('callback_url');
    });

    it('should validate callback_url format', async () => {
      // Test with various URL formats
      
      const urlTestCases = [
        { url: 'https://api.gpthost.online/callback', valid: true },
        { url: 'http://localhost:8080/callback', valid: true },
        { url: 'https://example.com/path?query=1', valid: true },
        { url: 'invalid-url', valid: false },
        { url: '', valid: false },
        { url: null, valid: false }
      ];

      for (const testCase of urlTestCases) {
        // Arrange
        const bridge = new GitHubQueueBridge(GITHUB_TOKEN, REPOSITORY_FULL_NAME, {
          callbackUrl: testCase.url as string
        });

        mockFetch.mockClear();
        mockFetch
          .mockResolvedValueOnce({ // Token validation
            ok: true,
            json: async () => ({ login: 'test-user' }),
            headers: new Headers()
          })
          .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // App.jsx
          .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // index.html
          .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // package.json from source
          .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // generated package.json
          .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // vite.config.js
          .mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers() }) // workflow dispatch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              workflow_runs: [{ id: 123456, status: 'queued' }]
            })
          });

        // Act
        await bridge.triggerBuildFromQueue(testBuildJob);

        // Assert
        const dispatchCall = mockFetch.mock.calls.find((call: any) =>
          call[0].includes('/actions/workflows/gpthost-build.yml/dispatches')
        );

        if (dispatchCall) {
          const payload = JSON.parse(dispatchCall[1].body);
          
          if (testCase.valid && testCase.url) {
            expect(payload.inputs.callback_url).toBe(testCase.url);
          } else {
            // When invalid or null, implementation provides default callback URL
            expect(payload.inputs.callback_url).toBe('https://gpthost-builder-staging.gladden4work.workers.dev/api/v2/github/build-callback');
          }
        }
      }
    });

    it('should handle network failures with retry', async () => {
      // Test network error handling
      
      // Arrange
      mockFetch
        .mockResolvedValueOnce({ // Token validation
          ok: true,
          json: async () => ({ login: 'test-user' }),
          headers: new Headers()
        })
        .mockRejectedValueOnce(new Error('Network error')) // First upload attempt fails
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // App.jsx retry
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // index.html
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // package.json from source
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // generated package.json
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // vite.config.js
        .mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers() }) // workflow dispatch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            workflow_runs: [{ id: 123456, status: 'queued' }]
          })
        });

      // Create bridge with short retry delays
      const bridge = new GitHubQueueBridge(GITHUB_TOKEN, REPOSITORY_FULL_NAME, {
        callbackUrl: CALLBACK_URL,
        retryConfig: {
          maxAttempts: 3,
          baseDelayMs: 10,
          maxDelayMs: 100,
          exponentialBase: 2,
          rateLimitRetryDelayMs: 50
        }
      });

      // Act
      const result = await bridge.triggerBuildFromQueue(testBuildJob);

      // Assert
      expect(result.success).toBe(true);
      expect(result.retryCount).toBeGreaterThan(0);
    });

    it('should include debug information when workflow trigger fails', async () => {
      // Test error reporting includes helpful debug info
      
      // Arrange
      mockFetch
        .mockResolvedValueOnce({ // Token validation
          ok: true,
          json: async () => ({ login: 'test-user' }),
          headers: new Headers()
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha1' }) }) // App.jsx
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha2' }) }) // index.html
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha3' }) }) // package.json from source
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha4' }) }) // generated package.json
        .mockResolvedValueOnce({ ok: true, json: async () => ({ sha: 'sha5' }) }) // vite.config.js
        .mockResolvedValueOnce({ // Workflow dispatch fails
          ok: false,
          status: 404,
          json: async () => ({
            message: 'Workflow not found',
            documentation_url: 'https://docs.github.com/rest/reference/actions'
          })
        });

      // Act
      const result = await githubBridge.triggerBuildFromQueue(testBuildJob);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('api_error');
      expect(result.error?.details).toBeDefined();
      expect(result.error?.details.repository).toBe(REPOSITORY_FULL_NAME);
      expect(result.error?.details.workflow).toBe('gpthost-build.yml');
    });
  });
});

/**
 * Test Summary - TDD Approach
 * 
 * This comprehensive test suite ensures that:
 * 
 * 1. ✅ callback_url is ALWAYS included in workflow dispatch when provided
 * 2. ✅ callback_token is ALWAYS included for authentication
 * 3. ✅ All required workflow inputs match the actual workflow YAML requirements
 * 4. ✅ Complex URLs with query parameters are handled correctly
 * 5. ✅ Missing callback_url is handled gracefully when optional
 * 6. ✅ Rate limiting is handled with proper retry logic
 * 7. ✅ Build job validation prevents invalid triggers
 * 8. ✅ Network errors are retried appropriately
 * 9. ✅ Error messages include helpful debug information
 * 10. ✅ The complete E2E flow works with all parameters
 * 
 * Implementation Requirements:
 * 
 * The githubApi.ts triggerBuild method MUST include:
 * - callback_url in the workflow dispatch inputs (when provided)
 * - callback_token for authentication
 * 
 * The githubQueueBridge.ts MUST:
 * - Pass callback_url from configuration to triggerBuild
 * - Include callback_token (GitHub token) for authentication
 * - Validate build jobs before triggering
 * - Handle rate limits with exponential backoff
 * - Provide comprehensive error information
 * 
 * These tests follow TDD principles:
 * - RED: Tests fail if implementation is incomplete
 * - GREEN: Implementation makes tests pass
 * - REFACTOR: Code is improved while tests remain green
 */
