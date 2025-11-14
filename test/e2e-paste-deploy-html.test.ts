import { describe, it, expect, beforeEach } from 'vitest';
import { pasteHandler } from '../src/routes/paste';
import { deploymentHandler } from '../src/handlers/deployment';

class R2ObjectMock {
  constructor(private body: string, private meta?: any) { this.uploaded = new Date(); }
  uploaded: Date;
  async text() { return this.body; }
  async json() { return JSON.parse(this.body); }
  async arrayBuffer() { return new TextEncoder().encode(this.body); }
}

class R2BucketMock {
  store = new Map<string, string>();
  meta = new Map<string, any>();
  async get(key: string): Promise<any | null> {
    const v = this.store.get(key);
    if (v === undefined) return null;
    const obj = new R2ObjectMock(v, this.meta.get(key));
    return obj;
  }
  async put(key: string, value: any, opts?: any) {
    if (value instanceof Uint8Array) {
      this.store.set(key, Buffer.from(value).toString('utf-8'));
    } else if (typeof value === 'string') {
      this.store.set(key, value);
    } else if (value instanceof ArrayBuffer) {
      this.store.set(key, Buffer.from(value).toString('utf-8'));
    } else if (value && typeof value.getReader === 'function') {
      // ReadableStream
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
      this.store.set(key, buf.toString('utf-8'));
    } else {
      this.store.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    this.meta.set(key, opts || {});
  }
  async delete(key: string) { this.store.delete(key); this.meta.delete(key); }
  async list(_opts?: any) { return { objects: [...this.store.keys()].map(k => ({ key: k })), delimitedPrefixes: [] }; }
}

describe('E2E: Paste full HTML then deploy', () => {
  let PROJECTS_BUCKET: any;
  let DEPLOYMENTS_BUCKET: any;
  let BUILDS_BUCKET: any;
  let env: any;

  beforeEach(() => {
    PROJECTS_BUCKET = new R2BucketMock();
    DEPLOYMENTS_BUCKET = new R2BucketMock();
    BUILDS_BUCKET = new R2BucketMock();
    env = { PROJECTS_BUCKET, DEPLOYMENTS_BUCKET, BUILDS_BUCKET, DEPLOYMENT_DOMAIN: 'test-deploy.local' };
  });

  it('pastes full HTML, auto-deploys statically, and re-deploys via handler', async () => {
    const html = '<!DOCTYPE html><html><head><title>E2E</title></head><body><h1>OK</h1></body></html>';
    const payload = { content: html, project_name: 'E2E HTML', description: 'test' };
    const req = new Request('https://internal/api/paste', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

    const pasteResp = await pasteHandler(req, env);
    expect(pasteResp.status).toBeGreaterThanOrEqual(200);
    const pasteJson = await pasteResp.json();
    expect(pasteJson.success).toBe(true);
    const pr = pasteJson.data;
    expect(pr.detected_framework).toBe('html');

    // Should have auto-deployed statically in paste flow
    const projectId = pr.project_id;
    const deployedObj = await DEPLOYMENTS_BUCKET.get(`sites/${projectId}/index.html`);
    expect(deployedObj).not.toBeNull();
    const deployedHtml = await deployedObj!.text();
    expect(deployedHtml).toBe(html);

    // Now call deployment handler explicitly; it should detect static and succeed again
    const depReq = new Request(`https://internal/api/projects/${projectId}/deploy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const depResp = await deploymentHandler(depReq, env);
    expect(depResp.status).toBeGreaterThanOrEqual(200);
    const depJson = await depResp.json();
    expect(depJson.success).toBe(true);
    // Accept either configured domain or local dev server URL
    const urlPattern = new RegExp(`^(https?://test-deploy\\.local|http://localhost:8787)/sites/${projectId}/$`);
    expect(depJson.data.url).toMatch(urlPattern);
  });
});
