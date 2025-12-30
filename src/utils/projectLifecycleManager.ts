/**
 * Project Lifecycle Manager
 * 
 * Manages the complete lifecycle of projects within the multi-project repository.
 * Handles project creation, transitions between states (active -> archived -> deleted),
 * and ensures proper resource management throughout the project lifecycle.
 * 
 * Features:
 * - Project creation with proper initialization
 * - State transitions (active -> archived -> deleted)
 * - Lifecycle policy enforcement
 * - Resource allocation and deallocation
 * - Audit logging for all lifecycle events
 * - Rollback capabilities for failed operations
 */

import { 
  ProjectMetadata,
  ProjectStatus,
  FrameworkType 
} from '../types/api';

import { 
  RepositoryStructure,
  ProjectDirectoryStructure,
  MultiProjectResult 
} from './multiProjectManager';

/**
 * Project lifecycle configuration
 */
export interface LifecycleConfig {
  enableAuditLogging: boolean;          // Log all lifecycle events
  enableRollback: boolean;              // Allow rollback of failed operations
  enableStateValidation: boolean;       // Validate state transitions
  enableResourceTracking: boolean;      // Track resource usage during lifecycle
  maxRetries: number;                   // Maximum retries for failed operations
  retryDelayMs: number;                 // Delay between retries
}

/**
 * Project lifecycle state
 */
export type ProjectLifecycleState = 
  | 'creating'      // Project is being created
  | 'active'        // Project is active and available for builds
  | 'archiving'     // Project is being moved to archive
  | 'archived'      // Project is archived but preserved
  | 'deleting'      // Project is being permanently deleted
  | 'deleted'       // Project has been permanently deleted
  | 'error';        // Project is in an error state

/**
 * Lifecycle operation result
 */
export interface LifecycleResult<T = any> {
  success: boolean;
  data?: T;
  error?: {
    type: 'validation_error' | 'state_conflict' | 'resource_error' | 'storage_error';
    message: string;
    details?: any;
  };
  metadata?: {
    project_id: string;
    operation: string;
    duration_ms: number;
    resources_affected: string[];
    rollback_available: boolean;
  };
}

/**
 * Project lifecycle event
 */
export interface LifecycleEvent {
  event_id: string;
  project_id: string;
  event_type: 'created' | 'archived' | 'restored' | 'deleted' | 'error';
  from_state: ProjectLifecycleState;
  to_state: ProjectLifecycleState;
  timestamp: string;
  duration_ms: number;
  triggered_by: 'user' | 'system' | 'policy';
  metadata: {
    reason?: string;
    resources_affected: string[];
    storage_change_mb: number;
    rollback_data?: any;
  };
}

/**
 * Project creation request
 */
export interface ProjectCreationRequest {
  project_id: string;
  metadata: ProjectMetadata;
  source_files: Record<string, string>;
  options?: {
    skip_validation?: boolean;
    enable_fast_creation?: boolean;
    custom_directory?: string;
  };
}

/**
 * Project archival request
 */
export interface ProjectArchivalRequest {
  project_id: string;
  reason: 'age_based' | 'size_based' | 'activity_based' | 'user_requested' | 'policy_based';
  preserve_build_history: boolean;
  compress_artifacts: boolean;
  metadata?: Record<string, any>;
}

/**
 * Project restoration request
 */
export interface ProjectRestorationRequest {
  project_id: string;
  restore_to_state: 'active';
  restore_build_history: boolean;
  reason: string;
}

/**
 * Project deletion request
 */
export interface ProjectDeletionRequest {
  project_id: string;
  deletion_type: 'soft' | 'hard';
  reason: 'age_based' | 'user_requested' | 'policy_based' | 'cleanup';
  grace_period_hours?: number;
  create_backup?: boolean;
}

/**
 * Project Lifecycle Manager
 * 
 * Manages all aspects of project lifecycle from creation to deletion
 */
export class ProjectLifecycleManager {
  private config: LifecycleConfig;
  private auditLog: LifecycleEvent[];

