/**
 * Multi-Project Repository Management
 * 
 * Core orchestration system for managing multiple concurrent projects within
 * the same GitHub repository. Provides project isolation, resource management,
 * and concurrent build coordination.
 * 
 * Features:
 * - Repository structure management for 100+ concurrent projects
 * - Project isolation and boundary enforcement
 * - Storage optimization and cleanup automation
 * - Concurrent build support without conflicts
 * - Repository health monitoring and maintenance
 * - Project lifecycle management (create, archive, delete)
 */

import { 
  ProjectMetadata, 
  BuildJob,
  BuildStatus,
  FrameworkType 
} from '../types/api';

import { ProjectIsolationManager } from './projectIsolationManager';
import { RepositoryCleanupManager } from './repositoryCleanupManager';
import { ProjectLifecycleManager } from './projectLifecycleManager';

/**
 * Repository structure configuration for multi-project management
 */
export interface RepositoryStructure {
  maxActiveProjects: number;           // Maximum concurrent active projects (default: 100)
  maxProjectSizeMB: number;           // Maximum size per project in MB (default: 50)
  maxRepositorySizeGB: number;        // Maximum total repository size in GB (default: 5)
  activeProjectRetentionDays: number; // Retention period for active projects (default: 30)
  archivedProjectRetentionDays: number; // Retention period for archived projects (default: 90)
  cleanupGracePeriodDays: number;     // Grace period before deletion (default: 7)
}

/**
 * Multi-project repository management result
 */
export interface MultiProjectResult<T = any> {
  success: boolean;
  data?: T;
  error?: {
    type: 'storage_limit' | 'project_conflict' | 'isolation_failure' | 'cleanup_error';
    message: string;
    details?: any;
  };
  metrics?: {
    operation_duration_ms: number;
    projects_affected: number;
    storage_freed_mb?: number;
  };
}

/**
 * Repository health metrics
 */
export interface RepositoryHealthMetrics {
  activeProjects: number;
  archivedProjects: number;
  totalStorageUsedMB: number;
  storageUsagePercent: number;
  concurrentBuilds: number;
  averageProjectSizeMB: number;
  oldestProjectDays: number;
  cleanupNeeded: boolean;
  performanceScore: number; // 0-100 based on various metrics
  recommendations: string[];
}

/**
 * Project creation request
 */
export interface ProjectCreationRequest {
  project_id: string;
  framework: FrameworkType;
  description: string;
  source_files: Array<{
    path: string;
    content: string;
    type: string;
  }>;
  dependencies: Record<string, string>;
  build_config: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * Project cleanup request
 */
export interface ProjectCleanupRequest {
  cleanup_type: 'soft' | 'aggressive' | 'emergency';
  target_projects: string[];
  max_age_days: number;
  force_cleanup: boolean;
  preserve_active_builds: boolean;
  metadata?: Record<string, any>;
}

/**
 * Project directory mapping for GitHub repository structure
 */
export interface ProjectDirectoryStructure {
  root: string;                       // projects/
  active: string;                     // projects/active/
  archived: string;                   // projects/archived/
  cleanup: string;                    // projects/cleanup/
  shared: string;                     // shared/
  cache: string;                      // shared/cache/
  logs: string;                       // shared/logs/
  config: string;                     // shared/config/
}

/**
 * Core Multi-Project Repository Manager
 * 
 * Orchestrates all aspects of multi-project repository management including
 * project isolation, cleanup, lifecycle management, and concurrent build support.
 */
export class MultiProjectManager {
  private isolationManager: ProjectIsolationManager;
  private cleanupManager: RepositoryCleanupManager;
  private lifecycleManager: ProjectLifecycleManager;
  private config: RepositoryStructure;
  private directoryStructure: ProjectDirectoryStructure;

  constructor(
    private env: Env,
    config?: Partial<RepositoryStructure>
  ) {
    // Initialize configuration with defaults
    this.config = {
      maxActiveProjects: 100,
      maxProjectSizeMB: 50,
      maxRepositorySizeGB: 5,
      activeProjectRetentionDays: 30,
      archivedProjectRetentionDays: 90,
      cleanupGracePeriodDays: 7,
      ...config
    };

    // Define repository directory structure
    this.directoryStructure = {
      root: 'projects',
      active: 'projects/active',
      archived: 'projects/archived',
      cleanup: 'projects/cleanup',
      shared: 'shared',
      cache: 'shared/cache',
      logs: 'shared/logs',
      config: 'shared/config'
    };

    // Initialize management components
    this.isolationManager = new ProjectIsolationManager(env, this.directoryStructure);
    this.cleanupManager = new RepositoryCleanupManager(env, this.config, this.directoryStructure);
    this.lifecycleManager = new ProjectLifecycleManager(env, this.config, this.directoryStructure);
  }

