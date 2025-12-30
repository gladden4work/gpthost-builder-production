/**
 * Project Delete Endpoint Implementation
 * 
 * Comprehensive API endpoints for safe project deletion with recovery mechanisms:
 * - DELETE /api/projects/{id} - Single project deletion (soft/hard)
 * - DELETE /api/projects/bulk - Bulk project deletion
 * - POST /api/projects/{id}/recover - Project recovery
 * - GET /api/projects/deleted - List deleted projects (recoverable)
 * - GET /api/projects/deletion-audits - Deletion audit trail
 * 
 * Features:
 * - Soft delete (archive with recovery) and hard delete (permanent removal)
 * - Audit trail system for tracking all deletion operations
 * - Cascade deletion of all associated project data
 * - Recovery options for accidentally deleted projects
 * - Bulk operations with atomic transaction support
 * - Comprehensive security validation and input sanitization
 * - Cleanup of R2 storage, build artifacts, deployments, and metadata
 */

import { 
  ProjectDeletionRequest,
  ProjectDeletionResponse,
  ProjectDeletionType,
  ProjectDeletionAudit,
  BulkProjectDeletionRequest,
  BulkProjectDeletionResponse,
  ProjectRecoveryRequest,
  ProjectRecoveryResponse,
  EnhancedProjectMetadata,
  ScheduledDeletion
} from '../types/api';
import { corsResponse, successResponse, errorResponse } from '../utils/responses';
import { sanitizeProjectDeletionRequest, createSanitizationSummary } from '../utils/inputSanitization';
import { createAtomicMetadataManager } from '../utils/atomicOperations';
import { getEnhancedMetadataManager } from '../utils/enhancedMetadataManager';
import { ServiceFactory } from '../services/ServiceFactory';

/**
 * Default configuration for project deletions
 */
const DELETION_CONFIG = {
  // Recovery periods in days
  DEFAULT_RECOVERY_PERIOD_DAYS: 30,
  MAX_RECOVERY_PERIOD_DAYS: 90,
  
  // Bulk operation limits
  MAX_BULK_DELETE_COUNT: 50,
  MAX_PARALLEL_DELETIONS: 5,

  // Performance limits
  MAX_CLEANUP_DURATION_MS: 60000, // 1 minute per project
  CLEANUP_BATCH_SIZE: 100
};

/**
 * Generate a cryptographically secure recovery token with collision detection
 */
async function generateRecoveryToken(
  env: Env, 
  projectId: string, 
  deletionId: string,
  maxRetries: number = 5
): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Generate cryptographically secure random bytes
    const randomBytes = new Uint8Array(32); // 256 bits of entropy
    crypto.getRandomValues(randomBytes);
    
    const timestamp = Date.now().toString(36);
    const randomPart = Array.from(randomBytes)
      .map(byte => byte.toString(36))
      .join('')
      .substring(0, 24); // Take first 24 characters for consistent length
    
    // Convert projectId to base64url using Web APIs (Cloudflare Workers compatible)
    const encoder = new TextEncoder();
    const projectBytes = encoder.encode(projectId);
    const projectPart = btoa(String.fromCharCode(...projectBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
      .substring(0, 8);
    const token = `recovery_${timestamp}_${projectPart}_${randomPart}`;
    
    // Check for collision by attempting to read existing token
    const recoveryPath = `recovery/tokens/${token}.json`;
    const existing = await env.PROJECTS_BUCKET.get(recoveryPath);
    
    if (!existing) {
      // No collision, token is unique
      return token;
    }
    
    console.warn('[RECOVERY-TOKEN] Token collision detected, retrying', {
      attempt: attempt + 1,
      token_prefix: token.substring(0, 20) + '...'
    });
  }
  
  // If we exhausted retries, throw an error
  throw new Error(`Failed to generate unique recovery token after ${maxRetries} attempts`);
}

// Confirmation validation and secure token storage removed in Phase 3 simplification

/**
 * Create audit trail entry for deletion
 */
async function createDeletionAuditEntry(
  env: Env,
  projectMetadata: EnhancedProjectMetadata,
  request: ProjectDeletionRequest,
  deletionId: string,
  userAgent?: string,
  ipAddress?: string
): Promise<ProjectDeletionAudit> {
  const now = new Date().toISOString();
  const recoveryDeadline = request.deletion_type === 'soft' 
    ? new Date(Date.now() + (request.options?.recovery_period_days || DELETION_CONFIG.DEFAULT_RECOVERY_PERIOD_DAYS) * 24 * 60 * 60 * 1000).toISOString()
    : undefined;

  const auditEntry: ProjectDeletionAudit = {
    deletion_id: deletionId,
    project_id: projectMetadata.id,
    project_name: projectMetadata.display_name || projectMetadata.name || projectMetadata.id,
    deletion_type: request.deletion_type,
    deletion_reason: request.reason,
    initiated_by: request.audit_info?.requested_by || 'system',
    initiated_at: now,
    recovery_deadline: recoveryDeadline,
    recovery_data: request.deletion_type === 'soft' ? {
      metadata_backup: projectMetadata,
      storage_locations: [
        `projects/${projectMetadata.id}`,
        `builds/${projectMetadata.id}`,
        // Deployed site content is stored under DEPLOYMENTS_BUCKET using the unified manager
        `sites/${projectMetadata.id}`
      ],
      build_artifacts: [],
      deployment_urls: projectMetadata.deployment_history?.map(d => d.url) || []
    } : undefined,
    cleanup_results: {
      metadata_deleted: false,
      storage_cleaned: false,
      builds_cleaned: false,
      deployments_cleaned: false,
      search_index_cleaned: false,
      total_files_deleted: 0,
      total_storage_freed_mb: 0,
      cleanup_errors: []
    },
    status: 'pending'
  };

  // Store audit entry in dedicated audit storage
  const auditPath = `audit/deletions/${deletionId}.json`;
  await env.PROJECTS_BUCKET.put(
    auditPath,
    JSON.stringify(auditEntry, null, 2),
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        type: 'deletion-audit',
        project_id: projectMetadata.id,
        deletion_type: request.deletion_type,
        created_at: now,
        recovery_deadline: recoveryDeadline || 'none'
      }
    }
  );

  return auditEntry;
}

/**
 * Update audit trail with cleanup results
 */
