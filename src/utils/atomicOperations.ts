/**
 * TASK-034: Atomic Operations Utility
 * 
 * Provides atomic compare-and-swap operations for preventing race conditions
 * in concurrent update scenarios, specifically for optimistic locking.
 * 
 * Features:
 * - Compare-and-swap operations using ETags
 * - Retry mechanisms with exponential backoff
 * - Conflict detection and resolution
 * - Integration with Cloudflare R2 storage
 */

import { EnhancedProjectMetadata } from '../types/api';

/**
 * Result of an atomic operation
 */
interface AtomicOperationResult<T> {
  success: boolean;
  data?: T;
  etag?: string;
  error?: {
    type: 'version_conflict' | 'storage_error' | 'validation_error' | 'not_found';
    message: string;
    details?: any;
    current_version?: number;
    expected_version?: number;
  };
}

/**
 * Options for atomic operations
 */
interface AtomicOperationOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  expectedVersion?: number;
  expectedEtag?: string;
}

/**
 * Default options for atomic operations
 */
const DEFAULT_ATOMIC_OPTIONS: Required<AtomicOperationOptions> = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 2000,
  expectedVersion: 0,
  expectedEtag: ''
};

/**
 * Atomic metadata manager for compare-and-swap operations
 */
export class AtomicMetadataManager {
  private projectsBucket: R2Bucket;

  constructor(projectsBucket: R2Bucket) {
    this.projectsBucket = projectsBucket;
  }

