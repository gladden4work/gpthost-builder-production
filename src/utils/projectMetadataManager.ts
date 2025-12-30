/**
 * Project Metadata Manager
 * 
 * This utility manages project metadata stored in R2, specifically handling
 * build status updates and GitHub Actions integration metadata.
 * 
 * Features:
 * - Load and update project metadata from R2 storage
 * - Synchronize build status with project records
 * - Track GitHub workflow run information
 * - Handle build completion and deployment status
 * - Comprehensive error handling for R2 operations
 */

import { 
  ProjectMetadata, 
  ProjectStatus,
  BuildStatusType,
  FrameworkType 
} from '../types/api';

import {
  EnhancedBuildStatus
} from './buildStatusTracker';
import { canTransition } from './buildLifecycleStateMachine';

/**
 * Build metadata stored with project
 */
export interface ProjectBuildMetadata {
  github_workflow_run_id?: number;
  github_workflow_run_url?: string;
  github_repository?: string;
  build_started_at?: string;
  build_completed_at?: string;
  build_duration_ms?: number;
  build_status?: BuildStatusType;
  build_stage?: string;
  build_progress?: number;
  build_logs?: string[];
  deployment_url?: string;
  error_message?: string;
}

/**
 * Metadata update result
 */
export interface MetadataUpdateResult {
  success: boolean;
  project_id: string;
  updated_fields: string[];
  error?: {
    type: 'not_found' | 'storage_error' | 'validation_error';
    message: string;
    details?: any;
  };
}

/**
 * Project Metadata Manager for R2 operations
 */
export class ProjectMetadataManager {
  private projectsBucket: R2Bucket;

  constructor(projectsBucket: R2Bucket) {
    this.projectsBucket = projectsBucket;
  }