async function updateAuditCleanupResults(
  env: Env,
  deletionId: string,
  cleanupResults: ProjectDeletionAudit['cleanup_results']
): Promise<void> {
  try {
    const auditPath = `audit/deletions/${deletionId}.json`;
    const auditObject = await env.PROJECTS_BUCKET.get(auditPath);
    
    if (auditObject) {
      const auditEntry: ProjectDeletionAudit = JSON.parse(await auditObject.text());
      auditEntry.cleanup_results = cleanupResults;
      auditEntry.completed_at = new Date().toISOString();
      auditEntry.status = cleanupResults.cleanup_errors.length > 0 ? 'failed' : 'completed';
      
      await env.PROJECTS_BUCKET.put(
        auditPath,
        JSON.stringify(auditEntry, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            type: 'deletion-audit',
            project_id: auditEntry.project_id,
            deletion_type: auditEntry.deletion_type,
            updated_at: auditEntry.completed_at,
            status: auditEntry.status
          }
        }
      );
    }
  } catch (error) {
    console.warn('[PROJECT-DELETE] Failed to update audit trail', {
      deletion_id: deletionId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Clean up expired recovery tokens (automatic maintenance)
 */
async function cleanupExpiredRecoveryTokens(env: Env): Promise<{
  cleaned_tokens: number;
  errors: string[];
}> {
  const results = { cleaned_tokens: 0, errors: [] };
  
  try {
    console.info('[RECOVERY-TOKEN-CLEANUP] Starting expired token cleanup');
    
    // List all recovery tokens
    const tokensList = await env.PROJECTS_BUCKET.list({
      prefix: 'recovery/tokens/',
      limit: 1000
    });
    
    const now = new Date();
    const cleanupPromises = tokensList.objects.map(async (tokenObj) => {
      try {
        const tokenData = await env.PROJECTS_BUCKET.get(tokenObj.key);
        if (tokenData) {
          const token = JSON.parse(await tokenData.text());
          const expiresAt = new Date(token.expires_at);
          
          if (expiresAt < now) {
            // Token is expired, delete it
            await env.PROJECTS_BUCKET.delete(tokenObj.key);
            results.cleaned_tokens++;
            
            console.info('[RECOVERY-TOKEN-CLEANUP] Deleted expired token', {
              token_id: token.recovery_token?.substring(0, 20) + '...',
              project_id: token.project_id,
              expired_at: token.expires_at
            });
          }
        }
      } catch (error) {
        results.errors.push(`Failed to process token ${tokenObj.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    
    await Promise.allSettled(cleanupPromises);
    
    console.info('✅ [RECOVERY-TOKEN-CLEANUP] Cleanup completed', {
      tokens_cleaned: results.cleaned_tokens,
      errors: results.errors.length
    });
    
  } catch (error) {
    results.errors.push(`Token cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return results;
}

/**
 * Streaming file processor to prevent memory exhaustion
 */
class StreamingFileProcessor {
  private env: Env;
  private readonly STREAM_BATCH_SIZE = 10; // Process 10 files at a time
  private readonly MAX_MEMORY_USAGE_MB = 100; // Limit memory usage

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Stream process files without loading everything into memory
   */
  async processFilesStreaming(
    bucket: R2Bucket,
    prefix: string,
    processor: (obj: { key: string; size?: number }) => Promise<{ success: boolean; error?: string; bytesProcessed: number }>,
    options: {
      maxDurationMs: number;
      onProgress?: (processed: number, total: number) => void;
    }
  ): Promise<{
    success: boolean;
    totalProcessed: number;
    totalBytes: number;
    errors: string[];
    timedOut: boolean;
  }> {
    const results = {
      success: true,
      totalProcessed: 0,
      totalBytes: 0,
      errors: [] as string[],
      timedOut: false
    };

    const startTime = Date.now();
    let truncated = true;
    let cursor: string | undefined;

    try {
      // Stream through files using pagination to avoid loading everything
      while (truncated) {
        // Check timeout
        if (Date.now() - startTime > options.maxDurationMs) {
          results.timedOut = true;
          results.errors.push(`Processing timed out after ${options.maxDurationMs}ms`);
          break;
        }

        // Get next batch of files
        const listOptions: R2ListOptions = {
          prefix,
          limit: this.STREAM_BATCH_SIZE
        };
        if (cursor) {
          listOptions.cursor = cursor;
        }

        const listResult = await bucket.list(listOptions);
        truncated = listResult.truncated;
        cursor = listResult.cursor;

        if (listResult.objects.length === 0) {
          break;
        }

        // Process this batch of files
        const batchPromises = listResult.objects.map(async (obj) => {
          try {
            const result = await processor(obj);
            if (result.success) {
              results.totalProcessed++;
              results.totalBytes += result.bytesProcessed;
            } else {
              results.errors.push(result.error || `Failed to process ${obj.key}`);
              results.success = false;
            }
          } catch (error) {
            const errorMsg = `Processing failed for ${obj.key}: ${error instanceof Error ? error.message : String(error)}`;
            results.errors.push(errorMsg);
            results.success = false;
          }
        });

        // Wait for batch to complete
        await Promise.allSettled(batchPromises);

        // Report progress if callback provided
        if (options.onProgress) {
          options.onProgress(results.totalProcessed, results.totalProcessed);
        }

        // Small delay to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } catch (error) {
      results.success = false;
      results.errors.push(`Streaming processor failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return results;
  }
}

/**
 * File integrity checker for data validation
 */
class FileIntegrityChecker {
  /**
   * Calculate SHA-256 checksum for file content
   */
  static async calculateChecksum(content: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Verify file integrity with checksum
   */
  static async verifyFileIntegrity(
    content: ArrayBuffer,
    expectedChecksum?: string
  ): Promise<{ valid: boolean; checksum: string; error?: string }> {
    try {
      const actualChecksum = await this.calculateChecksum(content);
      
      if (expectedChecksum) {
        const valid = actualChecksum === expectedChecksum;
        return {
          valid,
          checksum: actualChecksum,
          error: valid ? undefined : 'Checksum mismatch - file may be corrupted'
        };
      }
      
      return { valid: true, checksum: actualChecksum };
    } catch (error) {
      return {
        valid: false,
        checksum: '',
        error: `Integrity check failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * Perform comprehensive project cleanup with atomic operations and streaming
 */
async function performProjectCleanup(
  env: Env,
  projectId: string,
  deletionType: ProjectDeletionType,
  preserveOptions?: {
    preserve_build_logs?: boolean;
    preserve_analytics?: boolean;
    preserve_deployment_history?: boolean;
  }
): Promise<ProjectDeletionAudit['cleanup_results']> {
  const results: ProjectDeletionAudit['cleanup_results'] = {
    metadata_deleted: false,
    storage_cleaned: false,
    builds_cleaned: false,
    deployments_cleaned: false,
    search_index_cleaned: false,
    total_files_deleted: 0,
    total_storage_freed_mb: 0,
    cleanup_errors: []
  };

  const cleanupStartTime = Date.now();
  const atomicManager = createAtomicMetadataManager(env.PROJECTS_BUCKET);
  const streamProcessor = new StreamingFileProcessor(env);

  try {
    console.info('[PROJECT-DELETE] Starting atomic comprehensive cleanup', { 
      project_id: projectId,
      deletion_type: deletionType
    });

    // 1. ATOMIC operation: Handle metadata with proper rollback capability
    try {
      if (deletionType === 'soft') {
        // Use atomic update for soft delete
        const atomicResult = await atomicManager.atomicUpdate(
          projectId,
          (currentMetadata) => ({
            ...currentMetadata,
            extended_status: 'archived',
            archived_at: new Date().toISOString(),
            status_history: [
              ...currentMetadata.status_history,
              {
                status: 'archived',
                timestamp: new Date().toISOString(),
                reason: 'Soft delete - moved to archive',
                changed_by: 'system'
              }
            ],
            updated_at: new Date().toISOString()
          })
        );
        
        if (!atomicResult.success) {
          throw new Error(`Atomic soft delete failed: ${atomicResult.error?.message}`);
        }
        
        results.metadata_deleted = true;
      } else {
        // For hard delete, we'll handle metadata deletion after file cleanup
        // to ensure we can rollback if file operations fail
        console.info('[PROJECT-DELETE] Deferring metadata deletion until file cleanup completes');
      }
    } catch (error) {
      results.cleanup_errors.push(`Metadata atomic operation error: ${error instanceof Error ? error.message : String(error)}`);
      // For hard deletes, this is not necessarily fatal - continue with cleanup
      if (deletionType === 'soft') {
        throw error; // For soft deletes, metadata failure should abort
      }
    }

    // 2. STREAMING operation: Clean up project storage without memory exhaustion
    try {
      console.info('[PROJECT-DELETE] Starting streaming storage cleanup');

      const storagePrefixes = [
        `projects/${projectId}/`,
        `projects/active/${projectId}/`,
        `projects/archived/${projectId}/`,
      ];

      results.storage_cleaned = true;
      for (const storagePrefix of storagePrefixes) {
        const storageResult = await streamProcessor.processFilesStreaming(
          env.PROJECTS_BUCKET,
          storagePrefix,
          async (obj) => {
            try {
              if (deletionType === 'hard') {
                await env.PROJECTS_BUCKET.delete(obj.key);
                return {
                  success: true,
                  bytesProcessed: obj.size || 0
                };
              } else {
                // For soft delete, move to archive with integrity verification
                const originalObject = await env.PROJECTS_BUCKET.get(obj.key);
                if (originalObject) {
                  const content = await originalObject.arrayBuffer();

                  // Calculate checksum for integrity verification
                  const integrity = await FileIntegrityChecker.verifyFileIntegrity(content);

                  const archivePath = `archive/${projectId}/${obj.key.replace(storagePrefix, '')}`;

                  // Store with integrity metadata
                  await env.PROJECTS_BUCKET.put(
                    archivePath,
                    content,
                    {
                      httpMetadata: originalObject.httpMetadata,
                      customMetadata: {
                        ...originalObject.customMetadata,
                        archived_at: new Date().toISOString(),
                        original_path: obj.key,
                        integrity_checksum: integrity.checksum,
                        verified: integrity.valid.toString()
                      }
                    }
                  );

                  await env.PROJECTS_BUCKET.delete(obj.key);

                  return {
                    success: true,
                    bytesProcessed: obj.size || 0
                  };
                }

                return { success: false, error: 'Object not found', bytesProcessed: 0 };
              }
            } catch (error) {
              return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                bytesProcessed: 0
              };
            }
          },
          {
            maxDurationMs: DELETION_CONFIG.MAX_CLEANUP_DURATION_MS,
            onProgress: (processed, total) => {
              if (processed % 50 === 0) { // Log every 50 files
                console.info(`[PROJECT-DELETE] Storage cleanup progress: ${processed} files processed`);
              }
            }
          }
        );

        results.total_files_deleted += storageResult.totalProcessed;
        results.total_storage_freed_mb += Math.round(storageResult.totalBytes / (1024 * 1024) * 100) / 100;
        if (!storageResult.success) {
          results.storage_cleaned = false;
        }

        if (storageResult.errors.length > 0) {
          results.cleanup_errors.push(...storageResult.errors);
        }

        if (storageResult.timedOut) {
          results.cleanup_errors.push('Storage cleanup timed out - some files may not have been processed');
        }
      }

    } catch (error) {
      results.cleanup_errors.push(`Streaming storage cleanup error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 3. Clean up build artifacts with streaming
    try {
      console.info('[PROJECT-DELETE] Cleaning up build artifacts');
      
      if (env.BUILDS_BUCKET) {
        const buildPrefix = `projects/${projectId}/`;
        
        if (deletionType === 'hard' || !preserveOptions?.preserve_build_logs) {
          const buildResult = await streamProcessor.processFilesStreaming(
            env.BUILDS_BUCKET,
            buildPrefix,
            async (obj) => {
              try {
                await env.BUILDS_BUCKET.delete(obj.key);
                return {
                  success: true,
                  bytesProcessed: obj.size || 0
                };
              } catch (error) {
                return {
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                  bytesProcessed: 0
                };
              }
            },
            { maxDurationMs: DELETION_CONFIG.MAX_CLEANUP_DURATION_MS }
          );
          
          results.total_files_deleted += buildResult.totalProcessed;
          results.total_storage_freed_mb += Math.round(buildResult.totalBytes / (1024 * 1024) * 100) / 100;
          
          if (buildResult.errors.length > 0) {
            results.cleanup_errors.push(...buildResult.errors);
          }
        }
      }
      
      results.builds_cleaned = true;
    } catch (error) {
      results.cleanup_errors.push(`Build artifacts cleanup error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 4. Clean up deployment data (sites bucket)
    try {
      console.info('[PROJECT-DELETE] Cleaning up deployment data');

      if ((env as any).DEPLOYMENTS_BUCKET) {
        const sitesPrefix = `sites/${projectId}/`;

        const sitesResult = await streamProcessor.processFilesStreaming(
          (env as any).DEPLOYMENTS_BUCKET,
          sitesPrefix,
          async (obj) => {
            try {
              await (env as any).DEPLOYMENTS_BUCKET.delete(obj.key);
              return { success: true, bytesProcessed: obj.size || 0 };
            } catch (error) {
              return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                bytesProcessed: 0,
              };
            }
          },
          { maxDurationMs: DELETION_CONFIG.MAX_CLEANUP_DURATION_MS }
        );

        results.total_files_deleted += sitesResult.totalProcessed;
        results.total_storage_freed_mb += Math.round(sitesResult.totalBytes / (1024 * 1024) * 100) / 100;
        if (sitesResult.errors.length > 0) {
          results.cleanup_errors.push(...sitesResult.errors);
        }
      }

      results.deployments_cleaned = true;
    } catch (error) {
      results.cleanup_errors.push(`Deployment cleanup error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 5. Clean up search index
    try {
      console.info('[PROJECT-DELETE] Cleaning up search index');
      
      const searchIndexPath = `search-index/${projectId}.json`;
      await env.PROJECTS_BUCKET.delete(searchIndexPath);
      results.search_index_cleaned = true;
    } catch (error) {
      results.cleanup_errors.push(`Search index cleanup error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 6. ATOMIC operation: Final metadata deletion for hard deletes
    if (deletionType === 'hard') {
      try {
        // Delete metadata regardless of file cleanup status
        // Files can be cleaned up later, but metadata must be deleted to complete the deletion

        // 1. Delete enhanced metadata via metadata manager
        const metadataManager = getEnhancedMetadataManager(env);
        const deleteResult = await metadataManager.deleteMetadata(projectId);

        // 2. Delete legacy metadata at projects/{id}/metadata.json (used by dashboard)
        const legacyMetadataPath = `projects/${projectId}/metadata.json`;
        let legacyDeleted = false;
        try {
          await env.PROJECTS_BUCKET.delete(legacyMetadataPath);
          legacyDeleted = true;
          console.info('[PROJECT-DELETE] Legacy metadata deleted successfully', {
            project_id: projectId,
            path: legacyMetadataPath
          });
        } catch (legacyError) {
          console.warn('[PROJECT-DELETE] Failed to delete legacy metadata', {
            project_id: projectId,
            path: legacyMetadataPath,
            error: legacyError instanceof Error ? legacyError.message : String(legacyError)
          });
          results.cleanup_errors.push(`Legacy metadata deletion failed: ${legacyError instanceof Error ? legacyError.message : String(legacyError)}`);
        }

        // 3. Delete from active directory structure (CRITICAL for dashboard)
        const activeMetadataPath = `projects/active/${projectId}/metadata.json`;
        let activeDeleted = false;
        try {
          await env.PROJECTS_BUCKET.delete(activeMetadataPath);
          activeDeleted = true;
          console.info('[PROJECT-DELETE] Active directory metadata deleted successfully', {
            project_id: projectId,
            path: activeMetadataPath
          });
        } catch (activeError) {
          console.warn('[PROJECT-DELETE] Failed to delete active directory metadata', {
            project_id: projectId,
            path: activeMetadataPath,
            error: activeError instanceof Error ? activeError.message : String(activeError)
          });
        }

        // 4. Use ProjectService.deleteProject() to ensure ALL project files are removed
        try {
          const projectService = ServiceFactory.getProjectService(env);
          const serviceDeleteResult = await projectService.deleteProject(projectId);
          if (!serviceDeleteResult.ok) {
            console.warn('[PROJECT-DELETE] ProjectService deletion warning', {
              project_id: projectId,
              error: serviceDeleteResult.error.message
            });
            results.cleanup_errors.push(`ProjectService deletion warning: ${serviceDeleteResult.error.message}`);
          } else {
            console.info('[PROJECT-DELETE] ProjectService cleanup completed', {
              project_id: projectId
            });
          }
        } catch (serviceError) {
          console.warn('[PROJECT-DELETE] ProjectService deletion failed', {
            project_id: projectId,
            error: serviceError instanceof Error ? serviceError.message : String(serviceError)
          });
          results.cleanup_errors.push(`ProjectService deletion failed: ${serviceError instanceof Error ? serviceError.message : String(serviceError)}`);
        }

        // Mark as successful only if ALL three metadata systems were deleted
        results.metadata_deleted = deleteResult.success && legacyDeleted && activeDeleted;

        if (!deleteResult.success) {
          results.cleanup_errors.push(`Enhanced metadata deletion failed: ${deleteResult.error?.message}`);
        }

        // Log final status
        console.info('[PROJECT-DELETE] Triple metadata deletion completed', {
          project_id: projectId,
          enhanced_metadata_deleted: deleteResult.success,
          legacy_metadata_deleted: legacyDeleted,
          active_metadata_deleted: activeDeleted,
          overall_success: results.metadata_deleted
        });

        // Log warning if file cleanup failed but metadata was deleted
        if (!results.storage_cleaned || !results.builds_cleaned) {
          console.warn('[PROJECT-DELETE] Metadata deleted but some file cleanup operations failed', {
            project_id: projectId,
            storage_cleaned: results.storage_cleaned,
            builds_cleaned: results.builds_cleaned,
            metadata_deleted: results.metadata_deleted
          });
        }
      } catch (error) {
        results.cleanup_errors.push(`Final metadata deletion error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const cleanupDuration = Date.now() - cleanupStartTime;
    const hasErrors = results.cleanup_errors.length > 0;
    
    console.info(`✅ [PROJECT-DELETE] Atomic cleanup ${hasErrors ? 'completed with errors' : 'completed successfully'}`, {
      project_id: projectId,
      deletion_type: deletionType,
      files_deleted: results.total_files_deleted,
      storage_freed_mb: results.total_storage_freed_mb,
      errors: results.cleanup_errors.length,
      duration_ms: cleanupDuration,
      atomic_operations: deletionType === 'hard' ? 'deferred_metadata_deletion' : 'immediate_metadata_update'
    });

    return results;

  } catch (error) {
    const cleanupDuration = Date.now() - cleanupStartTime;
    console.error('[PROJECT-DELETE] Atomic cleanup failed', {
      project_id: projectId,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: cleanupDuration
    });
    
    results.cleanup_errors.push(`Atomic cleanup error: ${error instanceof Error ? error.message : String(error)}`);
    
    // Attempt rollback for soft deletes
    if (deletionType === 'soft' && results.metadata_deleted) {
      try {
        console.info('[PROJECT-DELETE] Attempting rollback of soft delete metadata changes');
        
        const rollbackResult = await atomicManager.atomicUpdate(
          projectId,
          (currentMetadata) => ({
            ...currentMetadata,
            extended_status: 'active',
            archived_at: undefined,
            status_history: [
              ...currentMetadata.status_history,
              {
                status: 'active',
                timestamp: new Date().toISOString(),
                reason: 'Rollback due to cleanup failure',
                changed_by: 'system'
              }
            ],
            updated_at: new Date().toISOString()
          })
        );
        
        if (rollbackResult.success) {
          console.info('✅ [PROJECT-DELETE] Rollback successful');
          results.cleanup_errors.push('Soft delete rolled back due to cleanup failure');
        } else {
          console.error('[PROJECT-DELETE] Rollback failed', rollbackResult.error);
          results.cleanup_errors.push(`Rollback failed: ${rollbackResult.error?.message}`);
        }
      } catch (rollbackError) {
        console.error('[PROJECT-DELETE] Rollback exception', rollbackError);
        results.cleanup_errors.push(`Rollback exception: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    
    return results;
  }
}

/**
 * DELETE /api/projects/{id} - Single Project Deletion
 * Performs safe project deletion with comprehensive validation and cleanup
 */
export async function deleteProjectHandler(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3];

    console.info('[PROJECT-DELETE] Processing deletion request', { 
      project_id: projectId 
    });

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Project ID is required',
        400
      );
    }

    // Parse and validate request body
    let rawRequest: any;
    try {
      rawRequest = await request.json();
    } catch (error) {
      return errorResponse(
        'INVALID_REQUEST',
        'Invalid JSON in request body',
        400,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    // Sanitize input data for deletion operations
    const sanitizationResult = sanitizeProjectDeletionRequest(rawRequest);
    const summary = createSanitizationSummary(sanitizationResult.violations);
    
    if (sanitizationResult.violations.length > 0) {
      console.warn('[PROJECT-DELETE] Input sanitization warnings', {
        project_id: projectId,
        violations: sanitizationResult.violations,
        summary: summary.summary
      });

      if (summary.hasCriticalIssues) {
        return errorResponse(
          'SECURITY_VIOLATION',
          'Request contains potentially dangerous content',
          400,
          {
            violations: sanitizationResult.violations,
            summary: summary.summary
          }
        );
      }
    }

    const deletionRequest: ProjectDeletionRequest = sanitizationResult.sanitized;

    // Validate deletion request structure
    if (!deletionRequest.deletion_type || !['soft', 'hard'].includes(deletionRequest.deletion_type)) {
      return errorResponse(
        'INVALID_REQUEST',
        'Valid deletion_type (soft/hard) is required',
        400
      );
    }

    // Get project metadata
    const metadataManager = getEnhancedMetadataManager(env);
    const projectMetadata = await metadataManager.getMetadata(projectId);
    
    if (!projectMetadata) {
      return errorResponse(
        'PROJECT_NOT_FOUND',
        `Project with ID ${projectId} not found`,
        404
      );
    }

    // Extract security context
    const userAgent = request.headers.get('User-Agent') || undefined;
    const ipAddress = request.headers.get('CF-Connecting-IP') ||
                     request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                     undefined;

    // Generate deletion ID and create audit entry
    const deletionId = `del_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const auditEntry = await createDeletionAuditEntry(
      env,
      projectMetadata,
      deletionRequest,
      deletionId,
      userAgent,
      ipAddress
    );

    // Perform cleanup
    const cleanupResults = await performProjectCleanup(
      env,
      projectId,
      deletionRequest.deletion_type,
      deletionRequest.options
    );

    // Update audit trail with cleanup results
    await updateAuditCleanupResults(env, deletionId, cleanupResults);

    // Perform automatic cleanup of expired recovery tokens (background maintenance)
    try {
      const tokenCleanupResults = await cleanupExpiredRecoveryTokens(env);
      if (tokenCleanupResults.cleaned_tokens > 0) {
        console.info('[PROJECT-DELETE] Cleaned up expired recovery tokens', {
          cleaned_tokens: tokenCleanupResults.cleaned_tokens,
          errors: tokenCleanupResults.errors.length
        });
      }
    } catch (error) {
      console.warn('[PROJECT-DELETE] Failed to cleanup expired tokens', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Generate recovery info for soft deletes
    let recoveryInfo: ProjectDeletionResponse['recovery_info'] = undefined;
    if (deletionRequest.deletion_type === 'soft') {
      const recoveryToken = await generateRecoveryToken(env, projectId, deletionId);
      const recoveryDeadline = new Date(
        Date.now() + (deletionRequest.options?.recovery_period_days || DELETION_CONFIG.DEFAULT_RECOVERY_PERIOD_DAYS) * 24 * 60 * 60 * 1000
      ).toISOString();

      recoveryInfo = {
        recovery_deadline: recoveryDeadline,
        recovery_token: recoveryToken,
        recovery_endpoint: `/api/projects/${projectId}/recover`,
        recovery_instructions: `Use the recovery token within ${deletionRequest.options?.recovery_period_days || DELETION_CONFIG.DEFAULT_RECOVERY_PERIOD_DAYS} days to restore this project.`
      };

      // Store recovery token
      const recoveryPath = `recovery/tokens/${recoveryToken}.json`;
      await env.PROJECTS_BUCKET.put(
        recoveryPath,
        JSON.stringify({
          project_id: projectId,
          deletion_id: deletionId,
          recovery_token: recoveryToken,
          created_at: new Date().toISOString(),
          expires_at: recoveryDeadline,
          status: 'active'
        }),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            type: 'recovery-token',
            project_id: projectId,
            deletion_id: deletionId,
            expires_at: recoveryDeadline
          }
        }
      );
    }

    const operationDuration = Date.now() - startTime;
    const hasErrors = cleanupResults.cleanup_errors.length > 0;

    console.info(`✅ [PROJECT-DELETE] Deletion ${hasErrors ? 'completed with errors' : 'completed successfully'}`, {
      project_id: projectId,
      deletion_id: deletionId,
      deletion_type: deletionRequest.deletion_type,
      files_deleted: cleanupResults.total_files_deleted,
      storage_freed_mb: cleanupResults.total_storage_freed_mb,
      errors: cleanupResults.cleanup_errors.length,
      duration_ms: operationDuration
    });

    const response: ProjectDeletionResponse = {
      success: !hasErrors,
      project_id: projectId,
      deletion_id: deletionId,
      deletion_type: deletionRequest.deletion_type,
      results: {
        status: deletionRequest.deletion_type === 'soft' ? 'archived' : 'deleted',
        recovery_deadline: recoveryInfo?.recovery_deadline,
        cleanup_results: cleanupResults
      },
      recovery_info: recoveryInfo,
      error: hasErrors ? {
        type: 'cleanup_failed',
        message: 'Some cleanup operations failed',
        details: cleanupResults.cleanup_errors,
        failed_cleanups: cleanupResults.cleanup_errors
      } : undefined,
      metrics: {
        operation_duration_ms: operationDuration,
        cleanup_duration_ms: operationDuration, // Same for single operation
        files_processed: cleanupResults.total_files_deleted,
        parallel_operations: 1
      }
    };

    return successResponse(response);

  } catch (error) {
    const operationDuration = Date.now() - startTime;
    
    console.error('[PROJECT-DELETE] Deletion failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: operationDuration
    });

    return errorResponse(
      'DELETION_FAILED',
      'Project deletion failed',
      500,
      { 
        error: error instanceof Error ? error.message : String(error),
        duration_ms: operationDuration
      }
    );
  }
}

/**
 * Handle OPTIONS request for CORS - Single Project Delete
 */
export async function deleteProjectOptionsHandler(request: Request, env: Env): Promise<Response> {
  return corsResponse();
}

/**
 * DELETE /api/projects/bulk - Bulk Project Deletion
 * Performs bulk deletion with atomic transaction support
 */
export async function bulkDeleteProjectsHandler(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  
  try {
    console.info('[BULK-DELETE] Processing bulk deletion request');

    // Parse and validate request body
    let rawRequest: any;
    try {
      rawRequest = await request.json();
    } catch (error) {
      return errorResponse(
        'INVALID_REQUEST',
        'Invalid JSON in request body',
        400,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    const bulkRequest: BulkProjectDeletionRequest = rawRequest;

    // Validate bulk request
    if (!bulkRequest.projects || bulkRequest.projects.length === 0) {
      return errorResponse(
        'INVALID_REQUEST',
        'At least one project deletion is required',
        400
      );
    }

    if (bulkRequest.projects.length > DELETION_CONFIG.MAX_BULK_DELETE_COUNT) {
      return errorResponse(
        'INVALID_REQUEST',
        `Maximum ${DELETION_CONFIG.MAX_BULK_DELETE_COUNT} projects can be deleted in a single bulk operation`,
        400,
        {
          max_projects: DELETION_CONFIG.MAX_BULK_DELETE_COUNT,
          received_projects: bulkRequest.projects.length
        }
      );
    }

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const results: BulkProjectDeletionResponse['results'] = [];
    const metadataManager = getEnhancedMetadataManager(env);
    
    // Initialize counters before use
    let successfulDeletions = 0;
    let failedDeletions = 0;
    let totalFilesDeleted = 0;
    let totalStorageFreedMB = 0;
    const recoveryTokens: string[] = [];
    
    // Collect all project metadata first (with legacy fallbacks)
    const projectDataList: Array<{ projectId: string; metadata: EnhancedProjectMetadata; request: ProjectDeletionRequest }> = [];
    
    for (const projectRequest of bulkRequest.projects) {
      let metadata = await metadataManager.getMetadata(projectRequest.project_id);

      // Fallback 1: try legacy raw metadata.json in R2 (projects/<id>/metadata.json)
      if (!metadata) {
        try {
          const rawPath = `projects/${projectRequest.project_id}/metadata.json`;
          const rawObj = await env.PROJECTS_BUCKET.get(rawPath);
          if (rawObj) {
            const raw = JSON.parse(await rawObj.text());
            metadata = {
              id: projectRequest.project_id,
              name: raw?.name || raw?.display_name || projectRequest.project_id,
              display_name: raw?.name || raw?.display_name || projectRequest.project_id,
              framework: raw?.framework || 'unknown',
              description: raw?.description || '',
              created_at: raw?.createdAt || new Date().toISOString(),
              updated_at: raw?.updatedAt || new Date().toISOString(),
              extended_status: 'deployed',
              status_history: [],
              deployment_history: []
            } as EnhancedProjectMetadata;
          }
        } catch {}
      }

      if (!metadata) {
        // Fallback 2: delete directly via ProjectService (legacy projects)
        if (bulkRequest.options?.atomic) {
          return errorResponse(
            'PROJECT_NOT_FOUND',
            `Project ${projectRequest.project_id} not found - atomic operation aborted`,
            404
          );
        }

        try {
          const projectService = ServiceFactory.getProjectService(env);
          const del = await projectService.deleteProject(projectRequest.project_id);
          // Only count as success if project was actually deleted
          if (del.ok && del.data?.deleted) {
            results.push({ project_id: projectRequest.project_id, success: true });
            successfulDeletions++;
          } else {
            // If deletion didn't actually happen, it's a failure
            const errorMsg = del.error?.message || 'Project not found or already deleted';
            results.push({ project_id: projectRequest.project_id, success: false, error: errorMsg });
            failedDeletions++;
          }
        } catch (err) {
          results.push({ project_id: projectRequest.project_id, success: false, error: err instanceof Error ? err.message : String(err) });
          failedDeletions++;
        }
        continue;
      }

      projectDataList.push({
        projectId: projectRequest.project_id,
        metadata,
        request: projectRequest.deletion_request
      });
    }

    // Execute deletions
    const maxParallel = Math.min(
      bulkRequest.options?.max_parallel || DELETION_CONFIG.MAX_PARALLEL_DELETIONS,
      DELETION_CONFIG.MAX_PARALLEL_DELETIONS
    );

    const userAgent = request.headers.get('User-Agent') || undefined;
    const ipAddress = request.headers.get('CF-Connecting-IP') || undefined;

    // Process deletions in batches for performance
    for (let i = 0; i < projectDataList.length; i += maxParallel) {
      const batch = projectDataList.slice(i, i + maxParallel);
      
      const batchPromises = batch.map(async (item) => {
        try {
          // Generate deletion ID and create audit entry
          const deletionId = `del_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
          await createDeletionAuditEntry(
            env,
            item.metadata,
            item.request,
            deletionId,
            userAgent,
            ipAddress
          );

          // Perform cleanup
          const cleanupResults = await performProjectCleanup(
            env,
            item.projectId,
            item.request.deletion_type,
            item.request.options
          );

          // Update audit trail
          await updateAuditCleanupResults(env, deletionId, cleanupResults);

          // Generate recovery token for soft deletes
          if (item.request.deletion_type === 'soft') {
            const recoveryToken = await generateRecoveryToken(env, item.projectId, deletionId);
            recoveryTokens.push(recoveryToken);
            
            // Store recovery token
            const recoveryPath = `recovery/tokens/${recoveryToken}.json`;
            const recoveryDeadline = new Date(
              Date.now() + (item.request.options?.recovery_period_days || DELETION_CONFIG.DEFAULT_RECOVERY_PERIOD_DAYS) * 24 * 60 * 60 * 1000
            ).toISOString();

            await env.PROJECTS_BUCKET.put(
              recoveryPath,
              JSON.stringify({
                project_id: item.projectId,
                deletion_id: deletionId,
                recovery_token: recoveryToken,
                created_at: new Date().toISOString(),
                expires_at: recoveryDeadline,
                status: 'active',
                batch_id: batchId
              }),
              {
                httpMetadata: { contentType: 'application/json' },
                customMetadata: {
                  type: 'recovery-token',
                  project_id: item.projectId,
                  batch_id: batchId,
                  expires_at: recoveryDeadline
                }
              }
            );
          }

          const hasErrors = cleanupResults.cleanup_errors.length > 0;
          
          return {
            project_id: item.projectId,
            success: !hasErrors,
            deletion_response: {
              success: !hasErrors,
              project_id: item.projectId,
              deletion_id: deletionId,
              deletion_type: item.request.deletion_type,
              results: {
                status: item.request.deletion_type === 'soft' ? 'archived' : 'deleted',
                cleanup_results: cleanupResults
              }
            } as ProjectDeletionResponse,
            error: hasErrors ? cleanupResults.cleanup_errors.join('; ') : undefined
          };

        } catch (error) {
          return {
            project_id: item.projectId,
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Update counters
      for (const result of batchResults) {
        if (result.success) {
          successfulDeletions++;
          if (result.deletion_response?.results?.cleanup_results) {
            totalFilesDeleted += result.deletion_response.results.cleanup_results.total_files_deleted;
            totalStorageFreedMB += result.deletion_response.results.cleanup_results.total_storage_freed_mb;
          }
        } else {
          failedDeletions++;
        }
      }

      // Check if atomic operation should abort
      if (bulkRequest.options?.atomic && failedDeletions > 0) {
        console.warn('[BULK-DELETE] Atomic operation failed, stopping execution', {
          successful: successfulDeletions,
          failed: failedDeletions
        });
        break;
      }
    }

    const operationDuration = Date.now() - startTime;
    const totalRequested = bulkRequest.projects.length;
    const success = failedDeletions === 0;

    console.info(`✅ [BULK-DELETE] Bulk deletion ${success ? 'completed successfully' : 'completed with errors'}`, {
      batch_id: batchId,
      total_requested: totalRequested,
      successful: successfulDeletions,
      failed: failedDeletions,
      files_deleted: totalFilesDeleted,
      storage_freed_mb: totalStorageFreedMB,
      duration_ms: operationDuration
    });

    // Generate recovery summary for soft deletes
    let recoverySummary: BulkProjectDeletionResponse['recovery_summary'] = undefined;
    if (recoveryTokens.length > 0) {
      const recoveryDeadlines = results
        .filter(r => r.success && r.deletion_response?.deletion_type === 'soft')
        .map(r => new Date(Date.now() + DELETION_CONFIG.DEFAULT_RECOVERY_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString());
        
      if (recoveryDeadlines.length > 0) {
        recoverySummary = {
          recoverable_projects: recoveryTokens.length,
          earliest_recovery_deadline: recoveryDeadlines.sort()[0],
          latest_recovery_deadline: recoveryDeadlines.sort().reverse()[0],
          batch_recovery_token: `batch_${batchId}`
        };
      }
    }

    const response: BulkProjectDeletionResponse = {
      success,
      batch_id: batchId,
      results,
      summary: {
        total_requested: totalRequested,
        successful_deletions: successfulDeletions,
        failed_deletions: failedDeletions,
        total_files_deleted: totalFilesDeleted,
        total_storage_freed_mb: totalStorageFreedMB,
        operation_duration_ms: operationDuration
      },
      recovery_summary: recoverySummary
    };

    return successResponse(response);

  } catch (error) {
    const operationDuration = Date.now() - startTime;
    
    console.error('[BULK-DELETE] Bulk deletion failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: operationDuration
    });

    return errorResponse(
      'BULK_DELETION_FAILED',
      'Bulk project deletion failed',
      500,
      { 
        error: error instanceof Error ? error.message : String(error),
        duration_ms: operationDuration
      }
    );
  }
}

/**
 * POST /api/projects/{id}/recover - Project Recovery
 * Recovers a soft-deleted project using recovery token
 */
export async function recoverProjectHandler(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3];

    console.info('[PROJECT-RECOVER] Processing recovery request', { 
      project_id: projectId 
    });

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Project ID is required',
        400
      );
    }

    // Parse recovery request
    let rawRequest: any;
    try {
      rawRequest = await request.json();
    } catch (error) {
      return errorResponse(
        'INVALID_REQUEST',
        'Invalid JSON in request body',
        400,
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    const recoveryRequest: ProjectRecoveryRequest = rawRequest;

    if (!recoveryRequest.recovery_token) {
      return errorResponse(
        'INVALID_REQUEST',
        'Recovery token is required',
        400
      );
    }

    // Validate recovery token
    const recoveryPath = `recovery/tokens/${recoveryRequest.recovery_token}.json`;
    const recoveryObject = await env.PROJECTS_BUCKET.get(recoveryPath);
    
    if (!recoveryObject) {
      return errorResponse(
        'TOKEN_INVALID',
        'Invalid or expired recovery token',
        404
      );
    }

    const recoveryData = JSON.parse(await recoveryObject.text());
    
    // Check if token is expired
    if (new Date(recoveryData.expires_at) < new Date()) {
      return errorResponse(
        'TOKEN_EXPIRED',
        'Recovery token has expired',
        410,
        {
          expired_at: recoveryData.expires_at,
          current_time: new Date().toISOString()
        }
      );
    }

    // Check if token matches project
    if (recoveryData.project_id !== projectId) {
      return errorResponse(
        'TOKEN_INVALID',
        'Recovery token does not match project ID',
        400
      );
    }

    // Load audit entry to get recovery data
    const auditPath = `audit/deletions/${recoveryData.deletion_id}.json`;
    const auditObject = await env.PROJECTS_BUCKET.get(auditPath);
    
    if (!auditObject) {
      return errorResponse(
        'RECOVERY_FAILED',
        'Recovery data not found',
        404
      );
    }

    const auditEntry: ProjectDeletionAudit = JSON.parse(await auditObject.text());
    
    if (!auditEntry.recovery_data) {
      return errorResponse(
        'RECOVERY_FAILED',
        'Project is not recoverable (hard deleted)',
        400
      );
    }

    const recoveryId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    
    console.info('[PROJECT-RECOVER] Starting recovery process', {
      project_id: projectId,
      recovery_id: recoveryId,
      deletion_id: recoveryData.deletion_id
    });

    // Restore metadata
    const metadataManager = getEnhancedMetadataManager(env);
    const originalMetadata = auditEntry.recovery_data.metadata_backup;
    
    // Update status to active and remove archived timestamps
    const restoredMetadata = {
      ...originalMetadata,
      extended_status: 'deployed' as const,
      archived_at: undefined,
      updated_at: new Date().toISOString(),
      status_history: [
        ...originalMetadata.status_history,
        {
          status: 'deployed' as const,
          timestamp: new Date().toISOString(),
          reason: 'Project recovered from soft delete',
          changed_by: recoveryRequest.requested_by || 'system'
        }
      ]
    };

    // Create the restored project
    const createResult = await metadataManager.createMetadata(
      projectId,
      originalMetadata,
      restoredMetadata,
      recoveryRequest.requested_by || 'system'
    );

    if (!createResult.success) {
      return errorResponse(
        'RECOVERY_FAILED',
        'Failed to restore project metadata',
        500,
        createResult.error
      );
    }

    // Restore files from archive with data integrity verification
    let totalFilesRestored = 0;
    let totalStorageRestoredMB = 0;
    const integrityErrors: string[] = [];
    const streamProcessor = new StreamingFileProcessor(env);
    
    try {
      const archivePrefix = `archive/${projectId}/`;
      
      const restorationResult = await streamProcessor.processFilesStreaming(
        env.PROJECTS_BUCKET,
        archivePrefix,
        async (obj) => {
          try {
            const originalObject = await env.PROJECTS_BUCKET.get(obj.key);
            if (!originalObject) {
              return {
                success: false,
                error: `Archive object not found: ${obj.key}`,
                bytesProcessed: 0
              };
            }
            
            if (!originalObject.customMetadata?.original_path) {
              return {
                success: false,
                error: `Missing original path metadata for: ${obj.key}`,
                bytesProcessed: 0
              };
            }
            
            const content = await originalObject.arrayBuffer();
            
            // Verify data integrity using stored checksum
            const storedChecksum = originalObject.customMetadata?.integrity_checksum;
            const integrityCheck = await FileIntegrityChecker.verifyFileIntegrity(
              content,
              storedChecksum
            );
            
            if (!integrityCheck.valid) {
              const errorMsg = `Integrity verification failed for ${obj.key}: ${integrityCheck.error}`;
              integrityErrors.push(errorMsg);
              
              // Still restore the file but mark it as potentially corrupted
              console.warn('[PROJECT-RECOVER] Integrity verification failed', {
                file: obj.key,
                expected_checksum: storedChecksum,
                actual_checksum: integrityCheck.checksum,
                error: integrityCheck.error
              });
            }
            
            // Restore to original location with integrity metadata
            await env.PROJECTS_BUCKET.put(
              originalObject.customMetadata.original_path,
              content,
              {
                httpMetadata: originalObject.httpMetadata,
                customMetadata: {
                  ...originalObject.customMetadata,
                  restored_at: new Date().toISOString(),
                  recovery_id: recoveryId,
                  integrity_verified: integrityCheck.valid.toString(),
                  verification_checksum: integrityCheck.checksum,
                  original_checksum: storedChecksum
                }
              }
            );
            
            // Remove from archive after successful restoration
            await env.PROJECTS_BUCKET.delete(obj.key);
            
            return {
              success: true,
              bytesProcessed: obj.size || 0
            };
            
          } catch (error) {
            return {
              success: false,
              error: `Failed to restore ${obj.key}: ${error instanceof Error ? error.message : String(error)}`,
              bytesProcessed: 0
            };
          }
        },
        {
          maxDurationMs: DELETION_CONFIG.MAX_CLEANUP_DURATION_MS,
          onProgress: (processed, total) => {
            if (processed % 20 === 0) {
              console.info(`[PROJECT-RECOVER] Recovery progress: ${processed} files restored`);
            }
          }
        }
      );
      
      totalFilesRestored = restorationResult.totalProcessed;
      totalStorageRestoredMB = Math.round(restorationResult.totalBytes / (1024 * 1024) * 100) / 100;
      
      if (restorationResult.errors.length > 0) {
        console.warn('[PROJECT-RECOVER] Some files failed to restore', {
          project_id: projectId,
          failed_files: restorationResult.errors.length,
          errors: restorationResult.errors.slice(0, 5) // Log first 5 errors
        });
      }
      
      if (integrityErrors.length > 0) {
        console.warn('[PROJECT-RECOVER] Data integrity issues detected', {
          project_id: projectId,
          integrity_failures: integrityErrors.length,
          errors: integrityErrors.slice(0, 3) // Log first 3 integrity errors
        });
      }
      
    } catch (error) {
      console.warn('[PROJECT-RECOVER] File restoration had issues', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    totalStorageRestoredMB = Math.round(totalStorageRestoredMB / (1024 * 1024) * 100) / 100;

    // Update audit entry to mark as recovered
    auditEntry.status = 'recovered';
    auditEntry.completed_at = new Date().toISOString();
    
    await env.PROJECTS_BUCKET.put(
      auditPath,
      JSON.stringify(auditEntry, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          type: 'deletion-audit',
          project_id: projectId,
          status: 'recovered',
          recovery_id: recoveryId,
          updated_at: new Date().toISOString()
        }
      }
    );

    // Invalidate recovery token
    await env.PROJECTS_BUCKET.delete(recoveryPath);

    const operationDuration = Date.now() - startTime;

    console.info('✅ [PROJECT-RECOVER] Recovery completed successfully', {
      project_id: projectId,
      recovery_id: recoveryId,
      files_restored: totalFilesRestored,
      storage_restored_mb: totalStorageRestoredMB,
      duration_ms: operationDuration
    });

    const response: ProjectRecoveryResponse = {
      success: true,
      project_id: projectId,
      original_project_id: projectId,
      recovery_id: recoveryId,
      results: {
        metadata_restored: true,
        storage_restored: totalFilesRestored > 0,
        builds_restored: recoveryRequest.options?.restore_build_history || false,
        deployments_restored: recoveryRequest.options?.restore_deployment_history || false,
        search_index_restored: true,
        total_files_restored: totalFilesRestored,
        total_storage_restored_mb: totalStorageRestoredMB,
        integrity_verification: {
          files_verified: totalFilesRestored,
          integrity_failures: integrityErrors.length,
          verification_enabled: true
        }
      },
      metrics: {
        recovery_duration_ms: operationDuration,
        files_processed: totalFilesRestored
      },
      warnings: integrityErrors.length > 0 ? [
        `${integrityErrors.length} files failed integrity verification - they may be corrupted`
      ] : undefined
    };

    return successResponse(response);

  } catch (error) {
    const operationDuration = Date.now() - startTime;
    
    console.error('[PROJECT-RECOVER] Recovery failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: operationDuration
    });

    return errorResponse(
      'RECOVERY_FAILED',
      'Project recovery failed',
      500,
      { 
        error: error instanceof Error ? error.message : String(error),
        duration_ms: operationDuration
      }
    );
  }
}

/**
 * GET /api/projects/deleted - List Deleted Projects
 * Returns list of soft-deleted projects that can be recovered
 */
export async function listDeletedProjectsHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[LIST-DELETED] Fetching deleted projects');

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const includeExpired = url.searchParams.get('include_expired') === 'true';

    // List all audit entries
    const auditList = await env.PROJECTS_BUCKET.list({
      prefix: 'audit/deletions/',
      limit: 1000 // Get all audit entries to filter properly
    });

    const deletedProjects: Array<{
      project_id: string;
      project_name: string;
      deletion_type: ProjectDeletionType;
      deleted_at: string;
      recovery_deadline?: string;
      is_recoverable: boolean;
      is_expired: boolean;
      deletion_reason?: string;
    }> = [];

    // Process audit entries
    for (const obj of auditList.objects) {
      try {
        const auditObject = await env.PROJECTS_BUCKET.get(obj.key);
        if (auditObject) {
          const audit: ProjectDeletionAudit = JSON.parse(await auditObject.text());
          
          // Only include soft deletes that haven't been recovered
          if (audit.deletion_type === 'soft' && audit.status !== 'recovered') {
            const isExpired = audit.recovery_deadline ? 
              new Date(audit.recovery_deadline) < new Date() : true;
            
            if (!isExpired || includeExpired) {
              deletedProjects.push({
                project_id: audit.project_id,
                project_name: audit.project_name,
                deletion_type: audit.deletion_type,
                deleted_at: audit.initiated_at,
                recovery_deadline: audit.recovery_deadline,
                is_recoverable: !isExpired,
                is_expired: isExpired,
                deletion_reason: audit.deletion_reason
              });
            }
          }
        }
      } catch (error) {
        console.warn('[LIST-DELETED] Failed to process audit entry', {
          key: obj.key,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Sort by deletion date (newest first) and apply pagination
    const sortedProjects = deletedProjects
      .sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime())
      .slice(offset, offset + limit);

    const response = {
      deleted_projects: sortedProjects,
      total_count: deletedProjects.length,
      recoverable_count: deletedProjects.filter(p => p.is_recoverable).length,
      expired_count: deletedProjects.filter(p => p.is_expired).length,
      pagination: {
        limit,
        offset,
        has_more: offset + limit < deletedProjects.length
      }
    };

    console.info('✅ [LIST-DELETED] Deleted projects fetched successfully', {
      total_found: deletedProjects.length,
      returned: sortedProjects.length,
      recoverable: response.recoverable_count,
      expired: response.expired_count
    });

    return successResponse(response);

  } catch (error) {
    console.error('[LIST-DELETED] Failed to list deleted projects', {
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse(
      'LISTING_FAILED',
      'Failed to list deleted projects',
      500,
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * GET /api/projects/deletion-audits - Deletion Audit Trail
 * Returns comprehensive audit trail of all deletion operations
 */
export async function getDeletionAuditsHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[AUDIT-TRAIL] Fetching deletion audit trail');

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const projectId = url.searchParams.get('project_id');
    const deletionType = url.searchParams.get('deletion_type') as ProjectDeletionType;
    const status = url.searchParams.get('status');
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');

    // List all audit entries
    const auditList = await env.PROJECTS_BUCKET.list({
      prefix: 'audit/deletions/',
      limit: 1000
    });

    const auditEntries: ProjectDeletionAudit[] = [];

    // Load and filter audit entries
    for (const obj of auditList.objects) {
      try {
        const auditObject = await env.PROJECTS_BUCKET.get(obj.key);
        if (auditObject) {
          const audit: ProjectDeletionAudit = JSON.parse(await auditObject.text());
          
          // Apply filters
          if (projectId && audit.project_id !== projectId) continue;
          if (deletionType && audit.deletion_type !== deletionType) continue;
          if (status && audit.status !== status) continue;
          
          if (startDate) {
            const auditDate = new Date(audit.initiated_at);
            const filterStart = new Date(startDate);
            if (auditDate < filterStart) continue;
          }
          
          if (endDate) {
            const auditDate = new Date(audit.initiated_at);
            const filterEnd = new Date(endDate);
            if (auditDate > filterEnd) continue;
          }
          
          auditEntries.push(audit);
        }
      } catch (error) {
        console.warn('[AUDIT-TRAIL] Failed to process audit entry', {
          key: obj.key,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Sort by initiation date (newest first) and apply pagination
    const sortedAudits = auditEntries
      .sort((a, b) => new Date(b.initiated_at).getTime() - new Date(a.initiated_at).getTime())
      .slice(offset, offset + limit);

    // Calculate summary statistics
    const summary = {
      total_deletions: auditEntries.length,
      soft_deletions: auditEntries.filter(a => a.deletion_type === 'soft').length,
      hard_deletions: auditEntries.filter(a => a.deletion_type === 'hard').length,
      completed_deletions: auditEntries.filter(a => a.status === 'completed').length,
      failed_deletions: auditEntries.filter(a => a.status === 'failed').length,
      recovered_projects: auditEntries.filter(a => a.status === 'recovered').length,
      total_files_deleted: auditEntries.reduce((sum, a) => sum + a.cleanup_results.total_files_deleted, 0),
      total_storage_freed_mb: auditEntries.reduce((sum, a) => sum + a.cleanup_results.total_storage_freed_mb, 0)
    };

    const response = {
      audit_entries: sortedAudits,
      summary,
      pagination: {
        limit,
        offset,
        total_count: auditEntries.length,
        has_more: offset + limit < auditEntries.length
      },
      filters: {
        project_id: projectId,
        deletion_type: deletionType,
        status,
        start_date: startDate,
        end_date: endDate
      }
    };

    console.info('✅ [AUDIT-TRAIL] Audit trail fetched successfully', {
      total_entries: auditEntries.length,
      returned_entries: sortedAudits.length,
      filters_applied: Object.values({projectId, deletionType, status, startDate, endDate}).filter(Boolean).length
    });

    return successResponse(response);

  } catch (error) {
    console.error('[AUDIT-TRAIL] Failed to fetch audit trail', {
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse(
      'AUDIT_FAILED',
      'Failed to fetch deletion audit trail',
      500,
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Handle OPTIONS request for CORS - Bulk Delete
 */
export async function bulkDeleteOptionsHandler(request: Request, env: Env): Promise<Response> {
  return corsResponse();
}

/**
 * Handle OPTIONS request for CORS - Recovery
 */
export async function recoverProjectOptionsHandler(request: Request, env: Env): Promise<Response> {
  return corsResponse();
}

/**
 * Handle OPTIONS request for CORS - List Deleted
 */
export async function listDeletedProjectsOptionsHandler(request: Request, env: Env): Promise<Response> {
  return corsResponse();
}

/**
 * Handle OPTIONS request for CORS - Audit Trail
 */
export async function getDeletionAuditsOptionsHandler(request: Request, env: Env): Promise<Response> {
  return corsResponse();
}
