import { describe, it, expect, beforeEach } from 'vitest';
import { createDeploymentManager } from '../src/utils/deploymentManager';

class R2ObjectMock {
  constructor(private body: string) {}
  async text() { return this.body; }
  async arrayBuffer() { return new TextEncoder().encode(this.body); }
}

class R2BucketMock {
  store = new Map<string, string>();
  async get(key: string): Promise<any | null> {
    const v = this.store.get(key);
    return v === undefined ? null : new R2ObjectMock(v);
  }
  async put(key: string, value: any, _opts?: any) {
    if (value instanceof Uint8Array) {
      this.store.set(key, Buffer.from(value).toString('utf-8'));
    } else if (typeof value === 'string') {
      this.store.set(key, value);
    } else if (value instanceof ArrayBuffer) {
      this.store.set(key, Buffer.from(value).toString('utf-8'));
    } else {
      // Assume JSON-serializable
      this.store.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }
  async delete(key: string) {
    this.store.delete(key);
  }
  async list(_opts?: any) {
    return { objects: [...this.store.keys()].map(k => ({ key: k })), delimitedPrefixes: [] };
  }
}

describe('Static HTML Deployment', () => {
  let PROJECTS_BUCKET: R2BucketMock;
  let DEPLOYMENTS_BUCKET: R2BucketMock;
  let BUILDS_BUCKET: R2BucketMock;
  let env: any;

  beforeEach(() => {
    PROJECTS_BUCKET = new R2BucketMock();
    DEPLOYMENTS_BUCKET = new R2BucketMock();
    BUILDS_BUCKET = new R2BucketMock();
    env = { PROJECTS_BUCKET, DEPLOYMENTS_BUCKET, BUILDS_BUCKET, DEPLOYMENT_DOMAIN: 'test-deploy.local' };
  });

  it('deploys original HTML files without scaffolding', async () => {
    const projectId = 'static-proj-1';
    const now = new Date().toISOString();
    const html = '<!DOCTYPE html><html><head><title>Static</title></head><body><h1>Hello</h1></body></html>';

    const metadata = {
      id: projectId,
      status: 'analyzing',
      name: 'Static Test',
      files: [
        { name: 'index.html', path: `projects/${projectId}/source/index.html`, size: html.length, type: 'text/html', upload_time: now }
      ],
      created_at: now,
      updated_at: now,
      analysis: {
        primaryFramework: 'html',
        componentType: 'full-application',
        hasMultipleFrameworks: false,
        totalComponents: 0,
        componentNames: [],
        entryPoints: [],
        dependencies: [],
        stylingApproaches: [],
        language: 'html',
        analysisComplete: true,
        analysisTimestamp: now
      }
    };

    await PROJECTS_BUCKET.put(`projects/${projectId}/metadata.json`, JSON.stringify(metadata));
    await PROJECTS_BUCKET.put(`projects/${projectId}/source/index.html`, html, { httpMetadata: { contentType: 'text/html' } });

    const manager = createDeploymentManager(env);
    const result = await manager.deployStaticSite(projectId);

    expect(result.success).toBe(true);
    expect(result.url).toMatch(new RegExp(`https://test-deploy\\.local/sites/${projectId}/`));

    const deployedIndexObj = await DEPLOYMENTS_BUCKET.get(`sites/${projectId}/index.html`);
    expect(deployedIndexObj).not.toBeNull();
    const deployedIndex = await deployedIndexObj!.text();
    expect(deployedIndex).toBe(html);

    const deploymentMetaObj = await DEPLOYMENTS_BUCKET.get(`sites/${projectId}/.deployment.json`);
    expect(deploymentMetaObj).not.toBeNull();
  });
});