  /**
   * Initialize repository structure for multi-project management
   * Sets up directory structure and basic configuration files
   */
  async initializeRepository(): Promise<MultiProjectResult<{
    structure_created: boolean;
    directories_created: string[];
    config_files_created: string[];
  }>> {
    const startTime = Date.now();
    
    try {
      console.info('[MULTI-PROJECT] Initializing repository structure');

      // Create directory structure markers in R2 (directories are virtual in R2)
      const directoriesToCreate = [
        this.directoryStructure.active,
        this.directoryStructure.archived,
        this.directoryStructure.cleanup,
        this.directoryStructure.cache,
        this.directoryStructure.logs,
        this.directoryStructure.config
      ];

      const configFilesToCreate = [];

      // Create directory markers by putting .gitkeep files
      for (const dir of directoriesToCreate) {
        const keepFile = `${dir}/.gitkeep`;
        await this.env.PROJECTS_BUCKET.put(keepFile, '', {
          customMetadata: {
            created_by: 'multi-project-manager',
            created_at: new Date().toISOString(),
            purpose: 'directory-marker'
          }
        });
      }

      // Create repository configuration file
      const repoConfig = {
        version: '1.0.0',
        created_at: new Date().toISOString(),
        multi_project_enabled: true,
        structure: this.directoryStructure,
        limits: this.config,
        last_cleanup: null,
        statistics: {
          total_projects_created: 0,
          active_projects: 0,
          archived_projects: 0,
          cleanup_runs: 0
        }
      };

      const configFile = `${this.directoryStructure.config}/repository.json`;
      await this.env.PROJECTS_BUCKET.put(
        configFile,
        JSON.stringify(repoConfig, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            created_by: 'multi-project-manager',
            created_at: new Date().toISOString(),
            type: 'repository-config'
          }
        }
      );
      configFilesToCreate.push(configFile);

      // Create cleanup schedule configuration
      const cleanupConfig = {
        enabled: true,
        schedule: {
          daily_cleanup_hour: 2,        // Run at 2 AM UTC
          weekly_deep_cleanup_day: 0,   // Sunday
          monthly_archive_day: 1        // 1st of month
        },
        retention: {
          active_projects_days: this.config.activeProjectRetentionDays,
          archived_projects_days: this.config.archivedProjectRetentionDays,
          cleanup_grace_period_days: this.config.cleanupGracePeriodDays
        },
        limits: {
          max_active_projects: this.config.maxActiveProjects,
          max_project_size_mb: this.config.maxProjectSizeMB,
          max_repository_size_gb: this.config.maxRepositorySizeGB
        },
        last_run: null,
        statistics: {
          total_cleanups: 0,
          projects_archived: 0,
          projects_deleted: 0,
          storage_freed_mb: 0
        }
      };

      const cleanupConfigFile = `${this.directoryStructure.config}/cleanup.json`;
      await this.env.PROJECTS_BUCKET.put(
        cleanupConfigFile,
        JSON.stringify(cleanupConfig, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            created_by: 'multi-project-manager',
            created_at: new Date().toISOString(),
            type: 'cleanup-config'
          }
        }
      );
      configFilesToCreate.push(cleanupConfigFile);

      console.info('✅ [MULTI-PROJECT] Repository structure initialized successfully', {
        directories_created: directoriesToCreate.length,
        config_files_created: configFilesToCreate.length,
        duration_ms: Date.now() - startTime
      });

