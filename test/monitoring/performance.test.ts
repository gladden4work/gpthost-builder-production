/**
 * Performance Tests - Part 4 of DAY3-TDD-STRATEGY
 * Validates that operations meet <100ms performance target
 * Tests concurrent operations and memory usage
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { StorageService } from '../../src/services/StorageService';
import { MonitoredStorageService } from '../../src/services/MonitoredStorageService';
import { ServiceMetrics } from '../../src/monitoring/ServiceMetrics';
import { Ok } from '../../src/lib/result';

describe('Performance Tests', () => {
  let mockBucket: R2Bucket;
  let storageService: StorageService;
  let monitoredService: MonitoredStorageService;

  beforeEach(() => {
    // Clear metrics
    ServiceMetrics.clear();
    
    // Create mock R2 bucket with realistic timing
    mockBucket = {
      put: vi.fn().mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            key: 'test-key',
            version: '1',
            size: 100,
            uploaded: new Date()
          }), 20) // Simulate 20ms network latency
        )
      ),
      get: vi.fn().mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            body: new ArrayBuffer(100),
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
            customMetadata: {}
          }), 25) // Simulate 25ms network latency
        )
      ),
      delete: vi.fn().mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve(undefined), 15) // Simulate 15ms network latency
        )
      ),
      list: vi.fn().mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            objects: [
              { key: 'file1.txt', size: 100, uploaded: new Date() },
              { key: 'file2.txt', size: 200, uploaded: new Date() }
            ],
            truncated: false
          }), 30) // Simulate 30ms network latency
        )
      ),
      head: vi.fn().mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            key: 'test-key',
            size: 100,
            uploaded: new Date()
          }), 10) // Simulate 10ms network latency
        )
      ),
      createMultipartUpload: vi.fn(),
      resumeMultipartUpload: vi.fn()
    } as any;

    storageService = new StorageService(mockBucket);
    monitoredService = new MonitoredStorageService(storageService);
  });

  describe('Individual Operation Performance', () => {
    it('should complete uploadFile in <100ms', async () => {
      // Act
      const start = performance.now();
      const result = await monitoredService.uploadFile('test.txt', new ArrayBuffer(1024));
      const duration = performance.now() - start;

      // Assert
      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(100);
      
      // Check metrics
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.uploadFile.success.avg']).toBeLessThan(100);
    });

    it('should complete downloadFile in <100ms', async () => {
      // Act
      const start = performance.now();
      const result = await monitoredService.downloadFile('test.txt');
      const duration = performance.now() - start;

      // Assert
      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(100);
      
      // Check metrics
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.downloadFile.success.avg']).toBeLessThan(100);
    });

    it('should complete listFiles in <100ms', async () => {
      // Act
      const start = performance.now();
      const result = await monitoredService.listFiles('test/');
      const duration = performance.now() - start;

      // Assert
      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(100);
      
      // Check metrics
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.listFiles.success.avg']).toBeLessThan(100);
    });

    it('should complete deleteFile in <100ms', async () => {
      // Act
      const start = performance.now();
      const result = await monitoredService.deleteFile('test.txt');
      const duration = performance.now() - start;

      // Assert
      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(100);
      
      // Check metrics
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.deleteFile.success.avg']).toBeLessThan(100);
    });

    it('should complete exists check in <100ms', async () => {
      // Act
      const start = performance.now();
      const result = await monitoredService.exists('test.txt');
      const duration = performance.now() - start;

      // Assert
      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(100);
      
      // Check metrics
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.exists.success.avg']).toBeLessThan(100);
    });

    it('should complete getMetadata in <100ms', async () => {
      // Act
      const start = performance.now();
      const result = await monitoredService.getMetadata('test.txt');
      const duration = performance.now() - start;

      // Assert
      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(100);
      
      // Check metrics
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.getMetadata.success.avg']).toBeLessThan(100);
    });
  });

  describe('Concurrent Operations Performance', () => {
    it('should handle 10 concurrent uploads efficiently', async () => {
      // Arrange
      const operations = Array.from({ length: 10 }, (_, i) => ({
        path: `file-${i}.txt`,
        content: new ArrayBuffer(1024)
      }));

      // Act
      const start = performance.now();
      const results = await Promise.all(
        operations.map(op => monitoredService.uploadFile(op.path, op.content))
      );
      const duration = performance.now() - start;

      // Assert
      expect(results.every(r => r.ok)).toBe(true);
      expect(duration).toBeLessThan(200); // All 10 operations in <200ms
      
      // Check individual operation averages
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.uploadFile.success.count']).toBe(10);
      expect(metrics['StorageService.uploadFile.success.avg']).toBeLessThan(100);
    });

    it('should handle mixed concurrent operations', async () => {
      // Arrange
      const operations = [
        monitoredService.uploadFile('upload.txt', new ArrayBuffer(100)),
        monitoredService.downloadFile('download.txt'),
        monitoredService.listFiles('list/'),
        monitoredService.deleteFile('delete.txt'),
        monitoredService.exists('exists.txt'),
        monitoredService.getMetadata('metadata.txt')
      ];

      // Act
      const start = performance.now();
      const results = await Promise.all(operations);
      const duration = performance.now() - start;

      // Assert
      expect(results.every(r => r.ok)).toBe(true);
      expect(duration).toBeLessThan(150); // All operations complete quickly
      
      // Check overall metrics
      const totalOps = ServiceMetrics.getTotalOperationCount();
      expect(totalOps).toBe(6);
      
      const avgDuration = ServiceMetrics.getOverallAverageDuration();
      expect(avgDuration).toBeLessThan(100);
    });

    it('should maintain performance under sustained load', async () => {
      // Arrange - 50 operations in batches
      const batchSize = 10;
      const numBatches = 5;
      
      // Act
      const start = performance.now();
      
      for (let batch = 0; batch < numBatches; batch++) {
        const operations = Array.from({ length: batchSize }, (_, i) => 
          monitoredService.uploadFile(`batch-${batch}-file-${i}.txt`, new ArrayBuffer(100))
        );
        await Promise.all(operations);
      }
      
      const duration = performance.now() - start;

      // Assert
      expect(duration).toBeLessThan(1000); // 50 operations in <1 second
      
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.uploadFile.success.count']).toBe(50);
      expect(metrics['StorageService.uploadFile.success.avg']).toBeLessThan(100);
    });
  });

  describe('Memory Usage', () => {
    it('should not leak memory with metric collection', async () => {
      // Note: This is a basic test. Real memory profiling would require tools like heap snapshots
      
      // Arrange - Track initial metrics count
      ServiceMetrics.clear();
      
      // Act - Perform many operations
      for (let i = 0; i < 100; i++) {
        await monitoredService.uploadFile(`file-${i}.txt`, new ArrayBuffer(100));
      }
      
      // Assert - Metrics should be aggregated, not growing unbounded
      const metrics = ServiceMetrics.getMetrics();
      const metricKeys = Object.keys(metrics);
      
      // Should have 3 keys per operation type (count, duration, avg), not 300
      expect(metricKeys.length).toBeLessThan(10);
      expect(metrics['StorageService.uploadFile.success.count']).toBe(100);
    });

    it('should handle large file operations efficiently', async () => {
      // Arrange - 10MB file
      const largeContent = new ArrayBuffer(10 * 1024 * 1024);
      
      // Act
      const start = performance.now();
      const result = await monitoredService.uploadFile('large.bin', largeContent);
      const duration = performance.now() - start;

      // Assert
      expect(result.ok).toBe(true);
      expect(duration).toBeLessThan(100); // Should still be fast (mocked)
    });
  });

  describe('Performance Degradation Detection', () => {
    it('should identify operations that exceed threshold', async () => {
      // Arrange - Make some operations slow
      mockBucket.put = vi.fn().mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            key: 'test-key',
            version: '1',
            size: 100,
            uploaded: new Date()
          }), 150) // Slow operation
        )
      );

      // Act
      await monitoredService.uploadFile('slow1.txt', new ArrayBuffer(100));
      await monitoredService.uploadFile('slow2.txt', new ArrayBuffer(100));
      await monitoredService.exists('fast.txt'); // This will be fast

      // Assert
      const slowOps = ServiceMetrics.getSlowOperations(100);
      expect(slowOps).toHaveLength(1);
      expect(slowOps[0].operation).toBe('uploadFile');
      expect(slowOps[0].avgDuration).toBeGreaterThan(100);
    });

    it('should track success rate under load', async () => {
      // Arrange - Make some operations fail
      let callCount = 0;
      mockBucket.delete = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount % 3 === 0) {
          return Promise.reject(new Error('Simulated failure'));
        }
        return Promise.resolve(undefined);
      });

      // Act - Perform 10 operations (3 will fail)
      const operations = Array.from({ length: 10 }, (_, i) => 
        monitoredService.deleteFile(`file-${i}.txt`).catch(() => {})
      );
      await Promise.all(operations);

      // Assert
      const successRate = ServiceMetrics.getSuccessRate('StorageService', 'deleteFile');
      expect(successRate).toBeCloseTo(0.7, 1); // ~70% success rate
    });
  });

  describe('Monitoring Overhead', () => {
    it('should add minimal overhead to operations', async () => {
      // Compare raw service vs monitored service
      const iterations = 10;
      
      // Measure raw service
      const rawStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        await storageService.uploadFile(`raw-${i}.txt`, new ArrayBuffer(100));
      }
      const rawDuration = performance.now() - rawStart;
      
      // Measure monitored service
      const monitoredStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        await monitoredService.uploadFile(`monitored-${i}.txt`, new ArrayBuffer(100));
      }
      const monitoredDuration = performance.now() - monitoredStart;
      
      // Calculate overhead
      const overhead = monitoredDuration - rawDuration;
      const overheadPercentage = (overhead / rawDuration) * 100;
      
      // Assert - Overhead should be less than 10%
      expect(overheadPercentage).toBeLessThan(10);
    });
  });
});