  /**
   * Load project metadata from R2 storage
   */
  async loadProjectMetadata(projectId: string): Promise<ProjectMetadata | null> {
    try {
      console.info('[PROJECT-METADATA] Loading metadata', { project_id: projectId });

      const metadataPath = `projects/${projectId}/metadata.json`;
      const metadataObject = await this.projectsBucket.get(metadataPath);

      if (!metadataObject) {
        console.warn('[PROJECT-METADATA] Metadata not found', { 
          project_id: projectId,
          path: metadataPath 
        });
        return null;
      }

      const metadataJson = await metadataObject.text();
      const metadata: ProjectMetadata = JSON.parse(metadataJson);

      console.info('[PROJECT-METADATA] Metadata loaded successfully', {
        project_id: projectId,
        status: metadata.status,
        framework: metadata.framework,
        files_count: metadata.files.length
      });

      return metadata;

    } catch (error) {
      console.error('[PROJECT-METADATA] Failed to load metadata', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Update project metadata with build status information
   */
  async updateBuildStatus(
    projectId: string,
    buildStatus: EnhancedBuildStatus
  ): Promise<MetadataUpdateResult> {
    try {
      console.info('[PROJECT-METADATA] Updating build status', {
        project_id: projectId,
        build_status: buildStatus.status,
        progress: buildStatus.progress,
        workflow_run_id: buildStatus.github_metadata.workflow_run_id
      });

      // Load existing metadata
      const existingMetadata = await this.loadProjectMetadata(projectId);
      if (!existingMetadata) {
        return {
          success: false,
          project_id: projectId,
          updated_fields: [],
          error: {
            type: 'not_found',
            message: `Project metadata not found for project ${projectId}`
          }
        };
      }

      const currentStatus = (existingMetadata as any).build_metadata?.build_status as BuildStatusType | undefined;
      if (!canTransition(currentStatus, buildStatus.status)) {
        console.warn('[PROJECT-METADATA] Invalid build status transition', {
          project_id: projectId,
          from: currentStatus,
          to: buildStatus.status
        });
        return {
          success: false,
          project_id: projectId,
          updated_fields: [],
          error: {
            type: 'validation_error',
            message: `Invalid build status transition from ${currentStatus} to ${buildStatus.status}`
          }
        };
      }

      // Convert build status to project status
      const projectStatus = this.convertBuildStatusToProjectStatus(buildStatus.status);

      // Prepare build metadata update
      const buildMetadata: ProjectBuildMetadata = {
        github_workflow_run_id: buildStatus.github_metadata.workflow_run_id,
        github_workflow_run_url: buildStatus.github_metadata.workflow_run_url,
        github_repository: buildStatus.github_metadata.repository,
        build_started_at: buildStatus.metadata.started_at,
        build_completed_at: buildStatus.metadata.completed_at,
        build_duration_ms: buildStatus.metadata.build_duration_ms,
        build_status: buildStatus.status,
        build_stage: buildStatus.current_stage,
        build_progress: buildStatus.progress,
        build_logs: buildStatus.logs,
        error_message: buildStatus.error?.message
      };

      // Update metadata fields with optimistic locking
      const updatedMetadata: ProjectMetadata = {
        ...existingMetadata,
        status: projectStatus,
        updated_at: new Date().toISOString(),
        build_logs: buildStatus.logs,
        // Do not derive deployment_url from logs; preserve any existing valid URL
        deployment_url: existingMetadata.deployment_url,
        error_message: buildStatus.error?.message,
        // Increment version for optimistic locking
        version: ((existingMetadata as any).version || 0) + 1,
        // Add build metadata as custom field
        build_metadata: buildMetadata
      } as ProjectMetadata & { version: number };

      // Save updated metadata to R2 with optimistic locking
      const saveResult = await this.saveProjectMetadataWithLocking(
        projectId, 
        updatedMetadata, 
        (existingMetadata as any).version || 0
      );
      
      if (!saveResult.success) {
        return {
          success: false,
          project_id: projectId,
          updated_fields: [],
          error: saveResult.error
        };
      }

      const updatedFields = [
        'status',
        'updated_at',
        'build_metadata',
        ...(buildStatus.logs ? ['build_logs'] : []),
        // deployment_url unchanged here; deployment stage will update it
        ...(buildStatus.error?.message ? ['error_message'] : [])
      ];

      console.info('✅ [PROJECT-METADATA] Build status updated successfully', {
        project_id: projectId,
        old_status: existingMetadata.status,
        new_status: projectStatus,
        updated_fields: updatedFields
      });

      return {
        success: true,
        project_id: projectId,
        updated_fields: updatedFields
      };

    } catch (error) {
      console.error('[PROJECT-METADATA] Failed to update build status', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        project_id: projectId,
        updated_fields: [],
        error: {
          type: 'storage_error',
          message: error instanceof Error ? error.message : String(error),
          details: error
        }
      };
    }
  }

  /**
   * Start build tracking by updating metadata with GitHub run information
   */
  async startBuildTracking(
    projectId: string,
    workflowRunId: number,
    workflowRunUrl: string,
    repositoryFullName: string
  ): Promise<MetadataUpdateResult> {
    try {
      console.info('[PROJECT-METADATA] Starting build tracking', {
        project_id: projectId,
        workflow_run_id: workflowRunId,
        repository: repositoryFullName
      });

      // Load existing metadata
      const existingMetadata = await this.loadProjectMetadata(projectId);
      if (!existingMetadata) {
        return {
          success: false,
          project_id: projectId,
          updated_fields: [],
          error: {
            type: 'not_found',
            message: `Project metadata not found for project ${projectId}`
          }
        };
      }

      // Update metadata with build tracking information
      const buildMetadata: ProjectBuildMetadata = {
        github_workflow_run_id: workflowRunId,
        github_workflow_run_url: workflowRunUrl,
        github_repository: repositoryFullName,
        build_started_at: new Date().toISOString(),
        build_status: 'queued',
        build_stage: 'queued',
        build_progress: 0
      };

      const updatedMetadata: ProjectMetadata = {
        ...existingMetadata,
        status: 'building',
        updated_at: new Date().toISOString(),
        // Increment version for optimistic locking
        version: ((existingMetadata as any).version || 0) + 1,
        build_metadata: buildMetadata
      } as ProjectMetadata & { version: number };

      // Save to R2 with optimistic locking
      const saveResult = await this.saveProjectMetadataWithLocking(
        projectId, 
        updatedMetadata, 
        (existingMetadata as any).version || 0
      );
      
      if (!saveResult.success) {
        return {
          success: false,
          project_id: projectId,
          updated_fields: [],
          error: saveResult.error
        };
      }

      console.info('✅ [PROJECT-METADATA] Build tracking started', {
        project_id: projectId,
        workflow_run_id: workflowRunId
      });

      return {
        success: true,
        project_id: projectId,
        updated_fields: ['status', 'updated_at', 'build_metadata']
      };

    } catch (error) {
      console.error('[PROJECT-METADATA] Failed to start build tracking', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        project_id: projectId,
        updated_fields: [],
        error: {
          type: 'storage_error',
          message: error instanceof Error ? error.message : String(error),
          details: error
        }
      };
    }
  }

  /**
   * Mark build as completed with final status and deployment URL
   */
  async completeBuildTracking(
    projectId: string,
    success: boolean,
    deploymentUrl?: string,
    errorMessage?: string
  ): Promise<MetadataUpdateResult> {
    try {
      console.info('[PROJECT-METADATA] Completing build tracking', {
        project_id: projectId,
        success,
        has_deployment_url: !!deploymentUrl,
        has_error: !!errorMessage
      });

      // Load existing metadata
      const existingMetadata = await this.loadProjectMetadata(projectId);
      if (!existingMetadata) {
        return {
          success: false,
          project_id: projectId,
          updated_fields: [],
          error: {
            type: 'not_found',
            message: `Project metadata not found for project ${projectId}`
          }
        };
      }

      // Calculate build duration if we have start time
      const existingBuildMetadata = (existingMetadata as any).build_metadata as ProjectBuildMetadata;
      const buildDuration = existingBuildMetadata?.build_started_at ?
        Date.now() - new Date(existingBuildMetadata.build_started_at).getTime() :
        undefined;

      const nextStatus: BuildStatusType = success ? 'completed' : 'failed';
      if (!canTransition(existingBuildMetadata?.build_status, nextStatus)) {
        console.warn('[PROJECT-METADATA] Invalid final build status transition', {
          project_id: projectId,
          from: existingBuildMetadata?.build_status,
          to: nextStatus
        });
        return {
          success: false,
          project_id: projectId,
          updated_fields: [],
          error: {
            type: 'validation_error',
            message: `Invalid build status transition from ${existingBuildMetadata?.build_status} to ${nextStatus}`
          }
        };
      }

      // Update build metadata
      const updatedBuildMetadata: ProjectBuildMetadata = {
        ...existingBuildMetadata,
        build_completed_at: new Date().toISOString(),
        build_duration_ms: buildDuration,
        build_status: nextStatus,
        build_stage: success ? 'deployment' : 'build',
        build_progress: success ? 100 : 0,
        error_message: errorMessage
      };

      // Update project metadata with optimistic locking
      const updatedMetadata: ProjectMetadata = {
        ...existingMetadata,
        status: success ? 'deployed' : 'failed',
        updated_at: new Date().toISOString(),
        deployment_url: deploymentUrl || existingMetadata.deployment_url,
        error_message: errorMessage,
        // Increment version for optimistic locking
        version: ((existingMetadata as any).version || 0) + 1,
        build_metadata: updatedBuildMetadata
      } as ProjectMetadata & { version: number };

      // Save to R2 with optimistic locking
      const saveResult = await this.saveProjectMetadataWithLocking(
        projectId, 
        updatedMetadata, 
        (existingMetadata as any).version || 0
      );
      
      if (!saveResult.success) {
        return {
          success: false,
          project_id: projectId,
          updated_fields: [],
          error: saveResult.error
        };
      }

      const updatedFields = [
        'status',
        'updated_at', 
        'build_metadata',
        ...(deploymentUrl ? ['deployment_url'] : []),
        ...(errorMessage ? ['error_message'] : [])
      ];

      console.info('✅ [PROJECT-METADATA] Build tracking completed', {
        project_id: projectId,
        final_status: updatedMetadata.status,
        build_duration_ms: buildDuration
      });

      return {
        success: true,
        project_id: projectId,
        updated_fields: updatedFields
      };

    } catch (error) {
      console.error('[PROJECT-METADATA] Failed to complete build tracking', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        project_id: projectId,
        updated_fields: [],
        error: {
          type: 'storage_error',
          message: error instanceof Error ? error.message : String(error),
          details: error
        }
      };
    }
  }

  /**
   * Get build tracking information from project metadata
   */
  async getBuildTrackingInfo(projectId: string): Promise<{
    success: boolean;
    tracking_info?: ProjectBuildMetadata;
    error?: string;
  }> {
    try {
      const metadata = await this.loadProjectMetadata(projectId);
      
      if (!metadata) {
        return {
          success: false,
          error: `Project metadata not found for ${projectId}`
        };
      }

      const buildMetadata = (metadata as any).build_metadata as ProjectBuildMetadata;
      
      return {
        success: true,
        tracking_info: buildMetadata || {
          build_status: 'pending' as BuildStatusType,
          build_progress: 0
        }
      };

    } catch (error) {
      console.error('[PROJECT-METADATA] Failed to get build tracking info', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Save project metadata to R2 storage
   */
  private async saveProjectMetadata(
    projectId: string, 
    metadata: ProjectMetadata
  ): Promise<{ success: boolean; error?: any }> {
    try {
      const metadataPath = `projects/${projectId}/metadata.json`;
      
      await this.projectsBucket.put(
        metadataPath, 
        JSON.stringify(metadata, null, 2),
        {
          httpMetadata: {
            contentType: 'application/json',
          },
          customMetadata: {
            projectId: projectId,
            lastUpdated: new Date().toISOString(),
          }
        }
      );

      return { success: true };

    } catch (error) {
      console.error('[PROJECT-METADATA] Failed to save metadata to R2', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      return { 
        success: false, 
        error: {
          type: 'storage_error',
          message: error instanceof Error ? error.message : String(error),
          details: error
        }
      };
    }
  }

  /**
   * Save project metadata with optimistic locking to prevent race conditions
   */
  private async saveProjectMetadataWithLocking(
    projectId: string, 
    metadata: ProjectMetadata & { version: number },
    expectedVersion: number,
    retryCount: number = 0
  ): Promise<{ success: boolean; error?: any; retries?: number }> {
    const maxRetries = 3;
    const baseDelay = 100; // 100ms base delay

    try {
      const metadataPath = `projects/${projectId}/metadata.json`;

      // First, check if the version matches what we expect
      const currentObject = await this.projectsBucket.get(metadataPath);
      
      if (currentObject) {
        const currentMetadata = JSON.parse(await currentObject.text());
        const currentVersion = (currentMetadata as any).version || 0;
        
        if (currentVersion !== expectedVersion) {
          console.warn('[PROJECT-METADATA] Version conflict detected during save', {
            project_id: projectId,
            expected_version: expectedVersion,
            current_version: currentVersion,
            retry_count: retryCount
          });

          // If we haven't exceeded retry limit, try again with exponential backoff
          if (retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount);
            console.info(`[PROJECT-METADATA] Retrying with backoff delay: ${delay}ms`);
            
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Re-load the current metadata and apply our changes on top
            const freshMetadata = await this.loadProjectMetadata(projectId);
            if (freshMetadata) {
              // Re-apply our changes to the fresh metadata
              const reappliedMetadata = {
                ...freshMetadata,
                ...metadata,
                version: ((freshMetadata as any).version || 0) + 1
              } as ProjectMetadata & { version: number };

              return await this.saveProjectMetadataWithLocking(
                projectId, 
                reappliedMetadata, 
                (freshMetadata as any).version || 0,
                retryCount + 1
              );
            }
          }

          return {
            success: false,
            error: {
              type: 'validation_error',
              message: `Version conflict: expected ${expectedVersion}, got ${currentVersion}. Max retries (${maxRetries}) exceeded.`
            },
            retries: retryCount
          };
        }
      }
      
      // Version matches, proceed with save
      await this.projectsBucket.put(
        metadataPath, 
        JSON.stringify(metadata, null, 2),
        {
          httpMetadata: {
            contentType: 'application/json',
          },
          customMetadata: {
            projectId: projectId,
            lastUpdated: new Date().toISOString(),
            version: metadata.version.toString()
          }
        }
      );

      console.info('[PROJECT-METADATA] Metadata saved successfully with optimistic locking', {
        project_id: projectId,
        version: metadata.version,
        retry_count: retryCount
      });

      return { success: true, retries: retryCount };

    } catch (error) {
      console.error('[PROJECT-METADATA] Failed to save metadata with locking', {
        project_id: projectId,
        expected_version: expectedVersion,
        retry_count: retryCount,
        error: error instanceof Error ? error.message : String(error)
      });

      // If it's a transient error and we haven't exceeded retries, try again
      if (retryCount < maxRetries && this.isTransientError(error)) {
        const delay = baseDelay * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return await this.saveProjectMetadataWithLocking(
          projectId, 
          metadata, 
          expectedVersion, 
          retryCount + 1
        );
      }

      return { 
        success: false, 
        error: {
          type: 'storage_error',
          message: error instanceof Error ? error.message : String(error),
          details: error
        },
        retries: retryCount
      };
    }
  }

  /**
   * Check if an error is transient and worth retrying
   */
  private isTransientError(error: any): boolean {
    const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
    
    // Common transient error patterns
    return errorMessage.includes('timeout') ||
           errorMessage.includes('network') ||
           errorMessage.includes('temporary') ||
           errorMessage.includes('503') ||
           errorMessage.includes('502') ||
           errorMessage.includes('504');
  }

  /**
   * Convert build status to project status
   */
  private convertBuildStatusToProjectStatus(buildStatus: BuildStatusType): ProjectStatus {
    const statusMap: Record<BuildStatusType, ProjectStatus> = {
      'queued': 'building',
      'processing': 'building', 
      'completed': 'deployed',
      'failed': 'failed',
      'timeout': 'failed',
      'cancelled': 'failed'
    };

    return statusMap[buildStatus] || 'building';
  }
}

/**
 * Factory function to create metadata manager from environment
 */
export function createProjectMetadataManager(env: Env): ProjectMetadataManager {
  return new ProjectMetadataManager(env.PROJECTS_BUCKET);
}

/**
 * Global metadata manager instance (singleton for Cloudflare Workers)
 */
let globalMetadataManager: ProjectMetadataManager | null = null;

/**
 * Get or create global metadata manager instance
 */
export function getProjectMetadataManager(env: Env): ProjectMetadataManager {
  if (!globalMetadataManager) {
    globalMetadataManager = createProjectMetadataManager(env);
  }
  return globalMetadataManager;
}

/**
 * Utility to update project metadata with enhanced build status
 */
export async function updateProjectWithBuildStatus(
  projectId: string,
  buildStatus: EnhancedBuildStatus,
  env: Env
): Promise<MetadataUpdateResult> {
  const metadataManager = getProjectMetadataManager(env);
  return await metadataManager.updateBuildStatus(projectId, buildStatus);
}

/**
 * Utility to start build tracking for a project
 */
export async function startProjectBuildTracking(
  projectId: string,
  workflowRunId: number,
  workflowRunUrl: string,
  repositoryFullName: string,
  env: Env
): Promise<MetadataUpdateResult> {
  const metadataManager = getProjectMetadataManager(env);
  return await metadataManager.startBuildTracking(
    projectId,
    workflowRunId,
    workflowRunUrl,
    repositoryFullName
  );
}

/**
 * Utility to complete build tracking with final status
 */
export async function completeProjectBuildTracking(
  projectId: string,
  success: boolean,
  deploymentUrl?: string,
  errorMessage?: string,
  env?: Env
): Promise<MetadataUpdateResult> {
  if (!env) {
    return {
      success: false,
      project_id: projectId,
      updated_fields: [],
      error: {
        type: 'validation_error',
        message: 'Environment not provided for metadata operations'
      }
    };
  }

  const metadataManager = getProjectMetadataManager(env);
  return await metadataManager.completeBuildTracking(
    projectId,
    success,
    deploymentUrl,
    errorMessage
  );
}