  constructor(
    private env: Env,
    private repositoryConfig: RepositoryStructure,
    private directoryStructure: ProjectDirectoryStructure,
    config?: Partial<LifecycleConfig>
  ) {
    // Initialize configuration with defaults
    this.config = {
      enableAuditLogging: true,
      enableRollback: true,
      enableStateValidation: true,
      enableResourceTracking: true,
      maxRetries: 3,
      retryDelayMs: 1000,
      ...config
    };

    this.auditLog = [];
  }

  /**
   * Create a new project with full lifecycle setup
   */
  async createProject(
    projectId: string,
    metadata: ProjectMetadata,
    sourceFiles: Record<string, string>,
    options?: ProjectCreationRequest['options']
  ): Promise<LifecycleResult<{
    project_created: boolean;
    directory_path: string;
    files_created: number;
    initial_size_mb: number;
  }>> {
    const startTime = Date.now();
    let rollbackData: any = null;

    try {
      console.info('[LIFECYCLE] Creating project', {
        project_id: projectId,
        framework: metadata.framework,
        files_count: Object.keys(sourceFiles).length,
        enable_fast_creation: options?.enable_fast_creation
      });

      // Validate project creation request
      if (this.config.enableStateValidation) {
        const validation = await this.validateProjectCreation(projectId, metadata, sourceFiles);
        if (!validation.success) {
          return validation;
        }
      }

      // Check if project already exists
      const existsCheck = await this.checkProjectExists(projectId);
      if (existsCheck.exists) {
        return {
          success: false,
          error: {
            type: 'state_conflict',
            message: `Project ${projectId} already exists`,
            details: { current_state: existsCheck.state }
          },
          metadata: {
            project_id: projectId,
            operation: 'create',
            duration_ms: Date.now() - startTime,
            resources_affected: [],
            rollback_available: false
          }
        };
      }

      // Begin project creation process
      await this.setProjectState(projectId, 'creating');

      // Create project directory structure
      const directoryPath = `${this.directoryStructure.active}/${projectId}`;
      const directoryCreation = await this.createProjectDirectories(projectId, directoryPath);
      
      if (!directoryCreation.success) {
        await this.setProjectState(projectId, 'error');
        return directoryCreation;
      }

      rollbackData = { directories_created: directoryCreation.data?.directories || [] };

      // Store project metadata
      const metadataStorage = await this.storeProjectMetadata(projectId, metadata, directoryPath);
      if (!metadataStorage.success) {
        if (this.config.enableRollback) {
          await this.rollbackProjectCreation(projectId, rollbackData);
        }
        await this.setProjectState(projectId, 'error');
        return metadataStorage;
      }

      // Store source files
      let totalSizeMB = 0;
      let filesCreated = 0;
      const fileKeys: string[] = [];

      for (const [filename, content] of Object.entries(sourceFiles)) {
        const fileKey = `${directoryPath}/source/${filename}`;
        const contentBuffer = new TextEncoder().encode(content);
        
        await this.env.PROJECTS_BUCKET.put(fileKey, contentBuffer, {
          httpMetadata: { contentType: this.getContentType(filename) },
          customMetadata: {
            project_id: projectId,
            created_at: new Date().toISOString(),
            file_type: 'source',
            original_filename: filename
          }
        });

        totalSizeMB += contentBuffer.byteLength / (1024 * 1024);
        filesCreated++;
        fileKeys.push(fileKey);
      }

      rollbackData.files_created = fileKeys;

      // Create project lifecycle metadata
      const lifecycleMetadata = {
        project_id: projectId,
        current_state: 'active' as ProjectLifecycleState,
        created_at: new Date().toISOString(),
        state_history: [
          {
            state: 'creating',
            timestamp: new Date(startTime).toISOString(),
            duration_ms: 0
          },
          {
            state: 'active',
            timestamp: new Date().toISOString(),
            duration_ms: Date.now() - startTime
          }
        ],
        resource_usage: {
          storage_mb: totalSizeMB,
          file_count: filesCreated,
          directory_count: directoryCreation.data?.directories?.length || 0
        },
        lifecycle_config: {
          auto_archive_days: this.repositoryConfig.activeProjectRetentionDays,
          auto_delete_days: this.repositoryConfig.archivedProjectRetentionDays,
          max_size_mb: this.repositoryConfig.maxProjectSizeMB
        }
      };

      await this.env.PROJECTS_BUCKET.put(
        `${directoryPath}/lifecycle.json`,
        JSON.stringify(lifecycleMetadata, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            type: 'lifecycle-metadata',
            created_at: new Date().toISOString()
          }
        }
      );

      // Set final project state
      await this.setProjectState(projectId, 'active');

      // Log creation event
      if (this.config.enableAuditLogging) {
        await this.logLifecycleEvent({
          event_id: `create-${projectId}-${Date.now()}`,
          project_id: projectId,
          event_type: 'created',
          from_state: 'creating',
          to_state: 'active',
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          triggered_by: 'user',
          metadata: {
            reason: 'Project creation requested',
            resources_affected: [directoryPath, ...fileKeys],
            storage_change_mb: totalSizeMB
          }
        });
      }

      console.info('✅ [LIFECYCLE] Project created successfully', {
        project_id: projectId,
        directory_path: directoryPath,
        files_created: filesCreated,
        size_mb: Math.round(totalSizeMB),
        duration_ms: Date.now() - startTime
      });

      return {
        success: true,
        data: {
          project_created: true,
          directory_path: directoryPath,
          files_created: filesCreated,
          initial_size_mb: totalSizeMB
        },
        metadata: {
          project_id: projectId,
          operation: 'create',
          duration_ms: Date.now() - startTime,
          resources_affected: [directoryPath, ...fileKeys],
          rollback_available: this.config.enableRollback
        }
      };

    } catch (error) {
      console.error('[LIFECYCLE] Project creation failed', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      // Attempt rollback if enabled and rollback data exists
      if (this.config.enableRollback && rollbackData) {
        try {
          await this.rollbackProjectCreation(projectId, rollbackData);
        } catch (rollbackError) {
          console.error('[LIFECYCLE] Rollback failed', {
            project_id: projectId,
            rollback_error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          });
        }
      }

      await this.setProjectState(projectId, 'error');

      return {
        success: false,
        error: {
          type: 'storage_error',
          message: 'Project creation failed',
          details: error
        },
        metadata: {
          project_id: projectId,
          operation: 'create',
          duration_ms: Date.now() - startTime,
          resources_affected: [],
          rollback_available: false
        }
      };
    }
  }

