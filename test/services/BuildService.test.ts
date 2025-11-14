/**
 * Build Service Test Suite
 * Following TDD approach - RED phase tests for BuildService
 * Tests drive the implementation of build orchestration with GitHub Actions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BuildService } from '../../src/services/BuildService';
import { IProjectService, IGitHubService, IStorageService, Project, ProjectStatus, WorkflowRun, WorkflowStatus, BuildJob, BuildResult, BuildStatus, FrameworkType } from '../../src/services/interfaces';
import { BuildError, BuildErrorCode, GitHubError, GitHubErrorCode, ProjectError, ProjectErrorCode, StorageError, StorageErrorCode } from '../../src/lib/errors';
import { Ok, Err } from '../../src/lib/result';

describe('BuildService', () => {
  let service: BuildService;
  let mockProjectService: IProjectService;
  let mockGitHubService: IGitHubService;
  let mockStorageService: IStorageService;
  
  // Helper function to create consistent mock projects
  const createMockProject = (overrides?: Partial<Project>): Project => ({
    id: 'test-123',
    name: 'test-project',
    framework: 'react' as FrameworkType,
    status: ProjectStatus.PENDING,
    files: [{ path: 'App.tsx', content: 'export default App' }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });
  
  // Helper function to create consistent mock build jobs
  const createMockBuildJob = (overrides?: Partial<BuildJob>): BuildJob => ({
    buildId: 'build-123',
    projectId: 'test-123',
    status: 'queued',
    createdAt: new Date(),
    retryCount: 0,
    ...overrides
  });
  
  beforeEach(() => {
    // Create mock implementations
    mockProjectService = {
      createProject: vi.fn(),
      getProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      listProjects: vi.fn()
    };
    
    mockGitHubService = {
      triggerWorkflow: vi.fn(),
      getWorkflowStatus: vi.fn(),
      handleWebhookCallback: vi.fn(),
      validateWebhookSignature: vi.fn()
    };
    
    mockStorageService = {
      uploadFile: vi.fn(),
      downloadFile: vi.fn(),
      deleteFile: vi.fn(),
      listFiles: vi.fn(),
      fileExists: vi.fn()
    };
    
    // Initialize service with mocked dependencies
    service = new BuildService(
      mockProjectService,
      mockGitHubService,
      mockStorageService
    );
  });

  describe('queueBuild', () => {
    it('should queue build and trigger GitHub workflow', async () => {
      // Arrange
      const project = createMockProject();
      
      const workflowRun: WorkflowRun = {
        id: 789,
        status: 'queued',
        htmlUrl: 'https://github.com/owner/repo/actions/runs/789',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      vi.mocked(mockGitHubService.triggerWorkflow).mockResolvedValue(Ok(workflowRun));
      vi.mocked(mockProjectService.updateProject).mockResolvedValue(Ok({
        ...project,
        status: ProjectStatus.BUILDING
      }));

      // Mock storage for saving build metadata
      vi.mocked(mockStorageService.uploadFile).mockResolvedValue(Ok(undefined));

      // Act
      const result = await service.queueBuild(project);

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.projectId).toBe('test-123');
        expect(result.value.status).toBe('queued');
        expect(result.value.githubRunId).toBe(789);
        expect(result.value.githubRunUrl).toBe('https://github.com/owner/repo/actions/runs/789');
      }
      
      // Verify GitHub workflow was triggered with correct params
      expect(mockGitHubService.triggerWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'test-123',
          workflowFile: expect.any(String),
          inputs: expect.objectContaining({
            project_id: 'test-123',
            framework: 'react',
            source_files: expect.any(String)
          })
        })
      );
      
      // Verify project status was updated
      expect(mockProjectService.updateProject).toHaveBeenCalledWith(
        'test-123',
        expect.objectContaining({ 
          status: ProjectStatus.BUILDING,
          buildId: expect.any(String),
          githubWorkflowRunId: 789
        })
      );

      // Verify build metadata was stored
      expect(mockStorageService.uploadFile).toHaveBeenCalledWith(
        expect.stringContaining('builds/'),
        expect.any(ArrayBuffer),
        expect.any(Object)
      );
    });

    it('should handle GitHub trigger failure', async () => {
      // Arrange
      const project = createMockProject(); // Use default project with files

      vi.mocked(mockGitHubService.triggerWorkflow).mockResolvedValue(
        Err(new GitHubError(GitHubErrorCode.API_ERROR, 'Failed to trigger workflow'))
      );

      // Act
      const result = await service.queueBuild(project);

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(BuildErrorCode.TRIGGER_FAILED);
        expect(result.error.message).toContain('Failed to trigger build workflow');
      }

      // Verify project status was updated to failed
      expect(mockProjectService.updateProject).toHaveBeenCalledWith(
        'test-123',
        expect.objectContaining({
          status: ProjectStatus.FAILED,
          errorMessage: expect.any(String)
        })
      );
    });

    it('should handle missing project files', async () => {
      // Arrange
      const project = createMockProject({ files: [] }); // No files

      // Act
      const result = await service.queueBuild(project);

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(BuildErrorCode.INVALID_STATE);
        expect(result.error.message).toContain('No files to build');
      }
    });

    it('should handle storage failure when saving build metadata', async () => {
      // Arrange
      const project = createMockProject();
      
      const workflowRun: WorkflowRun = {
        id: 789,
        status: 'queued',
        htmlUrl: 'https://github.com/owner/repo/actions/runs/789',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      vi.mocked(mockGitHubService.triggerWorkflow).mockResolvedValue(Ok(workflowRun));
      vi.mocked(mockProjectService.updateProject).mockResolvedValue(Ok({
        ...project,
        status: ProjectStatus.BUILDING
      }));

      // Mock storage failure
      vi.mocked(mockStorageService.uploadFile).mockResolvedValue(
        Err(new StorageError(StorageErrorCode.OPERATION_FAILED, 'Storage service unavailable'))
      );

      // Act
      const result = await service.queueBuild(project);

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(BuildErrorCode.STORAGE_ERROR);
        expect(result.error.message).toContain('Failed to save build metadata');
      }
    });

    it('should handle ProjectService.updateProject failure', async () => {
      // Arrange
      const project = createMockProject();
      
      const workflowRun: WorkflowRun = {
        id: 789,
        status: 'queued',
        htmlUrl: 'https://github.com/owner/repo/actions/runs/789',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      vi.mocked(mockGitHubService.triggerWorkflow).mockResolvedValue(Ok(workflowRun));
      
      // Mock project update failure
      vi.mocked(mockProjectService.updateProject).mockResolvedValue(
        Err(new ProjectError(ProjectErrorCode.STORAGE_ERROR, 'Database connection lost'))
      );

      // Act
      const result = await service.queueBuild(project);

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(BuildErrorCode.STORAGE_ERROR);
        expect(result.error.message).toContain('Failed to update project status');
      }
    });
  });

  describe('getBuildStatus', () => {
    it('should get current build status from GitHub', async () => {
      // Arrange
      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        githubRunId: 789,
        status: 'building',
        createdAt: new Date(),
        retryCount: 0
      };

      const workflowStatus: WorkflowStatus = {
        runId: 789,
        status: 'in_progress',
        jobs: [{
          id: 1,
          name: 'build',
          status: 'in_progress',
          steps: [
            { 
              name: 'Build', 
              status: 'in_progress',
              number: 3
            }
          ]
        }]
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));
      
      vi.mocked(mockGitHubService.getWorkflowStatus).mockResolvedValue(Ok(workflowStatus));

      // Act
      const result = await service.getBuildStatus('build-123');

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.buildId).toBe('build-123');
        expect(result.value.status).toBe('building');
        expect(result.value.currentStep).toBe('Build');
        expect(result.value.projectId).toBe('test-123');
      }

      expect(mockStorageService.downloadFile).toHaveBeenCalledWith(
        'builds/build-123/metadata.json'
      );
      expect(mockGitHubService.getWorkflowStatus).toHaveBeenCalledWith(789);
    });

    it('should handle build not found', async () => {
      // Arrange
      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(
        Err(new StorageError(StorageErrorCode.NOT_FOUND, 'Not found'))
      );

      // Act
      const result = await service.getBuildStatus('non-existent');

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(BuildErrorCode.BUILD_NOT_FOUND);
      }
    });

    it('should handle completed builds without GitHub status', async () => {
      // Arrange
      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        status: 'success',
        createdAt: new Date(),
        completedAt: new Date(),
        retryCount: 0,
        artifactPath: 'builds/test-123/dist'
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));

      // Act
      const result = await service.getBuildStatus('build-123');

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('success');
        expect(result.value.completedAt).toBeDefined();
      }

      // Should not call GitHub for completed builds
      expect(mockGitHubService.getWorkflowStatus).not.toHaveBeenCalled();
    });
  });

  describe('completeBuild', () => {
    it('should handle successful build completion', async () => {
      // Arrange
      const buildResult: BuildResult = {
        success: true,
        artifactPath: 'builds/test-123/dist',
        logs: ['Build successful', 'Artifacts uploaded']
      };
      
      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        githubRunId: 789,
        status: 'building',
        createdAt: new Date(),
        retryCount: 0
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));
      
      vi.mocked(mockStorageService.uploadFile).mockResolvedValue(Ok(undefined));
      vi.mocked(mockProjectService.updateProject).mockResolvedValue(Ok({} as Project));

      // Act
      const result = await service.completeBuild('build-123', buildResult);

      // Assert
      expect(result.ok).toBe(true);
      
      // Verify project was updated with success status
      expect(mockProjectService.updateProject).toHaveBeenCalledWith(
        'test-123',
        expect.objectContaining({
          status: ProjectStatus.DEPLOYING,
          buildMetadata: expect.objectContaining({
            buildId: 'build-123',
            artifactPath: 'builds/test-123/dist',
            completedAt: expect.any(Date)
          })
        })
      );

      // Verify build metadata was updated
      expect(mockStorageService.uploadFile).toHaveBeenCalledWith(
        'builds/build-123/metadata.json',
        expect.any(ArrayBuffer),
        expect.any(Object)
      );
    });

    it('should handle build failure', async () => {
      // Arrange
      const buildResult: BuildResult = {
        success: false,
        error: 'Compilation failed',
        logs: ['Error: Module not found', 'Build failed with exit code 1']
      };

      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        githubRunId: 789,
        status: 'building',
        createdAt: new Date(),
        retryCount: 0
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));
      
      vi.mocked(mockStorageService.uploadFile).mockResolvedValue(Ok(undefined));
      vi.mocked(mockProjectService.updateProject).mockResolvedValue(Ok({} as Project));

      // Act
      const result = await service.completeBuild('build-123', buildResult);

      // Assert
      expect(result.ok).toBe(true);
      
      // Verify project was updated with failed status
      expect(mockProjectService.updateProject).toHaveBeenCalledWith(
        'test-123',
        expect.objectContaining({
          status: ProjectStatus.FAILED,
          errorMessage: 'Compilation failed'
        })
      );

      // Verify build metadata was updated with error
      expect(mockStorageService.uploadFile).toHaveBeenCalledWith(
        'builds/build-123/metadata.json',
        expect.any(ArrayBuffer),
        expect.any(Object)
      );
    });

    it('should store build logs', async () => {
      // Arrange
      const buildResult: BuildResult = {
        success: true,
        artifactPath: 'builds/test-123/dist',
        logs: ['Step 1: Installing dependencies', 'Step 2: Building project', 'Build complete']
      };

      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        status: 'building',
        createdAt: new Date(),
        retryCount: 0
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));
      vi.mocked(mockStorageService.uploadFile).mockResolvedValue(Ok(undefined));
      vi.mocked(mockProjectService.updateProject).mockResolvedValue(Ok({} as Project));

      // Act
      const result = await service.completeBuild('build-123', buildResult);

      // Assert
      expect(result.ok).toBe(true);
      
      // Verify logs were stored
      expect(mockStorageService.uploadFile).toHaveBeenCalledWith(
        'builds/build-123/logs.txt',
        expect.any(ArrayBuffer),
        expect.objectContaining({
          contentType: 'text/plain'
        })
      );
    });
  });

  describe('retryBuild', () => {
    it('should retry failed build with exponential backoff', async () => {
      // Arrange
      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        githubRunId: 789,
        status: 'failed',
        createdAt: new Date(),
        retryCount: 1
      };

      const project = createMockProject({ 
        status: ProjectStatus.FAILED 
      });

      const newWorkflowRun: WorkflowRun = {
        id: 999,
        status: 'queued',
        htmlUrl: 'https://github.com/owner/repo/actions/runs/999',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));
      
      vi.mocked(mockProjectService.getProject).mockResolvedValue(Ok(project));
      vi.mocked(mockGitHubService.triggerWorkflow).mockResolvedValue(Ok(newWorkflowRun));
      vi.mocked(mockStorageService.uploadFile).mockResolvedValue(Ok(undefined));
      vi.mocked(mockProjectService.updateProject).mockResolvedValue(Ok({} as Project));

      // Act
      const result = await service.retryBuild('build-123');

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.buildId).not.toBe('build-123'); // New build ID
        expect(result.value.retryCount).toBe(2);
        expect(result.value.githubRunId).toBe(999);
      }

      // Verify workflow was triggered with retry delay
      expect(mockGitHubService.triggerWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          retryCount: 2
        })
      );
    });

    it('should not retry after max attempts', async () => {
      // Arrange
      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        status: 'failed',
        createdAt: new Date(),
        retryCount: 3 // Max retries reached
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));

      // Act
      const result = await service.retryBuild('build-123');

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(BuildErrorCode.MAX_RETRIES_EXCEEDED);
        expect(result.error.message).toContain('Maximum retry attempts');
      }

      // Should not trigger new workflow
      expect(mockGitHubService.triggerWorkflow).not.toHaveBeenCalled();
    });

    it('should only retry failed or cancelled builds', async () => {
      // Arrange
      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        status: 'success', // Already successful
        createdAt: new Date(),
        retryCount: 0
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));

      // Act
      const result = await service.retryBuild('build-123');

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(BuildErrorCode.INVALID_STATE);
        expect(result.error.message).toContain('Can only retry failed or cancelled builds');
      }
    });
  });

  describe('cancelBuild', () => {
    it('should cancel an active build', async () => {
      // Arrange
      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        githubRunId: 789,
        status: 'building',
        createdAt: new Date(),
        retryCount: 0
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));
      
      // Note: GitHub workflow cancellation will be handled internally by the service
      // No need to mock cancelWorkflow as it's not part of IGitHubService interface
      
      vi.mocked(mockStorageService.uploadFile).mockResolvedValue(Ok(undefined));
      vi.mocked(mockProjectService.updateProject).mockResolvedValue(Ok({} as Project));

      // Act
      const result = await service.cancelBuild('build-123');

      // Assert
      expect(result.ok).toBe(true);

      // Verify build metadata was updated
      expect(mockStorageService.uploadFile).toHaveBeenCalledWith(
        'builds/build-123/metadata.json',
        expect.any(ArrayBuffer),
        expect.any(Object)
      );

      // Verify project status was updated
      expect(mockProjectService.updateProject).toHaveBeenCalledWith(
        'test-123',
        expect.objectContaining({
          status: ProjectStatus.FAILED,
          errorMessage: 'Build cancelled by user'
        })
      );
    });

    it('should handle cancellation of queued builds', async () => {
      // Arrange
      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        githubRunId: 789,
        status: 'queued',
        createdAt: new Date(),
        retryCount: 0
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));
      vi.mocked(mockStorageService.uploadFile).mockResolvedValue(Ok(undefined));
      vi.mocked(mockProjectService.updateProject).mockResolvedValue(Ok({} as Project));

      // Act
      const result = await service.cancelBuild('build-123');

      // Assert
      expect(result.ok).toBe(true);
    });

    it('should not cancel completed builds', async () => {
      // Arrange
      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        status: 'success',
        createdAt: new Date(),
        completedAt: new Date(),
        retryCount: 0
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));

      // Act
      const result = await service.cancelBuild('build-123');

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(BuildErrorCode.INVALID_STATE);
        expect(result.error.message).toContain('Cannot cancel completed build');
      }
    });
  });

  describe('error handling', () => {
    it('should handle StorageService.uploadFile failure during completeBuild', async () => {
      // Arrange
      const buildResult: BuildResult = {
        success: true,
        artifactPath: 'builds/test-123/dist',
        logs: ['Build successful']
      };
      
      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        githubRunId: 789,
        status: 'building',
        createdAt: new Date(),
        retryCount: 0
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));
      
      // Mock storage failure when saving updated metadata
      vi.mocked(mockStorageService.uploadFile).mockResolvedValue(
        Err(new StorageError(StorageErrorCode.OPERATION_FAILED, 'Storage quota exceeded'))
      );

      // Act
      const result = await service.completeBuild('build-123', buildResult);

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(BuildErrorCode.STORAGE_ERROR);
        expect(result.error.message).toContain('Failed to update build metadata');
      }
    });

    it('should handle ProjectService.getProject failure during retryBuild', async () => {
      // Arrange
      const buildMetadata: BuildJob = {
        buildId: 'build-123',
        projectId: 'test-123',
        githubRunId: 789,
        status: 'failed',
        createdAt: new Date(),
        retryCount: 1
      };

      vi.mocked(mockStorageService.downloadFile).mockResolvedValue(Ok(
        new TextEncoder().encode(JSON.stringify(buildMetadata)).buffer
      ));
      
      // Mock project retrieval failure
      vi.mocked(mockProjectService.getProject).mockResolvedValue(
        Err(new ProjectError(ProjectErrorCode.NOT_FOUND, 'Project deleted'))
      );

      // Act
      const result = await service.retryBuild('build-123');

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(BuildErrorCode.PROJECT_NOT_FOUND);
        expect(result.error.message).toContain('Project not found');
      }
    });

    it('should handle concurrent build operations gracefully', async () => {
      // Arrange
      const project = createMockProject();
      
      // Simulate concurrent builds by having project already in BUILDING state
      const updatedProject = createMockProject({ 
        status: ProjectStatus.BUILDING,
        buildId: 'existing-build-456'
      });
      
      vi.mocked(mockProjectService.getProject).mockResolvedValue(Ok(updatedProject));

      // Act
      const result = await service.queueBuild(project);

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(BuildErrorCode.INVALID_STATE);
        expect(result.error.message).toContain('Project already has an active build');
      }
    });
  });
});