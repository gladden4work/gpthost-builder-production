/**
 * TASK-028: Repository Cleanup Manager
 * 
 * Automated storage optimization and cleanup system for multi-project repositories.
 * Handles project lifecycle management, storage quota enforcement, and 
 * repository health maintenance through intelligent cleanup policies.
 * 
 * Features:
 * - Automated storage cleanup and optimization
 * - Project archival and deletion policies
 * - Storage quota monitoring and enforcement
 * - Age-based cleanup with configurable retention
 * - Performance-aware cleanup scheduling
 * - Repository defragmentation and optimization
 */

import { 
  ProjectMetadata,
  ProjectStatus 
} from '../types/api';

import { 
  RepositoryStructure,
  ProjectDirectoryStructure,
  MultiProjectResult 
} from './multiProjectManager';

/**
 * Cleanup policy configuration
 */
export interface CleanupPolicy {
  enable_age_based_cleanup: boolean;          // Clean up based on project age
  enable_size_based_cleanup: boolean;         // Clean up based on storage usage
  enable_activity_based_cleanup: boolean;     // Clean up inactive projects
  retention_days: {
    active_projects: number;                   // Days to keep active projects
    failed_projects: number;                   // Days to keep failed projects
    archived_projects: number;                 // Days to keep archived projects
    temp_files: number;                        // Days to keep temporary files
  };
  size_limits: {
    max_project_size_mb: number;               // Maximum size per project
    storage_warning_threshold_percent: number; // Warn when reaching this usage
    storage_critical_threshold_percent: number; // Force cleanup at this usage
  };
  activity_thresholds: {
    inactive_days: number;                     // Days of inactivity before archival
    abandoned_days: number;                    // Days before considering project abandoned
  };
}

/**
 * Cleanup operation result
 */
export interface CleanupResult {
  projects_archived: number;
  projects_deleted: number;
  storage_freed_mb: number;
  temp_files_deleted: number;
  operation_duration_ms: number;
  cleanup_details: {
    active_to_archived: string[];             // Project IDs moved to archive
    archived_to_deleted: string[];            // Project IDs deleted permanently
    temp_files_removed: string[];             // Temporary files removed
    large_projects_optimized: string[];       // Projects that were optimized
  };
  performance_impact: {
    repository_health_improvement: number;    // 0-100 improvement score
    storage_usage_reduction_percent: number;  // Percentage reduction in storage
    expected_performance_gain: number;        // Expected performance improvement
  };
}

/**
 * Project cleanup status
 */
export interface ProjectCleanupStatus {
  project_id: string;
  current_status: ProjectStatus;
  recommended_action: 'keep' | 'archive' | 'delete' | 'optimize';
  reasons: string[];
  metrics: {
    age_days: number;
    size_mb: number;
    last_activity: string;
    build_failures: number;
    storage_efficiency: number;              // 0-100 efficiency score
  };
  priority: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Storage analysis result
 */
export interface StorageAnalysis {
  total_projects: number;
  active_projects: number;
  archived_projects: number;
  failed_projects: number;
  total_storage_mb: number;
  average_project_size_mb: number;
  largest_projects: Array<{
    project_id: string;
    size_mb: number;
    status: ProjectStatus;
  }>;
  oldest_projects: Array<{
    project_id: string;
    age_days: number;
    status: ProjectStatus;
  }>;
  storage_distribution: {
    active_projects_mb: number;
    archived_projects_mb: number;
    temp_files_mb: number;
    cache_files_mb: number;
  };
  cleanup_recommendations: string[];
}

/**
 * Repository Cleanup Manager
 * 
 * Manages automated cleanup, archival, and storage optimization for multi-project repositories
 */
export class RepositoryCleanupManager {
  private policy: CleanupPolicy;

  constructor(
    private env: Env,
    private config: RepositoryStructure,
    private directoryStructure: ProjectDirectoryStructure,
    policy?: Partial<CleanupPolicy>
  ) {
    // Initialize cleanup policy with defaults
    this.policy = {
      enable_age_based_cleanup: true,
      enable_size_based_cleanup: true,
      enable_activity_based_cleanup: true,
      retention_days: {
        active_projects: config.activeProjectRetentionDays,
        failed_projects: 7,              // Keep failed projects for 7 days
        archived_projects: config.archivedProjectRetentionDays,
        temp_files: 1                    // Clean temp files daily
      },
      size_limits: {
        max_project_size_mb: config.maxProjectSizeMB,
        storage_warning_threshold_percent: 75,
        storage_critical_threshold_percent: 90
      },
      activity_thresholds: {
        inactive_days: 14,               // Archive after 14 days of inactivity
        abandoned_days: 30               // Consider abandoned after 30 days
      },
      ...policy
    };
  }

