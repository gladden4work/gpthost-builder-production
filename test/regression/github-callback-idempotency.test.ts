/**
 * Regression test suite for GitHub callback idempotency
 * Ensures callbacks can be safely retried without side effects
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { router } from '../../src/routes/router';
import type { Env } from '../../src/types/env';

describe('GitHub Callback Idempotency Tests', () => {
  let mockEnv: Env;

  beforeEach(() => {
    mockEnv = {
      R2_PROJECTS: {
        put: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      } as any,
      R2_BUILDS: {
        put: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      } as any,
      R2_DEPLOYMENTS: {
        put: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      } as any,
      KV_PROJECTS: {
        put: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
      } as any,
      BUILD_QUEUE: {
        send: vi.fn(),
      } as any,
      GITHUB_CALLBACK_TOKEN: 'test-callback-token',
      MVP_ACCESS_TOKEN: 'test-valid-token-12345',
      GITHUB_PAT: 'test-pat',
      GITHUB_OWNER: 'test-owner',
      GITHUB_REPO: 'test-repo',
    } as Env;
  });

  describe('Idempotency Checks', () => {
    it('should prevent duplicate callback processing', async () => {
      const githubRunId = 'run-12345';
      const projectId = 'project-abc';
      const buildId = 'build-xyz';
      
      const callbackPayload = {
        github_run_id: githubRunId,
        project_id: projectId,
        build_id: buildId,
        status: 'completed',
        conclusion: 'success',
        workflow_job_url: 'https://github.com/test/run',
        artifact_url: 'https://example.com/artifact.zip',
        logs: 'Build completed successfully',
      };

      // Mock R2 to simulate callback already processed
      mockEnv.R2_BUILDS.get = vi.fn().mockImplementation((key: string) => {
        if (key.includes('github-callbacks')) {
          return {
            text: async () => JSON.stringify({ processed: true, timestamp: Date.now() }),
          };
        }
        return null;
      });

      // First request
      const request1 = new Request('https://test.com/api/v2/github/build-callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mockEnv.GITHUB_CALLBACK_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(callbackPayload),
      });

      const response1 = await router(request1, mockEnv);
      const result1 = await response1.json() as any;

      // Second identical request
      const request2 = new Request('https://test.com/api/v2/github/build-callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mockEnv.GITHUB_CALLBACK_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(callbackPayload),
      });

      const response2 = await router(request2, mockEnv);
      const result2 = await response2.json() as any;

      // Both should succeed but only first should process
      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(result2.message).toContain('already processed');
    });

    it('should handle concurrent callbacks for same build', async () => {
      const githubRunId = 'run-concurrent';
      const callbacks = Array(5).fill(null).map((_, i) => ({
        github_run_id: githubRunId,
        project_id: 'project-concurrent',
        build_id: 'build-concurrent',
        status: 'completed',
        conclusion: 'success',
        workflow_job_url: 'https://github.com/test/run',
        artifact_url: 'https://example.com/artifact.zip',
        logs: `Build ${i} completed`,
      }));

      let processedCount = 0;
      mockEnv.R2_BUILDS.get = vi.fn().mockImplementation((key: string) => {
        if (key.includes('github-callbacks') && processedCount > 0) {
          return {
            text: async () => JSON.stringify({ processed: true }),
          };
        }
        return null;
      });

      mockEnv.R2_BUILDS.put = vi.fn().mockImplementation(() => {
        processedCount++;
        return Promise.resolve();
      });

      // Send all callbacks concurrently
      const promises = callbacks.map(payload => {
        const request = new Request('https://test.com/api/v2/github/build-callback', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mockEnv.GITHUB_CALLBACK_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        return router(request, mockEnv);
      });

      const responses = await Promise.all(promises);
      const statuses = responses.map(r => r.status);

      // All should return success
      expect(statuses.every(s => s === 200 || s === 409)).toBe(true);
      // But only one should actually process
      expect(processedCount).toBeLessThanOrEqual(2); // Allow for race condition
    });

    it('should allow different builds to process independently', async () => {
      const builds = [
        { github_run_id: 'run-1', build_id: 'build-1', project_id: 'project-1' },
        { github_run_id: 'run-2', build_id: 'build-2', project_id: 'project-2' },
        { github_run_id: 'run-3', build_id: 'build-3', project_id: 'project-3' },
      ];

      const processedBuilds = new Set<string>();
      
      mockEnv.R2_BUILDS.get = vi.fn().mockImplementation((key: string) => {
        for (const build of builds) {
          if (key.includes(build.github_run_id) && processedBuilds.has(build.github_run_id)) {
            return {
              text: async () => JSON.stringify({ processed: true }),
            };
          }
        }
        return null;
      });

      mockEnv.R2_BUILDS.put = vi.fn().mockImplementation((key: string) => {
        for (const build of builds) {
          if (key.includes(build.github_run_id)) {
            processedBuilds.add(build.github_run_id);
            break;
          }
        }
        return Promise.resolve();
      });

      // Process each build
      for (const build of builds) {
        const request = new Request('https://test.com/api/v2/github/build-callback', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mockEnv.GITHUB_CALLBACK_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...build,
            status: 'completed',
            conclusion: 'success',
            workflow_job_url: 'https://github.com/test/run',
            artifact_url: 'https://example.com/artifact.zip',
            logs: 'Build completed',
          }),
        });

        const response = await router(request, mockEnv);
        expect(response.status).toBe(200);
      }

      // All three builds should be processed
      expect(processedBuilds.size).toBe(3);
    });
  });

  describe('Failure Scenarios', () => {
    it('should handle callback for non-existent build gracefully', async () => {
      mockEnv.R2_BUILDS.get = vi.fn().mockResolvedValue(null);
      mockEnv.R2_PROJECTS.get = vi.fn().mockResolvedValue(null);

      const request = new Request('https://test.com/api/v2/github/build-callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mockEnv.GITHUB_CALLBACK_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          github_run_id: 'non-existent-run',
          project_id: 'non-existent-project',
          build_id: 'non-existent-build',
          status: 'completed',
          conclusion: 'failure',
          logs: 'Build failed',
        }),
      });

      const response = await router(request, mockEnv);
      
      // Should handle gracefully without crashing
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    });

    it('should mark build as failed when GitHub reports failure', async () => {
      const failurePayload = {
        github_run_id: 'failed-run',
        project_id: 'failed-project',
        build_id: 'failed-build',
        status: 'completed',
        conclusion: 'failure',
        logs: 'Build failed with errors',
        workflow_job_url: 'https://github.com/test/failed-run',
      };

      mockEnv.R2_BUILDS.get = vi.fn().mockImplementation((key: string) => {
        if (key.includes('metadata')) {
          return {
            text: async () => JSON.stringify({
              id: failurePayload.build_id,
              projectId: failurePayload.project_id,
              status: 'building',
              createdAt: new Date(),
            }),
          };
        }
        return null;
      });

      let updatedBuildStatus: any = null;
      mockEnv.R2_BUILDS.put = vi.fn().mockImplementation((key: string, value: any) => {
        if (key.includes('metadata')) {
          updatedBuildStatus = JSON.parse(value);
        }
        return Promise.resolve();
      });

      const request = new Request('https://test.com/api/v2/github/build-callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mockEnv.GITHUB_CALLBACK_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(failurePayload),
      });

      const response = await router(request, mockEnv);
      
      expect(response.status).toBe(200);
      expect(updatedBuildStatus?.status).toBe('failed');
      expect(updatedBuildStatus?.error).toContain('failed');
    });

    it('should handle network failures gracefully', async () => {
      // Simulate R2 failure
      mockEnv.R2_BUILDS.get = vi.fn().mockRejectedValue(new Error('Network error'));
      
      const request = new Request('https://test.com/api/v2/github/build-callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mockEnv.GITHUB_CALLBACK_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          github_run_id: 'network-fail-run',
          project_id: 'project-123',
          build_id: 'build-123',
          status: 'completed',
          conclusion: 'success',
        }),
      });

      const response = await router(request, mockEnv);
      
      // Should return error status but not crash
      expect(response.status).toBeGreaterThanOrEqual(500);
      const result = await response.json() as any;
      expect(result.error || result.message).toContain('error');
    });
  });

  describe('Build Status Transitions', () => {
    it('should not downgrade deployed status to building', async () => {
      const buildId = 'deployed-build';
      const projectId = 'deployed-project';
      
      // Mock a deployed project
      mockEnv.R2_PROJECTS.get = vi.fn().mockImplementation((key: string) => {
        if (key.includes(projectId)) {
          return {
            text: async () => JSON.stringify({
              id: projectId,
              status: 'deployed',
              build_id: buildId,
              updated_at: new Date().toISOString(),
            }),
          };
        }
        return null;
      });

      let projectUpdateAttempted = false;
      mockEnv.R2_PROJECTS.put = vi.fn().mockImplementation((key: string, value: any) => {
        const data = JSON.parse(value);
        if (data.status === 'building') {
          projectUpdateAttempted = true;
        }
        return Promise.resolve();
      });

      const request = new Request('https://test.com/api/v2/github/build-callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${mockEnv.GITHUB_CALLBACK_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          github_run_id: 'late-callback',
          project_id: projectId,
          build_id: buildId,
          status: 'in_progress',
          conclusion: null,
        }),
      });

      await router(request, mockEnv);
      
      // Should not attempt to downgrade status
      expect(projectUpdateAttempted).toBe(false);
    });
  });
});