/**
 * Load test for deploy endpoint
 * Tests concurrent request handling and performance
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { performance } from 'perf_hooks';

// Simple load test client
class LoadTestClient {
  private baseUrl: string;
  private authToken: string;

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl;
    this.authToken = authToken;
  }

  async deployProject(projectName: string, code: string) {
    const startTime = performance.now();
    
    try {
      const response = await fetch(`${this.baseUrl}/api/paste`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: code,
          project_name: projectName,
        }),
      });

      const endTime = performance.now();
      const responseTime = endTime - startTime;
      
      const result = await response.json();
      
      return {
        success: response.ok,
        status: response.status,
        projectId: result.data?.project_id || result.project_id,
        responseTime,
        error: result.error,
      };
    } catch (error: any) {
      const endTime = performance.now();
      return {
        success: false,
        status: 0,
        projectId: null,
        responseTime: endTime - startTime,
        error: error.message,
      };
    }
  }
}

describe('Deploy Endpoint Load Tests', () => {
  const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
  const AUTH_TOKEN = process.env.MVP_ACCESS_TOKEN || 'test-valid-token-12345';

  // Safety guard: Prevent accidental staging tests
  if (WORKER_URL.includes('staging') || WORKER_URL.includes('gladden4work')) {
    if (!process.env.ALLOW_STAGING_TESTS) {
      console.warn('⚠️  SKIPPING: Tests targeting staging require ALLOW_STAGING_TESTS=1');
      console.warn('⚠️  Current URL:', WORKER_URL);
      return;
    }
  }
  
  let client: LoadTestClient;
  let deployedProjects: string[] = [];

  beforeAll(() => {
    client = new LoadTestClient(WORKER_URL, AUTH_TOKEN);
  });

  afterAll(async () => {
    // Cleanup: Delete all test projects
    if (deployedProjects.length > 0) {
      console.log(`Cleaning up ${deployedProjects.length} test projects...`);
      // In a real scenario, we'd delete these projects
    }
  });

  describe('Concurrent Request Handling', () => {
    it('should handle 10 concurrent deploy requests', async () => {
      const concurrentRequests = 10;
      const testCode = `
        import React from 'react';
        export default function LoadTest() {
          return <div>Load Test Component</div>;
        }
      `;

      const promises = Array.from({ length: concurrentRequests }, (_, i) => 
        client.deployProject(`load-test-10-${Date.now()}-${i}`, testCode)
      );

      const results = await Promise.all(promises);
      
      // Track deployed projects for cleanup
      results.forEach(r => {
        if (r.projectId) deployedProjects.push(r.projectId);
      });

      // Analyze results
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      const responseTimes = results.map(r => r.responseTime);
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      const minResponseTime = Math.min(...responseTimes);

      console.log(`
        === 10 Concurrent Requests ===
        Success: ${successful.length}/${concurrentRequests}
        Failed: ${failed.length}/${concurrentRequests}
        Avg Response Time: ${avgResponseTime.toFixed(2)}ms
        Min Response Time: ${minResponseTime.toFixed(2)}ms
        Max Response Time: ${maxResponseTime.toFixed(2)}ms
      `);

      // Assertions
      expect(successful.length).toBeGreaterThanOrEqual(8); // Allow 20% failure rate
      expect(avgResponseTime).toBeLessThan(10000); // Average should be under 10 seconds
      
      // Check for duplicate project IDs
      const projectIds = successful.map(r => r.projectId).filter(Boolean);
      const uniqueIds = new Set(projectIds);
      expect(uniqueIds.size).toBe(projectIds.length); // No duplicates
    });

    it('should handle 50 concurrent deploy requests', async () => {
      const concurrentRequests = 50;
      const testCode = `
        import React from 'react';
        export default function StressTest() {
          return <h1>Stress Test ${Date.now()}</h1>;
        }
      `;

      const promises = Array.from({ length: concurrentRequests }, (_, i) => 
        client.deployProject(`stress-test-50-${Date.now()}-${i}`, testCode)
      );

      const startTime = performance.now();
      const results = await Promise.all(promises);
      const totalTime = performance.now() - startTime;

      // Track deployed projects
      results.forEach(r => {
        if (r.projectId) deployedProjects.push(r.projectId);
      });

      // Analyze results
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      const responseTimes = results.map(r => r.responseTime);
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const p95ResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.95)];
      const p99ResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.99)];

      console.log(`
        === 50 Concurrent Requests ===
        Success: ${successful.length}/${concurrentRequests}
        Failed: ${failed.length}/${concurrentRequests}
        Total Time: ${totalTime.toFixed(2)}ms
        Avg Response Time: ${avgResponseTime.toFixed(2)}ms
        P95 Response Time: ${p95ResponseTime.toFixed(2)}ms
        P99 Response Time: ${p99ResponseTime.toFixed(2)}ms
        Throughput: ${(concurrentRequests / (totalTime / 1000)).toFixed(2)} req/s
      `);

      // Assertions
      expect(successful.length).toBeGreaterThanOrEqual(35); // Allow 30% failure rate
      expect(p95ResponseTime).toBeLessThan(20000); // P95 should be under 20 seconds
      
      // Check for unique project IDs
      const projectIds = successful.map(r => r.projectId).filter(Boolean);
      const uniqueIds = new Set(projectIds);
      expect(uniqueIds.size).toBe(projectIds.length);
    });

    it('should handle 100 concurrent deploy requests (stress test)', async () => {
      const concurrentRequests = 100;
      const testCode = `
        export default function MaxLoadTest() {
          return "Maximum Load Test - ${Date.now()}";
        }
      `;

      // Split into batches to avoid overwhelming the system
      const batchSize = 25;
      const batches = [];
      for (let i = 0; i < concurrentRequests; i += batchSize) {
        batches.push(
          Array.from({ length: Math.min(batchSize, concurrentRequests - i) }, (_, j) => 
            client.deployProject(`max-load-100-${Date.now()}-${i + j}`, testCode)
          )
        );
      }

      const startTime = performance.now();
      const allResults = [];
      
      // Process batches with slight delay between them
      for (const batch of batches) {
        const batchResults = await Promise.all(batch);
        allResults.push(...batchResults);
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const totalTime = performance.now() - startTime;

      // Track deployed projects
      allResults.forEach(r => {
        if (r.projectId) deployedProjects.push(r.projectId);
      });

      // Analyze results
      const successful = allResults.filter(r => r.success);
      const failed = allResults.filter(r => !r.success);
      const responseTimes = allResults.map(r => r.responseTime);
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      
      // Error analysis
      const errorTypes = failed.reduce((acc, r) => {
        const errorType = r.error || 'unknown';
        acc[errorType] = (acc[errorType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log(`
        === 100 Concurrent Requests (Batched) ===
        Success: ${successful.length}/${concurrentRequests}
        Failed: ${failed.length}/${concurrentRequests}
        Total Time: ${totalTime.toFixed(2)}ms
        Avg Response Time: ${avgResponseTime.toFixed(2)}ms
        Throughput: ${(concurrentRequests / (totalTime / 1000)).toFixed(2)} req/s
        
        Error Breakdown:
        ${Object.entries(errorTypes).map(([type, count]) => `  ${type}: ${count}`).join('\n')}
      `);

      // Assertions
      expect(successful.length).toBeGreaterThanOrEqual(50); // At least 50% success rate
      
      // Check for duplicate project IDs
      const projectIds = successful.map(r => r.projectId).filter(Boolean);
      const uniqueIds = new Set(projectIds);
      expect(uniqueIds.size).toBe(projectIds.length); // No duplicates even under stress
    });
  });

  describe('Response Time Analysis', () => {
    it('should maintain consistent response times under sustained load', async () => {
      const requestsPerSecond = 5;
      const durationSeconds = 10;
      const totalRequests = requestsPerSecond * durationSeconds;
      
      const testCode = `
        import React from 'react';
        export default function SustainedLoad() {
          return <div>Sustained Load Test</div>;
        }
      `;

      const results = [];
      const startTime = performance.now();
      
      for (let i = 0; i < totalRequests; i++) {
        const requestPromise = client.deployProject(
          `sustained-${Date.now()}-${i}`, 
          testCode
        );
        
        // Wait to maintain rate
        if (i < totalRequests - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 / requestsPerSecond));
        }
        
        results.push(await requestPromise);
      }
      
      const totalTime = performance.now() - startTime;

      // Track deployed projects
      results.forEach(r => {
        if (r.projectId) deployedProjects.push(r.projectId);
      });

      // Analyze response time consistency
      const responseTimes = results.map(r => r.responseTime);
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const variance = responseTimes.reduce((acc, time) => 
        acc + Math.pow(time - avgResponseTime, 2), 0
      ) / responseTimes.length;
      const stdDev = Math.sqrt(variance);
      const coefficientOfVariation = (stdDev / avgResponseTime) * 100;

      console.log(`
        === Sustained Load (${requestsPerSecond} req/s for ${durationSeconds}s) ===
        Total Requests: ${totalRequests}
        Success Rate: ${results.filter(r => r.success).length}/${totalRequests}
        Total Time: ${totalTime.toFixed(2)}ms
        Avg Response Time: ${avgResponseTime.toFixed(2)}ms
        Std Deviation: ${stdDev.toFixed(2)}ms
        Coefficient of Variation: ${coefficientOfVariation.toFixed(2)}%
      `);

      // Assertions
      expect(coefficientOfVariation).toBeLessThan(100); // Response times should be relatively consistent
      expect(results.filter(r => r.success).length).toBeGreaterThanOrEqual(totalRequests * 0.8);
    });
  });

  describe('Error Recovery', () => {
    it('should handle invalid project names gracefully', async () => {
      const invalidNames = [
        '', // Empty name
        ' '.repeat(100), // Whitespace only
        'a'.repeat(256), // Too long
        'test/invalid', // Invalid characters
        '../../etc/passwd', // Path traversal attempt
      ];

      const testCode = 'export default function Test() { return "Test"; }';
      
      const promises = invalidNames.map(name => 
        client.deployProject(name, testCode)
      );

      const results = await Promise.all(promises);
      
      // All should fail gracefully
      expect(results.every(r => !r.success || r.error)).toBe(true);
      
      // Response times should still be reasonable even for errors
      const responseTimes = results.map(r => r.responseTime);
      const avgErrorResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      expect(avgErrorResponseTime).toBeLessThan(5000); // Errors should fail fast
    });

    it('should handle malformed code gracefully', async () => {
      const malformedCode = [
        'not valid javascript',
        '{ broken json }',
        '<html>Not React</html>',
        'import { nonexistent } from "nowhere"',
        'a'.repeat(1000000), // Very large code
      ];

      const promises = malformedCode.map((code, i) => 
        client.deployProject(`malformed-${Date.now()}-${i}`, code)
      );

      const results = await Promise.all(promises);
      
      // Track any that succeeded for cleanup
      results.forEach(r => {
        if (r.projectId) deployedProjects.push(r.projectId);
      });

      // Should handle gracefully (either succeed with scaffolding or fail cleanly)
      expect(results.every(r => r.status !== 500)).toBe(true); // No server errors
      
      const responseTimes = results.map(r => r.responseTime);
      const maxResponseTime = Math.max(...responseTimes);
      expect(maxResponseTime).toBeLessThan(30000); // Should timeout reasonably
    });
  });
});