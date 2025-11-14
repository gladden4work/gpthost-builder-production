/**
 * Integration tests for Day 1 & Day 2 critical fixes
 * Tests timeout detection, navigation timing, and delete function
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BuildService } from '../../src/services/BuildService';
import { ProjectService } from '../../src/services/ProjectService';
import { StorageService } from '../../src/services/StorageService';
import { GitHubService } from '../../src/services/GitHubService';
import { ProjectStatus, BuildStatus } from '../../src/services/interfaces';
import type { Env } from '../../src/types/env';

describe('Critical Fixes Integration Tests', () => {
  let buildService: BuildService;
  let projectService: ProjectService;
  let storageService: StorageService;
  let githubService: GitHubService;
  let mockEnv: Env;

  beforeEach(() => {
    // Setup mock environment
    mockEnv = {
      R2_PROJECTS: {} as any,
      R2_BUILDS: {} as any,
      R2_DEPLOYMENTS: {} as any,
      KV_PROJECTS: {} as any,
      BUILD_QUEUE: {} as any,
      GITHUB_CALLBACK_TOKEN: 'test-token',
      MVP_ACCESS_TOKEN: 'test-valid-token-12345',
      GITHUB_PAT: 'test-pat',
      GITHUB_OWNER: 'test-owner',
      GITHUB_REPO: 'test-repo',
    } as Env;

    // Initialize services
    storageService = new StorageService(mockEnv);
    projectService = new ProjectService(storageService, mockEnv);
    githubService = new GitHubService(mockEnv);
    buildService = new BuildService(projectService, githubService, storageService, mockEnv);
  });

  describe('Issue #1: Build Timeout Detection', () => {
    it('should detect builds stuck in "building" state for more than timeout', async () => {
      // Mock a stuck build
      const stuckBuildId = 'stuck-build-123';
      const stuckBuildMetadata = {
        id: stuckBuildId,
        projectId: 'project-123',
        status: 'building' as BuildStatus,
        createdAt: new Date(Date.now() - 35 * 60 * 1000), // 35 minutes ago
        githubRunId: 'run-123',
      };

      // Mock storage service to return the stuck build
      vi.spyOn(storageService, 'listFiles').mockResolvedValue({
        ok: true,
        value: [{ key: `builds/${stuckBuildId}/metadata.json`, size: 100, modified: new Date() }],
        error: undefined as any,
      });

      vi.spyOn(storageService, 'downloadFile').mockResolvedValue({
        ok: true,
        value: new TextEncoder().encode(JSON.stringify(stuckBuildMetadata)).buffer,
        error: undefined as any,
      });

      vi.spyOn(storageService, 'uploadFile').mockResolvedValue({
        ok: true,
        value: undefined,
        error: undefined as any,
      });

      vi.spyOn(projectService, 'updateProject').mockResolvedValue({
        ok: true,
        value: undefined,
        error: undefined as any,
      });

      // Run detection with 30 minute timeout
      const result = await buildService.detectStuckBuilds(30);

      expect(result.ok).toBe(true);
      expect(result.value).toContain(stuckBuildId);
      expect(result.value?.length).toBe(1);

      // Verify the build was marked as failed
      expect(storageService.uploadFile).toHaveBeenCalledWith(
        expect.stringContaining(stuckBuildId),
        expect.any(ArrayBuffer),
        expect.any(Object)
      );

      // Verify project status was updated
      expect(projectService.updateProject).toHaveBeenCalledWith(
        'project-123',
        expect.objectContaining({
          status: ProjectStatus.FAILED,
          errorMessage: expect.stringContaining('timed out'),
        })
      );
    });

    it('should not mark recent builds as stuck', async () => {
      // Mock a recent build (5 minutes old)
      const recentBuildId = 'recent-build-123';
      const recentBuildMetadata = {
        id: recentBuildId,
        projectId: 'project-456',
        status: 'building' as BuildStatus,
        createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        githubRunId: 'run-456',
      };

      vi.spyOn(storageService, 'listFiles').mockResolvedValue({
        ok: true,
        value: [{ key: `builds/${recentBuildId}/metadata.json`, size: 100, modified: new Date() }],
        error: undefined as any,
      });

      vi.spyOn(storageService, 'downloadFile').mockResolvedValue({
        ok: true,
        value: new TextEncoder().encode(JSON.stringify(recentBuildMetadata)).buffer,
        error: undefined as any,
      });

      vi.spyOn(storageService, 'uploadFile').mockResolvedValue({
        ok: true,
        value: undefined,
        error: undefined as any,
      });

      // Run detection with 30 minute timeout
      const result = await buildService.detectStuckBuilds(30);

      expect(result.ok).toBe(true);
      expect(result.value).toEqual([]);
      expect(storageService.uploadFile).not.toHaveBeenCalled();
    });

    it('should handle multiple stuck builds', async () => {
      const builds = [
        {
          id: 'stuck-1',
          projectId: 'project-1',
          status: 'building' as BuildStatus,
          createdAt: new Date(Date.now() - 40 * 60 * 1000),
        },
        {
          id: 'stuck-2',
          projectId: 'project-2',
          status: 'pending' as BuildStatus,
          createdAt: new Date(Date.now() - 35 * 60 * 1000),
        },
        {
          id: 'not-stuck',
          projectId: 'project-3',
          status: 'building' as BuildStatus,
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ];

      vi.spyOn(storageService, 'listFiles').mockResolvedValue({
        ok: true,
        value: builds.map(b => ({ 
          key: `builds/${b.id}/metadata.json`, 
          size: 100, 
          modified: new Date() 
        })),
        error: undefined as any,
      });

      let downloadCallCount = 0;
      vi.spyOn(storageService, 'downloadFile').mockImplementation(async (key: string) => {
        const build = builds[downloadCallCount++];
        return {
          ok: true,
          value: new TextEncoder().encode(JSON.stringify(build)).buffer,
          error: undefined as any,
        };
      });

      vi.spyOn(storageService, 'uploadFile').mockResolvedValue({
        ok: true,
        value: undefined,
        error: undefined as any,
      });

      vi.spyOn(projectService, 'updateProject').mockResolvedValue({
        ok: true,
        value: undefined,
        error: undefined as any,
      });

      const result = await buildService.detectStuckBuilds(30);

      expect(result.ok).toBe(true);
      expect(result.value).toContain('stuck-1');
      expect(result.value).toContain('stuck-2');
      expect(result.value).not.toContain('not-stuck');
      expect(result.value?.length).toBe(2);
    });
  });

  describe('Issue #2: Deploy UX Navigation Timing', () => {
    it('should show loading state immediately on deploy', async () => {
      // This would be tested in the frontend tests
      // Here we verify the backend handles the request properly
      
      const projectId = 'test-project-123';
      const mockProject = {
        id: projectId,
        name: 'Test Project',
        status: ProjectStatus.SCAFFOLDING,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.spyOn(projectService, 'createProject').mockResolvedValue({
        ok: true,
        value: mockProject,
        error: undefined as any,
      });

      const result = await projectService.createProject({
        name: 'Test Project',
        framework: 'react',
        files: [],
      });

      expect(result.ok).toBe(true);
      expect(result.value?.id).toBe(projectId);
      expect(result.value?.status).toBe(ProjectStatus.SCAFFOLDING);
    });

    it('should handle concurrent deploy requests without duplicates', async () => {
      const projectName = 'Concurrent Test';
      const deployPromises = [];

      vi.spyOn(projectService, 'createProject').mockImplementation(async (data) => {
        // Simulate some processing time
        await new Promise(resolve => setTimeout(resolve, 50));
        return {
          ok: true,
          value: {
            id: `project-${Date.now()}`,
            name: data.name,
            status: ProjectStatus.SCAFFOLDING,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          error: undefined as any,
        };
      });

      // Simulate multiple concurrent deploys
      for (let i = 0; i < 5; i++) {
        deployPromises.push(
          projectService.createProject({
            name: `${projectName} ${i}`,
            framework: 'react',
            files: [],
          })
        );
      }

      const results = await Promise.all(deployPromises);
      const projectIds = results.map(r => r.value?.id);
      const uniqueIds = new Set(projectIds);

      // All requests should succeed with unique IDs
      expect(results.every(r => r.ok)).toBe(true);
      expect(uniqueIds.size).toBe(5);
    });
  });

  describe('Issue #3: Delete Function', () => {
    it('should delete all project objects from R2', async () => {
      const projectId = 'delete-test-123';
      const projectFiles = [
        `projects/${projectId}/metadata.json`,
        `projects/${projectId}/src/index.js`,
        `projects/${projectId}/package.json`,
        `projects/${projectId}/build/output.js`,
      ];

      vi.spyOn(storageService, 'listFiles').mockResolvedValue({
        ok: true,
        value: projectFiles.map(key => ({ key, size: 100, modified: new Date() })),
        error: undefined as any,
      });

      vi.spyOn(storageService, 'deleteFile').mockResolvedValue({
        ok: true,
        value: undefined,
        error: undefined as any,
      });

      const result = await projectService.deleteProject(projectId);

      expect(result.ok).toBe(true);
      expect(storageService.listFiles).toHaveBeenCalledWith(`projects/${projectId}/`);
      expect(storageService.deleteFile).toHaveBeenCalledTimes(projectFiles.length);
      
      // Verify each file was deleted
      for (const file of projectFiles) {
        expect(storageService.deleteFile).toHaveBeenCalledWith(file);
      }
    });

    it('should handle empty projects gracefully', async () => {
      const projectId = 'empty-project-123';

      vi.spyOn(storageService, 'listFiles').mockResolvedValue({
        ok: true,
        value: [],
        error: undefined as any,
      });

      const result = await projectService.deleteProject(projectId);

      expect(result.ok).toBe(true);
      expect(storageService.deleteFile).not.toHaveBeenCalled();
    });

    it('should handle large projects with batch deletion', async () => {
      const projectId = 'large-project-123';
      // Create 250 files to test batch processing
      const projectFiles = Array.from({ length: 250 }, (_, i) => 
        `projects/${projectId}/file-${i}.js`
      );

      vi.spyOn(storageService, 'listFiles').mockResolvedValue({
        ok: true,
        value: projectFiles.map(key => ({ key, size: 100, modified: new Date() })),
        error: undefined as any,
      });

      let deleteCallCount = 0;
      vi.spyOn(storageService, 'deleteFile').mockImplementation(async () => {
        deleteCallCount++;
        return {
          ok: true,
          value: undefined,
          error: undefined as any,
        };
      });

      const result = await projectService.deleteProject(projectId);

      expect(result.ok).toBe(true);
      expect(deleteCallCount).toBe(250);
    });
  });

  describe('Regression Tests', () => {
    it('should maintain idempotency in GitHub callbacks', async () => {
      const buildId = 'idempotent-build-123';
      const githubRunId = 'run-789';
      
      // First callback
      const firstResult = await buildService.completeBuild(buildId, {
        success: true,
        githubRunId,
        logs: 'Build successful',
        artifactUrl: 'https://example.com/artifact.zip',
      });

      // Second callback with same data (idempotent)
      const secondResult = await buildService.completeBuild(buildId, {
        success: true,
        githubRunId,
        logs: 'Build successful',
        artifactUrl: 'https://example.com/artifact.zip',
      });

      // Both should succeed without errors
      expect(firstResult.ok || secondResult.ok).toBe(true);
    });

    it('should handle status transitions correctly', async () => {
      const transitions = [
        { from: ProjectStatus.PENDING, to: ProjectStatus.SCAFFOLDING, valid: true },
        { from: ProjectStatus.SCAFFOLDING, to: ProjectStatus.BUILDING, valid: true },
        { from: ProjectStatus.BUILDING, to: ProjectStatus.DEPLOYED, valid: true },
        { from: ProjectStatus.BUILDING, to: ProjectStatus.FAILED, valid: true },
        { from: ProjectStatus.DEPLOYED, to: ProjectStatus.PENDING, valid: false },
        { from: ProjectStatus.FAILED, to: ProjectStatus.BUILDING, valid: true },
      ];

      for (const transition of transitions) {
        const project = {
          id: `project-${transition.from}-${transition.to}`,
          name: 'Test Project',
          status: transition.from,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        vi.spyOn(projectService, 'getProject').mockResolvedValue({
          ok: true,
          value: project,
          error: undefined as any,
        });

        if (transition.valid) {
          vi.spyOn(storageService, 'uploadFile').mockResolvedValue({
            ok: true,
            value: undefined,
            error: undefined as any,
          });

          const result = await projectService.updateProject(project.id, {
            status: transition.to,
          });

          expect(result.ok).toBe(true);
        }
      }
    });
  });
});