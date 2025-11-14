/**
 * DeployService Test Suite (v1.1 canonical)
 * Following TDD approach - RED phase tests for DeployService
 * Tests drive the implementation with canonical errors and multi-bucket storage
 * 
 * Based on DAY5-TDD-STRATEGY.md Section 1.2b (lines 135-218)
 * This is the AUTHORITATIVE v1.1 specification
 * 
 * Test Coverage:
 * 1. deploys successful build artifacts to sites and updates project
 * 2. rejects failed builds
 * 3. requires artifacts presence
 * 4. serves SPA routes falling back to index.html with correct headers
 * 5. returns NOT_FOUND for missing files
 * 6. generates sanitized URLs and supports custom domains
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeployService } from '../../src/services/DeployService';
import { Ok, Err } from '../../src/lib/result';
import { DeploymentError, DeploymentErrorCode } from '../../src/lib/errors';
import { ProjectStatus } from '../../src/services/interfaces';

describe('DeployService (v1.1 canonical)', () => {
  let builds: any; // BUILDS_BUCKET storage
  let sites: any;  // SITES_BUCKET storage
  let projects: any;
  let buildsSvc: any;
  let svc: DeployService;

  beforeEach(() => {
    builds = { exists: vi.fn(), listFiles: vi.fn() };
    sites = { copyDirectory: vi.fn(), uploadFile: vi.fn(), downloadFile: vi.fn(), getMetadata: vi.fn() };
    projects = { updateProject: vi.fn() };
    buildsSvc = { getBuildStatus: vi.fn() };
    svc = new DeployService(builds as any, sites as any, projects as any, buildsSvc as any);
  });

  it('deploys successful build artifacts to sites and updates project', async () => {
    (buildsSvc.getBuildStatus as any).mockResolvedValue(Ok({ buildId: 'b1', projectId: 'p1', status: 'success', artifactPath: 'builds/p1/dist/' }));
    (builds.exists as any).mockResolvedValue(Ok(true));
    (sites.copyDirectory as any).mockResolvedValue(Ok(undefined));
    (sites.uploadFile as any).mockResolvedValue(Ok(undefined));
    (projects.updateProject as any).mockResolvedValue(Ok({ id: 'p1', status: ProjectStatus.DEPLOYED }));

    const res = await svc.deployBuild('b1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.deploymentUrl).toBe('http://localhost:8787/sites/p1/');
      expect(res.value.status).toBe('deployed');
    }
    expect(sites.copyDirectory).toHaveBeenCalledWith('builds/p1/dist/', 'sites/p1/');
  });

  it('rejects failed builds', async () => {
    (buildsSvc.getBuildStatus as any).mockResolvedValue(Ok({ buildId: 'b', projectId: 'p', status: 'failed' }));
    const res = await svc.deployBuild('b');
    expect(!res.ok && (res.error as DeploymentError).code === DeploymentErrorCode.BUILD_NOT_READY).toBe(true);
  });

  it('requires artifacts presence', async () => {
    (buildsSvc.getBuildStatus as any).mockResolvedValue(Ok({ buildId: 'b', projectId: 'p', status: 'success', artifactPath: 'builds/p/dist/' }));
    (builds.exists as any).mockResolvedValue(Ok(false));
    const res = await svc.deployBuild('b');
    expect(!res.ok && (res.error as DeploymentError).code === DeploymentErrorCode.INVALID_ARTIFACTS).toBe(true);
  });

  it('serves SPA routes falling back to index.html with correct headers', async () => {
    const html = '<html>SPA</html>';
    (sites.downloadFile as any)
      .mockResolvedValueOnce(Err({ code: 'STORAGE_NOT_FOUND' }))
      .mockResolvedValueOnce(Ok(new TextEncoder().encode(html).buffer));
    (sites.getMetadata as any).mockResolvedValue(Ok({ contentType: 'text/html' }));

    const res = await svc.serveSite('p', 'dashboard/route', { spa: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const body = new TextDecoder().decode(res.value.body);
      expect(body).toBe(html);
      expect(res.value.headers['Cache-Control']).toBeDefined();
    }
  });

  it('returns NOT_FOUND for missing files', async () => {
    (sites.downloadFile as any).mockResolvedValue(Err({ code: 'STORAGE_NOT_FOUND' }));
    const res = await svc.serveSite('p', 'missing.js');
    expect(!res.ok && (res.error as DeploymentError).code === DeploymentErrorCode.NOT_FOUND).toBe(true);
  });

  it('generates worker URLs for sanitized project ids and supports custom domains', () => {
    expect(svc.generateDeploymentUrl('my-project-123')).toBe('http://localhost:8787/sites/my-project-123/');
    expect(svc.generateDeploymentUrl('x', { customDomain: 'myapp.com' })).toBe('https://myapp.com');
  });

  it('writes deployment metadata after successful deployment', async () => {
    (buildsSvc.getBuildStatus as any).mockResolvedValue(Ok({ buildId: 'b2', projectId: 'p2', status: 'success', artifactPath: 'builds/p2/dist/' }));
    (builds.exists as any).mockResolvedValue(Ok(true));
    (sites.copyDirectory as any).mockResolvedValue(Ok(undefined));
    (sites.uploadFile as any).mockResolvedValue(Ok(undefined));
    (projects.updateProject as any).mockResolvedValue(Ok({ id: 'p2', status: ProjectStatus.DEPLOYED }));

    const res = await svc.deployBuild('b2');
    expect(res.ok).toBe(true);
    expect(sites.uploadFile).toHaveBeenCalledWith(
      'sites/p2/_deployment.json',
      expect.any(ArrayBuffer),
      expect.objectContaining({ contentType: 'application/json' })
    );
  });

  describe('security and headers hardening (RED)', () => {
    it('prevents path traversal when serving', async () => {
      const res = await svc.serveSite('p1', '../secrets.txt', { spa: false });
      expect(!res.ok && (res.error as DeploymentError).code === DeploymentErrorCode.NOT_FOUND).toBe(true);
      expect(sites.downloadFile).not.toHaveBeenCalledWith(expect.stringContaining('..'));
    });

    it('properly sanitizes paths with multiple slashes and trailing slashes', async () => {
      // Multiple consecutive slashes should be collapsed
      (sites.downloadFile as any).mockResolvedValueOnce(Ok(new TextEncoder().encode('test').buffer));
      (sites.getMetadata as any).mockResolvedValueOnce(Ok({ contentType: 'text/plain' }));
      
      const res1 = await svc.serveSite('p1', '///path///to///file.txt///');
      expect(res1.ok).toBe(true);
      expect(sites.downloadFile).toHaveBeenCalledWith('sites/p1/path/to/file.txt');
      
      // Reset mocks for next test
      vi.clearAllMocks();
      sites.downloadFile = vi.fn();
      sites.getMetadata = vi.fn();
      
      // Leading slashes should be removed
      (sites.downloadFile as any).mockResolvedValueOnce(Ok(new TextEncoder().encode('test').buffer));
      (sites.getMetadata as any).mockResolvedValueOnce(Ok({ contentType: 'text/plain' }));
      
      const res2 = await svc.serveSite('p1', '/static/app.js');
      expect(res2.ok).toBe(true);
      expect(sites.downloadFile).toHaveBeenCalledWith('sites/p1/static/app.js');
    });

    it('sets correct content-type and cache headers for css/js/svg', async () => {
      // css with metadata missing → fallback by extension
      (sites.downloadFile as any).mockResolvedValueOnce(Ok(new TextEncoder().encode('body{}').buffer));
      (sites.getMetadata as any).mockResolvedValueOnce(Err({ code: 'NO_METADATA' }));
      const css = await svc.serveSite('p1', 'styles/site.css');
      expect(css.ok).toBe(true);
      if (css.ok) {
        expect(css.value.contentType).toBe('text/css');
        expect(css.value.headers['Cache-Control']).toContain('max-age');
      }

      // js
      (sites.downloadFile as any).mockResolvedValueOnce(Ok(new TextEncoder().encode('console.log(1)').buffer));
      (sites.getMetadata as any).mockResolvedValueOnce(Err({ code: 'NO_METADATA' }));
      const js = await svc.serveSite('p1', 'app.mjs');
      expect(js.ok && js.value.contentType.includes('application/javascript')).toBe(true);

      // svg
      (sites.downloadFile as any).mockResolvedValueOnce(Ok(new TextEncoder().encode('<svg/>').buffer));
      (sites.getMetadata as any).mockResolvedValueOnce(Err({ code: 'NO_METADATA' }));
      const svg = await svc.serveSite('p1', 'icon.svg');
      expect(svg.ok && svg.value.contentType === 'image/svg+xml').toBe(true);
    });

    it('adds HTML security headers', async () => {
      const html = '<html></html>';
      (sites.downloadFile as any).mockResolvedValueOnce(Ok(new TextEncoder().encode(html).buffer));
      (sites.getMetadata as any).mockResolvedValueOnce(Ok({ contentType: 'text/html' }));
      const res = await svc.serveSite('p1', 'index.html');
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.headers['X-Content-Type-Options']).toBe('nosniff');
        expect(res.value.headers['X-Frame-Options']).toBe('SAMEORIGIN');
        expect(res.value.headers['X-XSS-Protection']).toContain('1');
      }
    });

    it('injects base tag and rewrites root-relative asset paths', async () => {
      const html = '<html><head><title>Test</title></head><body><script src="/assets/app.js"></script><link href="/style.css" rel="stylesheet"></body></html>';
      (sites.downloadFile as any).mockResolvedValueOnce(Ok(new TextEncoder().encode(html).buffer));
      (sites.getMetadata as any).mockResolvedValueOnce(Ok({ contentType: 'text/html' }));

      const res = await svc.serveSite('p1', 'index.html');
      expect(res.ok).toBe(true);
      if (res.ok) {
        const body = new TextDecoder().decode(res.value.body);
        expect(body).toContain('<base href="/sites/p1/">');
        expect(body).toContain('src="./assets/app.js"');
        expect(body).toContain('href="./style.css"');
      }
    });
  });

  it('normalizes double slashes and serves css with correct content-type', async () => {
    // download succeeds, metadata missing -> fallback by extension
    (sites.downloadFile as any).mockResolvedValueOnce(Ok(new TextEncoder().encode('body{}').buffer));
    (sites.getMetadata as any).mockResolvedValueOnce(Err({ code: 'NO_METADATA' }));

    const res = await svc.serveSite('p1', 'styles//site.css');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.contentType).toBe('text/css');
      expect(res.value.headers['Content-Type']).toBe('text/css');
    }
  });

  it('SPA fallback infers html content-type when metadata missing', async () => {
    const html = '<html>Index</html>';
    // First attempt: route file missing
    (sites.downloadFile as any)
      .mockResolvedValueOnce(Err({ code: 'STORAGE_NOT_FOUND' }))
      // Fallback to index.html
      .mockResolvedValueOnce(Ok(new TextEncoder().encode(html).buffer));
    // Force metadata miss to exercise extension-based detection on effective index.html
    (sites.getMetadata as any).mockResolvedValueOnce(Err({ code: 'NO_METADATA' }));

    const res = await svc.serveSite('p1', 'dashboard/route', { spa: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.contentType).toBe('text/html');
      expect(res.value.headers['Content-Type']).toBe('text/html');
    }
  });

  describe('concurrency control', () => {
    it('serializes concurrent deployments to the same project', async () => {
      const projectId = 'concurrent-project';
      let deployment1Started = false;
      let deployment1Finished = false;
      let deployment2Started = false;
      let deployment2Finished = false;

      // Set up build status to return same project ID
      (buildsSvc.getBuildStatus as any).mockImplementation(async (buildId: string) => {
        if (buildId === 'build1' || buildId === 'build2') {
          return Ok({ buildId, projectId, status: 'success', artifactPath: `builds/${projectId}/dist/` });
        }
        return Err({ code: 'NOT_FOUND' });
      });

      // Mock storage operations with delays to simulate real work
      (builds.exists as any).mockResolvedValue(Ok(true));
      (sites.copyDirectory as any).mockImplementation(async () => {
        // Track which deployment is executing
        if (!deployment1Started) {
          deployment1Started = true;
          await new Promise(resolve => setTimeout(resolve, 50)); // Simulate work
          deployment1Finished = true;
        } else {
          deployment2Started = true;
          // Second deployment should only start after first finishes
          expect(deployment1Finished).toBe(true);
          await new Promise(resolve => setTimeout(resolve, 10));
          deployment2Finished = true;
        }
        return Ok(undefined);
      });
      (sites.uploadFile as any).mockResolvedValue(Ok(undefined));
      (projects.updateProject as any).mockResolvedValue(Ok({ id: projectId, status: ProjectStatus.DEPLOYED }));

      // Start two concurrent deployments
      const deploy1Promise = svc.deployBuild('build1');
      const deploy2Promise = svc.deployBuild('build2');

      // Wait for both to complete
      const [result1, result2] = await Promise.all([deploy1Promise, deploy2Promise]);

      // Both should succeed
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      // Verify serialization occurred
      expect(deployment1Started).toBe(true);
      expect(deployment1Finished).toBe(true);
      expect(deployment2Started).toBe(true);
      expect(deployment2Finished).toBe(true);
    });

    it('allows concurrent deployments to different projects', async () => {
      let project1CopyStarted = false;
      let project2CopyStarted = false;
      let project1CopyFinished = false;
      let project2CopyFinished = false;

      // Set up build status for different projects
      (buildsSvc.getBuildStatus as any).mockImplementation(async (buildId: string) => {
        if (buildId === 'build-p1') {
          return Ok({ buildId, projectId: 'project1', status: 'success', artifactPath: 'builds/project1/dist/' });
        } else if (buildId === 'build-p2') {
          return Ok({ buildId, projectId: 'project2', status: 'success', artifactPath: 'builds/project2/dist/' });
        }
        return Err({ code: 'NOT_FOUND' });
      });

      (builds.exists as any).mockResolvedValue(Ok(true));
      
      // Track concurrent execution
      (sites.copyDirectory as any).mockImplementation(async (from: string) => {
        if (from.includes('project1')) {
          project1CopyStarted = true;
          await new Promise(resolve => setTimeout(resolve, 30));
          project1CopyFinished = true;
        } else if (from.includes('project2')) {
          project2CopyStarted = true;
          // Project 2 can start while project 1 is still running
          expect(project1CopyFinished).toBe(false);
          await new Promise(resolve => setTimeout(resolve, 20));
          project2CopyFinished = true;
        }
        return Ok(undefined);
      });
      
      (sites.uploadFile as any).mockResolvedValue(Ok(undefined));
      (projects.updateProject as any).mockResolvedValue(Ok({ id: 'p', status: ProjectStatus.DEPLOYED }));

      // Start deployments to different projects concurrently
      const deploy1Promise = svc.deployBuild('build-p1');
      const deploy2Promise = svc.deployBuild('build-p2');

      // Wait for both
      const [result1, result2] = await Promise.all([deploy1Promise, deploy2Promise]);

      // Both should succeed
      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      // Verify they ran concurrently (not serialized)
      expect(project1CopyStarted).toBe(true);
      expect(project2CopyStarted).toBe(true);
      expect(project1CopyFinished).toBe(true);
      expect(project2CopyFinished).toBe(true);
    });

    it('handles deployment failures correctly with concurrency control', async () => {
      const projectId = 'failing-project';

      (buildsSvc.getBuildStatus as any).mockImplementation(async (buildId: string) => {
        if (buildId === 'build-fail' || buildId === 'build-next') {
          return Ok({ buildId, projectId, status: 'success', artifactPath: `builds/${projectId}/dist/` });
        }
        return Err({ code: 'NOT_FOUND' });
      });

      (builds.exists as any).mockResolvedValue(Ok(true));
      
      let firstCallMade = false;
      (sites.copyDirectory as any).mockImplementation(async () => {
        if (!firstCallMade) {
          firstCallMade = true;
          // First deployment fails
          return Err({ code: 'STORAGE_ERROR', message: 'Copy failed' });
        }
        // Second deployment should be able to proceed after first fails
        return Ok(undefined);
      });

      (sites.uploadFile as any).mockResolvedValue(Ok(undefined));
      (projects.updateProject as any).mockResolvedValue(Ok({ id: projectId, status: ProjectStatus.DEPLOYED }));

      // First deployment fails
      const failResult = await svc.deployBuild('build-fail');
      expect(failResult.ok).toBe(false);

      // Second deployment to same project should succeed
      const successResult = await svc.deployBuild('build-next');
      expect(successResult.ok).toBe(true);
    });
  });
});
