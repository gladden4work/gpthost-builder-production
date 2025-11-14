/**
 * StorageService - Foundation service for R2 storage operations
 * Implements canonical patterns from steering documents
 * Zero dependencies - this is the base service all others depend on
 */

import { Result, Ok, Err } from '../lib/result';
import { StorageError, StorageErrorCode } from '../lib/errors';
import type { R2Bucket, R2Object, R2ListOptions } from '@cloudflare/workers-types';

// Supporting types as defined in service-interfaces.md
export interface ListOptions {
  maxKeys?: number;
  cursor?: string;
  delimiter?: string;
}

export interface StorageFile {
  key: string;
  size?: number;
  lastModified?: Date;
  etag?: string;
}

export interface StorageMetadata {
  size: number;
  contentType?: string;
  lastModified?: Date;
  etag?: string;
  customMetadata?: Record<string, string>;
}

/**
 * Service interface for storage operations
 */
export interface IStorageService {
  uploadFile(path: string, content: ArrayBuffer, metadata?: Record<string, string>): Promise<Result<void, StorageError>>;
  downloadFile(path: string): Promise<Result<ArrayBuffer, StorageError>>;
  listFiles(prefix: string, options?: ListOptions): Promise<Result<StorageFile[], StorageError>>;
  deleteFile(path: string): Promise<Result<void, StorageError>>;
  copyDirectory(source: string, destination: string): Promise<Result<void, StorageError>>;
  exists(path: string): Promise<Result<boolean, StorageError>>;
  getMetadata(path: string): Promise<Result<StorageMetadata, StorageError>>;
}

/**
 * StorageService implementation for Cloudflare R2
 * ~200 lines replacing scattered R2 logic across the codebase
 */
export class StorageService implements IStorageService {
  constructor(private readonly bucket: R2Bucket) {}