  /**
   * Atomically update metadata with compare-and-swap semantics
   */
  async atomicUpdate(
    projectId: string,
    updateFunction: (current: EnhancedProjectMetadata) => EnhancedProjectMetadata,
    options: AtomicOperationOptions = {}
  ): Promise<AtomicOperationResult<EnhancedProjectMetadata>> {
    const opts = { ...DEFAULT_ATOMIC_OPTIONS, ...options };
    let attempt = 0;

    while (attempt <= opts.maxRetries) {
      try {
        console.info('[ATOMIC-UPDATE] Attempt', { 
          project_id: projectId, 
          attempt: attempt + 1,
          max_retries: opts.maxRetries
        });

        // Step 1: Load current metadata with ETag
        const loadResult = await this.loadWithETag(projectId);
        if (!loadResult.success) {
          return loadResult as AtomicOperationResult<EnhancedProjectMetadata>;
        }

        const currentMetadata = loadResult.data!;
        const currentETag = loadResult.etag!;

        // Step 2: Check version expectations if provided
        if (opts.expectedVersion && opts.expectedVersion > 0) {
          if (currentMetadata.metadata_version.version !== opts.expectedVersion) {
            return {
              success: false,
              error: {
                type: 'version_conflict',
                message: 'Version conflict detected - metadata was modified by another process',
                current_version: currentMetadata.metadata_version.version,
                expected_version: opts.expectedVersion
              }
            };
          }
        }

        // Step 3: Check ETag expectations if provided
        if (opts.expectedEtag && opts.expectedEtag !== currentETag) {
          return {
            success: false,
            error: {
              type: 'version_conflict',
              message: 'ETag conflict detected - metadata was modified by another process',
              details: { current_etag: currentETag, expected_etag: opts.expectedEtag }
            }
          };
        }

        // Step 4: Apply the update function
        let updatedMetadata: EnhancedProjectMetadata;
        try {
          updatedMetadata = updateFunction(currentMetadata);
        } catch (error) {
          return {
            success: false,
            error: {
              type: 'validation_error',
              message: error instanceof Error ? error.message : String(error)
            }
          };
        }

        // Step 5: Increment version number atomically
        updatedMetadata = {
          ...updatedMetadata,
          metadata_version: {
            ...updatedMetadata.metadata_version,
            version: currentMetadata.metadata_version.version + 1
          },
          updated_at: new Date().toISOString()
        };

        // Step 6: Attempt atomic store with conditional put
        const storeResult = await this.storeWithETagCheck(
          projectId,
          updatedMetadata,
          currentETag
        );

        if (storeResult.success) {
          console.info('✅ [ATOMIC-UPDATE] Update successful', {
            project_id: projectId,
            attempt: attempt + 1,
            new_version: updatedMetadata.metadata_version.version,
            new_etag: storeResult.etag
          });

          return {
            success: true,
            data: updatedMetadata,
            etag: storeResult.etag
          };
        }

        // If ETag mismatch (concurrent modification), retry
        if (storeResult.error?.type === 'version_conflict') {
          attempt++;
          if (attempt <= opts.maxRetries) {
            const delay = Math.min(
              opts.baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100,
              opts.maxDelayMs
            );
            
            console.info('[ATOMIC-UPDATE] Retrying after concurrent modification', {
              project_id: projectId,
              attempt: attempt + 1,
              delay_ms: delay
            });
            
            await this.sleep(delay);
            continue;
          }
        }

        return storeResult as AtomicOperationResult<EnhancedProjectMetadata>;

      } catch (error) {
        console.error('[ATOMIC-UPDATE] Unexpected error', {
          project_id: projectId,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error)
        });

        return {
          success: false,
          error: {
            type: 'storage_error',
            message: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }

    return {
      success: false,
      error: {
        type: 'version_conflict',
        message: `Max retries (${opts.maxRetries}) exceeded due to concurrent modifications`
      }
    };
  }

  /**
   * Batch atomic operations with all-or-nothing semantics
   */
  async atomicBatchUpdate(
    operations: Array<{
      projectId: string;
      updateFunction: (current: EnhancedProjectMetadata) => EnhancedProjectMetadata;
      expectedVersion?: number;
    }>,
    options: AtomicOperationOptions = {}
  ): Promise<{
    success: boolean;
    results: Array<AtomicOperationResult<EnhancedProjectMetadata>>;
    rollbackRequired?: boolean;
  }> {
    const results: Array<AtomicOperationResult<EnhancedProjectMetadata>> = [];
    const successfulOperations: Array<{ 
      projectId: string; 
      etag: string; 
      metadata: EnhancedProjectMetadata;
      previousMetadata: EnhancedProjectMetadata;
      previousEtag: string;
    }> = [];

    try {
      // Phase 1: Load all current states before making changes
      const originalStates: Map<string, { metadata: EnhancedProjectMetadata; etag: string }> = new Map();
      
      for (const operation of operations) {
        const loadResult = await this.loadWithETag(operation.projectId);
        if (loadResult.success) {
          originalStates.set(operation.projectId, {
            metadata: loadResult.data!,
            etag: loadResult.etag!
          });
        }
      }

      // Phase 2: Execute all operations
      for (const operation of operations) {
        const originalState = originalStates.get(operation.projectId);
        if (!originalState) {
          results.push({
            success: false,
            error: {
              type: 'not_found',
              message: `Project ${operation.projectId} not found`
            }
          });
          
          // Rollback all successful operations
          await this.rollbackOperations(successfulOperations);
          
          return {
            success: false,
            results,
            rollbackRequired: true
          };
        }

        const result = await this.atomicUpdate(
          operation.projectId,
          operation.updateFunction,
          { ...options, expectedVersion: operation.expectedVersion }
        );

        results.push(result);

        if (result.success) {
          successfulOperations.push({
            projectId: operation.projectId,
            etag: result.etag!,
            metadata: result.data!,
            previousMetadata: originalState.metadata,
            previousEtag: originalState.etag
          });
        } else {
          // If any operation fails, we need to rollback
          console.warn('[ATOMIC-BATCH] Operation failed, rolling back', {
            project_id: operation.projectId,
            successful_operations: successfulOperations.length,
            error: result.error?.message
          });

          // Attempt rollback of successful operations
          await this.rollbackOperations(successfulOperations);

          return {
            success: false,
            results,
            rollbackRequired: true
          };
        }
      }

      console.info('✅ [ATOMIC-BATCH] All operations successful', {
        total_operations: operations.length,
        successful_operations: successfulOperations.length
      });

      return {
        success: true,
        results
      };

    } catch (error) {
      console.error('[ATOMIC-BATCH] Batch operation failed', {
        error: error instanceof Error ? error.message : String(error)
      });

      // Attempt rollback
      await this.rollbackOperations(successfulOperations);

      return {
        success: false,
        results: results.length > 0 ? results : [{
          success: false,
          error: {
            type: 'storage_error',
            message: error instanceof Error ? error.message : String(error)
          }
        }],
        rollbackRequired: true
      };
    }
  }

  /**
   * Load metadata with ETag for atomic operations
   */
  private async loadWithETag(
    projectId: string
  ): Promise<AtomicOperationResult<EnhancedProjectMetadata> & { etag?: string }> {
    try {
      const metadataPath = `projects/${projectId}/enhanced-metadata.json`;
      const object = await this.projectsBucket.get(metadataPath);

      if (!object) {
        return {
          success: false,
          error: {
            type: 'not_found',
            message: `Enhanced metadata not found for project ${projectId}`
          }
        };
      }

      const metadata: EnhancedProjectMetadata = JSON.parse(await object.text());
      const etag = object.etag;

      return {
        success: true,
        data: metadata,
        etag
      };

    } catch (error) {
      return {
        success: false,
        error: {
          type: 'storage_error',
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * Store metadata with ETag check for atomic operations
   */
  private async storeWithETagCheck(
    projectId: string,
    metadata: EnhancedProjectMetadata,
    expectedETag: string
  ): Promise<AtomicOperationResult<EnhancedProjectMetadata> & { etag?: string }> {
    try {
      const metadataPath = `projects/${projectId}/enhanced-metadata.json`;
      
      // Use conditional put with ETag
      const putOptions: R2PutOptions = {
        httpMetadata: {
          contentType: 'application/json',
        },
        customMetadata: {
          projectId: projectId,
          schemaVersion: '1.0.0',
          lastUpdated: new Date().toISOString(),
          metadataVersion: metadata.metadata_version.version.toString()
        },
        // Conditional put - only succeed if ETag matches
        onlyIf: {
          etagMatches: expectedETag
        }
      };

      const result = await this.projectsBucket.put(
        metadataPath,
        JSON.stringify(metadata, null, 2),
        putOptions
      );

      if (!result) {
        return {
          success: false,
          error: {
            type: 'version_conflict',
            message: 'Conditional put failed - ETag mismatch indicates concurrent modification'
          }
        };
      }

      return {
        success: true,
        data: metadata,
        etag: result.etag
      };

    } catch (error) {
      // Check if it's an ETag mismatch error
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('etag') || errorMessage.includes('precondition') || errorMessage.includes('conditional')) {
        return {
          success: false,
          error: {
            type: 'version_conflict',
            message: 'Concurrent modification detected - ETag mismatch'
          }
        };
      }

      return {
        success: false,
        error: {
          type: 'storage_error',
          message: errorMessage
        }
      };
    }
  }

  /**
   * Rollback operations by restoring previous state
   */
  private async rollbackOperations(
    operations: Array<{ 
      projectId: string; 
      etag: string; 
      metadata: EnhancedProjectMetadata;
      previousMetadata: EnhancedProjectMetadata;
      previousEtag: string;
    }>
  ): Promise<void> {
    console.info('[ATOMIC-ROLLBACK] Rolling back operations', { count: operations.length });

    const rollbackPromises = operations.map(async (op) => {
      try {
        console.info('[ATOMIC-ROLLBACK] Restoring previous state', { 
          project_id: op.projectId,
          current_version: op.metadata.metadata_version.version,
          restoring_version: op.previousMetadata.metadata_version.version
        });
        
        // Create rollback metadata with incremented version to ensure atomicity
        const rollbackMetadata: EnhancedProjectMetadata = {
          ...op.previousMetadata,
          metadata_version: {
            ...op.previousMetadata.metadata_version,
            version: op.metadata.metadata_version.version + 1, // Increment to avoid conflicts
            changes: [
              ...op.previousMetadata.metadata_version.changes,
              {
                field: 'rollback',
                old_value: op.metadata.metadata_version.version,
                new_value: op.metadata.metadata_version.version + 1,
                reason: 'Atomic operation rollback'
              }
            ]
          },
          updated_at: new Date().toISOString(),
          status_history: [
            ...op.previousMetadata.status_history,
            {
              status: op.previousMetadata.extended_status,
              timestamp: new Date().toISOString(),
              reason: 'Rolled back due to atomic batch operation failure',
              changed_by: 'system'
            }
          ]
        };

        // Attempt to restore the previous state atomically
        const rollbackResult = await this.storeWithETagCheck(
          op.projectId,
          rollbackMetadata,
          op.etag // Use the current ETag from the failed batch
        );

        if (rollbackResult.success) {
          console.info('✅ [ATOMIC-ROLLBACK] Successfully restored previous state', {
            project_id: op.projectId,
            restored_version: rollbackMetadata.metadata_version.version
          });
        } else {
          console.error('[ATOMIC-ROLLBACK] Failed to restore previous state - ETag conflict', {
            project_id: op.projectId,
            error: rollbackResult.error?.message
          });
          
          // If ETag-based rollback fails, try a force rollback (last resort)
          // This could happen if another process modified the metadata during rollback
          try {
            const forceRollbackResult = await this.forceRollback(op.projectId, rollbackMetadata);
            if (forceRollbackResult.success) {
              console.warn('[ATOMIC-ROLLBACK] Force rollback successful', {
                project_id: op.projectId
              });
            } else {
              throw new Error(forceRollbackResult.error?.message || 'Force rollback failed');
            }
          } catch (forceError) {
            console.error('[ATOMIC-ROLLBACK] Force rollback also failed', {
              project_id: op.projectId,
              error: forceError instanceof Error ? forceError.message : String(forceError)
            });
          }
        }
        
      } catch (error) {
        console.error('[ATOMIC-ROLLBACK] Rollback failed', {
          project_id: op.projectId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    await Promise.allSettled(rollbackPromises);
    console.info('[ATOMIC-ROLLBACK] Rollback operations completed');
  }

  /**
   * Force rollback without ETag check (last resort)
   */
  private async forceRollback(
    projectId: string,
    rollbackMetadata: EnhancedProjectMetadata
  ): Promise<AtomicOperationResult<EnhancedProjectMetadata>> {
    try {
      const metadataPath = `projects/${projectId}/enhanced-metadata.json`;
      
      // Store without ETag check (force overwrite)
      const result = await this.projectsBucket.put(
        metadataPath,
        JSON.stringify(rollbackMetadata, null, 2),
        {
          httpMetadata: {
            contentType: 'application/json',
          },
          customMetadata: {
            projectId: projectId,
            schemaVersion: '1.0.0',
            lastUpdated: new Date().toISOString(),
            metadataVersion: rollbackMetadata.metadata_version.version.toString(),
            rollback: 'true'
          }
        }
      );

      if (result) {
        return {
          success: true,
          data: rollbackMetadata,
          etag: result.etag
        };
      } else {
        return {
          success: false,
          error: {
            type: 'storage_error',
            message: 'Force rollback failed - storage operation returned null'
          }
        };
      }

    } catch (error) {
      return {
        success: false,
        error: {
          type: 'storage_error',
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create atomic metadata manager
 */
export function createAtomicMetadataManager(projectsBucket: R2Bucket): AtomicMetadataManager {
  return new AtomicMetadataManager(projectsBucket);
}

/**
 * Utility function for simple compare-and-swap operation
 */
export async function compareAndSwap<T>(
  loadFn: () => Promise<{ data: T; etag: string }>,
  updateFn: (current: T) => T,
  storeFn: (data: T, expectedETag: string) => Promise<{ success: boolean; etag?: string; error?: any }>,
  options: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<AtomicOperationResult<T>> {
  const maxRetries = options.maxRetries || 3;
  const baseDelayMs = options.baseDelayMs || 100;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Load current state
      const { data: currentData, etag: currentETag } = await loadFn();
      
      // Apply update
      const updatedData = updateFn(currentData);
      
      // Attempt atomic store
      const storeResult = await storeFn(updatedData, currentETag);
      
      if (storeResult.success) {
        return {
          success: true,
          data: updatedData,
          etag: storeResult.etag
        };
      }

      // If conflict and we have retries left, wait and retry
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return {
        success: false,
        error: storeResult.error || {
          type: 'version_conflict',
          message: 'Max retries exceeded due to concurrent modifications'
        }
      };

    } catch (error) {
      return {
        success: false,
        error: {
          type: 'storage_error',
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  return {
    success: false,
    error: {
      type: 'version_conflict',
      message: 'Compare-and-swap operation failed after maximum retries'
    }
  };
}