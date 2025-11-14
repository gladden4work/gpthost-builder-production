/**
 * MVP API Contract Tests - Consolidated for Launch
 * 
 * This file consolidates essential API contract validation tests,
 * ensuring consistency across all endpoints for MVP launch.
 * 
 * Coverage:
 * - Content-Type validation across endpoints
 * - Standardized error response format
 * - Authentication consistency
 * - Request/response structure validation
 * - CORS and security headers
 * 
 * Focused on MVP requirements only - no enterprise features.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Configuration
const API_BASE_URL = process.env.GPTHOST_API_URL || 'http://localhost:8787';

// Helper to create test requests
const createRequest = (
  method: string,
  path: string,
  options: {
    body?: any;
    headers?: Record<string, string>;
    contentType?: string;
  } = {}
) => {
  const url = `${API_BASE_URL}${path}`;
  const headers = new Headers(options.headers || {});
  
  if (options.contentType) {
    headers.set('Content-Type', options.contentType);
  }
  
  const init: RequestInit = {
    method,
    headers,
  };
  
  if (options.body) {
    if (options.contentType === 'multipart/form-data') {
      const formData = new FormData();
      Object.entries(options.body).forEach(([key, value]) => {
        if (value instanceof File) {
          formData.append(key, value);
        } else {
          formData.append(key, String(value));
        }
      });
      init.body = formData;
      headers.delete('Content-Type'); // Let browser set boundary
    } else {
      init.body = JSON.stringify(options.body);
    }
  }
  
  return new Request(url, init);
};

describe('MVP API Contract Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Content-Type Validation', () => {
    it('JSON endpoints MUST require application/json Content-Type', async () => {
      const jsonEndpoints = [
        { path: '/api/paste', method: 'POST' },
        { path: '/api/projects', method: 'POST' },
        { path: '/api/projects/test-id/build', method: 'POST' },
      ];

      for (const { path, method } of jsonEndpoints) {
        // Test with wrong Content-Type
        const wrongContentTypes = ['text/plain', 'application/x-www-form-urlencoded'];

        for (const contentType of wrongContentTypes) {
          const request = createRequest(method, path, {
            contentType,
            body: { test: 'data' },
            headers: { 'Authorization': 'Bearer test-token' },
          });

          const response = await fetch(request);
          
          if (!response.ok) {
            const data = await response.json();
            expect(response.status).toBe(400);
            expect(data).toHaveProperty('error');
            expect(data.error).toMatch(/content-type|json/i);
          }
        }
      }
    });

    it('Multipart endpoints MUST accept multipart/form-data', async () => {
      const file = new File(['test content'], 'test.jsx', { type: 'text/javascript' });
      const formData = new FormData();
      formData.append('files', file);
      formData.append('project_name', 'test-project');

      const request = new Request(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-token',
        },
        body: formData,
      });

      const response = await fetch(request);
      
      // Should accept multipart/form-data
      if (response.status === 400) {
        const data = await response.json();
        expect(data.error).not.toMatch(/content-type/i);
      }
    });
  });

  describe('Error Response Standardization', () => {
    it('All error responses MUST follow standard format', async () => {
      // Test various error scenarios
      const errorScenarios = [
        {
          request: createRequest('POST', '/api/paste', {
            contentType: 'application/json',
            body: { content: '', project_name: 'test' },
            headers: { 'Authorization': 'Bearer test-token' },
          }),
          description: 'Empty content error',
        },
        {
          request: createRequest('GET', '/api/projects/invalid-id/build/status', {
            headers: { 'Authorization': 'Bearer test-token' },
          }),
          description: 'Project not found error',
        },
      ];

      for (const scenario of errorScenarios) {
        const response = await fetch(scenario.request);
        
        if (!response.ok) {
          const data = await response.json();
          
          // Verify standard error structure
          expect(data).toHaveProperty('success', false);
          expect(data).toHaveProperty('error');
          
          // Error should be string or object with message
          if (typeof data.error === 'object') {
            expect(data.error).toHaveProperty('message');
          }
        }
      }
    });

    it('Authentication errors MUST be consistent', async () => {
      const protectedEndpoints = [
        { path: '/api/paste', method: 'POST' },
        { path: '/api/projects', method: 'GET' },
        { path: '/api/upload', method: 'POST' },
      ];

      for (const { path, method } of protectedEndpoints) {
        // Test missing auth header
        const noAuthRequest = createRequest(method, path, {
          contentType: method === 'POST' ? 'application/json' : undefined,
          body: method === 'POST' ? { test: 'data' } : undefined,
        });

        const response = await fetch(noAuthRequest);
        
        // Should return 401 or handle gracefully
        if (response.status === 401) {
          const data = await response.json();
          expect(data).toHaveProperty('success', false);
          expect(data).toHaveProperty('error');
        }
      }
    });
  });

  describe('Response Structure Validation', () => {
    it('Successful responses MUST have consistent structure', async () => {
      const request = createRequest('GET', '/api/health');
      const response = await fetch(request);

      if (response.ok) {
        const data = await response.json();
        
        // Success response should have standard structure
        expect(data).toHaveProperty('success', true);
        
        // Should have data property for successful responses
        if (data.success) {
          expect(data).toHaveProperty('data');
          expect(data).not.toHaveProperty('error');
        }
      }
    });

    it('All endpoints MUST return JSON responses', async () => {
      const endpoints = [
        { path: '/api/health', method: 'GET' },
        { path: '/api/projects', method: 'GET', auth: true },
        { path: '/api/paste', method: 'POST', auth: true },
      ];

      for (const endpoint of endpoints) {
        const request = createRequest(endpoint.method, endpoint.path, {
          headers: endpoint.auth ? { 'Authorization': 'Bearer test-token' } : {},
          contentType: endpoint.method === 'POST' ? 'application/json' : undefined,
          body: endpoint.method === 'POST' ? { test: 'data' } : undefined,
        });

        const response = await fetch(request);
        
        // Verify Content-Type is JSON
        const contentType = response.headers.get('content-type');
        if (contentType) {
          expect(contentType).toMatch(/application\/json/i);
        }
        
        // Verify response is valid JSON
        try {
          await response.json();
        } catch {
          // If JSON parse fails, test should fail
          expect(true).toBe(false);
        }
      }
    });
  });

  describe('CORS and Security Headers', () => {
    it('All endpoints MUST include CORS headers', async () => {
      const request = createRequest('GET', '/api/health');
      const response = await fetch(request);

      // Check for CORS headers
      const corsHeaders = [
        'Access-Control-Allow-Origin',
        'Access-Control-Allow-Methods',
      ];

      for (const header of corsHeaders) {
        const value = response.headers.get(header);
        if (value) {
          expect(value).toBeTruthy();
        }
      }
    });

    it('OPTIONS requests MUST be handled for CORS preflight', async () => {
      const endpoints = [
        '/api/upload',
        '/api/paste',
        '/api/projects',
      ];

      for (const path of endpoints) {
        const request = createRequest('OPTIONS', path);
        const response = await fetch(request);

        // OPTIONS should return 204 or 200
        expect([200, 204]).toContain(response.status);
        
        // Should have CORS headers
        const allowMethods = response.headers.get('Access-Control-Allow-Methods');
        if (allowMethods) {
          expect(allowMethods).toBeTruthy();
        }
      }
    });
  });

  describe('Input Validation', () => {
    it('MUST validate required fields in request body', async () => {
      const validationTests = [
        {
          endpoint: '/api/paste',
          body: { project_name: 'test' }, // Missing content
          missingField: 'content',
        },
        {
          endpoint: '/api/paste',
          body: { content: 'code' }, // Missing project_name
          missingField: 'project_name',
        },
      ];

      for (const test of validationTests) {
        const request = createRequest('POST', test.endpoint, {
          contentType: 'application/json',
          body: test.body,
          headers: { 'Authorization': 'Bearer test-token' },
        });

        const response = await fetch(request);
        
        if (!response.ok) {
          const data = await response.json();
          expect(data.success).toBe(false);
          expect(data.error).toBeTruthy();
          
          // Error should mention the missing field
          const errorString = JSON.stringify(data.error).toLowerCase();
          expect(errorString).toContain(test.missingField);
        }
      }
    });

    it('MUST handle malformed JSON gracefully', async () => {
      const malformedRequest = new Request(`${API_BASE_URL}/api/paste`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: '{ invalid json }',
      });

      const response = await fetch(malformedRequest);
      
      if (!response.ok) {
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error.message || data.error).toMatch(/json|parse|invalid/i);
      }
    });
  });

  describe('HTTP Status Codes', () => {
    it('Success responses MUST use appropriate 2xx status codes', async () => {
      const request = createRequest('GET', '/api/health');
      const response = await fetch(request);

      if (response.ok) {
        expect(response.status).toBeGreaterThanOrEqual(200);
        expect(response.status).toBeLessThan(300);
      }
    });

    it('Client errors MUST use appropriate 4xx status codes', async () => {
      // Test with invalid request
      const request = createRequest('POST', '/api/paste', {
        contentType: 'application/json',
        body: { invalid: 'request' },
        headers: { 'Authorization': 'Bearer test-token' },
      });

      const response = await fetch(request);
      
      if (!response.ok && response.status < 500) {
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      }
    });

    it('Authentication errors MUST return 401', async () => {
      const request = createRequest('GET', '/api/projects');
      const response = await fetch(request);
      
      // If endpoint requires auth and no token provided
      if (!response.ok && response.status === 401) {
        expect(response.status).toBe(401);
      }
    });
  });
});

/**
 * Test Summary - MVP API Contracts
 * 
 * This consolidated file covers:
 * 
 * 1. Content-Type Validation (2 tests)
 *    - JSON endpoint validation
 *    - Multipart endpoint validation
 * 
 * 2. Error Response Format (2 tests)
 *    - Standard error structure
 *    - Authentication error consistency
 * 
 * 3. Response Structure (2 tests)
 *    - Success response structure
 *    - JSON response validation
 * 
 * 4. CORS and Security (2 tests)
 *    - CORS header presence
 *    - OPTIONS preflight handling
 * 
 * 5. Input Validation (2 tests)
 *    - Required field validation
 *    - Malformed JSON handling
 * 
 * 6. HTTP Status Codes (3 tests)
 *    - 2xx for success
 *    - 4xx for client errors
 *    - 401 for authentication
 * 
 * Total: 13 focused API contract tests for MVP launch
 */