  /**
   * Archive a project from active to archived state
   */
  async archiveProject(
    request: ProjectArchivalRequest
  ): Promise<LifecycleResult<{
    archived: boolean;
    storage_change_mb: number;
    archived_location: string;
  }>> {
    const startTime = Date.now();

    try {
      console.info('[LIFECYCLE] Archiving project', {
        project_id: request.project_id,
        reason: request.reason,
        preserve_build_history: request.preserve_build_history
      });

      // Validate project can be archived
      const validation = await this.validateProjectArchival(request.project_id);
      if (!validation.success) {
        return validation;
      }

      await this.setProjectState(request.project_id, 'archiving');

      const sourcePath = `${this.directoryStructure.active}/${request.project_id}`;
      const targetPath = `${this.directoryStructure.archived}/${request.project_id}`;

      // Get all project objects
      const projectObjects = await this.env.PROJECTS_BUCKET.list({ prefix: `${sourcePath}/` });
      let storageChangeMB = 0;
      const movedObjects: string[] = [];

      // Move objects to archived location
      for (const obj of projectObjects.objects) {
        const sourceKey = obj.key;
        const targetKey = sourceKey.replace(sourcePath, targetPath);

        // Skip build history if not preserving
        if (!request.preserve_build_history && sourceKey.includes('/builds/')) {
          await this.env.PROJECTS_BUCKET.delete(sourceKey);
          storageChangeMB -= (obj.size || 0) / (1024 * 1024);
          continue;
        }

        // Get source object
        const sourceObj = await this.env.PROJECTS_BUCKET.get(sourceKey);
        if (sourceObj) {
          // Apply compression if requested
          let content = sourceObj.body;
          if (request.compress_artifacts && this.shouldCompress(sourceKey)) {
            // Simplified compression - in production you might use actual compression
            const text = await sourceObj.text();
            content = text; // Placeholder for compression logic
          }

          // Store in archived location with archival metadata
          await this.env.PROJECTS_BUCKET.put(targetKey, content, {
            httpMetadata: sourceObj.httpMetadata,
            customMetadata: {
              ...sourceObj.customMetadata,
              archived_at: new Date().toISOString(),
              archived_reason: request.reason,
              original_location: sourceKey,
              compressed: request.compress_artifacts && this.shouldCompress(sourceKey)
            }
          });

          // Delete from source location
          await this.env.PROJECTS_BUCKET.delete(sourceKey);
          movedObjects.push(targetKey);
        }
      }

      // Update lifecycle metadata
      await this.updateLifecycleState(request.project_id, 'archived', targetPath, {
        archived_reason: request.reason,
        preserve_build_history: request.preserve_build_history,
        compress_artifacts: request.compress_artifacts,
        objects_moved: movedObjects.length,
        storage_change_mb: storageChangeMB
      });

      // Log archival event
      if (this.config.enableAuditLogging) {
        await this.logLifecycleEvent({
          event_id: `archive-${request.project_id}-${Date.now()}`,
          project_id: request.project_id,
          event_type: 'archived',
          from_state: 'active',
          to_state: 'archived',
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          triggered_by: 'system',
          metadata: {
            reason: `Project archived: ${request.reason}`,
            resources_affected: movedObjects,
            storage_change_mb: storageChangeMB
          }
        });
      }

      console.info('✅ [LIFECYCLE] Project archived successfully', {
        project_id: request.project_id,
        archived_location: targetPath,
        objects_moved: movedObjects.length,
        storage_change_mb: Math.round(storageChangeMB),
        duration_ms: Date.now() - startTime
      });

      return {
        success: true,
        data: {
          archived: true,
          storage_change_mb: storageChangeMB,
          archived_location: targetPath
        },
        metadata: {
          project_id: request.project_id,
          operation: 'archive',
          duration_ms: Date.now() - startTime,
          resources_affected: movedObjects,
          rollback_available: true
        }
      };

    } catch (error) {
      console.error('[LIFECYCLE] Project archival failed', {
        project_id: request.project_id,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      await this.setProjectState(request.project_id, 'error');

      return {
        success: false,
        error: {
          type: 'storage_error',
          message: 'Project archival failed',
          details: error
        },
        metadata: {
          project_id: request.project_id,
          operation: 'archive',
          duration_ms: Date.now() - startTime,
          resources_affected: [],
          rollback_available: false
        }
      };
    }
  }

  /**
   * Delete a project permanently
   */
  async deleteProject(
    projectId: string,
    hard: boolean = false,
    reason: string = 'manual'
  ): Promise<LifecycleResult<{
    deleted: boolean;
    storage_freed_mb: number;
    backup_created: boolean;
  }>> {
    const startTime = Date.now();

    try {
      console.info('[LIFECYCLE] Deleting project', {
        project_id: projectId,
        hard_delete: hard,
        reason
      });

      // Validate project can be deleted
      const validation = await this.validateProjectDeletion(projectId);
      if (!validation.success) {
        return validation;
      }

      await this.setProjectState(projectId, 'deleting');

      // Determine project location (active or archived)
      const projectLocation = await this.findProjectLocation(projectId);
      if (!projectLocation.found) {
        return {
          success: false,
          error: {
            type: 'validation_error',
            message: `Project ${projectId} not found in any location`
          }
        };
      }

      const projectPath = projectLocation.path!;
      let storageFreedMB = 0;
      let backupCreated = false;

      // Create backup if requested and not hard delete
      if (!hard && this.config.enableRollback) {
        const backupResult = await this.createProjectBackup(projectId, projectPath);
        backupCreated = backupResult.success;
      }

      // Get all project objects for deletion
      const projectObjects = await this.env.PROJECTS_BUCKET.list({ prefix: `${projectPath}/` });
      const deletedObjects: string[] = [];

      // Delete all project objects
      for (const obj of projectObjects.objects) {
        await this.env.PROJECTS_BUCKET.delete(obj.key);
        storageFreedMB += (obj.size || 0) / (1024 * 1024);
        deletedObjects.push(obj.key);
      }

      // Create deletion record
      await this.createDeletionRecord(projectId, {
        deleted_at: new Date().toISOString(),
        reason: reason,
        hard_delete: hard,
        storage_freed_mb: storageFreedMB,
        backup_created: backupCreated,
        objects_deleted: deletedObjects.length
      });

      // Log deletion event
      if (this.config.enableAuditLogging) {
        await this.logLifecycleEvent({
          event_id: `delete-${projectId}-${Date.now()}`,
          project_id: projectId,
          event_type: 'deleted',
          from_state: projectLocation.state as ProjectLifecycleState,
          to_state: 'deleted',
          timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          triggered_by: 'system',
          metadata: {
            reason: `Project deleted: ${reason}`,
            resources_affected: deletedObjects,
            storage_change_mb: -storageFreedMB
          }
        });
      }

      console.info('✅ [LIFECYCLE] Project deleted successfully', {
        project_id: projectId,
        objects_deleted: deletedObjects.length,
        storage_freed_mb: Math.round(storageFreedMB),
        backup_created: backupCreated,
        duration_ms: Date.now() - startTime
      });

      return {
        success: true,
        data: {
          deleted: true,
          storage_freed_mb: storageFreedMB,
          backup_created: backupCreated
        },
        metadata: {
          project_id: projectId,
          operation: 'delete',
          duration_ms: Date.now() - startTime,
          resources_affected: deletedObjects,
          rollback_available: backupCreated
        }
      };

    } catch (error) {
      console.error('[LIFECYCLE] Project deletion failed', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      await this.setProjectState(projectId, 'error');

      return {
        success: false,
        error: {
          type: 'storage_error',
          message: 'Project deletion failed',
          details: error
        },
        metadata: {
          project_id: projectId,
          operation: 'delete',
          duration_ms: Date.now() - startTime,
          resources_affected: [],
          rollback_available: false
        }
      };
    }
  }

  /**
   * Get project lifecycle status and history
   */
  async getProjectLifecycleStatus(projectId: string): Promise<LifecycleResult<{
    current_state: ProjectLifecycleState;
    state_history: any[];
    resource_usage: any;
    lifecycle_config: any;
  }>> {
    try {
      const projectLocation = await this.findProjectLocation(projectId);
      
      if (!projectLocation.found) {
        return {
          success: false,
          error: {
            type: 'validation_error',
            message: `Project ${projectId} not found`
          }
        };
      }

      const lifecyclePath = `${projectLocation.path}/lifecycle.json`;
      const lifecycleObj = await this.env.PROJECTS_BUCKET.get(lifecyclePath);

      if (!lifecycleObj) {
        return {
          success: false,
          error: {
            type: 'validation_error',
            message: 'Lifecycle metadata not found'
          }
        };
      }

      const lifecycleData = await lifecycleObj.json();

      return {
        success: true,
        data: {
          current_state: lifecycleData.current_state,
          state_history: lifecycleData.state_history || [],
          resource_usage: lifecycleData.resource_usage || {},
          lifecycle_config: lifecycleData.lifecycle_config || {}
        }
      };

    } catch (error) {
      return {
        success: false,
        error: {
          type: 'storage_error',
          message: 'Failed to get lifecycle status',
          details: error
        }
      };
    }
  }

  // Private helper methods

  private async validateProjectCreation(
    projectId: string,
    metadata: ProjectMetadata,
    sourceFiles: Record<string, string>
  ): Promise<LifecycleResult<boolean>> {
    // Validate project ID format
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
      return {
        success: false,
        error: {
          type: 'validation_error',
          message: 'Invalid project ID format'
        }
      };
    }

    // Validate required metadata
    if (!metadata.framework || !metadata.id) {
      return {
        success: false,
        error: {
          type: 'validation_error',
          message: 'Missing required metadata fields'
        }
      };
    }

    // Validate source files
    if (Object.keys(sourceFiles).length === 0) {
      return {
        success: false,
        error: {
          type: 'validation_error',
          message: 'No source files provided'
        }
      };
    }

    // Estimate storage requirements
    let totalSize = 0;
    for (const content of Object.values(sourceFiles)) {
      totalSize += new TextEncoder().encode(content).length;
    }

    const sizeMB = totalSize / (1024 * 1024);
    if (sizeMB > this.repositoryConfig.maxProjectSizeMB) {
      return {
        success: false,
        error: {
          type: 'validation_error',
          message: `Project size (${Math.round(sizeMB)}MB) exceeds limit (${this.repositoryConfig.maxProjectSizeMB}MB)`
        }
      };
    }

    return { success: true, data: true };
  }

  private async checkProjectExists(projectId: string): Promise<{ exists: boolean; state?: string }> {
    try {
      // Check active projects
      const activeMetadata = await this.env.PROJECTS_BUCKET.get(`${this.directoryStructure.active}/${projectId}/metadata.json`);
      if (activeMetadata) {
        return { exists: true, state: 'active' };
      }

      // Check archived projects
      const archivedMetadata = await this.env.PROJECTS_BUCKET.get(`${this.directoryStructure.archived}/${projectId}/metadata.json`);
      if (archivedMetadata) {
        return { exists: true, state: 'archived' };
      }

      return { exists: false };
    } catch (error) {
      return { exists: false };
    }
  }

  private async createProjectDirectories(projectId: string, basePath: string): Promise<LifecycleResult<{
    directories: string[];
  }>> {
    try {
      const directories = [
        `${basePath}/source`,
        `${basePath}/builds`,
        `${basePath}/cache`,
        `${basePath}/logs`
      ];

      for (const dir of directories) {
        const keepFile = `${dir}/.gitkeep`;
        await this.env.PROJECTS_BUCKET.put(keepFile, '', {
          customMetadata: {
            project_id: projectId,
            created_at: new Date().toISOString(),
            type: 'directory-marker'
          }
        });
      }

      return { success: true, data: { directories } };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'storage_error',
          message: 'Failed to create project directories',
          details: error
        }
      };
    }
  }

