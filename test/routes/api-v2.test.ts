/**
 * API Routes v2 Test Suite - RED Phase TDD
 * Tests for thin routing layer that delegates to services
 * 
 * Based on DAY5-TDD-STRATEGY.md lines 813-876
 * Testing v2 API envelope format and authentication
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { router } from '../../src/routes/router';
import { ServiceFactory } from '../../src/services/ServiceFactory';
import { Err, Ok } from '../../src/lib/result';
import { DeploymentError, DeploymentErrorCode } from '../../src/lib/errors';

// Mock environment similar to other integration tests
const mockEnv = {
  MVP_ACCESS_TOKEN: 'test-token', // Use the correct env variable name for auth
  AUTH_TOKEN: 'test-token', // Keep for backward compatibility
  GITHUB_WEBHOOK_SECRET: 'test-secret',
  FEATURE_FLAGS: JSON.stringify({
    useNewStorageService: true,
    useMonitoring: false,
    useNewProjectService: true,
    useNewGitHubService: true,
    useNewBuildService: true,
    useNewDeployService: true  // Enable deploy service for tests
  }),
  ENVIRONMENT: 'test',
  DEPLOYMENTS_BUCKET: {
    put: vi.fn().mockResolvedValue(undefined),
    copyDirectory: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockImplementation((key: string) => {
      // Mock deployment metadata
      if (key.includes('_deployment.json')) {
        return Promise.resolve({
          text: () => Promise.resolve(JSON.stringify({
            projectId: 'b1',
            deployedAt: new Date().toISOString(),
            deploymentUrl: 'http://localhost:8787/sites/b1/'
          }))
        });
      }
      // Mock sites for deployment
      if (key.includes('sites/b1/')) {
        return Promise.resolve({
          text: () => Promise.resolve('<html>Deployed content</html>'),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100))
        });
      }
      // Mock build metadata for BuildService
      if (key === 'builds/b1/metadata.json') {
        const data = JSON.stringify({
          id: 'b1',
          projectId: 'b1',
          status: 'success',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          artifactPath: 'builds/b1/dist/'
        });
        return Promise.resolve({
          text: () => Promise.resolve(data),
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(data).buffer)
        });
      }
      if (key === 'builds/p1/metadata.json') {
        const data = JSON.stringify({
          id: 'p1',
          projectId: 'p1', 
          status: 'success',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          artifactPath: 'builds/p1/dist/'
        });
        return Promise.resolve({
          text: () => Promise.resolve(data),
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(data).buffer)
        });
      }
      // Mock build artifacts
      if (key.includes('builds/b1/dist/')) {
        return Promise.resolve({
          body: new ArrayBuffer(100),
          text: () => Promise.resolve('<html>Test</html>'),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100))
        });
      }
      return Promise.resolve(null);
    }),
    list: vi.fn().mockResolvedValue({ objects: [{ key: 'builds/b1/dist/index.html' }] }),
    delete: vi.fn().mockResolvedValue(undefined)
  },
  PROJECTS_BUCKET: {
    put: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockImplementation((path: string) => {
      // Return true for build artifacts
      if (path.includes('builds/') && path.includes('/dist/')) {
        return true;
      }
      return true;
    }),
    get: vi.fn().mockImplementation((key: string) => {
      // Mock build metadata for BuildService (must be in PROJECTS_BUCKET)
      // This matches the same data in DEPLOYMENTS_BUCKET
      if (key === 'builds/b1/metadata.json') {
        const data = JSON.stringify({
          id: 'b1',
          projectId: 'b1',
          status: 'success',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          artifactPath: 'builds/b1/dist/'
        });
        return Promise.resolve({
          text: () => Promise.resolve(data),
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(data).buffer)
        });
      }
      if (key === 'builds/p1/metadata.json') {
        const data = JSON.stringify({
          id: 'p1',
          projectId: 'p1', 
          status: 'success',
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          artifactPath: 'builds/p1/dist/'
        });
        return Promise.resolve({
          text: () => Promise.resolve(data),
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(data).buffer)
        });
      }
      // Correlation map for runId -> buildId
      if (key === 'projects/p1/github-runs/123.json') {
        const map = JSON.stringify({ projectId: 'p1', buildId: 'p1', githubRunId: 123 });
        return Promise.resolve({
          text: () => Promise.resolve(map),
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(map).buffer)
        });
      }
      // Mock build artifacts in PROJECTS_BUCKET
      if (key.includes('builds/b1/dist/')) {
        return Promise.resolve({
          body: new ArrayBuffer(100),
          text: () => Promise.resolve('<html>Test</html>'),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100))
        });
      }
      // Handle both b1 and p1 project IDs
      // Make sure to match the exact paths BuildService expects
      if (key === 'projects/b1/metadata.json') {
        const data = JSON.stringify({
          id: 'b1',
          name: 'test-project',
          framework: 'react',
          status: 'building',
          buildId: 'b1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        return Promise.resolve({
          text: () => Promise.resolve(data),
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(data).buffer)
        });
      }
      if (key === 'projects/p1/metadata.json') {
        const data = JSON.stringify({
          id: 'p1',
          name: 'project-p1',
          framework: 'react',
          status: 'building',
          buildId: 'p1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        return Promise.resolve({
          text: () => Promise.resolve(data),
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(data).buffer)
        });
      }
      // Build status for b1
      if (key.includes('b1') && key.includes('build-status.json')) {
        return Promise.resolve({
          text: () => Promise.resolve(JSON.stringify({
            id: 'b1',
            projectId: 'b1',
            status: 'success',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            artifactPath: 'builds/b1/dist/'
          }))
        });
      }
      // Build status for p1
      if (key.includes('p1') && key.includes('build-status.json')) {
        return Promise.resolve({
          text: () => Promise.resolve(JSON.stringify({
            id: 'p1',
            projectId: 'p1',
            status: 'success',
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            artifactPath: 'builds/p1/dist/'
          }))
        });
      }
      // console.log(`[TEST] PROJECTS_BUCKET.get miss: ${key}`);
      return Promise.resolve(null);
    }),
    copyDirectory: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockImplementation((options?: any) => {
      // Return build artifacts when listing builds/b1/dist/
      if (options?.prefix === 'builds/b1/dist/') {
        return Promise.resolve({ 
          objects: [
            { key: 'builds/b1/dist/index.html', size: 1000 },
            { key: 'builds/b1/dist/style.css', size: 500 }
          ] 
        });
      }
      if (options?.prefix === 'builds/p1/dist/') {
        return Promise.resolve({ 
          objects: [
            { key: 'builds/p1/dist/index.html', size: 1000 },
            { key: 'builds/p1/dist/style.css', size: 500 }
          ] 
        });
      }
      return Promise.resolve({ objects: [] });
    }),
    delete: vi.fn().mockResolvedValue(undefined)
  }
};

// Helper to create requests with proper URL and structure
function createRequest(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Request {
  const url = `http://localhost:8787${path}`;
  const init: RequestInit = {
    method: options.method || 'GET',
    headers: new Headers(options.headers || {})
  };
  
  if (options.body) {
    init.body = typeof options.body === 'string' 
      ? options.body 
      : JSON.stringify(options.body);
  }
  
  return new Request(url, init);
}

describe('API v2 /api/v2/deploy', () => {
  it('requires Authorization', async () => {
    const request = createRequest('/api/v2/deploy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: { build_id: 'b1' }
    });
    
    const response = await router(request, mockEnv as any);
    
    // Should fail with 401 because no Authorization header
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_UNAUTHORIZED');
  });

  it('returns 403 for insufficient scope or wrong token', async () => {
    const request = createRequest('/api/v2/deploy', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer wrong-token',
        'Content-Type': 'application/json'
      },
      body: { build_id: 'b1' }
    });

    const response = await router(request, mockEnv as any);
    expect([401, 403]).toContain(response.status);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('returns 400/422 for invalid payload', async () => {
    const request = createRequest('/api/v2/deploy', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json'
      },
      body: {} // missing build_id
    });

    const response = await router(request, mockEnv as any);
    expect([400, 422]).toContain(response.status);
  });

  it('returns success envelope for valid request', async () => {
    // Stub deploy service to focus on routing contract
    const spy = vi.spyOn(ServiceFactory, 'getDeployService').mockReturnValue({
      deployBuild: async (buildId: string) => Ok({
        deploymentUrl: `http://localhost:8787/sites/${buildId}/`,
        status: 'deployed',
        projectId: buildId,
        deployedAt: new Date()
      })
    } as any);

    const request = createRequest('/api/v2/deploy', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json'
      },
      body: { build_id: 'b1' }
    });
    
    const response = await router(request, mockEnv as any);
    
    // Should return success with proper envelope format
    const body = await response.json();
    if (response.status !== 200) {
      console.error('Deploy endpoint error:', body);
    }
    expect([200, 202]).toContain(response.status);
    expect(body.success).toBe(true);
    expect(body.data.deployment_url).toBe(`http://localhost:8787/sites/b1/`);
    expect(body.metadata.timestamp).toBeDefined();

    spy.mockRestore();
  });

  it('returns 400 when build is not ready (failed)', async () => {
    const spy = vi.spyOn(ServiceFactory, 'getDeployService').mockReturnValue({
      deployBuild: async () => Err(new DeploymentError(DeploymentErrorCode.BUILD_NOT_READY, 'Build not ready'))
    } as any);

    const request = createRequest('/api/v2/deploy', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json'
      },
      body: { build_id: 'b-failed' }
    });

    const response = await router(request, mockEnv as any);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DEPLOYMENT_BUILD_NOT_READY');

    spy.mockRestore();
  });
});

describe('API v2 /api/v2/github/build-callback', () => {
  it('validates signature and completes build (happy path via runId→buildId)', async () => {
    const payload = { 
      project_id: 'p1', 
      status: 'success', 
      github_run_id: '123', 
      r2_build_path: 'builds/p1/dist/' 
    };
    
    const request = createRequest('/api/v2/github/build-callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'sha256=validsig'
      },
      body: payload
    });
    
    const response = await router(request, mockEnv as any);
    
    // Should accept valid signature and return success
    const body = await response.json();
    if (response.status !== 200) {
      console.error('GitHub callback error:', body);
      console.error('Response status:', response.status);
    }
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(['completed','acknowledged']).toContain(body.data.status);
    // deployment_url may be present when deploy succeeds
    // If DeployService succeeded, the URL should be returned
    // We avoid asserting its exact value due to mocked environment
  });

  it('rejects invalid signature', async () => {
    const request = createRequest('/api/v2/github/build-callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'sha256=invalid'
      },
      body: {}
    });
    
    const response = await router(request, mockEnv as any);
    
    // Should reject invalid signature
    expect([401, 403]).toContain(response.status);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('GITHUB_INVALID_SIGNATURE');
  });

  it('rejects missing signature header', async () => {
    const request = createRequest('/api/v2/github/build-callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: {}
    });

    const response = await router(request, mockEnv as any);
    expect([401, 403]).toContain(response.status);
  });

  it('rejects unknown event types', async () => {
    const request = createRequest('/api/v2/github/build-callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'sha256=validsig',
        'X-GitHub-Event': 'ping'
      },
      body: {}
    });

    const response = await router(request, mockEnv as any);
    expect([400, 422]).toContain(response.status);
  });
});

describe('API v2 feature flags and CORS (RED)', () => {
  it('disables new deploy route when flag off', async () => {
    const envWithFlags = { ...mockEnv, FEATURE_FLAGS: JSON.stringify({ useNewDeployService: false }) };
    const request = createRequest('/api/v2/deploy', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json'
      },
      body: { build_id: 'b1' }
    });
    const response = await router(request, envWithFlags as any);
    expect([404, 501]).toContain(response.status);
  });

  it('responds to CORS preflight with allowed headers', async () => {
    const request = createRequest('/api/v2/deploy', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.gpthost.dev' } as any
    });
    const response = await router(request, mockEnv as any);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods') || '').toContain('POST');
    expect(response.headers.get('Access-Control-Allow-Headers') || '').toMatch(/Authorization|Content-Type/);
  });
});