  /**
   * Validate path to prevent path traversal and other security issues
   * @param path - The path to validate
   * @returns true if path is valid, false otherwise
   */
  private validatePath(path: string): boolean {
    // Check for path traversal attempts
    if (path.includes('..')) return false;
    
    // Check for absolute paths (security risk)
    if (path.startsWith('/')) return false;
    
    // Check for Windows-style absolute paths
    if (/^[a-zA-Z]:/.test(path)) return false;
    
    // Check for null bytes (can bypass security checks)
    if (path.includes('\0')) return false;
    
    // Check for URL protocols (potential SSRF)
    if (/^[a-zA-Z]+:\/\//.test(path)) return false;
    
    // Check for special characters that might cause issues (but allow colons in filenames)
    // Only reject Windows drive patterns (handled above) and other dangerous chars
    if (/[\<\>\|\"\*\?]/.test(path)) return false;
    
    return true;
  }

  /**
   * Upload a file to R2 storage with path validation
   */
  async uploadFile(
    path: string, 
    content: ArrayBuffer, 
    metadata?: Record<string, string>
  ): Promise<Result<void, StorageError>> {
    // Path validation
    if (!this.validatePath(path)) {
      return Err(new StorageError(
        StorageErrorCode.INVALID_PATH,
        `Invalid path: ${path}`,
        { operation: 'uploadFile', path }
      ));
    }

    try {
      await this.bucket.put(path, content, {
        customMetadata: metadata
      });
      return Ok(undefined);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to upload ${path}: ${(error as Error).message}`,
        { operation: 'uploadFile', path },
        error as Error
      ));
    }
  }

  /**
   * Download a file from R2 storage with error handling
   */
  async downloadFile(path: string): Promise<Result<ArrayBuffer, StorageError>> {
    // Path validation
    if (!this.validatePath(path)) {
      return Err(new StorageError(
        StorageErrorCode.INVALID_PATH,
        `Invalid path: ${path}`,
        { operation: 'downloadFile', path }
      ));
    }

    try {
      const object = await this.bucket.get(path);
      
      if (!object) {
        return Err(new StorageError(
          StorageErrorCode.NOT_FOUND,
          `File not found: ${path}`,
          { operation: 'downloadFile', path }
        ));
      }

      const buffer = await object.arrayBuffer();
      return Ok(buffer);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to download ${path}: ${(error as Error).message}`,
        { operation: 'downloadFile', path },
        error as Error
      ));
    }
  }

  /**
   * List files with pagination support
   */
  async listFiles(
    prefix: string, 
    options?: ListOptions
  ): Promise<Result<StorageFile[], StorageError>> {
    try {
      const files: StorageFile[] = [];
      let cursor = options?.cursor;
      const limit = options?.maxKeys || 1000;

      // Handle pagination - iterate while truncated
      do {
        const listOptions: R2ListOptions = { 
          prefix, 
          cursor, 
          limit 
        };

        if (options?.delimiter) {
          listOptions.delimiter = options.delimiter;
        }

        const page = await this.bucket.list(listOptions);
        
        for (const obj of page.objects) {
          files.push({
            key: obj.key,
            size: obj.size,
            lastModified: obj.uploaded,
            etag: obj.etag
          });
        }

        cursor = page.truncated ? page.cursor : undefined;
        
        // Stop if we've reached the requested limit
        if (options?.maxKeys && files.length >= options.maxKeys) {
          break;
        }
      } while (cursor);

      return Ok(files);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to list files with prefix ${prefix}: ${(error as Error).message}`,
        { operation: 'listFiles', prefix },
        error as Error
      ));
    }
  }

  /**
   * Delete single files or directories recursively
   */
  async deleteFile(path: string): Promise<Result<void, StorageError>> {
    try {
      // Check if it's a directory (ends with /)
      if (path.endsWith('/')) {
        // Delete directory recursively with batch deletions
        const listResult = await this.listFiles(path);
        if (!listResult.ok) {
          return listResult as Result<void, StorageError>;
        }
        
        const keys = listResult.value.map(f => f.key);
        
        if (keys.length === 0) {
          // Empty directory, nothing to delete
          return Ok(undefined);
        }

        // Batch deletions in chunks of 1000 to avoid oversized requests
        const batchSize = 1000;
        for (let i = 0; i < keys.length; i += batchSize) {
          const chunk = keys.slice(i, i + batchSize);
          if (chunk.length > 0) {
            await this.bucket.delete(chunk);
          }
        }
      } else {
        // Delete single file
        await this.bucket.delete(path);
      }
      
      return Ok(undefined);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to delete ${path}: ${(error as Error).message}`,
        { operation: 'deleteFile', path },
        error as Error
      ));
    }
  }

  /**
   * Copy all files preserving metadata
   */
  async copyDirectory(
    source: string, 
    destination: string
  ): Promise<Result<void, StorageError>> {
    try {
      // List all files in source directory (handles pagination internally)
      const listResult = await this.listFiles(source);
      if (!listResult.ok) {
        return listResult as Result<void, StorageError>;
      }

      // Copy each file preserving metadata
      for (const file of listResult.value) {
        const srcKey = file.key;
        const dstKey = srcKey.replace(source, destination);

        // Get the object with metadata
        const obj = await this.bucket.get(srcKey);
        if (!obj) {
          return Err(new StorageError(
            StorageErrorCode.NOT_FOUND,
            `Source file missing during copy: ${srcKey}`,
            { operation: 'copyDirectory', source: srcKey, destination: dstKey }
          ));
        }

        // Get metadata from head request for complete metadata
        const head = await this.bucket.head(srcKey);

        // Stream large files to avoid memory issues
        const size = head?.size || 0;
        if (size > 50 * 1024 * 1024) {
          // Use streaming for large files (>50MB) - pass the ReadableStream directly
          await this.bucket.put(dstKey, obj.body, {
            httpMetadata: head?.httpMetadata,
            customMetadata: head?.customMetadata
          });
        } else {
          // For smaller files, load into memory
          const body = await obj.arrayBuffer();
          await this.bucket.put(dstKey, body, {
            httpMetadata: head?.httpMetadata,
            customMetadata: head?.customMetadata
          });
        }
      }

      return Ok(undefined);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to copy from ${source} to ${destination}: ${(error as Error).message}`,
        { operation: 'copyDirectory', source, destination },
        error as Error
      ));
    }
  }

  /**
   * Check file existence
   */
  async exists(path: string): Promise<Result<boolean, StorageError>> {
    try {
      const head = await this.bucket.head(path);
      return Ok(head !== null);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to check existence of ${path}: ${(error as Error).message}`,
        { operation: 'exists', path },
        error as Error
      ));
    }
  }

  /**
   * Get file metadata without downloading
   */
  async getMetadata(path: string): Promise<Result<StorageMetadata, StorageError>> {
    try {
      const head = await this.bucket.head(path);
      
      if (!head) {
        return Err(new StorageError(
          StorageErrorCode.NOT_FOUND,
          `File not found: ${path}`,
          { operation: 'getMetadata', path }
        ));
      }

      return Ok({
        size: head.size,
        contentType: head.httpMetadata?.contentType,
        lastModified: head.uploaded,
        etag: head.etag,
        customMetadata: head.customMetadata as Record<string, string> | undefined
      });
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to get metadata for ${path}: ${(error as Error).message}`,
        { operation: 'getMetadata', path },
        error as Error
      ));
    }
  }
}
