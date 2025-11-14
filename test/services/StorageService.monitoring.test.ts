/**
 * StorageService Monitoring Integration Tests - Part 4 of DAY3-TDD-STRATEGY
 * Tests for feature flag integration with monitoring
 * Verifies ServiceFactory correctly enables/disables monitoring
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Env } from '../../src/types/env';
import type { R2Bucket } from '@cloudflare/workers-types';
import { ServiceFactory } from '../../src/services/ServiceFactory';
import { ServiceMetrics } from '../../src/monitoring/ServiceMetrics';
import { MonitoredStorageService } from '../../src/services/MonitoredStorageService';
import { StorageService } from '../../src/services/StorageService';
import { Ok } from '../../src/lib/result';

describe('StorageService Monitoring Integration', () => {
  let mockBucket: R2Bucket;
  let baseEnv: Env;
  let consoleWarnSpy: any;

  beforeEach(() => {
    // Clear metrics before each test
    ServiceMetrics.clear();
    
    // Create mock R2 bucket
    mockBucket = {
      put: vi.fn().mockResolvedValue({
        key: 'test-key',
        version: '1',
        size: 100,
        uploaded: new Date()
      }),
      get: vi.fn().mockResolvedValue({
        body: new ArrayBuffer(100),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
        customMetadata: {}
      }),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({
        objects: [],
        truncated: false
      }),
      head: vi.fn().mockResolvedValue({
        key: 'test-key',
        size: 100,
        uploaded: new Date()
      }),
      createMultipartUpload: vi.fn(),
      resumeMultipartUpload: vi.fn()
    } as any;

    // Base environment
    baseEnv = {
      PROJECTS_BUCKET: mockBucket,
      MVP_ACCESS_TOKEN: 'test-token'
    } as Env;

    // Spy on console.warn
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Feature Flag Integration', () => {
    it('should enable monitoring when useMonitoring flag is true', async () => {
      // Arrange
      const env: Env = {
        ...baseEnv,
        FEATURE_FLAGS: JSON.stringify({
          useNewStorageService: true,
          useMonitoring: true
        })
      };

      // Act
      const service = ServiceFactory.getStorageService(env);
      
      // Assert - Service should be wrapped with monitoring
      expect(service).toBeInstanceOf(MonitoredStorageService);
      
      // Verify monitoring works
      await service.uploadFile('test.txt', new ArrayBuffer(100));
      
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.uploadFile.success.count']).toBe(1);
    });

    it('should disable monitoring when useMonitoring flag is false', async () => {
      // Arrange
      const env: Env = {
        ...baseEnv,
        FEATURE_FLAGS: JSON.stringify({
          useNewStorageService: true,
          useMonitoring: false
        })
      };

      // Act
      const service = ServiceFactory.getStorageService(env);
      
      // Assert - Service should NOT be wrapped with monitoring
      expect(service).toBeInstanceOf(StorageService);
      expect(service).not.toBeInstanceOf(MonitoredStorageService);
      
      // Verify no metrics are collected
      await service.uploadFile('test.txt', new ArrayBuffer(100));
      
      const metrics = ServiceMetrics.getMetrics();
      expect(Object.keys(metrics)).toHaveLength(0);
    });

    it('should disable monitoring by default when flag is not set', async () => {
      // Arrange
      const env: Env = {
        ...baseEnv,
        FEATURE_FLAGS: JSON.stringify({
          useNewStorageService: true
          // useMonitoring not specified
        })
      };

      // Act
      const service = ServiceFactory.getStorageService(env);
      
      // Assert
      expect(service).toBeInstanceOf(StorageService);
      expect(service).not.toBeInstanceOf(MonitoredStorageService);
    });

    it('should handle malformed FEATURE_FLAGS gracefully', async () => {
      // Arrange
      const env: Env = {
        ...baseEnv,
        FEATURE_FLAGS: '{not-valid-json}' as any
      };

      // Act
      const service = ServiceFactory.getStorageService(env);
      
      // Assert - Should fall back to legacy (non-monitored)
      expect(service).not.toBeInstanceOf(MonitoredStorageService);
    });

    it('should use legacy env vars as fallback', async () => {
      // Arrange - Use legacy env vars
      const env: Env = {
        ...baseEnv,
        FEATURE_NEW_STORAGE: 'true',
        FEATURE_MONITORING: 'true'
      } as any;

      // Act
      const service = ServiceFactory.getStorageService(env);
      
      // Assert
      expect(service).toBeInstanceOf(MonitoredStorageService);
    });
  });

  describe('Performance Monitoring', () => {
    it('should detect and warn about slow operations when monitoring enabled', async () => {
      // Arrange
      const env: Env = {
        ...baseEnv,
        FEATURE_FLAGS: JSON.stringify({
          useNewStorageService: true,
          useMonitoring: true
        })
      };

      // Mock slow operation
      mockBucket.put = vi.fn().mockImplementation(
        () => new Promise(resolve => 
          setTimeout(() => resolve({
            key: 'test-key',
            version: '1',
            size: 100,
            uploaded: new Date()
          }), 150)
        )
      );

      // Act
      const service = ServiceFactory.getStorageService(env);
      await service.uploadFile('slow.txt', new ArrayBuffer(100));

      // Assert - Should have warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[StorageMonitor Warning]',
        expect.objectContaining({
          operation: 'uploadFile',
          threshold: 100
        })
      );

      // Should have slow operation in metrics
      const slowOps = ServiceMetrics.getSlowOperations(100);
      expect(slowOps).toHaveLength(1);
      expect(slowOps[0].operation).toBe('uploadFile');
    });

    it('should not warn when monitoring is disabled', async () => {
      // Arrange
      const env: Env = {
        ...baseEnv,
        FEATURE_FLAGS: JSON.stringify({
          useNewStorageService: true,
          useMonitoring: false
        })
      };

      // Mock slow operation
      mockBucket.put = vi.fn().mockImplementation(
        () => new Promise(resolve => 
          setTimeout(() => resolve({
            key: 'test-key',
            version: '1',
            size: 100,
            uploaded: new Date()
          }), 150)
        )
      );

      // Act
      const service = ServiceFactory.getStorageService(env);
      await service.uploadFile('slow.txt', new ArrayBuffer(100));

      // Assert - No warning because monitoring is disabled
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      
      // No metrics collected
      const metrics = ServiceMetrics.getMetrics();
      expect(Object.keys(metrics)).toHaveLength(0);
    });
  });

  describe('Success Rate Tracking', () => {
    it('should track success rates when monitoring enabled', async () => {
      // Arrange
      const env: Env = {
        ...baseEnv,
        FEATURE_FLAGS: JSON.stringify({
          useNewStorageService: true,
          useMonitoring: true
        })
      };

      // Mock mixed results
      mockBucket.delete = vi.fn()
        .mockResolvedValueOnce(undefined) // Success
        .mockResolvedValueOnce(undefined) // Success
        .mockRejectedValueOnce(new Error('Not found')); // Failure

      // Act
      const service = ServiceFactory.getStorageService(env);
      await service.deleteFile('file1.txt');
      await service.deleteFile('file2.txt');
      await service.deleteFile('file3.txt').catch(() => {}); // Ignore error

      // Assert
      const successRate = ServiceMetrics.getSuccessRate('StorageService', 'deleteFile');
      expect(successRate).toBeCloseTo(0.667, 2); // 2/3 = 66.7%
    });

    it('should not track metrics when monitoring disabled', async () => {
      // Arrange
      const env: Env = {
        ...baseEnv,
        FEATURE_FLAGS: JSON.stringify({
          useNewStorageService: true,
          useMonitoring: false
        })
      };

      // Act
      const service = ServiceFactory.getStorageService(env);
      await service.deleteFile('file1.txt');

      // Assert
      const successRate = ServiceMetrics.getSuccessRate('StorageService', 'deleteFile');
      expect(successRate).toBeNull(); // No data
    });
  });

  describe('Metrics Aggregation', () => {
    it('should aggregate metrics across multiple operations', async () => {
      // Arrange
      const env: Env = {
        ...baseEnv,
        FEATURE_FLAGS: JSON.stringify({
          useNewStorageService: true,
          useMonitoring: true
        })
      };

      // Act
      const service = ServiceFactory.getStorageService(env);
      
      // Perform multiple operations
      await service.uploadFile('file1.txt', new ArrayBuffer(100));
      await service.uploadFile('file2.txt', new ArrayBuffer(200));
      await service.downloadFile('file1.txt');
      await service.listFiles('test/');
      await service.exists('file1.txt');

      // Assert - Check total operation count
      const totalOps = ServiceMetrics.getTotalOperationCount();
      expect(totalOps).toBe(5);

      // Check service-specific metrics
      const serviceMetrics = ServiceMetrics.getServiceMetrics('StorageService');
      expect(serviceMetrics['StorageService.uploadFile.success.count']).toBe(2);
      expect(serviceMetrics['StorageService.downloadFile.success.count']).toBe(1);
      expect(serviceMetrics['StorageService.listFiles.success.count']).toBe(1);
      expect(serviceMetrics['StorageService.exists.success.count']).toBe(1);
    });

    it('should calculate overall average duration', async () => {
      // Arrange
      const env: Env = {
        ...baseEnv,
        FEATURE_FLAGS: JSON.stringify({
          useNewStorageService: true,
          useMonitoring: true
        })
      };

      // Act
      const service = ServiceFactory.getStorageService(env);
      
      // Perform operations
      await service.uploadFile('file1.txt', new ArrayBuffer(100));
      await service.downloadFile('file1.txt');
      await service.exists('file1.txt');

      // Assert
      const avgDuration = ServiceMetrics.getOverallAverageDuration();
      expect(avgDuration).toBeGreaterThanOrEqual(0);
      expect(avgDuration).toBeLessThan(100); // Should be fast for mocked operations
    });
  });

  describe('Monitoring Overhead', () => {
    it('should have minimal performance overhead', async () => {
      // Arrange
      const envWithMonitoring: Env = {
        ...baseEnv,
        FEATURE_FLAGS: JSON.stringify({
          useNewStorageService: true,
          useMonitoring: true
        })
      };

      const envWithoutMonitoring: Env = {
        ...baseEnv,
        FEATURE_FLAGS: JSON.stringify({
          useNewStorageService: true,
          useMonitoring: false
        })
      };

      // Act - Measure with monitoring
      const monitoredService = ServiceFactory.getStorageService(envWithMonitoring);
      const startMonitored = performance.now();
      await monitoredService.uploadFile('test.txt', new ArrayBuffer(100));
      const durationMonitored = performance.now() - startMonitored;

      // Act - Measure without monitoring
      const plainService = ServiceFactory.getStorageService(envWithoutMonitoring);
      const startPlain = performance.now();
      await plainService.uploadFile('test.txt', new ArrayBuffer(100));
      const durationPlain = performance.now() - startPlain;

      // Assert - Overhead should be minimal (<10ms)
      const overhead = durationMonitored - durationPlain;
      expect(overhead).toBeLessThan(10);
    });
  });
});