  private async storeProjectMetadata(
    projectId: string,
    metadata: ProjectMetadata,
    directoryPath: string
  ): Promise<LifecycleResult<boolean>> {
    try {
      const metadataPath = `${directoryPath}/metadata.json`;
      
      await this.env.PROJECTS_BUCKET.put(
        metadataPath,
        JSON.stringify(metadata, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            type: 'project-metadata',
            created_at: new Date().toISOString()
          }
        }
      );

      return { success: true, data: true };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'storage_error',
          message: 'Failed to store project metadata',
          details: error
        }
      };
    }
  }

  private async rollbackProjectCreation(projectId: string, rollbackData: any): Promise<void> {
    try {
      console.info('[LIFECYCLE] Rolling back project creation', { project_id: projectId });

      // Delete created files
      if (rollbackData.files_created) {
        for (const fileKey of rollbackData.files_created) {
          try {
            await this.env.PROJECTS_BUCKET.delete(fileKey);
          } catch (error) {
            // Continue with other files even if one fails
          }
        }
      }

      // Delete created directories
      if (rollbackData.directories_created) {
        for (const dir of rollbackData.directories_created) {
          try {
            const objects = await this.env.PROJECTS_BUCKET.list({ prefix: `${dir}/` });
            for (const obj of objects.objects) {
              await this.env.PROJECTS_BUCKET.delete(obj.key);
            }
          } catch (error) {
            // Continue with other directories even if one fails
          }
        }
      }
    } catch (error) {
      console.error('[LIFECYCLE] Rollback failed', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async setProjectState(projectId: string, state: ProjectLifecycleState): Promise<void> {
    // This would typically update a central state registry
    // For now, we'll store it as a simple state file
    try {
      const stateKey = `${this.directoryStructure.shared}/states/${projectId}.json`;
      await this.env.PROJECTS_BUCKET.put(
        stateKey,
        JSON.stringify({
          project_id: projectId,
          state: state,
          updated_at: new Date().toISOString()
        }),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            type: 'lifecycle-state'
          }
        }
      );
    } catch (error) {
      console.warn('[LIFECYCLE] Failed to set project state', {
        project_id: projectId,
        state,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async logLifecycleEvent(event: LifecycleEvent): Promise<void> {
    try {
      if (!this.config.enableAuditLogging) return;

      const eventKey = `${this.directoryStructure.logs}/lifecycle-events/${event.event_id}.json`;
      await this.env.PROJECTS_BUCKET.put(
        eventKey,
        JSON.stringify(event, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: event.project_id,
            event_type: event.event_type,
            type: 'lifecycle-event',
            timestamp: event.timestamp
          }
        }
      );

      // Also add to in-memory log for quick access
      this.auditLog.push(event);
      
      // Keep only recent events in memory (last 100)
      if (this.auditLog.length > 100) {
        this.auditLog = this.auditLog.slice(-100);
      }
    } catch (error) {
      console.warn('[LIFECYCLE] Failed to log lifecycle event', {
        event_id: event.event_id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private getContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      'js': 'application/javascript',
      'ts': 'text/typescript',
      'jsx': 'text/jsx',
      'tsx': 'text/tsx',
      'css': 'text/css',
      'html': 'text/html',
      'json': 'application/json',
      'md': 'text/markdown',
      'txt': 'text/plain'
    };
    return contentTypes[ext || ''] || 'text/plain';
  }

  // Additional helper methods for archival, deletion, etc.
  private async validateProjectArchival(projectId: string): Promise<LifecycleResult<boolean>> {
    const projectLocation = await this.findProjectLocation(projectId);
    
    if (!projectLocation.found) {
      return {
        success: false,
        error: {
          type: 'validation_error',
          message: `Project ${projectId} not found`
        }
      };
    }

    if (projectLocation.state !== 'active') {
      return {
        success: false,
        error: {
          type: 'state_conflict',
          message: `Project is not in active state (current: ${projectLocation.state})`
        }
      };
    }

    return { success: true, data: true };
  }

  private async validateProjectDeletion(projectId: string): Promise<LifecycleResult<boolean>> {
    const projectLocation = await this.findProjectLocation(projectId);
    
    if (!projectLocation.found) {
      return {
        success: false,
        error: {
          type: 'validation_error',
          message: `Project ${projectId} not found`
        }
      };
    }

    // Allow deletion from archived state, but check for active builds
    if (projectLocation.state === 'active') {
      // Check if there are active builds
      const activeBuilds = await this.checkActiveBuilds(projectId);
      if (activeBuilds > 0) {
        return {
          success: false,
          error: {
            type: 'state_conflict',
            message: `Project has ${activeBuilds} active builds`
          }
        };
      }
    }

    return { success: true, data: true };
  }

  private async findProjectLocation(projectId: string): Promise<{
    found: boolean;
    path?: string;
    state?: string;
  }> {
    // Check active projects first
    try {
      const activePath = `${this.directoryStructure.active}/${projectId}`;
      const activeCheck = await this.env.PROJECTS_BUCKET.get(`${activePath}/metadata.json`);
      if (activeCheck) {
        return { found: true, path: activePath, state: 'active' };
      }
    } catch (error) {
      // Project not in active directory
    }

    // Check archived projects
    try {
      const archivedPath = `${this.directoryStructure.archived}/${projectId}`;
      const archivedCheck = await this.env.PROJECTS_BUCKET.get(`${archivedPath}/metadata.json`);
      if (archivedCheck) {
        return { found: true, path: archivedPath, state: 'archived' };
      }
    } catch (error) {
      // Project not in archived directory
    }

    return { found: false };
  }

  private async checkActiveBuilds(projectId: string): Promise<number> {
    try {
      const reservationPrefix = `${this.directoryStructure.shared}/build-reservations/`;
      const reservations = await this.env.PROJECTS_BUCKET.list({ prefix: reservationPrefix });
      
      let activeBuilds = 0;
      for (const obj of reservations.objects) {
        try {
          const reservation = await obj.json();
          if (reservation.project_id === projectId) {
            activeBuilds++;
          }
        } catch (error) {
          // Skip invalid reservation files
        }
      }
      
      return activeBuilds;
    } catch (error) {
      return 0;
    }
  }

  private async updateLifecycleState(
    projectId: string,
    newState: ProjectLifecycleState,
    newPath: string,
    metadata: any
  ): Promise<void> {
    try {
      const lifecyclePath = `${newPath}/lifecycle.json`;
      const existingObj = await this.env.PROJECTS_BUCKET.get(lifecyclePath);
      
      let lifecycleData: any = {};
      if (existingObj) {
        lifecycleData = await existingObj.json();
      }

      // Update state history
      if (!lifecycleData.state_history) {
        lifecycleData.state_history = [];
      }

      lifecycleData.state_history.push({
        state: newState,
        timestamp: new Date().toISOString(),
        metadata: metadata
      });

      lifecycleData.current_state = newState;
      lifecycleData.updated_at = new Date().toISOString();

      await this.env.PROJECTS_BUCKET.put(
        lifecyclePath,
        JSON.stringify(lifecycleData, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            type: 'lifecycle-metadata',
            updated_at: new Date().toISOString()
          }
        }
      );
    } catch (error) {
      console.warn('[LIFECYCLE] Failed to update lifecycle state', {
        project_id: projectId,
        new_state: newState,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private shouldCompress(filePath: string): boolean {
    // Compress text files and build artifacts, but not images or already compressed files
    const compressibleExtensions = ['.js', '.css', '.html', '.json', '.txt', '.md', '.xml'];
    const extension = filePath.substring(filePath.lastIndexOf('.'));
    return compressibleExtensions.includes(extension.toLowerCase());
  }

  private async createProjectBackup(projectId: string, projectPath: string): Promise<LifecycleResult<boolean>> {
    try {
      const backupPath = `${this.directoryStructure.shared}/backups/${projectId}-${Date.now()}`;
      const objects = await this.env.PROJECTS_BUCKET.list({ prefix: `${projectPath}/` });

      for (const obj of objects.objects) {
        const backupKey = obj.key.replace(projectPath, backupPath);
        const sourceObj = await this.env.PROJECTS_BUCKET.get(obj.key);
        
        if (sourceObj) {
          await this.env.PROJECTS_BUCKET.put(backupKey, sourceObj.body, {
            httpMetadata: sourceObj.httpMetadata,
            customMetadata: {
              ...sourceObj.customMetadata,
              backup_of: obj.key,
              backup_created: new Date().toISOString()
            }
          });
        }
      }

      return { success: true, data: true };
    } catch (error) {
      return { success: false, error: { type: 'storage_error', message: 'Backup creation failed' } };
    }
  }

  private async createDeletionRecord(projectId: string, deletionData: any): Promise<void> {
    try {
      const recordKey = `${this.directoryStructure.logs}/deletions/${projectId}-${Date.now()}.json`;
      await this.env.PROJECTS_BUCKET.put(
        recordKey,
        JSON.stringify(deletionData, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            type: 'deletion-record',
            created_at: new Date().toISOString()
          }
        }
      );
    } catch (error) {
      console.warn('[LIFECYCLE] Failed to create deletion record', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

/**
 * Factory function to create ProjectLifecycleManager
 */
export function createProjectLifecycleManager(
  env: Env,
  repositoryConfig: RepositoryStructure,
  directoryStructure: ProjectDirectoryStructure,
  config?: Partial<LifecycleConfig>
): ProjectLifecycleManager {
  return new ProjectLifecycleManager(env, repositoryConfig, directoryStructure, config);
}