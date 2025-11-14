/**
 * ServiceMetrics Tests - Part 4 of DAY3-TDD-STRATEGY
 * Tests for the metrics collection system that tracks operation performance
 * RED phase: Writing tests first before implementation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ServiceMetrics } from '../../src/monitoring/ServiceMetrics';

describe('ServiceMetrics', () => {
  beforeEach(() => {
    // Clear metrics before each test
    ServiceMetrics.clear();
  });

  describe('recordOperation', () => {
    it('should record successful operation metrics', () => {
      // Act
      ServiceMetrics.recordOperation(
        'StorageService',
        'uploadFile',
        50, // 50ms duration
        true // success
      );

      // Assert
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.uploadFile.success.count']).toBe(1);
      expect(metrics['StorageService.uploadFile.success.duration']).toBe(50);
      expect(metrics['StorageService.uploadFile.success.avg']).toBe(50);
    });

    it('should record failed operation metrics', () => {
      // Act
      ServiceMetrics.recordOperation(
        'StorageService',
        'downloadFile',
        120, // 120ms duration
        false // failure
      );

      // Assert
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.downloadFile.failure.count']).toBe(1);
      expect(metrics['StorageService.downloadFile.failure.duration']).toBe(120);
      expect(metrics['StorageService.downloadFile.failure.avg']).toBe(120);
    });

    it('should accumulate metrics for multiple operations', () => {
      // Act - Record 3 successful operations with different durations
      ServiceMetrics.recordOperation('StorageService', 'listFiles', 30, true);
      ServiceMetrics.recordOperation('StorageService', 'listFiles', 50, true);
      ServiceMetrics.recordOperation('StorageService', 'listFiles', 70, true);

      // Assert
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.listFiles.success.count']).toBe(3);
      expect(metrics['StorageService.listFiles.success.duration']).toBe(150); // 30+50+70
      expect(metrics['StorageService.listFiles.success.avg']).toBe(50); // 150/3
    });

    it('should track success and failure metrics separately', () => {
      // Act
      ServiceMetrics.recordOperation('StorageService', 'deleteFile', 40, true);
      ServiceMetrics.recordOperation('StorageService', 'deleteFile', 60, true);
      ServiceMetrics.recordOperation('StorageService', 'deleteFile', 200, false);

      // Assert
      const metrics = ServiceMetrics.getMetrics();
      
      // Success metrics
      expect(metrics['StorageService.deleteFile.success.count']).toBe(2);
      expect(metrics['StorageService.deleteFile.success.duration']).toBe(100);
      expect(metrics['StorageService.deleteFile.success.avg']).toBe(50);
      
      // Failure metrics
      expect(metrics['StorageService.deleteFile.failure.count']).toBe(1);
      expect(metrics['StorageService.deleteFile.failure.duration']).toBe(200);
      expect(metrics['StorageService.deleteFile.failure.avg']).toBe(200);
    });

    it('should handle metrics for different services independently', () => {
      // Act
      ServiceMetrics.recordOperation('StorageService', 'uploadFile', 30, true);
      ServiceMetrics.recordOperation('ProjectService', 'createProject', 150, true);
      ServiceMetrics.recordOperation('GitHubService', 'triggerWorkflow', 2000, false);

      // Assert
      const metrics = ServiceMetrics.getMetrics();
      
      expect(metrics['StorageService.uploadFile.success.count']).toBe(1);
      expect(metrics['ProjectService.createProject.success.count']).toBe(1);
      expect(metrics['GitHubService.triggerWorkflow.failure.count']).toBe(1);
    });
  });

  describe('getMetrics', () => {
    it('should return empty object when no metrics recorded', () => {
      // Act
      const metrics = ServiceMetrics.getMetrics();

      // Assert
      expect(metrics).toEqual({});
    });

    it('should calculate averages correctly for all operations', () => {
      // Arrange - Record multiple operations with varying durations
      const operations = [
        { service: 'StorageService', op: 'uploadFile', duration: 20, success: true },
        { service: 'StorageService', op: 'uploadFile', duration: 30, success: true },
        { service: 'StorageService', op: 'uploadFile', duration: 40, success: true },
        { service: 'StorageService', op: 'downloadFile', duration: 100, success: false },
        { service: 'StorageService', op: 'downloadFile', duration: 150, success: false },
      ];

      operations.forEach(({ service, op, duration, success }) => {
        ServiceMetrics.recordOperation(service, op, duration, success);
      });

      // Act
      const metrics = ServiceMetrics.getMetrics();

      // Assert
      expect(metrics['StorageService.uploadFile.success.avg']).toBe(30); // (20+30+40)/3
      expect(metrics['StorageService.downloadFile.failure.avg']).toBe(125); // (100+150)/2
    });

    it('should include all metric types in response', () => {
      // Act
      ServiceMetrics.recordOperation('TestService', 'testOp', 100, true);
      const metrics = ServiceMetrics.getMetrics();

      // Assert - Check that all expected keys are present
      expect(metrics).toHaveProperty('TestService.testOp.success.count');
      expect(metrics).toHaveProperty('TestService.testOp.success.duration');
      expect(metrics).toHaveProperty('TestService.testOp.success.avg');
    });

    it('should handle edge case of zero duration', () => {
      // Act
      ServiceMetrics.recordOperation('StorageService', 'exists', 0, true);

      // Assert
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.exists.success.duration']).toBe(0);
      expect(metrics['StorageService.exists.success.avg']).toBe(0);
    });

    it('should handle very large durations', () => {
      // Act
      ServiceMetrics.recordOperation('StorageService', 'copyDirectory', 10000, true);

      // Assert
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.copyDirectory.success.duration']).toBe(10000);
      expect(metrics['StorageService.copyDirectory.success.avg']).toBe(10000);
    });
  });

  describe('clear', () => {
    it('should clear all recorded metrics', () => {
      // Arrange
      ServiceMetrics.recordOperation('StorageService', 'uploadFile', 50, true);
      ServiceMetrics.recordOperation('StorageService', 'downloadFile', 100, false);
      
      // Act
      ServiceMetrics.clear();
      
      // Assert
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics).toEqual({});
    });
  });

  describe('Performance threshold detection', () => {
    it('should identify slow operations (>100ms)', () => {
      // Act
      ServiceMetrics.recordOperation('StorageService', 'uploadFile', 50, true);  // Fast
      ServiceMetrics.recordOperation('StorageService', 'downloadFile', 150, true); // Slow
      ServiceMetrics.recordOperation('StorageService', 'listFiles', 200, false);  // Slow

      // Assert - Get slow operations
      const slowOps = ServiceMetrics.getSlowOperations(100);
      
      expect(slowOps).toHaveLength(2);
      expect(slowOps).toContainEqual({
        service: 'StorageService',
        operation: 'downloadFile',
        avgDuration: 150,
        count: 1
      });
      expect(slowOps).toContainEqual({
        service: 'StorageService',
        operation: 'listFiles',
        avgDuration: 200,
        count: 1
      });
    });

    it('should calculate success rate for operations', () => {
      // Act - Mix of successes and failures
      ServiceMetrics.recordOperation('StorageService', 'uploadFile', 50, true);
      ServiceMetrics.recordOperation('StorageService', 'uploadFile', 60, true);
      ServiceMetrics.recordOperation('StorageService', 'uploadFile', 70, false);

      // Assert
      const successRate = ServiceMetrics.getSuccessRate('StorageService', 'uploadFile');
      expect(successRate).toBeCloseTo(0.667, 2); // 2/3 = 66.7%
    });

    it('should return 0 success rate when all operations fail', () => {
      // Act
      ServiceMetrics.recordOperation('StorageService', 'deleteFile', 50, false);
      ServiceMetrics.recordOperation('StorageService', 'deleteFile', 60, false);

      // Assert
      const successRate = ServiceMetrics.getSuccessRate('StorageService', 'deleteFile');
      expect(successRate).toBe(0);
    });

    it('should return 1 success rate when all operations succeed', () => {
      // Act
      ServiceMetrics.recordOperation('StorageService', 'exists', 10, true);
      ServiceMetrics.recordOperation('StorageService', 'exists', 15, true);

      // Assert
      const successRate = ServiceMetrics.getSuccessRate('StorageService', 'exists');
      expect(successRate).toBe(1);
    });

    it('should return null for non-existent operations', () => {
      // Act
      const successRate = ServiceMetrics.getSuccessRate('NonExistent', 'operation');

      // Assert
      expect(successRate).toBeNull();
    });
  });

  describe('Concurrent operations', () => {
    it('should handle concurrent metric recording safely', async () => {
      // Act - Simulate concurrent operations
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          Promise.resolve().then(() => 
            ServiceMetrics.recordOperation('StorageService', 'concurrent', i, true)
          )
        );
      }
      
      await Promise.all(promises);

      // Assert
      const metrics = ServiceMetrics.getMetrics();
      expect(metrics['StorageService.concurrent.success.count']).toBe(100);
      
      // Sum of 0 to 99 = (99 * 100) / 2 = 4950
      expect(metrics['StorageService.concurrent.success.duration']).toBe(4950);
      expect(metrics['StorageService.concurrent.success.avg']).toBe(49.5);
    });
  });
});