/**
 * MonitoredStorageService - Decorator for storage monitoring
 * Wraps any IStorageService to add performance monitoring and logging
 * Part 4 of DAY3-TDD-STRATEGY: Integrates with ServiceMetrics
 */

import { Result, Err } from '../lib/result';
import { StorageError, StorageErrorCode } from '../lib/errors';
import { ServiceMetrics } from '../monitoring/ServiceMetrics';
import type { 
  IStorageService, 
  ListOptions, 
  StorageFile, 
  StorageMetadata 
} from './StorageService';

/**
 * Monitored storage service that adds observability to any storage implementation
 * Decorator pattern - delegates all operations to wrapped service
 */
export class MonitoredStorageService implements IStorageService {
  constructor(private readonly wrapped: IStorageService) {}
  
  /**
   * Upload with monitoring
   */
  async uploadFile(
    path: string, 
    content: ArrayBuffer, 
    metadata?: Record<string, string>
  ): Promise<Result<void, StorageError>> {
    const start = performance.now();
    const operation = 'uploadFile';
    
    try {
      const result = await this.wrapped.uploadFile(path, content, metadata);
      const duration = performance.now() - start;
      
      // Record metrics with ServiceMetrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, result.ok);
      
      // Log metrics
      this.logMetrics(operation, {
        path,
        size: content.byteLength,
        duration,
        success: result.ok
      });
      
      // Warn if operation is slow (>100ms)
      if (duration > 100) {
        console.warn('[StorageMonitor Warning]', {
          operation,
          duration: Math.round(duration),
          path,
          threshold: 100,
          timestamp: new Date().toISOString()
        });
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      
      // Record failure metrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, false);
      
      // Log error and return typed Result error to preserve contract
      this.logError(operation, error as Error, { path });
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `MonitoredStorageService.${operation} error: ${(error as Error).message}`,
        { operation, path },
        error as Error
      ));
    }
  }
  
  /**
   * Download with monitoring
   */
  async downloadFile(path: string): Promise<Result<ArrayBuffer, StorageError>> {
    const start = performance.now();
    const operation = 'downloadFile';
    
    try {
      const result = await this.wrapped.downloadFile(path);
      const duration = performance.now() - start;
      
      // Record metrics with ServiceMetrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, result.ok);
      
      // Log metrics
      this.logMetrics(operation, {
        path,
        size: result.ok ? result.value.byteLength : 0,
        duration,
        success: result.ok
      });
      
      // Warn if operation is slow (>100ms)
      if (duration > 100) {
        console.warn('[StorageMonitor Warning]', {
          operation,
          duration: Math.round(duration),
          path,
          threshold: 100,
          timestamp: new Date().toISOString()
        });
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      
      // Record failure metrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, false);
      
      this.logError(operation, error as Error, { path });
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `MonitoredStorageService.${operation} error: ${(error as Error).message}`,
        { operation, path },
        error as Error
      ));
    }
  }
  
  /**
   * List with monitoring
   */
  async listFiles(
    prefix: string, 
    options?: ListOptions
  ): Promise<Result<StorageFile[], StorageError>> {
    const start = performance.now();
    const operation = 'listFiles';
    
    try {
      const result = await this.wrapped.listFiles(prefix, options);
      const duration = performance.now() - start;
      
      // Record metrics with ServiceMetrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, result.ok);
      
      // Log metrics
      this.logMetrics(operation, {
        prefix,
        count: result.ok ? result.value.length : 0,
        duration,
        success: result.ok
      });
      
      // Warn if operation is slow (>100ms)
      if (duration > 100) {
        console.warn('[StorageMonitor Warning]', {
          operation,
          duration: Math.round(duration),
          prefix,
          threshold: 100,
          timestamp: new Date().toISOString()
        });
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      
      // Record failure metrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, false);
      
      this.logError(operation, error as Error, { prefix });
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `MonitoredStorageService.${operation} error: ${(error as Error).message}`,
        { operation, prefix },
        error as Error
      ));
    }
  }
  
  /**
   * Delete with monitoring
   */
  async deleteFile(path: string): Promise<Result<void, StorageError>> {
    const start = performance.now();
    const operation = 'deleteFile';
    
    try {
      const result = await this.wrapped.deleteFile(path);
      const duration = performance.now() - start;
      
      // Record metrics with ServiceMetrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, result.ok);
      
      // Log metrics
      this.logMetrics(operation, {
        path,
        duration,
        success: result.ok
      });
      
      // Warn if operation is slow (>100ms)
      if (duration > 100) {
        console.warn('[StorageMonitor Warning]', {
          operation,
          duration: Math.round(duration),
          path,
          threshold: 100,
          timestamp: new Date().toISOString()
        });
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      
      // Record failure metrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, false);
      
      this.logError(operation, error as Error, { path });
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `MonitoredStorageService.${operation} error: ${(error as Error).message}`,
        { operation, path },
        error as Error
      ));
    }
  }
  
  /**
   * Copy with monitoring
   */
  async copyDirectory(
    source: string, 
    destination: string
  ): Promise<Result<void, StorageError>> {
    const start = performance.now();
    const operation = 'copyDirectory';
    
    try {
      const result = await this.wrapped.copyDirectory(source, destination);
      const duration = performance.now() - start;
      
      // Record metrics with ServiceMetrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, result.ok);
      
      // Log metrics
      this.logMetrics(operation, {
        source,
        destination,
        duration,
        success: result.ok
      });
      
      // Warn if operation is slow (>100ms)
      if (duration > 100) {
        console.warn('[StorageMonitor Warning]', {
          operation,
          duration: Math.round(duration),
          source,
          destination,
          threshold: 100,
          timestamp: new Date().toISOString()
        });
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      
      // Record failure metrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, false);
      
      this.logError(operation, error as Error, { source, destination });
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `MonitoredStorageService.${operation} error: ${(error as Error).message}`,
        { operation, source, destination },
        error as Error
      ));
    }
  }
  
  /**
   * Exists check with monitoring
   */
  async exists(path: string): Promise<Result<boolean, StorageError>> {
    const start = performance.now();
    const operation = 'exists';
    
    try {
      const result = await this.wrapped.exists(path);
      const duration = performance.now() - start;
      
      // Record metrics with ServiceMetrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, result.ok);
      
      // Log metrics
      this.logMetrics(operation, {
        path,
        exists: result.ok ? result.value : null,
        duration,
        success: result.ok
      });
      
      // Warn if operation is slow (>100ms)
      if (duration > 100) {
        console.warn('[StorageMonitor Warning]', {
          operation,
          duration: Math.round(duration),
          path,
          threshold: 100,
          timestamp: new Date().toISOString()
        });
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      
      // Record failure metrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, false);
      
      this.logError(operation, error as Error, { path });
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `MonitoredStorageService.${operation} error: ${(error as Error).message}`,
        { operation, path },
        error as Error
      ));
    }
  }
  
  /**
   * Get metadata with monitoring
   */
  async getMetadata(path: string): Promise<Result<StorageMetadata, StorageError>> {
    const start = performance.now();
    const operation = 'getMetadata';
    
    try {
      const result = await this.wrapped.getMetadata(path);
      const duration = performance.now() - start;
      
      // Record metrics with ServiceMetrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, result.ok);
      
      // Log metrics
      this.logMetrics(operation, {
        path,
        size: result.ok ? result.value.size : 0,
        duration,
        success: result.ok
      });
      
      // Warn if operation is slow (>100ms)
      if (duration > 100) {
        console.warn('[StorageMonitor Warning]', {
          operation,
          duration: Math.round(duration),
          path,
          threshold: 100,
          timestamp: new Date().toISOString()
        });
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      
      // Record failure metrics
      ServiceMetrics.recordOperation('StorageService', operation, duration, false);
      
      this.logError(operation, error as Error, { path });
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `MonitoredStorageService.${operation} error: ${(error as Error).message}`,
        { operation, path },
        error as Error
      ));
    }
  }
  
  /**
   * Log operation metrics
   */
  private logMetrics(operation: string, metrics: Record<string, unknown>): void {
    // In production, this would send to monitoring service
    console.info('[StorageMonitor]', {
      operation,
      timestamp: new Date().toISOString(),
      ...metrics
    });
  }
  
  /**
   * Log operation errors
   */
  private logError(operation: string, error: Error, context: Record<string, unknown>): void {
    // In production, this would send to error tracking service
    console.error('[StorageMonitor Error]', {
      operation,
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
      ...context
    });
  }
}
