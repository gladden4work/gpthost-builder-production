/**
 * API v2 Routes - Authentication Enforcement Tests
 * Verifies that v2 endpoints require Bearer auth and reject invalid tokens
 */

import { describe, it, expect } from 'vitest';
import { router } from '../../src/routes/router';

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
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  return new Request(url, init);
}

// Minimal env to exercise auth middleware behavior in test mode
const env = {
  ENVIRONMENT: 'test',
  FEATURE_FLAGS: JSON.stringify({
    useNewDeployService: true,
    useNewBuildService: true,
    useNewProjectService: true,
    useNewGitHubService: true,
    useNewStorageService: true
  })
} as any;

describe('API v2 auth enforcement', () => {
  it('POST /api/v2/projects requires Authorization', async () => {
    const req = createRequest('/api/v2/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { name: 'proj' }
    });
    const res = await router(req, env);
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH_UNAUTHORIZED');
  });

  it('POST /api/v2/projects rejects wrong token', async () => {
    const req = createRequest('/api/v2/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-token' },
      body: { name: 'proj' }
    });
    const res = await router(req, env);
    expect([401, 403]).toContain(res.status);
  });

  it('GET /api/v2/projects/{id} requires Authorization', async () => {
    const req = createRequest('/api/v2/projects/p1');
    const res = await router(req, env);
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe('AUTH_UNAUTHORIZED');
  });

  it('POST /api/v2/build requires Authorization', async () => {
    const req = createRequest('/api/v2/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { project_id: 'p1' }
    });
    const res = await router(req, env);
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe('AUTH_UNAUTHORIZED');
  });

  it('GET /api/v2/build/{id} requires Authorization', async () => {
    const req = createRequest('/api/v2/build/b1');
    const res = await router(req, env);
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error.code).toBe('AUTH_UNAUTHORIZED');
  });
});

