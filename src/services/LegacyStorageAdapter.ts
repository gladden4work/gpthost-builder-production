/**
 * LegacyStorageAdapter - Adapter for legacy storage implementation
 * Placeholder that implements IStorageService interface
 * Will be replaced/removed when fully migrated to new StorageService
 */

import { Result, Err } from '../lib/result';
import { StorageError, StorageErrorCode } from '../lib/errors';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { 
  IStorageService, 
  ListOptions, 
  StorageFile, 
  StorageMetadata 
} from './StorageService';

/**
 * Legacy storage adapter that wraps old storage logic
 * Currently returns errors as we're focused on new implementation
 */
export class LegacyStorageAdapter implements IStorageService {
  constructor(private readonly bucket: R2Bucket) {}
  
  /**
   * Legacy upload - placeholder implementation
   */
  async uploadFile(
    path: string, 
    content: ArrayBuffer, 
    metadata?: Record<string, string>
  ): Promise<Result<void, StorageError>> {
    // Legacy implementation placeholder
    // In a real migration, this would wrap existing upload logic
    return Err(new StorageError(
      StorageErrorCode.OPERATION_FAILED,
      'Legacy storage adapter: uploadFile not implemented',
      { operation: 'uploadFile', path, adapter: 'legacy' }
    ));
  }
  
  /**
   * Legacy download - placeholder implementation
   */
  async downloadFile(path: string): Promise<Result<ArrayBuffer, StorageError>> {
    // Legacy implementation placeholder
    return Err(new StorageError(
      StorageErrorCode.OPERATION_FAILED,
      'Legacy storage adapter: downloadFile not implemented',
      { operation: 'downloadFile', path, adapter: 'legacy' }
    ));
  }
  
  /**
   * Legacy list - placeholder implementation
   */
  async listFiles(
    prefix: string, 
    options?: ListOptions
  ): Promise<Result<StorageFile[], StorageError>> {
    // Legacy implementation placeholder
    return Err(new StorageError(
      StorageErrorCode.OPERATION_FAILED,
      'Legacy storage adapter: listFiles not implemented',
      { operation: 'listFiles', prefix, adapter: 'legacy' }
    ));
  }
  
  /**
   * Legacy delete - placeholder implementation
   */
  async deleteFile(path: string): Promise<Result<void, StorageError>> {
    // Legacy implementation placeholder
    return Err(new StorageError(
      StorageErrorCode.OPERATION_FAILED,
      'Legacy storage adapter: deleteFile not implemented',
      { operation: 'deleteFile', path, adapter: 'legacy' }
    ));
  }
  
  /**
   * Legacy copy - placeholder implementation
   */
  async copyDirectory(
    source: string, 
    destination: string
  ): Promise<Result<void, StorageError>> {
    // Legacy implementation placeholder
    return Err(new StorageError(
      StorageErrorCode.OPERATION_FAILED,
      'Legacy storage adapter: copyDirectory not implemented',
      { operation: 'copyDirectory', source, destination, adapter: 'legacy' }
    ));
  }
  
  /**
   * Legacy exists check - placeholder implementation
   */
  async exists(path: string): Promise<Result<boolean, StorageError>> {
    // Legacy implementation placeholder
    return Err(new StorageError(
      StorageErrorCode.OPERATION_FAILED,
      'Legacy storage adapter: exists not implemented',
      { operation: 'exists', path, adapter: 'legacy' }
    ));
  }
  
  /**
   * Legacy metadata - placeholder implementation
   */
  async getMetadata(path: string): Promise<Result<StorageMetadata, StorageError>> {
    // Legacy implementation placeholder
    return Err(new StorageError(
      StorageErrorCode.OPERATION_FAILED,
      'Legacy storage adapter: getMetadata not implemented',
      { operation: 'getMetadata', path, adapter: 'legacy' }
    ));
  }
}