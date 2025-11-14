/**
 * Minimal integration harness: Paste → Auto-Scaffold → Build queued
 *
 * Verifies that POST /api/paste triggers scaffolding automatically in-process
 * and returns status "scaffolded" with a build_job_id in the response.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { pasteHandler } from '../../src/routes/paste';

describe('Paste → Auto-Scaffold Bridge', () => {
  beforeEach(async () => {
    const testProjects = await env.PROJECTS_BUCKET.list({ prefix: 'projects/' });
    for (const obj of testProjects.objects) {
      await env.PROJECTS_BUCKET.delete(obj.key);
    }
  });

  it('returns scaffolded status with build_job_id', async () => {
    const request = new Request('http://localhost/api/paste', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-valid-token-12345'
      },
      body: JSON.stringify({
        content: 'export default function Test(){return (<div>Test</div>)}',
        project_name: 'Test',
        description: 'Test'
      })
    });

    const response = await pasteHandler(request, env);
    expect(response.status).toBe(201);

    const payload = await response.json() as any;
    expect(payload?.data?.status).toBe('scaffolded');
    expect(typeof payload?.data?.build_job_id).toBe('string');
    expect(payload.data.build_job_id.length).toBeGreaterThan(0);
  });
});

