/**
 * API v2 Routes - Bootstrap Env Usage (Option A)
 * Demonstrates centralized Day 5 test environment seeding for CI stability.
 */

import { describe, it, expect, vi } from 'vitest';
import { router } from '../../src/routes/router';
import { ServiceFactory } from '../../src/services/ServiceFactory';
import { bootstrapDay5UnitEnv } from '../helpers/testEnvironments';
import { Ok, Err } from '../../src/lib/result';
import { DeploymentError, DeploymentErrorCode } from '../../src/lib/errors';

function createRequest(path: string, options: { method?: string; headers?: Record<string, string>; body?: any } = {}): Request {
  const url = `http://localhost:8787${path}`;
  const init: RequestInit = {
    method: options.method || 'GET',
    headers: new Headers(options.headers || {}),
  };
  if (options.body) {
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  return new Request(url, init);
}

describe('API v2 /api/v2/deploy with bootstrap env', () => {
  it('returns success envelope for valid request (stubbed DeployService)', async () => {
    const env = await bootstrapDay5UnitEnv({ projectId: 'p-bootstrap', buildId: 'b-bootstrap' });

    const spy = vi.spyOn(ServiceFactory, 'getDeployService').mockReturnValue({
      deployBuild: async () =>
        Ok({
          deploymentUrl: 'http://localhost:8787/sites/p-bootstrap/',
          status: 'deployed',
          projectId: 'p-bootstrap',
          deployedAt: new Date(),
        }),
    } as any);

    const req = createRequest('/api/v2/deploy', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: { build_id: 'b-bootstrap' },
    });

    const res = await router(req, env as any);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.deployment_url).toBe('http://localhost:8787/sites/p-bootstrap/');

    spy.mockRestore();
  });

  it('returns 400 when build is not ready (stubbed DeployService)', async () => {
    const env = await bootstrapDay5UnitEnv({ projectId: 'p-bootstrap', buildId: 'b-bootstrap' });

    const spy = vi.spyOn(ServiceFactory, 'getDeployService').mockReturnValue({
      deployBuild: async () => Err(new DeploymentError(DeploymentErrorCode.BUILD_NOT_READY, 'not ready')),
    } as any);

    const req = createRequest('/api/v2/deploy', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: { build_id: 'b-bootstrap' },
    });

    const res = await router(req, env as any);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DEPLOYMENT_BUILD_NOT_READY');

    spy.mockRestore();
  });
});