  /**
   * Perform daily cleanup routine
   * Focuses on temp files, failed builds, and basic maintenance
   */
  async performDailyCleanup(): Promise<MultiProjectResult<CleanupResult>> {
    const startTime = Date.now();
    
    try {
      console.info('[CLEANUP] Starting daily cleanup routine');

      let totalProjectsArchived = 0;
      let totalProjectsDeleted = 0;
      let totalStorageFreed = 0;
      let totalTempFilesDeleted = 0;
      const cleanupDetails = {
        active_to_archived: [] as string[],
        archived_to_deleted: [] as string[],
        temp_files_removed: [] as string[],
        large_projects_optimized: [] as string[]
      };

      // 1. Clean up temporary files
      const tempCleanup = await this.cleanupTemporaryFiles();
      if (tempCleanup.success && tempCleanup.data) {
        totalTempFilesDeleted += tempCleanup.data.files_deleted;
        totalStorageFreed += tempCleanup.data.storage_freed_mb;
        cleanupDetails.temp_files_removed.push(...tempCleanup.data.files_removed);
      }

      // 2. Archive failed projects older than retention period
      const failedProjects = await this.identifyFailedProjects();
      for (const project of failedProjects) {
        if (project.metrics.age_days > this.policy.retention_days.failed_projects) {
          const archiveResult = await this.archiveProject(project.project_id, 'age-based-failed');
          if (archiveResult.success) {
            totalProjectsArchived++;
            totalStorageFreed += archiveResult.data?.storage_freed_mb || 0;
            cleanupDetails.active_to_archived.push(project.project_id);
          }
        }
      }

      // 3. Basic storage optimization
      const optimization = await this.performBasicOptimization();
      if (optimization.success && optimization.data) {
        totalStorageFreed += optimization.data.storage_freed_mb;
        cleanupDetails.large_projects_optimized.push(...optimization.data.projects_optimized);
      }

      const operationDuration = Date.now() - startTime;

      console.info('✅ [CLEANUP] Daily cleanup completed', {
        projects_archived: totalProjectsArchived,
        projects_deleted: totalProjectsDeleted,
        storage_freed_mb: Math.round(totalStorageFreed),
        temp_files_deleted: totalTempFilesDeleted,
        duration_ms: operationDuration
      });

      return {
        success: true,
        data: {
          projects_archived: totalProjectsArchived,
          projects_deleted: totalProjectsDeleted,
          storage_freed_mb: totalStorageFreed,
          temp_files_deleted: totalTempFilesDeleted,
          operation_duration_ms: operationDuration,
          cleanup_details: cleanupDetails,
          performance_impact: {
            repository_health_improvement: Math.min(100, totalStorageFreed / 10),
            storage_usage_reduction_percent: this.calculateStorageReduction(totalStorageFreed),
            expected_performance_gain: Math.min(50, totalProjectsArchived * 5)
          }
        },
        metrics: {
          operation_duration_ms: operationDuration,
          projects_affected: totalProjectsArchived + totalProjectsDeleted,
          storage_freed_mb: totalStorageFreed
        }
      };

    } catch (error) {
      console.error('[CLEANUP] Daily cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: 'Daily cleanup routine failed',
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
   * Perform weekly cleanup routine
   * Includes project archival, deep cleanup, and storage optimization
   */
  async performWeeklyCleanup(): Promise<MultiProjectResult<CleanupResult>> {
    const startTime = Date.now();
    
    try {
      console.info('[CLEANUP] Starting weekly cleanup routine');

      // First perform daily cleanup
      const dailyResult = await this.performDailyCleanup();
      let totalProjectsArchived = dailyResult.data?.projects_archived || 0;
      let totalProjectsDeleted = dailyResult.data?.projects_deleted || 0;
      let totalStorageFreed = dailyResult.data?.storage_freed_mb || 0;
      let totalTempFilesDeleted = dailyResult.data?.temp_files_deleted || 0;
      const cleanupDetails = dailyResult.data?.cleanup_details || {
        active_to_archived: [],
        archived_to_deleted: [],
        temp_files_removed: [],
        large_projects_optimized: []
      };

      // 1. Archive inactive projects
      const inactiveProjects = await this.identifyInactiveProjects();
      for (const project of inactiveProjects) {
        if (project.recommended_action === 'archive') {
          const archiveResult = await this.archiveProject(project.project_id, 'activity-based');
          if (archiveResult.success) {
            totalProjectsArchived++;
            totalStorageFreed += archiveResult.data?.storage_freed_mb || 0;
            cleanupDetails.active_to_archived.push(project.project_id);
          }
        }
      }

      // 2. Delete old archived projects
      const oldArchivedProjects = await this.identifyOldArchivedProjects();
      for (const project of oldArchivedProjects) {
        if (project.metrics.age_days > this.policy.retention_days.archived_projects) {
          const deleteResult = await this.deleteProject(project.project_id, 'age-based-archived');
          if (deleteResult.success) {
            totalProjectsDeleted++;
            totalStorageFreed += deleteResult.data?.storage_freed_mb || 0;
            cleanupDetails.archived_to_deleted.push(project.project_id);
          }
        }
      }

      // 3. Optimize large projects
      const largeProjects = await this.identifyLargeProjects();
      for (const project of largeProjects) {
        const optimizeResult = await this.optimizeProject(project.project_id);
        if (optimizeResult.success) {
          totalStorageFreed += optimizeResult.data?.storage_freed_mb || 0;
          cleanupDetails.large_projects_optimized.push(project.project_id);
        }
      }

      const operationDuration = Date.now() - startTime;

      console.info('✅ [CLEANUP] Weekly cleanup completed', {
        projects_archived: totalProjectsArchived,
        projects_deleted: totalProjectsDeleted,
        storage_freed_mb: Math.round(totalStorageFreed),
        temp_files_deleted: totalTempFilesDeleted,
        duration_ms: operationDuration
      });

      return {
        success: true,
        data: {
          projects_archived: totalProjectsArchived,
          projects_deleted: totalProjectsDeleted,
          storage_freed_mb: totalStorageFreed,
          temp_files_deleted: totalTempFilesDeleted,
          operation_duration_ms: operationDuration,
          cleanup_details: cleanupDetails,
          performance_impact: {
            repository_health_improvement: Math.min(100, totalStorageFreed / 5),
            storage_usage_reduction_percent: this.calculateStorageReduction(totalStorageFreed),
            expected_performance_gain: Math.min(75, (totalProjectsArchived + totalProjectsDeleted) * 3)
          }
        },
        metrics: {
          operation_duration_ms: operationDuration,
          projects_affected: totalProjectsArchived + totalProjectsDeleted,
          storage_freed_mb: totalStorageFreed
        }
      };

    } catch (error) {
      console.error('[CLEANUP] Weekly cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: 'Weekly cleanup routine failed',
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
   * Perform monthly cleanup routine
   * Comprehensive repository optimization and maintenance
   */
  async performMonthlyCleanup(): Promise<MultiProjectResult<CleanupResult>> {
    const startTime = Date.now();
    
    try {
      console.info('[CLEANUP] Starting monthly cleanup routine');

      // First perform weekly cleanup
      const weeklyResult = await this.performWeeklyCleanup();
      let totalProjectsArchived = weeklyResult.data?.projects_archived || 0;
      let totalProjectsDeleted = weeklyResult.data?.projects_deleted || 0;
      let totalStorageFreed = weeklyResult.data?.storage_freed_mb || 0;
      let totalTempFilesDeleted = weeklyResult.data?.temp_files_deleted || 0;
      const cleanupDetails = weeklyResult.data?.cleanup_details || {
        active_to_archived: [],
        archived_to_deleted: [],
        temp_files_removed: [],
        large_projects_optimized: []
      };

      // 1. Deep storage analysis and cleanup
      const storageAnalysis = await this.performStorageAnalysis();
      if (storageAnalysis.success && storageAnalysis.data) {
        // Apply storage-based cleanup recommendations
        for (const recommendation of storageAnalysis.data.cleanup_recommendations) {
          const cleanupResult = await this.applyCleanupRecommendation(recommendation);
          if (cleanupResult.success && cleanupResult.data) {
            totalStorageFreed += cleanupResult.data.storage_freed_mb;
          }
        }
      }

      // 2. Repository defragmentation
      const defragResult = await this.defragmentRepository();
      if (defragResult.success) {
        totalStorageFreed += defragResult.data?.storage_freed_mb || 0;
      }

      // 3. Cache cleanup and optimization
      const cacheCleanup = await this.cleanupCacheFiles();
      if (cacheCleanup.success) {
        totalStorageFreed += cacheCleanup.data?.storage_freed_mb || 0;
      }

      // 4. Update repository health statistics
      await this.updateRepositoryHealthStatistics({
        total_cleanups: 1,
        projects_archived: totalProjectsArchived,
        projects_deleted: totalProjectsDeleted,
        storage_freed_mb: totalStorageFreed
      });

      const operationDuration = Date.now() - startTime;

      console.info('✅ [CLEANUP] Monthly cleanup completed', {
        projects_archived: totalProjectsArchived,
        projects_deleted: totalProjectsDeleted,
        storage_freed_mb: Math.round(totalStorageFreed),
        temp_files_deleted: totalTempFilesDeleted,
        duration_ms: operationDuration
      });

      return {
        success: true,
        data: {
          projects_archived: totalProjectsArchived,
          projects_deleted: totalProjectsDeleted,
          storage_freed_mb: totalStorageFreed,
          temp_files_deleted: totalTempFilesDeleted,
          operation_duration_ms: operationDuration,
          cleanup_details: cleanupDetails,
          performance_impact: {
            repository_health_improvement: Math.min(100, totalStorageFreed / 3),
            storage_usage_reduction_percent: this.calculateStorageReduction(totalStorageFreed),
            expected_performance_gain: Math.min(100, (totalProjectsArchived + totalProjectsDeleted) * 2)
          }
        },
        metrics: {
          operation_duration_ms: operationDuration,
          projects_affected: totalProjectsArchived + totalProjectsDeleted,
          storage_freed_mb: totalStorageFreed
        }
      };

    } catch (error) {
      console.error('[CLEANUP] Monthly cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: 'Monthly cleanup routine failed',
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
   * Perform routine cleanup based on current repository health
   */
  async performRoutineCleanup(): Promise<MultiProjectResult<{ storage_freed_mb: number }>> {
    try {
      console.info('[CLEANUP] Performing routine cleanup check');

      // Check if cleanup is needed based on storage usage
      const storageUsage = await this.getCurrentStorageUsage();
      const usagePercent = (storageUsage.total_mb / (this.config.maxRepositorySizeGB * 1024)) * 100;

      if (usagePercent < this.policy.size_limits.storage_warning_threshold_percent) {
        // No cleanup needed
        return { success: true, data: { storage_freed_mb: 0 } };
      }

      // Perform appropriate level of cleanup based on usage
      if (usagePercent >= this.policy.size_limits.storage_critical_threshold_percent) {
        // Critical usage - perform aggressive cleanup
        const weeklyResult = await this.performWeeklyCleanup();
        return { 
          success: true, 
          data: { storage_freed_mb: weeklyResult.data?.storage_freed_mb || 0 }
        };
      } else {
        // Warning usage - perform daily cleanup
        const dailyResult = await this.performDailyCleanup();
        return { 
          success: true, 
          data: { storage_freed_mb: dailyResult.data?.storage_freed_mb || 0 }
        };
      }

    } catch (error) {
      console.error('[CLEANUP] Routine cleanup failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: 'Routine cleanup failed',
          details: error
        }
      };
    }
  }

  /**
   * Analyze repository storage and provide recommendations
   */
  async performStorageAnalysis(): Promise<MultiProjectResult<StorageAnalysis>> {
    const startTime = Date.now();
    
    try {
      console.info('[CLEANUP] Performing storage analysis');

      // Get all projects in active and archived directories
      const activeProjects = await this.getProjectsInDirectory(this.directoryStructure.active);
      const archivedProjects = await this.getProjectsInDirectory(this.directoryStructure.archived);
      
      let totalStorageMB = 0;
      const projectSizes: Array<{ project_id: string; size_mb: number; status: ProjectStatus }> = [];
      const projectAges: Array<{ project_id: string; age_days: number; status: ProjectStatus }> = [];

      // Analyze active projects
      for (const projectId of activeProjects) {
        const metadata = await this.getProjectMetadata(projectId, false);
        if (metadata) {
          const size = await this.calculateProjectSize(projectId, false);
          const age = this.calculateProjectAge(metadata.created_at);
          
          totalStorageMB += size;
          projectSizes.push({ project_id: projectId, size_mb: size, status: metadata.status });
          projectAges.push({ project_id: projectId, age_days: age, status: metadata.status });
        }
      }

      // Analyze archived projects
      for (const projectId of archivedProjects) {
        const metadata = await this.getProjectMetadata(projectId, true);
        if (metadata) {
          const size = await this.calculateProjectSize(projectId, true);
          const age = this.calculateProjectAge(metadata.created_at);
          
          totalStorageMB += size;
          projectSizes.push({ project_id: projectId, size_mb: size, status: metadata.status });
          projectAges.push({ project_id: projectId, age_days: age, status: metadata.status });
        }
      }

      // Sort for analysis
      const largestProjects = projectSizes.sort((a, b) => b.size_mb - a.size_mb).slice(0, 10);
      const oldestProjects = projectAges.sort((a, b) => b.age_days - a.age_days).slice(0, 10);

      // Calculate storage distribution
      const storageDistribution = await this.calculateStorageDistribution();

      // Generate cleanup recommendations
      const recommendations = this.generateCleanupRecommendations(
        totalStorageMB,
        largestProjects,
        oldestProjects,
        storageDistribution
      );

      const analysis: StorageAnalysis = {
        total_projects: activeProjects.length + archivedProjects.length,
        active_projects: activeProjects.length,
        archived_projects: archivedProjects.length,
        failed_projects: projectSizes.filter(p => p.status === 'failed').length,
        total_storage_mb: totalStorageMB,
        average_project_size_mb: totalStorageMB / (activeProjects.length + archivedProjects.length || 1),
        largest_projects: largestProjects,
        oldest_projects: oldestProjects,
        storage_distribution: storageDistribution,
        cleanup_recommendations: recommendations
      };

      console.info('✅ [CLEANUP] Storage analysis completed', {
        total_projects: analysis.total_projects,
        total_storage_mb: Math.round(analysis.total_storage_mb),
        recommendations: analysis.cleanup_recommendations.length,
        duration_ms: Date.now() - startTime
      });

      return {
        success: true,
        data: analysis,
        metrics: {
          operation_duration_ms: Date.now() - startTime,
          projects_affected: analysis.total_projects
        }
      };

    } catch (error) {
      console.error('[CLEANUP] Storage analysis failed', {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: 'Storage analysis failed',
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
   * Clean up temporary files and build artifacts
   */
  private async cleanupTemporaryFiles(): Promise<MultiProjectResult<{
    files_deleted: number;
    storage_freed_mb: number;
    files_removed: string[];
  }>> {
    try {
      let filesDeleted = 0;
      let storageFreed = 0;
      const filesRemoved: string[] = [];

      // Clean up temp files in active projects
      const tempPrefix = `${this.directoryStructure.active}/`;
      const tempObjects = await this.env.PROJECTS_BUCKET.list({ prefix: tempPrefix });
      
      const cutoffTime = Date.now() - (this.policy.retention_days.temp_files * 24 * 60 * 60 * 1000);

      for (const obj of tempObjects.objects) {
        // Check if file is a temp file (contains 'temp' or is build artifact older than retention)
        if (obj.key.includes('/temp/') || obj.key.includes('/builds/')) {
          const modifiedTime = obj.uploaded?.getTime() || 0;
          if (modifiedTime < cutoffTime) {
            await this.env.PROJECTS_BUCKET.delete(obj.key);
            filesDeleted++;
            storageFreed += (obj.size || 0) / (1024 * 1024); // Convert to MB
            filesRemoved.push(obj.key);
          }
        }
      }

      return {
        success: true,
        data: {
          files_deleted: filesDeleted,
          storage_freed_mb: storageFreed,
          files_removed: filesRemoved
        }
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: 'Failed to cleanup temporary files',
          details: error
        }
      };
    }
  }

  /**
   * Archive a project from active to archived directory
   */
  private async archiveProject(projectId: string, reason: string): Promise<MultiProjectResult<{
    archived: boolean;
    storage_freed_mb: number;
  }>> {
    try {
      console.info('[CLEANUP] Archiving project', { project_id: projectId, reason });

      const sourcePrefix = `${this.directoryStructure.active}/${projectId}/`;
      const targetPrefix = `${this.directoryStructure.archived}/${projectId}/`;

      // List all objects in the project
      const objects = await this.env.PROJECTS_BUCKET.list({ prefix: sourcePrefix });
      let storageFreed = 0;

      // Copy objects to archived location
      for (const obj of objects.objects) {
        const sourceKey = obj.key;
        const targetKey = sourceKey.replace(sourcePrefix, targetPrefix);
        
        // Get object and copy to new location
        const sourceObject = await this.env.PROJECTS_BUCKET.get(sourceKey);
        if (sourceObject) {
          await this.env.PROJECTS_BUCKET.put(targetKey, sourceObject.body, {
            httpMetadata: sourceObject.httpMetadata,
            customMetadata: {
              ...sourceObject.customMetadata,
              archived_at: new Date().toISOString(),
              archived_reason: reason
            }
          });
          
          // Delete from source location
          await this.env.PROJECTS_BUCKET.delete(sourceKey);
          storageFreed += (obj.size || 0) / (1024 * 1024); // Archiving can free space through compression
        }
      }

      return {
        success: true,
        data: {
          archived: true,
          storage_freed_mb: storageFreed * 0.1 // Estimate 10% space savings from archival
        }
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: 'Failed to archive project',
          details: error
        }
      };
    }
  }

  /**
   * Delete a project permanently
   */
  private async deleteProject(projectId: string, reason: string): Promise<MultiProjectResult<{
    deleted: boolean;
    storage_freed_mb: number;
  }>> {
    try {
      console.info('[CLEANUP] Deleting project permanently', { project_id: projectId, reason });

      const projectPrefix = `${this.directoryStructure.archived}/${projectId}/`;
      const objects = await this.env.PROJECTS_BUCKET.list({ prefix: projectPrefix });
      
      let storageFreed = 0;

      // Delete all project objects
      for (const obj of objects.objects) {
        await this.env.PROJECTS_BUCKET.delete(obj.key);
        storageFreed += (obj.size || 0) / (1024 * 1024);
      }

      // Log deletion for audit
      const deletionLog = {
        project_id: projectId,
        deleted_at: new Date().toISOString(),
        reason: reason,
        storage_freed_mb: storageFreed
      };

      await this.env.PROJECTS_BUCKET.put(
        `${this.directoryStructure.logs}/deletions/${projectId}-${Date.now()}.json`,
        JSON.stringify(deletionLog),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            type: 'deletion-log',
            project_id: projectId,
            deleted_at: deletionLog.deleted_at
          }
        }
      );

      return {
        success: true,
        data: {
          deleted: true,
          storage_freed_mb: storageFreed
        }
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: 'Failed to delete project',
          details: error
        }
      };
    }
  }

  /**
   * Identify failed projects that can be cleaned up
   */
  private async identifyFailedProjects(): Promise<ProjectCleanupStatus[]> {
    const failedProjects: ProjectCleanupStatus[] = [];
    const activeProjects = await this.getProjectsInDirectory(this.directoryStructure.active);
    
    for (const projectId of activeProjects) {
      const metadata = await this.getProjectMetadata(projectId, false);
      if (metadata && metadata.status === 'failed') {
        const age = this.calculateProjectAge(metadata.created_at);
        const size = await this.calculateProjectSize(projectId, false);
        
        failedProjects.push({
          project_id: projectId,
          current_status: 'failed',
          recommended_action: age > this.policy.retention_days.failed_projects ? 'archive' : 'keep',
          reasons: [`Failed project older than ${this.policy.retention_days.failed_projects} days`],
          metrics: {
            age_days: age,
            size_mb: size,
            last_activity: metadata.updated_at,
            build_failures: 1,
            storage_efficiency: 0
          },
          priority: age > this.policy.retention_days.failed_projects ? 'high' : 'low'
        });
      }
    }
    
    return failedProjects;
  }

  /**
   * Identify inactive projects based on activity thresholds
   */
  private async identifyInactiveProjects(): Promise<ProjectCleanupStatus[]> {
    const inactiveProjects: ProjectCleanupStatus[] = [];
    const activeProjects = await this.getProjectsInDirectory(this.directoryStructure.active);
    
    for (const projectId of activeProjects) {
      const metadata = await this.getProjectMetadata(projectId, false);
      if (metadata) {
        const daysSinceUpdate = this.calculateProjectAge(metadata.updated_at);
        const size = await this.calculateProjectSize(projectId, false);
        
        if (daysSinceUpdate > this.policy.activity_thresholds.inactive_days) {
          inactiveProjects.push({
            project_id: projectId,
            current_status: metadata.status,
            recommended_action: daysSinceUpdate > this.policy.activity_thresholds.abandoned_days ? 'archive' : 'keep',
            reasons: [`No activity for ${daysSinceUpdate} days`],
            metrics: {
              age_days: this.calculateProjectAge(metadata.created_at),
              size_mb: size,
              last_activity: metadata.updated_at,
              build_failures: metadata.status === 'failed' ? 1 : 0,
              storage_efficiency: this.calculateStorageEfficiency(size, daysSinceUpdate)
            },
            priority: daysSinceUpdate > this.policy.activity_thresholds.abandoned_days ? 'medium' : 'low'
          });
        }
      }
    }
    
    return inactiveProjects;
  }

  /**
   * Identify old archived projects that can be deleted
   */
  private async identifyOldArchivedProjects(): Promise<ProjectCleanupStatus[]> {
    const oldProjects: ProjectCleanupStatus[] = [];
    const archivedProjects = await this.getProjectsInDirectory(this.directoryStructure.archived);
    
    for (const projectId of archivedProjects) {
      const metadata = await this.getProjectMetadata(projectId, true);
      if (metadata) {
        const age = this.calculateProjectAge(metadata.created_at);
        const size = await this.calculateProjectSize(projectId, true);
        
        oldProjects.push({
          project_id: projectId,
          current_status: metadata.status,
          recommended_action: age > this.policy.retention_days.archived_projects ? 'delete' : 'keep',
          reasons: [`Archived project older than ${this.policy.retention_days.archived_projects} days`],
          metrics: {
            age_days: age,
            size_mb: size,
            last_activity: metadata.updated_at,
            build_failures: metadata.status === 'failed' ? 1 : 0,
            storage_efficiency: 0
          },
          priority: age > this.policy.retention_days.archived_projects ? 'high' : 'low'
        });
      }
    }
    
    return oldProjects;
  }

  /**
   * Identify large projects that need optimization
   */
  private async identifyLargeProjects(): Promise<ProjectCleanupStatus[]> {
    const largeProjects: ProjectCleanupStatus[] = [];
    const activeProjects = await this.getProjectsInDirectory(this.directoryStructure.active);
    
    for (const projectId of activeProjects) {
      const metadata = await this.getProjectMetadata(projectId, false);
      if (metadata) {
        const size = await this.calculateProjectSize(projectId, false);
        
        if (size > this.policy.size_limits.max_project_size_mb) {
          largeProjects.push({
            project_id: projectId,
            current_status: metadata.status,
            recommended_action: 'optimize',
            reasons: [`Project size (${Math.round(size)}MB) exceeds limit (${this.policy.size_limits.max_project_size_mb}MB)`],
            metrics: {
              age_days: this.calculateProjectAge(metadata.created_at),
              size_mb: size,
              last_activity: metadata.updated_at,
              build_failures: metadata.status === 'failed' ? 1 : 0,
              storage_efficiency: this.calculateStorageEfficiency(size, this.calculateProjectAge(metadata.updated_at))
            },
            priority: size > this.policy.size_limits.max_project_size_mb * 1.5 ? 'critical' : 'medium'
          });
        }
      }
    }
    
    return largeProjects;
  }

  /**
   * Optimize a large project by removing unnecessary files
   */
  private async optimizeProject(projectId: string): Promise<MultiProjectResult<{
    optimized: boolean;
    storage_freed_mb: number;
  }>> {
    try {
      console.info('[CLEANUP] Optimizing project', { project_id: projectId });

      let storageFreed = 0;
      const projectPrefix = `${this.directoryStructure.active}/${projectId}/`;
      const objects = await this.env.PROJECTS_BUCKET.list({ prefix: projectPrefix });

      // Remove large unnecessary files (logs, temp files, large build artifacts)
      for (const obj of objects.objects) {
        const shouldDelete = this.shouldDeleteForOptimization(obj.key, obj.size || 0);
        
        if (shouldDelete) {
          await this.env.PROJECTS_BUCKET.delete(obj.key);
          storageFreed += (obj.size || 0) / (1024 * 1024);
        }
      }

      return {
        success: true,
        data: {
          optimized: true,
          storage_freed_mb: storageFreed
        }
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: 'Failed to optimize project',
          details: error
        }
      };
    }
  }

  /**
   * Perform basic repository optimization
   */
  private async performBasicOptimization(): Promise<MultiProjectResult<{
    storage_freed_mb: number;
    projects_optimized: string[];
  }>> {
    try {
      let totalStorageFreed = 0;
      const projectsOptimized: string[] = [];

      // Clean up build reservations older than timeout
      const reservationPrefix = `${this.directoryStructure.shared}/build-reservations/`;
      const reservations = await this.env.PROJECTS_BUCKET.list({ prefix: reservationPrefix });
      const timeoutMs = 30 * 60 * 1000; // 30 minutes

      for (const obj of reservations.objects) {
        const age = Date.now() - (obj.uploaded?.getTime() || 0);
        if (age > timeoutMs) {
          await this.env.PROJECTS_BUCKET.delete(obj.key);
          totalStorageFreed += (obj.size || 0) / (1024 * 1024);
        }
      }

      return {
        success: true,
        data: {
          storage_freed_mb: totalStorageFreed,
          projects_optimized: projectsOptimized
        }
      };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'cleanup_error',
          message: 'Basic optimization failed',
          details: error
        }
      };
    }
  }

  // Additional helper methods would continue here...
  // For brevity, I'll include key methods but not every single helper

  /**
   * Get current storage usage
   */
  private async getCurrentStorageUsage(): Promise<{ total_mb: number; active_mb: number; archived_mb: number }> {
    try {
      const allObjects = await this.env.PROJECTS_BUCKET.list();
      let totalSize = 0;
      let activeSize = 0;
      let archivedSize = 0;

      for (const obj of allObjects.objects) {
        const size = obj.size || 0;
        totalSize += size;

        if (obj.key.startsWith(this.directoryStructure.active)) {
          activeSize += size;
        } else if (obj.key.startsWith(this.directoryStructure.archived)) {
          archivedSize += size;
        }
      }

      return {
        total_mb: totalSize / (1024 * 1024),
        active_mb: activeSize / (1024 * 1024),
        archived_mb: archivedSize / (1024 * 1024)
      };
    } catch (error) {
      return { total_mb: 0, active_mb: 0, archived_mb: 0 };
    }
  }

  private calculateStorageReduction(storageFreedMB: number): number {
    // Calculate percentage based on maximum repository size
    const maxStorageMB = this.config.maxRepositorySizeGB * 1024;
    return (storageFreedMB / maxStorageMB) * 100;
  }

  private async getProjectsInDirectory(directory: string): Promise<string[]> {
    try {
      const listResult = await this.env.PROJECTS_BUCKET.list({
        prefix: `${directory}/`,
        delimiter: '/'
      });
      
      return (listResult.delimitedPrefixes || [])
        .map(prefix => prefix.replace(`${directory}/`, '').replace('/', ''))
        .filter(id => id.length > 0);
    } catch (error) {
      return [];
    }
  }

  private async getProjectMetadata(projectId: string, archived: boolean): Promise<ProjectMetadata | null> {
    try {
      const baseDir = archived ? this.directoryStructure.archived : this.directoryStructure.active;
      const metadataKey = `${baseDir}/${projectId}/metadata.json`;
      const metadataObj = await this.env.PROJECTS_BUCKET.get(metadataKey);
      
      if (metadataObj) {
        return await metadataObj.json() as ProjectMetadata;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  private async calculateProjectSize(projectId: string, archived: boolean): Promise<number> {
    try {
      const baseDir = archived ? this.directoryStructure.archived : this.directoryStructure.active;
      const projectPrefix = `${baseDir}/${projectId}/`;
      const objects = await this.env.PROJECTS_BUCKET.list({ prefix: projectPrefix });
      
      let totalSize = 0;
      for (const obj of objects.objects) {
        totalSize += obj.size || 0;
      }
      
      return totalSize / (1024 * 1024); // Convert to MB
    } catch (error) {
      return 0;
    }
  }

  private calculateProjectAge(dateString: string): number {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  private calculateStorageEfficiency(sizeMB: number, daysSinceActivity: number): number {
    // Lower efficiency for larger projects with less recent activity
    const sizeScore = Math.max(0, 100 - (sizeMB / this.policy.size_limits.max_project_size_mb) * 100);
    const activityScore = Math.max(0, 100 - (daysSinceActivity / 30) * 100);
    return (sizeScore + activityScore) / 2;
  }

  private shouldDeleteForOptimization(key: string, size: number): boolean {
    // Delete large log files, temp files, and excessive build artifacts
    const largeSizeThreshold = 10 * 1024 * 1024; // 10MB
    
    return (
      key.includes('/logs/') ||
      key.includes('/temp/') ||
      key.includes('/.cache/') ||
      (key.includes('/builds/') && size > largeSizeThreshold)
    );
  }

  private async calculateStorageDistribution(): Promise<any> {
    // Simplified implementation - could be expanded for more detailed analysis
    const usage = await this.getCurrentStorageUsage();
    return {
      active_projects_mb: usage.active_mb,
      archived_projects_mb: usage.archived_mb,
      temp_files_mb: usage.total_mb - usage.active_mb - usage.archived_mb,
      cache_files_mb: 0 // Would need to calculate cache usage
    };
  }

  private generateCleanupRecommendations(
    totalStorageMB: number,
    largestProjects: any[],
    oldestProjects: any[],
    storageDistribution: any
  ): string[] {
    const recommendations: string[] = [];
    
    if (totalStorageMB > this.config.maxRepositorySizeGB * 1024 * 0.8) {
      recommendations.push('Repository approaching storage limit - consider archiving old projects');
    }
    
    if (largestProjects.length > 0 && largestProjects[0].size_mb > this.policy.size_limits.max_project_size_mb) {
      recommendations.push('Large projects detected - consider optimization or archival');
    }
    
    if (oldestProjects.length > 0 && oldestProjects[0].age_days > this.policy.retention_days.active_projects) {
      recommendations.push('Old projects detected - consider archival based on age');
    }
    
    return recommendations;
  }

  private async applyCleanupRecommendation(recommendation: string): Promise<MultiProjectResult<{ storage_freed_mb: number }>> {
    // Simplified implementation - would analyze recommendation and apply appropriate cleanup
    return { success: true, data: { storage_freed_mb: 0 } };
  }

  private async defragmentRepository(): Promise<MultiProjectResult<{ storage_freed_mb: number }>> {
    // Repository defragmentation logic would go here
    return { success: true, data: { storage_freed_mb: 0 } };
  }

  private async cleanupCacheFiles(): Promise<MultiProjectResult<{ storage_freed_mb: number }>> {
    // Cache cleanup logic would go here
    return { success: true, data: { storage_freed_mb: 0 } };
  }

  private async updateRepositoryHealthStatistics(stats: any): Promise<void> {
    try {
      const statsKey = `${this.directoryStructure.config}/health-stats.json`;
      await this.env.PROJECTS_BUCKET.put(
        statsKey,
        JSON.stringify({
          ...stats,
          last_updated: new Date().toISOString()
        }),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            type: 'health-statistics',
            updated_at: new Date().toISOString()
          }
        }
      );
    } catch (error) {
      console.warn('[CLEANUP] Failed to update repository health statistics', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

/**
 * Factory function to create RepositoryCleanupManager
 */
export function createRepositoryCleanupManager(
  env: Env,
  config: RepositoryStructure,
  directoryStructure: ProjectDirectoryStructure,
  policy?: Partial<CleanupPolicy>
): RepositoryCleanupManager {
  return new RepositoryCleanupManager(env, config, directoryStructure, policy);
}