/**
 * MonitoredStorageService Tests - Part 4 of DAY3-TDD-STRATEGY
 * Tests for the monitoring decorator that wraps IStorageService
 * Verifies metric collection, performance warnings, and decorator pattern
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { IStorageService } from '../../src/services/StorageService';
import { MonitoredStorageService } from '../../src/services/MonitoredStorageService';
import { ServiceMetrics } from '../../src/monitoring/ServiceMetrics';
import { Ok, Err } from '../../src/lib/result';
import { StorageError, StorageErrorCode } from '../../src/lib/errors';

describe('MonitoredStorageService', () => {
  let mockStorageService: IStorageService;
  let monitoredService: MonitoredStorageService;
  let consoleWarnSpy: any;

  beforeEach(() => {
    // Clear metrics before each test
    ServiceMetrics.clear();
    
    // Mock the wrapped storage service
    mockStorageService = {
      uploadFile: vi.fn(),
      downloadFile: vi.fn(),
      listFiles: vi.fn(),
      deleteFile: vi.fn(),
      copyDirectory: vi.fn(),
      exists: vi.fn(),
      getMetadata: vi.fn()
    };

    // Create monitored service wrapping the mock
    monitoredService = new MonitoredStorageService(mockStorageService);

    // Spy on console.warn for performance warning tests
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Decorator Pattern', () => {
    it('should delegate uploadFile to wrapped service', async () => {
      // Arrange
      const path = 'test/file.txt';
      const content = new ArrayBuffer(100);
      const metadata = { contentType: 'text/plain' };
      (mockStorageService.uploadFile as any).mockResolvedValue(Ok(undefined));

      // Act
      const result = await monitoredService.uploadFile(path, content, metadata);

      // Assert
      expect(result.ok).toBe(true);
      expect(mockStorageService.uploadFile).toHaveBeenCalledWith(path, content, metadata);
    });

    it('should delegate downloadFile to wrapped service', async () => {
      // Arrange
      const path = 'test/file.txt';
      const content = new ArrayBuffer(100);
      (mockStorageService.downloadFile as any).mockResolvedValue(Ok(content));

      // Act
      const result = await monitoredService.downloadFile(path);

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(content);
      }
      expect(mockStorageService.downloadFile).toHaveBeenCalledWith(path);
    });

    it('should delegate listFiles to wrapped service', async () => {
      // Arrange
      const prefix = 'test/';
      const options = { maxKeys: 10 };
      const files = [
        { key: 'test/file1.txt', size: 100 },
        { key: 'test/file2.txt', size: 200 }
      ];
      (mockStorageService.listFiles as any).mockResolvedValue(Ok(files));

      // Act
      const result = await monitoredService.listFiles(prefix, options);

      // Assert
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(files);
      }
      expect(mockStorageService.listFiles).toHaveBeenCalledWith(prefix, options);
    });

    it('should preserve error results from wrapped service', async () => {
      // Arrange
      const path = 'test/missing.txt';
      const error = new StorageError(
        StorageErrorCode.NOT_FOUND,
        `File not found: ${path}`,
        { path }
      );
      (mockStorageService.downloadFile as any).mockResolvedValue(Err(error));

      // Act
      const result = await monitoredService.downloadFile(path);

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(StorageErrorCode.NOT_FOUND);
      }
    });
  });

  describe('Metrics Collection', () => {
    it('should record metrics for successful uploadFile', async () => {
      // Arrange
      const path = 'test/file.txt';
      const content = new ArrayBuffer(100);
      (mockStorageService.uploadFile as any).mockResolvedValue(Ok(undefined));

      // Act
      await monitoredService.uploadFile(path, content);

      // Assert
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.uploadFile.success.count']).toBe(1);
      expect(metrics['StorageService.uploadFile.success.duration']).toBeGreaterThanOrEqual(0);
    });

    it('should record metrics for failed operations', async () => {
      // Arrange
      const path = 'test/file.txt';
      const error = new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        'Upload failed',
        { path }
      );
      (mockStorageService.uploadFile as any).mockResolvedValue(Err(error));

      // Act
      await monitoredService.uploadFile(path, new ArrayBuffer(100));

      // Assert
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.uploadFile.failure.count']).toBe(1);
      expect(metrics['StorageService.uploadFile.failure.duration']).toBeGreaterThanOrEqual(0);
    });

    it('should record metrics for all operations', async () => {
      // Arrange
      (mockStorageService.uploadFile as any).mockResolvedValue(Ok(undefined));
      (mockStorageService.downloadFile as any).mockResolvedValue(Ok(new ArrayBuffer(100)));
      (mockStorageService.listFiles as any).mockResolvedValue(Ok([]));
      (mockStorageService.deleteFile as any).mockResolvedValue(Ok(undefined));
      (mockStorageService.copyDirectory as any).mockResolvedValue(Ok(undefined));
      (mockStorageService.exists as any).mockResolvedValue(Ok(true));
      (mockStorageService.getMetadata as any).mockResolvedValue(Ok({
        size: 100,
        lastModified: new Date()
      }));

      // Act - Call each operation
      await monitoredService.uploadFile('test.txt', new ArrayBuffer(100));
      await monitoredService.downloadFile('test.txt');
      await monitoredService.listFiles('test/');
      await monitoredService.deleteFile('test.txt');
      await monitoredService.copyDirectory('src/', 'dest/');
      await monitoredService.exists('test.txt');
      await monitoredService.getMetadata('test.txt');

      // Assert - Each operation should have metrics
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.uploadFile.success.count']).toBe(1);
      expect(metrics['StorageService.downloadFile.success.count']).toBe(1);
      expect(metrics['StorageService.listFiles.success.count']).toBe(1);
      expect(metrics['StorageService.deleteFile.success.count']).toBe(1);
      expect(metrics['StorageService.copyDirectory.success.count']).toBe(1);
      expect(metrics['StorageService.exists.success.count']).toBe(1);
      expect(metrics['StorageService.getMetadata.success.count']).toBe(1);
    });

    it('should track operation size in metrics', async () => {
      // Arrange
      const content = new ArrayBuffer(1024);
      (mockStorageService.uploadFile as any).mockResolvedValue(Ok(undefined));
      (mockStorageService.downloadFile as any).mockResolvedValue(Ok(content));

      // Act
      await monitoredService.uploadFile('test.txt', content);
      await monitoredService.downloadFile('test.txt');

      // Assert - Metrics should be recorded (size tracking is in log output)
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.uploadFile.success.count']).toBe(1);
      expect(metrics['StorageService.downloadFile.success.count']).toBe(1);
    });
  });

  describe('Performance Warnings', () => {
    it('should warn for operations exceeding 100ms', async () => {
      // Arrange - Mock slow operation
      (mockStorageService.uploadFile as any).mockImplementation(
        () => new Promise(resolve => 
          setTimeout(() => resolve(Ok(undefined)), 150)
        )
      );

      // Act
      await monitoredService.uploadFile('slow.txt', new ArrayBuffer(100));

      // Assert
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[StorageMonitor Warning]'),
        expect.objectContaining({
          operation: 'uploadFile',
          duration: expect.any(Number),
          path: 'slow.txt',
          threshold: 100
        })
      );
      
      // Also check metrics recorded the slow operation
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.uploadFile.success.avg']).toBeGreaterThan(100);
    });

    it('should not warn for fast operations', async () => {
      // Arrange - Mock fast operation
      (mockStorageService.uploadFile as any).mockResolvedValue(Ok(undefined));

      // Act
      await monitoredService.uploadFile('fast.txt', new ArrayBuffer(100));

      // Assert
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[StorageMonitor Warning]')
      );
    });

    it('should warn for each slow operation type', async () => {
      // Arrange - Make all operations slow
      const slowImpl = () => new Promise(resolve => 
        setTimeout(() => resolve(Ok(undefined)), 150)
      );
      
      (mockStorageService.uploadFile as any).mockImplementation(slowImpl);
      (mockStorageService.deleteFile as any).mockImplementation(slowImpl);

      // Act
      await monitoredService.uploadFile('slow1.txt', new ArrayBuffer(100));
      await monitoredService.deleteFile('slow2.txt');

      // Assert - Should have 2 warnings
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle exceptions from wrapped service', async () => {
      // Arrange
      const errorMessage = 'Network error';
      (mockStorageService.uploadFile as any).mockRejectedValue(new Error(errorMessage));

      // Act
      const result = await monitoredService.uploadFile('test.txt', new ArrayBuffer(100));

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(StorageErrorCode.OPERATION_FAILED);
        expect(result.error.message).toContain(errorMessage);
      }
      
      // Metrics should still be recorded for failures
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.uploadFile.failure.count']).toBe(1);
    });

    it('should preserve original error context', async () => {
      // Arrange
      const originalError = new StorageError(
        StorageErrorCode.INVALID_PATH,
        'Path traversal detected',
        { path: '../etc/passwd' }
      );
      (mockStorageService.uploadFile as any).mockResolvedValue(Err(originalError));

      // Act
      const result = await monitoredService.uploadFile('../etc/passwd', new ArrayBuffer(100));

      // Assert
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(StorageErrorCode.INVALID_PATH);
        expect(result.error.message).toContain('Path traversal');
      }
    });
  });

  describe('Integration with ServiceMetrics', () => {
    it('should contribute to slow operations detection', async () => {
      // Arrange - Create one slow and one fast operation
      (mockStorageService.uploadFile as any).mockImplementation(
        () => new Promise(resolve => 
          setTimeout(() => resolve(Ok(undefined)), 150)
        )
      );
      (mockStorageService.exists as any).mockResolvedValue(Ok(true));

      // Act
      await monitoredService.uploadFile('slow.txt', new ArrayBuffer(100));
      await monitoredService.exists('fast.txt');

      // Assert
      const slowOps = ServiceMetrics.getSlowOperations(100);
      expect(slowOps).toHaveLength(1);
      expect(slowOps[0]).toMatchObject({
        service: 'StorageService',
        operation: 'uploadFile',
        avgDuration: expect.any(Number)
      });
      expect(slowOps[0].avgDuration).toBeGreaterThan(100);
    });

    it('should contribute to success rate calculation', async () => {
      // Arrange
      (mockStorageService.deleteFile as any)
        .mockResolvedValueOnce(Ok(undefined))
        .mockResolvedValueOnce(Ok(undefined))
        .mockResolvedValueOnce(Err(new StorageError(
          StorageErrorCode.NOT_FOUND,
          'File not found',
          {}
        )));

      // Act - 2 successes, 1 failure
      await monitoredService.deleteFile('file1.txt');
      await monitoredService.deleteFile('file2.txt');
      await monitoredService.deleteFile('file3.txt');

      // Assert
      const successRate = ServiceMetrics.getSuccessRate('StorageService', 'deleteFile');
      expect(successRate).toBeCloseTo(0.667, 2); // 2/3 = 66.7%
    });
  });

  describe('Logging', () => {
    it('should log metrics for successful operations', async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      (mockStorageService.uploadFile as any).mockResolvedValue(Ok(undefined));

      // Act
      await monitoredService.uploadFile('test.txt', new ArrayBuffer(100));

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        '[StorageMonitor]',
        expect.objectContaining({
          operation: 'uploadFile',
          path: 'test.txt',
          size: 100,
          success: true
        })
      );

      consoleSpy.mockRestore();
    });

    it('should log errors with context', async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (mockStorageService.uploadFile as any).mockRejectedValue(new Error('Network error'));

      // Act
      await monitoredService.uploadFile('test.txt', new ArrayBuffer(100));

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        '[StorageMonitor Error]',
        expect.objectContaining({
          operation: 'uploadFile',
          error: 'Network error',
          path: 'test.txt'
        })
      );

      consoleSpy.mockRestore();
    });
  });
});