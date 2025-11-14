/**
 * LegacyProjectAdapter - Bridges the legacy multiProjectManager with the new service interface
 * Adapts MultiProjectResult to Result pattern for seamless integration
 */

import { Result, Ok, Err } from '../lib/result';
import { ProjectError, ProjectErrorCode } from '../lib/errors';
import { 
  createMultiProjectManager,
  MultiProjectManager,
  MultiProjectResult 
} from '../utils/multiProjectManager';
import { BuildJob } from '../types/api';
import type { Env } from '../types/env';

/**
 * Minimal interface for build operations needed by buildQueueConsumer
 */
export interface IBuildService {
  prepareConcurrentBuild(buildJob: BuildJob): Promise<Result<{
    build_slot_reserved: boolean;
    isolation_verified: boolean;
    resources_allocated: boolean;
  }, ProjectError>>;
  
  cleanupAfterBuild(
    projectId: string,
    jobId: string,
    buildSuccess: boolean
  ): Promise<Result<{
    resources_released: boolean;
    cache_updated: boolean;
    cleanup_performed: boolean;
  }, ProjectError>>;
}

/**
 * Adapter to wrap legacy multiProjectManager in new service interface
 */
export class LegacyProjectAdapter implements IBuildService {
  private readonly manager: MultiProjectManager;

  constructor(env: Env) {
    this.manager = createMultiProjectManager(env);
  }

  /**
   * Adapts legacy prepareConcurrentBuild to Result pattern
   */
  async prepareConcurrentBuild(buildJob: BuildJob): Promise<Result<{
    build_slot_reserved: boolean;
    isolation_verified: boolean;
    resources_allocated: boolean;
  }, ProjectError>> {
    try {
      const result = await this.manager.prepareConcurrentBuild(buildJob);
      
      if (result.success && result.data) {
        return Ok(result.data);
      }
      
      // Convert MultiProjectResult error to ProjectError
      const errorMessage = result.error?.message || 'Build preparation failed';
      const errorType = this.mapErrorType(result.error?.type);
      
      return Err(new ProjectError(
        errorType,
        errorMessage,
        {
          service: 'LegacyProjectAdapter',
          operation: 'prepareConcurrentBuild',
          projectId: buildJob.project_id,
          jobId: buildJob.job_id,
          originalError: result.error
        }
      ));
    } catch (error) {
      return Err(new ProjectError(
        ProjectErrorCode.STORAGE_ERROR,
        `Unexpected error in prepareConcurrentBuild: ${error instanceof Error ? error.message : String(error)}`,
        {
          service: 'LegacyProjectAdapter',
          operation: 'prepareConcurrentBuild',
          projectId: buildJob.project_id,
          jobId: buildJob.job_id
        }
      ));
    }
  }

  /**
   * Adapts legacy cleanupAfterBuild to Result pattern
   */
  async cleanupAfterBuild(
    projectId: string,
    jobId: string,
    buildSuccess: boolean
  ): Promise<Result<{
    resources_released: boolean;
    cache_updated: boolean;
    cleanup_performed: boolean;
  }, ProjectError>> {
    try {
      const result = await this.manager.cleanupAfterBuild(projectId, jobId, buildSuccess);
      
      if (result.success && result.data) {
        return Ok(result.data);
      }
      
      // Convert MultiProjectResult error to ProjectError
      const errorMessage = result.error?.message || 'Build cleanup failed';
      const errorType = this.mapErrorType(result.error?.type);
      
      return Err(new ProjectError(
        errorType,
        errorMessage,
        {
          service: 'LegacyProjectAdapter',
          operation: 'cleanupAfterBuild',
          projectId,
          jobId,
          buildSuccess,
          originalError: result.error
        }
      ));
    } catch (error) {
      return Err(new ProjectError(
        ProjectErrorCode.STORAGE_ERROR,
        `Unexpected error in cleanupAfterBuild: ${error instanceof Error ? error.message : String(error)}`,
        {
          service: 'LegacyProjectAdapter',
          operation: 'cleanupAfterBuild',
          projectId,
          jobId,
          buildSuccess
        }
      ));
    }
  }

  /**
   * Maps legacy error types to ProjectErrorCode
   */
  private mapErrorType(errorType?: string): ProjectErrorCode {
    switch (errorType) {
      case 'storage_error':
        return ProjectErrorCode.STORAGE_ERROR;
      case 'not_found':
        return ProjectErrorCode.NOT_FOUND;
      case 'invalid_state':
        return ProjectErrorCode.INVALID_STATE;
      case 'invalid_input':
        return ProjectErrorCode.INVALID_INPUT;
      case 'concurrent_modification':
        // Map to invalid state since we don't have a concurrent modification code
        return ProjectErrorCode.INVALID_STATE;
      case 'rate_limit':
        // Map to storage error as a general infrastructure issue
        return ProjectErrorCode.STORAGE_ERROR;
      default:
        // Use storage error as the general fallback
        return ProjectErrorCode.STORAGE_ERROR;
    }
  }
}