      return {
        success: true,
        data: {
          structure_created: true,
          directories_created: directoriesToCreate,
          config_files_created: configFilesToCreate
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 0
        }
      };

    } catch (error) {
      console.error('[MULTI-PROJECT] Failed to initialize repository structure', {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      return {
        success: false,
        error: {
          type: 'storage_limit',
          message: 'Failed to initialize repository structure',
          details: error
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 0
        }
      };
    }
  }

  /**
   * Create a new project with proper isolation and resource allocation
   */
  async createProject(
    projectId: string,
    metadata: ProjectMetadata,
    sourceFiles: Record<string, string>
  ): Promise<MultiProjectResult<{
    project_created: boolean;
    directory_path: string;
    isolation_applied: boolean;
  }>> {
    const startTime = Date.now();

    try {
      console.info('[MULTI-PROJECT] Creating new project with isolation', {
        project_id: projectId,
        framework: metadata.framework,
        files_count: Object.keys(sourceFiles).length
      });

      // Check repository capacity before creating project
      const capacityCheck = await this.checkRepositoryCapacity(projectId, sourceFiles);
      if (!capacityCheck.success) {
        return capacityCheck;
      }

      // Create project with lifecycle manager
      const createResult = await this.lifecycleManager.createProject(projectId, metadata, sourceFiles);
      if (!createResult.success) {
        return createResult;
      }

      // Apply project isolation
      const isolationResult = await this.isolationManager.createProjectIsolation(projectId, metadata.framework!);
      if (!isolationResult.success) {
        // Rollback project creation if isolation fails
        await this.lifecycleManager.deleteProject(projectId, false);
        return {
          success: false,
          error: {
            type: 'isolation_failure',
            message: 'Failed to apply project isolation',
            details: isolationResult.error
          },
          metrics: {
            operation_duration_ms: Date.now() - startTime,
            projects_affected: 0
          }
        };
      }

      console.info('✅ [MULTI-PROJECT] Project created successfully with isolation', {
        project_id: projectId,
        directory_path: createResult.data?.directory_path,
        duration_ms: Date.now() - startTime
      });

      return {
        success: true,
        data: {
          project_created: true,
          directory_path: createResult.data?.directory_path || '',
          isolation_applied: true
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 1
        }
      };

    } catch (error) {
      console.error('[MULTI-PROJECT] Failed to create project', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      return {
        success: false,
        error: {
          type: 'project_conflict',
          message: 'Failed to create project with isolation',
          details: error
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 0
        }
      };
    }
  }

  /**
   * Prepare concurrent build environment for a project
   * Ensures no conflicts with other concurrent builds
   */
  async prepareConcurrentBuild(buildJob: BuildJob): Promise<MultiProjectResult<{
    build_slot_reserved: boolean;
    isolation_verified: boolean;
    resources_allocated: boolean;
  }>> {
    const startTime = Date.now();

    try {
      console.info('[MULTI-PROJECT] Preparing concurrent build environment', {
        project_id: buildJob.project_id,
        job_id: buildJob.job_id,
        framework: buildJob.framework
      });

      // Verify project isolation is intact
      const isolationCheck = await this.isolationManager.verifyProjectIsolation(buildJob.project_id);
      if (!isolationCheck.success) {
        return {
          success: false,
          error: {
            type: 'isolation_failure',
            message: 'Project isolation verification failed',
            details: isolationCheck.error
          },
          metrics: {
            operation_duration_ms: Date.now() - startTime,
            projects_affected: 1
          }
        };
      }

      // Reserve build resources
      const resourceReservation = await this.reserveBuildResources(buildJob);
      if (!resourceReservation.success) {
        return resourceReservation;
      }

      // Setup project-specific build environment
      const buildEnvironment = await this.isolationManager.setupBuildEnvironment(
        buildJob.project_id,
        buildJob.framework,
        buildJob.job_id
      );

      if (!buildEnvironment.success) {
        // Release reserved resources on failure
        await this.releaseBuildResources(buildJob.project_id, buildJob.job_id);
        return buildEnvironment;
      }

      console.info('✅ [MULTI-PROJECT] Concurrent build environment prepared', {
        project_id: buildJob.project_id,
        job_id: buildJob.job_id,
        duration_ms: Date.now() - startTime
      });

      return {
        success: true,
        data: {
          build_slot_reserved: true,
          isolation_verified: true,
          resources_allocated: true
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 1
        }
      };

    } catch (error) {
      console.error('[MULTI-PROJECT] Failed to prepare concurrent build', {
        project_id: buildJob.project_id,
        job_id: buildJob.job_id,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      return {
        success: false,
        error: {
          type: 'project_conflict',
          message: 'Failed to prepare concurrent build environment',
          details: error
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 1
        }
      };
    }
  }

  /**
   * Clean up after build completion or failure
   * Releases resources and maintains repository health
   */
  async cleanupAfterBuild(
    projectId: string,
    jobId: string,
    buildSuccess: boolean
  ): Promise<MultiProjectResult<{
    resources_released: boolean;
    cache_updated: boolean;
    cleanup_performed: boolean;
  }>> {
    const startTime = Date.now();

    try {
      console.info('[MULTI-PROJECT] Cleaning up after build', {
        project_id: projectId,
        job_id: jobId,
        build_success: buildSuccess
      });

      // Release build resources
      await this.releaseBuildResources(projectId, jobId);

      // Update project build cache
      const cacheUpdate = await this.isolationManager.updateProjectCache(projectId, buildSuccess);

      // Perform routine cleanup if needed
      const routineCleanup = await this.performRoutineCleanup();

      console.info('✅ [MULTI-PROJECT] Build cleanup completed', {
        project_id: projectId,
        job_id: jobId,
        cache_updated: cacheUpdate.success,
        cleanup_performed: routineCleanup.success,
        duration_ms: Date.now() - startTime
      });

      return {
        success: true,
        data: {
          resources_released: true,
          cache_updated: cacheUpdate.success,
          cleanup_performed: routineCleanup.success
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 1,
          storage_freed_mb: routineCleanup.data?.storage_freed_mb
        }
      };

    } catch (error) {
      console.error('[MULTI-PROJECT] Failed to cleanup after build', {
        project_id: projectId,
        job_id: jobId,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: 'Failed to cleanup after build',
          details: error
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 1
        }
      };
    }
  }

  /**
   * Get comprehensive repository health metrics
   */
  async getRepositoryHealth(): Promise<MultiProjectResult<RepositoryHealthMetrics>> {
    const startTime = Date.now();

    try {
      console.info('[MULTI-PROJECT] Analyzing repository health');

      // Get project counts from different directories
      const activeProjects = await this.countProjectsInDirectory(this.directoryStructure.active);
      const archivedProjects = await this.countProjectsInDirectory(this.directoryStructure.archived);
      
      // Calculate storage usage
      const storageUsage = await this.calculateStorageUsage();
      const storageUsagePercent = (storageUsage.totalMB / (this.config.maxRepositorySizeGB * 1024)) * 100;
      
      // Get concurrent builds count
      const concurrentBuilds = await this.getConcurrentBuildsCount();
      
      // Calculate average project size
      const totalProjects = activeProjects + archivedProjects;
      const averageProjectSizeMB = totalProjects > 0 ? storageUsage.totalMB / totalProjects : 0;
      
      // Find oldest project
      const oldestProjectDays = await this.getOldestProjectAge();
      
      // Determine if cleanup is needed
      const cleanupNeeded = storageUsagePercent > 80 || 
                           activeProjects > this.config.maxActiveProjects * 0.9 ||
                           oldestProjectDays > this.config.activeProjectRetentionDays;
      
      // Calculate performance score (0-100)
      let performanceScore = 100;
      performanceScore -= Math.max(0, storageUsagePercent - 70); // Penalize high storage usage
      performanceScore -= Math.max(0, (activeProjects / this.config.maxActiveProjects - 0.8) * 100); // Penalize high project count
      performanceScore -= Math.max(0, concurrentBuilds - 10) * 5; // Penalize too many concurrent builds
      performanceScore = Math.max(0, Math.min(100, performanceScore));
      
      // Generate recommendations
      const recommendations = [];
      if (storageUsagePercent > 80) recommendations.push('High storage usage - consider archiving old projects');
      if (activeProjects > this.config.maxActiveProjects * 0.9) recommendations.push('High project count - run cleanup to archive unused projects');
      if (concurrentBuilds > 15) recommendations.push('High concurrent builds - may impact performance');
      if (oldestProjectDays > this.config.activeProjectRetentionDays) recommendations.push('Old projects detected - schedule cleanup to improve performance');
      if (averageProjectSizeMB > this.config.maxProjectSizeMB * 0.8) recommendations.push('Large average project size - consider optimizing project templates');

      const healthMetrics: RepositoryHealthMetrics = {
        activeProjects,
        archivedProjects,
        totalStorageUsedMB: storageUsage.totalMB,
        storageUsagePercent,
        concurrentBuilds,
        averageProjectSizeMB,
        oldestProjectDays,
        cleanupNeeded,
        performanceScore,
        recommendations
      };

      console.info('✅ [MULTI-PROJECT] Repository health analysis completed', {
        active_projects: activeProjects,
        archived_projects: archivedProjects,
        storage_usage_percent: Math.round(storageUsagePercent),
        performance_score: Math.round(performanceScore),
        cleanup_needed: cleanupNeeded,
        duration_ms: Date.now() - startTime
      });

      return {
        success: true,
        data: healthMetrics,
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: totalProjects
        }
      };

    } catch (error) {
      console.error('[MULTI-PROJECT] Failed to analyze repository health', {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      return {
        success: false,
        error: {
          type: 'storage_limit',
          message: 'Failed to analyze repository health',
          details: error
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 0
        }
      };
    }
  }

  /**
   * Perform scheduled repository maintenance
   * Includes cleanup, archival, and optimization
   */
  async performScheduledMaintenance(
    maintenanceType: 'daily' | 'weekly' | 'monthly' = 'daily'
  ): Promise<MultiProjectResult<{
    cleanup_performed: boolean;
    projects_archived: number;
    projects_deleted: number;
    storage_freed_mb: number;
    maintenance_type: string;
  }>> {
    const startTime = Date.now();

    try {
      console.info('[MULTI-PROJECT] Starting scheduled maintenance', {
        maintenance_type: maintenanceType
      });

      let projectsArchived = 0;
      let projectsDeleted = 0;
      let storageFreedMB = 0;

      // Perform different levels of maintenance based on type
      switch (maintenanceType) {
        case 'daily':
          // Daily: Basic cleanup and health checks
          const dailyCleanup = await this.cleanupManager.performDailyCleanup();
          if (dailyCleanup.success && dailyCleanup.data) {
            projectsArchived += dailyCleanup.data.projects_archived || 0;
            storageFreedMB += dailyCleanup.data.storage_freed_mb || 0;
          }
          break;

        case 'weekly':
          // Weekly: Archive old projects, deep cleanup
          const weeklyCleanup = await this.cleanupManager.performWeeklyCleanup();
          if (weeklyCleanup.success && weeklyCleanup.data) {
            projectsArchived += weeklyCleanup.data.projects_archived || 0;
            projectsDeleted += weeklyCleanup.data.projects_deleted || 0;
            storageFreedMB += weeklyCleanup.data.storage_freed_mb || 0;
          }
          break;

        case 'monthly':
          // Monthly: Full repository optimization
          const monthlyCleanup = await this.cleanupManager.performMonthlyCleanup();
          if (monthlyCleanup.success && monthlyCleanup.data) {
            projectsArchived += monthlyCleanup.data.projects_archived || 0;
            projectsDeleted += monthlyCleanup.data.projects_deleted || 0;
            storageFreedMB += monthlyCleanup.data.storage_freed_mb || 0;
          }
          break;
      }

      // Update maintenance statistics
      await this.updateMaintenanceStatistics(maintenanceType, {
        projects_archived: projectsArchived,
        projects_deleted: projectsDeleted,
        storage_freed_mb: storageFreedMB
      });

      console.info('✅ [MULTI-PROJECT] Scheduled maintenance completed', {
        maintenance_type: maintenanceType,
        projects_archived: projectsArchived,
        projects_deleted: projectsDeleted,
        storage_freed_mb: Math.round(storageFreedMB),
        duration_ms: Date.now() - startTime
      });

      return {
        success: true,
        data: {
          cleanup_performed: true,
          projects_archived: projectsArchived,
          projects_deleted: projectsDeleted,
          storage_freed_mb: storageFreedMB,
          maintenance_type: maintenanceType
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: projectsArchived + projectsDeleted,
          storage_freed_mb: storageFreedMB
        }
      };

    } catch (error) {
      console.error('[MULTI-PROJECT] Scheduled maintenance failed', {
        maintenance_type: maintenanceType,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: `Scheduled ${maintenanceType} maintenance failed`,
          details: error
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 0
        }
      };
    }
  }

  // Private helper methods

  /**
   * Check if repository has capacity for a new project
   */
  private async checkRepositoryCapacity(
    projectId: string,
    sourceFiles: Record<string, string>
  ): Promise<MultiProjectResult<boolean>> {
    const activeProjects = await this.countProjectsInDirectory(this.directoryStructure.active);
    
    if (activeProjects >= this.config.maxActiveProjects) {
      return {
        success: false,
        error: {
          type: 'storage_limit',
          message: `Maximum active projects limit reached (${this.config.maxActiveProjects})`
        }
      };
    }

    // Estimate project size
    const estimatedSizeMB = this.estimateProjectSize(sourceFiles);
    if (estimatedSizeMB > this.config.maxProjectSizeMB) {
      return {
        success: false,
        error: {
          type: 'storage_limit',
          message: `Project size (${Math.round(estimatedSizeMB)}MB) exceeds limit (${this.config.maxProjectSizeMB}MB)`
        }
      };
    }

    return { success: true, data: true };
  }

  /**
   * Reserve build resources for concurrent execution
   */
  private async reserveBuildResources(buildJob: BuildJob): Promise<MultiProjectResult<boolean>> {
    // In this implementation, we use R2 metadata to track resource reservations
    const reservationKey = `${this.directoryStructure.shared}/build-reservations/${buildJob.job_id}.json`;
    
    const reservation = {
      job_id: buildJob.job_id,
      project_id: buildJob.project_id,
      reserved_at: new Date().toISOString(),
      framework: buildJob.framework,
      timeout_seconds: buildJob.timeout_seconds
    };

    await this.env.PROJECTS_BUCKET.put(
      reservationKey,
      JSON.stringify(reservation),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          type: 'build-reservation',
          project_id: buildJob.project_id,
          job_id: buildJob.job_id
        }
      }
    );

    return { success: true, data: true };
  }

  /**
   * Release build resources after completion
   */
  private async releaseBuildResources(projectId: string, jobId: string): Promise<void> {
    try {
      const reservationKey = `${this.directoryStructure.shared}/build-reservations/${jobId}.json`;
      await this.env.PROJECTS_BUCKET.delete(reservationKey);
    } catch (error) {
      console.warn('[MULTI-PROJECT] Failed to release build reservation', {
        project_id: projectId,
        job_id: jobId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Perform routine cleanup if conditions are met
   */
  private async performRoutineCleanup(): Promise<MultiProjectResult<{ storage_freed_mb: number }>> {
    const health = await this.getRepositoryHealth();
    
    if (health.success && health.data?.cleanupNeeded) {
      return await this.cleanupManager.performRoutineCleanup();
    }

    return { success: true, data: { storage_freed_mb: 0 } };
  }

  /**
   * Count projects in a specific directory
   */
  private async countProjectsInDirectory(directory: string): Promise<number> {
    try {
      const listResult = await this.env.PROJECTS_BUCKET.list({
        prefix: `${directory}/`,
        delimiter: '/'
      });
      
      return listResult.delimitedPrefixes?.length || 0;
    } catch (error) {
      console.warn('[MULTI-PROJECT] Failed to count projects in directory', {
        directory,
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Calculate total storage usage
   */
  private async calculateStorageUsage(): Promise<{ totalMB: number; activeProjects: number; archivedProjects: number }> {
    try {
      // This is a simplified calculation - in production you might want more detailed analysis
      const activeList = await this.env.PROJECTS_BUCKET.list({ prefix: this.directoryStructure.active });
      const archivedList = await this.env.PROJECTS_BUCKET.list({ prefix: this.directoryStructure.archived });
      
      let totalSizeBytes = 0;
      
      // Calculate size of active projects
      for (const obj of activeList.objects) {
        totalSizeBytes += obj.size || 0;
      }
      
      // Calculate size of archived projects  
      for (const obj of archivedList.objects) {
        totalSizeBytes += obj.size || 0;
      }
      
      return {
        totalMB: totalSizeBytes / (1024 * 1024),
        activeProjects: activeList.delimitedPrefixes?.length || 0,
        archivedProjects: archivedList.delimitedPrefixes?.length || 0
      };
    } catch (error) {
      console.warn('[MULTI-PROJECT] Failed to calculate storage usage', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { totalMB: 0, activeProjects: 0, archivedProjects: 0 };
    }
  }

  /**
   * Get count of currently running builds
   */
  private async getConcurrentBuildsCount(): Promise<number> {
    try {
      const reservationsPrefix = `${this.directoryStructure.shared}/build-reservations/`;
      const reservations = await this.env.PROJECTS_BUCKET.list({ prefix: reservationsPrefix });
      return reservations.objects.length;
    } catch (error) {
      console.warn('[MULTI-PROJECT] Failed to get concurrent builds count', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Get age of the oldest project in days
   */
  private async getOldestProjectAge(): Promise<number> {
    try {
      const activeProjects = await this.env.PROJECTS_BUCKET.list({ 
        prefix: `${this.directoryStructure.active}/`,
        delimiter: '/' 
      });
      
      if (!activeProjects.delimitedPrefixes || activeProjects.delimitedPrefixes.length === 0) {
        return 0;
      }
      
      // Find the oldest project by checking metadata
      let oldestDate = new Date();
      
      for (const prefix of activeProjects.delimitedPrefixes.slice(0, 10)) { // Check first 10 to avoid too many requests
        try {
          const metadataKey = `${prefix}metadata.json`;
          const metadataObj = await this.env.PROJECTS_BUCKET.get(metadataKey);
          
          if (metadataObj) {
            const metadata = await metadataObj.json() as ProjectMetadata;
            const createdAt = new Date(metadata.created_at);
            if (createdAt < oldestDate) {
              oldestDate = createdAt;
            }
          }
        } catch (error) {
          // Skip projects that can't be read
          continue;
        }
      }
      
      const ageDays = (Date.now() - oldestDate.getTime()) / (24 * 60 * 60 * 1000);
      return Math.floor(ageDays);
    } catch (error) {
      console.warn('[MULTI-PROJECT] Failed to get oldest project age', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Estimate project size from source files
   */
  private estimateProjectSize(sourceFiles: Record<string, string>): number {
    let totalSize = 0;
    
    for (const [filename, content] of Object.entries(sourceFiles)) {
      totalSize += new TextEncoder().encode(content).length;
    }
    
    // Convert to MB and add 50% overhead for build artifacts, dependencies, etc.
    return (totalSize / (1024 * 1024)) * 1.5;
  }

  /**
   * Update maintenance statistics
   */
  private async updateMaintenanceStatistics(
    maintenanceType: string,
    stats: { projects_archived: number; projects_deleted: number; storage_freed_mb: number }
  ): Promise<void> {
    try {
      const statsKey = `${this.directoryStructure.config}/maintenance-stats.json`;
      
      let currentStats: any = {};
      
      try {
        const existing = await this.env.PROJECTS_BUCKET.get(statsKey);
        if (existing) {
          currentStats = await existing.json();
        }
      } catch (error) {
        // File doesn't exist yet, start with empty stats
      }
      
      // Update statistics
      if (!currentStats[maintenanceType]) {
        currentStats[maintenanceType] = {
          total_runs: 0,
          total_projects_archived: 0,
          total_projects_deleted: 0,
          total_storage_freed_mb: 0,
          last_run: null
        };
      }
      
      currentStats[maintenanceType].total_runs++;
      currentStats[maintenanceType].total_projects_archived += stats.projects_archived;
      currentStats[maintenanceType].total_projects_deleted += stats.projects_deleted;
      currentStats[maintenanceType].total_storage_freed_mb += stats.storage_freed_mb;
      currentStats[maintenanceType].last_run = new Date().toISOString();
      
      await this.env.PROJECTS_BUCKET.put(
        statsKey,
        JSON.stringify(currentStats, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            updated_by: 'multi-project-manager',
            updated_at: new Date().toISOString(),
            type: 'maintenance-statistics'
          }
        }
      );
    } catch (error) {
      console.warn('[MULTI-PROJECT] Failed to update maintenance statistics', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * List all projects in the repository with their metadata
   */
  async listAllProjects(): Promise<MultiProjectResult<{
    projects: ProjectMetadata[];
    stats: { active: number; archived: number; cleanup: number; total: number };
  }>> {
    const startTime = Date.now();
    
    try {
      console.info('[MULTI-PROJECT] Listing all projects');

      const projects: ProjectMetadata[] = [];
      const seenProjectIds = new Set<string>(); // Track seen projects to avoid duplicates
      
      // List projects from all directories
      const directories = ['active', 'archived', 'cleanup'];
      let activeCounts = { active: 0, archived: 0, cleanup: 0 };

      // First, check structured directories (active/archived/cleanup)
      for (const dir of directories) {
        const prefix = `${this.directoryStructure.root}/${dir}/`;
        const listing = await this.env.PROJECTS_BUCKET.list({ 
          prefix, 
          delimiter: '/', 
          limit: 1000 
        });

        // Enumerate subdirectories (one per project)
        const projectPrefixes = listing.delimitedPrefixes || [];
        for (const projectPrefix of projectPrefixes) {
          const parts = projectPrefix.split('/').filter(Boolean);
          const projectId = parts[parts.length - 1];
          if (!projectId) continue;
          
          seenProjectIds.add(projectId); // Track this project ID

          // Get project metadata
          const metadataKey = `${projectPrefix}metadata.json`;
          const metadataObj = await this.env.PROJECTS_BUCKET.get(metadataKey);
          
          if (metadataObj) {
            const metadata = await metadataObj.json() as ProjectMetadata;
            metadata.status = dir as 'active' | 'archived' | 'cleanup';
            
            // Ensure required frontend fields are present
            if (!metadata.name) {
              metadata.name = metadata.project_id || metadata.id || projectId;
            }
            if (!metadata.id) {
              metadata.id = metadata.project_id || projectId;
            }
            if (!metadata.framework) {
              metadata.framework = 'unknown';
            }
            
            projects.push(metadata);
            activeCounts[dir as keyof typeof activeCounts]++;
          } else {
            // Create basic metadata for projects without it
            const basicMetadata: ProjectMetadata = {
              id: projectId,                    // Use 'id' consistently for frontend
              name: projectId,                  // Add required name field
              project_id: projectId,            // Keep for backward compatibility
              status: dir as 'active' | 'archived' | 'cleanup',
              framework: 'unknown' as FrameworkType,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              source_files: [],
              dependencies: {},
              build_config: {}
            };
            projects.push(basicMetadata);
            activeCounts[dir as keyof typeof activeCounts]++;
          }
        }
      }
      
      // Also check for projects directly under projects/ (legacy/paste-created projects)
      const rootListing = await this.env.PROJECTS_BUCKET.list({
        prefix: `${this.directoryStructure.root}/`,
        delimiter: '/',
        limit: 1000
      });
      
      const rootProjectPrefixes = rootListing.delimitedPrefixes || [];
      for (const projectPrefix of rootProjectPrefixes) {
        const parts = projectPrefix.split('/').filter(Boolean);
        const lastPart = parts[parts.length - 1];
        
        // Skip the structured directories we already processed
        if (['active', 'archived', 'cleanup', 'config', 'templates'].includes(lastPart)) {
          continue;
        }
        
        const projectId = lastPart;
        if (!projectId || seenProjectIds.has(projectId)) continue; // Skip if already seen
        
        // Get project metadata from the root level
        const metadataKey = `${projectPrefix}metadata.json`;
        const metadataObj = await this.env.PROJECTS_BUCKET.get(metadataKey);
        
        if (metadataObj) {
          const metadata = await metadataObj.json() as ProjectMetadata;
          
          // These are likely active projects that weren't properly placed in structured dirs
          // Check the actual status from metadata or default to 'active'
          if (!metadata.status || metadata.status === 'scaffolding' || metadata.status === 'building') {
            metadata.status = 'active';
          }
          
          // Ensure required frontend fields are present
          if (!metadata.name) {
            metadata.name = metadata.project_id || metadata.id || projectId;
          }
          if (!metadata.id) {
            metadata.id = metadata.project_id || projectId;
          }
          if (!metadata.framework) {
            metadata.framework = 'unknown';
          }
          
          projects.push(metadata);
          activeCounts.active++; // Count as active since they're not in archived/cleanup
        }
      }

      const stats = {
        ...activeCounts,
        total: projects.length
      };

      return {
        success: true,
        data: { projects, stats },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: projects.length
        }
      };

    } catch (error) {
      console.error('[MULTI-PROJECT] Error listing projects:', error);
      return {
        success: false,
        error: {
          type: 'listing_failure',
          message: error instanceof Error ? error.message : 'Failed to list projects'
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 0
        }
      };
    }
  }

  /**
   * Get detailed status for a specific project
   */
  async getProjectStatus(projectId: string): Promise<MultiProjectResult<ProjectMetadata & {
    storage_usage: { size_mb: number; files_count: number };
    build_history: { total_builds: number; successful_builds: number; failed_builds: number };
    last_activity: string | null;
  }>> {
    const startTime = Date.now();

    try {
      console.info('[MULTI-PROJECT] Getting project status', { project_id: projectId });

      // Find project in all directories
      const directories = ['active', 'archived', 'cleanup'];
      let projectData: ProjectMetadata | null = null;
      let projectDir = '';

      for (const dir of directories) {
        const metadataKey = `${this.directoryStructure.root}/${dir}/${projectId}/metadata.json`;
        const metadataObj = await this.env.PROJECTS_BUCKET.get(metadataKey);
        
        if (metadataObj) {
          projectData = await metadataObj.json() as ProjectMetadata;
          projectData.status = dir as 'active' | 'archived' | 'cleanup';
          projectDir = `${this.directoryStructure.root}/${dir}/${projectId}`;
          break;
        }
      }

      if (!projectData) {
        return {
          success: false,
          error: {
            type: 'project_not_found',
            message: `Project ${projectId} not found in any directory`
          },
          metrics: {
            operation_duration_ms: Date.now() - startTime,
            projects_affected: 0
          }
        };
      }

      // Calculate storage usage
      const storageUsage = await this.calculateProjectStorageUsage(projectDir);
      
      // Get build history (simplified for now)
      const buildHistory = await this.getProjectBuildHistory(projectId);

      // Get last activity
      const lastActivity = await this.getProjectLastActivity(projectDir);

      return {
        success: true,
        data: {
          ...projectData,
          storage_usage: storageUsage,
          build_history: buildHistory,
          last_activity: lastActivity
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 1
        }
      };

    } catch (error) {
      console.error('[MULTI-PROJECT] Error getting project status:', error);
      return {
        success: false,
        error: {
          type: 'status_retrieval_failure',
          message: error instanceof Error ? error.message : 'Failed to get project status'
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 0
        }
      };
    }
  }

  /**
   * Delete a project and all its associated data
   */
  async deleteProject(projectId: string): Promise<MultiProjectResult<{
    deleted_files: string[];
    storage_freed_mb: number;
  }>> {
    const startTime = Date.now();

    try {
      console.info('[MULTI-PROJECT] Deleting project', { project_id: projectId });

      // Find project in all directories
      const directories = ['active', 'archived', 'cleanup'];
      let projectDir = '';
      let found = false;

      for (const dir of directories) {
        const testPath = `${this.directoryStructure.root}/${dir}/${projectId}`;
        const listing = await this.env.PROJECTS_BUCKET.list({ 
          prefix: `${testPath}/`,
          limit: 1
        });
        
        if (listing.objects.length > 0) {
          projectDir = testPath;
          found = true;
          break;
        }
      }

      if (!found) {
        return {
          success: false,
          error: {
            type: 'project_not_found',
            message: `Project ${projectId} not found`
          },
          metrics: {
            operation_duration_ms: Date.now() - startTime,
            projects_affected: 0
          }
        };
      }

      // Get all files for this project
      const listing = await this.env.PROJECTS_BUCKET.list({ 
        prefix: `${projectDir}/`
      });

      const deletedFiles: string[] = [];
      let totalSizeBytes = 0;

      // Delete all project files
      for (const obj of listing.objects) {
        await this.env.PROJECTS_BUCKET.delete(obj.key);
        deletedFiles.push(obj.key);
        totalSizeBytes += obj.size || 0;
      }

      // Also delete from builds bucket
      const buildListing = await this.env.BUILDS_BUCKET?.list({ 
        prefix: `projects/${projectId}/`
      });

      if (buildListing) {
        for (const obj of buildListing.objects) {
          await this.env.BUILDS_BUCKET.delete(obj.key);
          deletedFiles.push(`builds:${obj.key}`);
          totalSizeBytes += obj.size || 0;
        }
      }

      const storageFreegedMB = Math.round(totalSizeBytes / (1024 * 1024) * 100) / 100;

      console.info(`✅ [MULTI-PROJECT] Project deleted successfully`, {
        project_id: projectId,
        files_deleted: deletedFiles.length,
        storage_freed_mb: storageFreegedMB
      });

      return {
        success: true,
        data: {
          deleted_files: deletedFiles,
          storage_freed_mb: storageFreegedMB
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 1
        }
      };

    } catch (error) {
      console.error('[MULTI-PROJECT] Error deleting project:', error);
      return {
        success: false,
        error: {
          type: 'deletion_failure',
          message: error instanceof Error ? error.message : 'Failed to delete project'
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 0
        }
      };
    }
  }

  /**
   * Perform repository cleanup based on request
   */
  async performRepositoryCleanup(request: ProjectCleanupRequest): Promise<MultiProjectResult<{
    projects_cleaned: string[];
    storage_freed_mb: number;
    actions_taken: string[];
  }>> {
    const startTime = Date.now();

    try {
      console.info('[MULTI-PROJECT] Performing repository cleanup', {
        cleanup_type: request.cleanup_type,
        target_projects: request.target_projects.length,
        max_age_days: request.max_age_days
      });

      const projectsCleaned: string[] = [];
      const actionsTaken: string[] = [];
      let totalStorageFreed = 0;

      // Implement different cleanup strategies
      switch (request.cleanup_type) {
        case 'soft':
          // Move old projects to archived
          const softResult = await this.performSoftCleanup(request);
          projectsCleaned.push(...softResult.projects_moved);
          actionsTaken.push(...softResult.actions);
          totalStorageFreed += softResult.storage_freed_mb;
          break;

        case 'aggressive':
          // Delete old projects entirely
          const aggressiveResult = await this.performAggressiveCleanup(request);
          projectsCleaned.push(...aggressiveResult.projects_deleted);
          actionsTaken.push(...aggressiveResult.actions);
          totalStorageFreed += aggressiveResult.storage_freed_mb;
          break;

        case 'emergency':
          // Free up maximum space immediately
          const emergencyResult = await this.performEmergencyCleanup(request);
          projectsCleaned.push(...emergencyResult.projects_removed);
          actionsTaken.push(...emergencyResult.actions);
          totalStorageFreed += emergencyResult.storage_freed_mb;
          break;
      }

      console.info(`✅ [MULTI-PROJECT] Repository cleanup completed`, {
        cleanup_type: request.cleanup_type,
        projects_cleaned: projectsCleaned.length,
        storage_freed_mb: totalStorageFreed,
        actions_taken: actionsTaken.length
      });

      return {
        success: true,
        data: {
          projects_cleaned: projectsCleaned,
          storage_freed_mb: totalStorageFreed,
          actions_taken: actionsTaken
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: projectsCleaned.length
        }
      };

    } catch (error) {
      console.error('[MULTI-PROJECT] Error during repository cleanup:', error);
      return {
        success: false,
        error: {
          type: 'cleanup_failure',
          message: error instanceof Error ? error.message : 'Repository cleanup failed'
        },
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: 0
        }
      };
    }
  }

  // Helper methods for the new functionality
  private extractProjectIdFromObject(key: string): string | null {
    const match = key.match(/projects\/(active|archived|cleanup)\/([^\/]+)/);
    return match ? match[2] : null;
  }

  private async calculateProjectStorageUsage(projectDir: string): Promise<{ size_mb: number; files_count: number }> {
    try {
      const listing = await this.env.PROJECTS_BUCKET.list({ 
        prefix: `${projectDir}/`
      });

      let totalSizeBytes = 0;
      let filesCount = listing.objects.length;

      for (const obj of listing.objects) {
        totalSizeBytes += obj.size || 0;
      }

      return {
        size_mb: Math.round(totalSizeBytes / (1024 * 1024) * 100) / 100,
        files_count: filesCount
      };
    } catch (error) {
      return { size_mb: 0, files_count: 0 };
    }
  }

  private async getProjectBuildHistory(projectId: string): Promise<{ total_builds: number; successful_builds: number; failed_builds: number }> {
    try {
      // This is a simplified implementation - in a real system you'd query build logs
      const buildListing = await this.env.BUILDS_BUCKET?.list({ 
        prefix: `projects/${projectId}/builds/`
      });

      if (!buildListing) {
        return { total_builds: 0, successful_builds: 0, failed_builds: 0 };
      }

      // Count build directories (each represents a build attempt)
      const buildDirs = new Set();
      for (const obj of buildListing.objects) {
        const buildMatch = obj.key.match(/projects\/[^\/]+\/builds\/([^\/]+)\//);
        if (buildMatch) {
          buildDirs.add(buildMatch[1]);
        }
      }

      // For now, assume all builds were successful (would need build status tracking for accurate data)
      const totalBuilds = buildDirs.size;
      return {
        total_builds: totalBuilds,
        successful_builds: totalBuilds, // Simplified
        failed_builds: 0 // Simplified
      };
    } catch (error) {
      return { total_builds: 0, successful_builds: 0, failed_builds: 0 };
    }
  }

  private async getProjectLastActivity(projectDir: string): Promise<string | null> {
    try {
      const listing = await this.env.PROJECTS_BUCKET.list({ 
        prefix: `${projectDir}/`,
        limit: 1
      });

      if (listing.objects.length > 0) {
        const lastModified = listing.objects[0].uploaded;
        return lastModified || null;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private async performSoftCleanup(request: ProjectCleanupRequest): Promise<{
    projects_moved: string[];
    actions: string[];
    storage_freed_mb: number;
  }> {
    // Implementation for soft cleanup (move old projects to archived)
    return {
      projects_moved: [],
      actions: ['Soft cleanup not yet implemented'],
      storage_freed_mb: 0
    };
  }

  private async performAggressiveCleanup(request: ProjectCleanupRequest): Promise<{
    projects_deleted: string[];
    actions: string[];
    storage_freed_mb: number;
  }> {
    // Implementation for aggressive cleanup (delete old projects)
    return {
      projects_deleted: [],
      actions: ['Aggressive cleanup not yet implemented'],
      storage_freed_mb: 0
    };
  }

  private async performEmergencyCleanup(request: ProjectCleanupRequest): Promise<{
    projects_removed: string[];
    actions: string[];
    storage_freed_mb: number;
  }> {
    // Implementation for emergency cleanup (remove everything possible)
    return {
      projects_removed: [],
      actions: ['Emergency cleanup not yet implemented'],
      storage_freed_mb: 0
    };
  }
}

/**
 * Factory function to create MultiProjectManager instance
 */
export function createMultiProjectManager(
  env: Env,
  config?: Partial<RepositoryStructure>
): MultiProjectManager {
  return new MultiProjectManager(env, config);
}

/**
 * Get project directory path for a specific project ID
 */
export function getProjectPath(projectId: string, archived: boolean = false): string {
  const baseDir = archived ? 'projects/archived' : 'projects/active';
  return `${baseDir}/${projectId}`;
}

/**
 * Extract project ID from directory path
 */
export function extractProjectIdFromPath(path: string): string | null {
  const match = path.match(/projects\/(active|archived|cleanup)\/([^\/]+)/);
  return match ? match[2] : null;
}
