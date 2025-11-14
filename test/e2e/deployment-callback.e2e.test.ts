/**
 * Day 7: Comprehensive E2E Test Suite for Automatic Deployment
 * 
 * This test suite validates that the GitHub callback properly triggers
 * automatic deployment when builds succeed, addressing the critical
 * issue discovered during Day 6 integration testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Env } from '../../src/types/env';
import { handleGitHubCallback } from '../../src/routes/api/v2/github';
import { ServiceFactory } from '../../src/services/ServiceFactory';

// Mock environment setup
function createMockEnv(): Env {
  const storage = new Map<string, ArrayBuffer>();
  
  return {
    MVP_ACCESS_TOKEN: 'test-mvp-token-2025',
    GITHUB_CALLBACK_TOKEN: 'gpthost-test-token-2025',
    // Enable new services for E2E
    FEATURE_FLAGS: JSON.stringify({
      useNewStorageService: true,
      useNewProjectService: true,
      useNewGitHubService: true,
      useNewBuildService: true,
      useNewDeployService: true,
      useMonitoring: false
    }),
    WORKER_URL: 'http://localhost:8787',
    PROJECTS_BUCKET: {
      get: async (key: string) => {
        const data = storage.get(key);
        return data ? {
          body: data,
          bodyUsed: false,
          arrayBuffer: async () => data,
          text: async () => new TextDecoder().decode(data),
          json: async () => JSON.parse(new TextDecoder().decode(data)),
          blob: async () => new Blob([data]),
          etag: '"mock-etag"',
          key,
          size: data.byteLength,
          uploaded: new Date(),
          httpMetadata: {},
          customMetadata: {}
        } : null;
      },
      put: async (key: string, value: ArrayBuffer | string) => {
        const buffer = typeof value === 'string' 
          ? new TextEncoder().encode(value).buffer 
          : value;
        storage.set(key, buffer);
        return {
          etag: '"mock-etag"',
          uploaded: new Date()
        };
      },
      list: async (options?: { prefix?: string }) => {
        const objects = Array.from(storage.keys())
          .filter(key => !options?.prefix || key.startsWith(options.prefix))
          .map(key => ({
            key,
            size: storage.get(key)!.byteLength,
            etag: '"mock-etag"',
            uploaded: new Date(),
            httpMetadata: {},
            customMetadata: {}
          }));
        return {
          objects,
          truncated: false,
          cursor: undefined
        };
      },
      delete: async (key: string) => {
        storage.delete(key);
      }
    } as any,
    BUILDS_BUCKET: {
      get: async (key: string) => {
        const effectiveKey = key.startsWith('builds/') ? key : `builds/${key}`;
        const data = storage.get(effectiveKey);
        return data ? {
          body: data,
          bodyUsed: false,
          arrayBuffer: async () => data,
          text: async () => new TextDecoder().decode(data),
          json: async () => JSON.parse(new TextDecoder().decode(data)),
          blob: async () => new Blob([data]),
          etag: '"mock-etag"',
          key,
          size: data.byteLength,
          uploaded: new Date(),
          httpMetadata: {},
          customMetadata: {}
        } : null;
      },
      put: async (key: string, value: ArrayBuffer | string) => {
        const buffer = typeof value === 'string' 
          ? new TextEncoder().encode(value).buffer 
          : value;
        storage.set(`builds/${key}`, buffer);
        return {
          etag: '"mock-etag"',
          uploaded: new Date()
        };
      },
      list: async (options?: { prefix?: string }) => {
        const prefix = options?.prefix
          ? (options.prefix.startsWith('builds/') ? options.prefix : `builds/${options.prefix}`)
          : 'builds/';
        const objects = Array.from(storage.keys())
          .filter(key => key.startsWith(prefix))
          .map(key => ({
            key, // keep full key for correct path replacement
            size: storage.get(key)!.byteLength,
            etag: '"mock-etag"',
            uploaded: new Date(),
            httpMetadata: {},
            customMetadata: {}
          }));
        return {
          objects,
          truncated: false,
          cursor: undefined
        };
      }
    } as any,
    DEPLOYMENTS_BUCKET: {
      get: async (key: string) => {
        const effectiveKey = key.startsWith('sites/') ? key : `sites/${key}`;
        const data = storage.get(effectiveKey);
        return data ? {
          body: data,
          bodyUsed: false,
          arrayBuffer: async () => data,
          text: async () => new TextDecoder().decode(data),
          json: async () => JSON.parse(new TextDecoder().decode(data)),
          blob: async () => new Blob([data]),
          etag: '"mock-etag"',
          key,
          size: data.byteLength,
          uploaded: new Date(),
          httpMetadata: {},
          customMetadata: {}
        } : null;
      },
      put: async (key: string, value: ArrayBuffer | string) => {
        const buffer = typeof value === 'string' 
          ? new TextEncoder().encode(value).buffer 
          : value;
        const effectiveKey = key.startsWith('sites/') ? key : `sites/${key}`;
        storage.set(effectiveKey, buffer);
        return {
          etag: '"mock-etag"',
          uploaded: new Date()
        };
      },
      list: async (options?: { prefix?: string }) => {
        const prefix = options?.prefix
          ? (options.prefix.startsWith('sites/') ? options.prefix : `sites/${options.prefix}`)
          : 'sites/';
        const objects = Array.from(storage.keys())
          .filter(key => key.startsWith(prefix))
          .map(key => ({
            key,
            size: storage.get(key)!.byteLength,
            etag: '"mock-etag"',
            uploaded: new Date(),
            httpMetadata: {},
            customMetadata: {}
          }));
        return {
          objects,
          truncated: false,
          cursor: undefined
        };
      }
    } as any
  };
}

// Helpers to seed minimal metadata so callback can resolve buildId and complete build
async function seedProjectAndBuild(
  env: Env,
  args: { projectId: string; buildId: string; runId: string; framework?: string }
): Promise<void> {
  const { projectId, buildId, runId, framework = 'react' } = args;
  const now = new Date().toISOString();

  // 1) Seed project metadata so ProjectService.getProject(projectId) succeeds
  const projectMeta = {
    id: projectId,
    name: `${projectId}-name`,
    description: 'E2E seeded project',
    framework,
    status: 'building', // allow transition to deploying in BuildService.completeBuild
    files: [],
    buildId, // allow fallback if run map missing
    createdAt: now,
    updatedAt: now
  } as any;
  await (env as any).PROJECTS_BUCKET.put(`projects/${projectId}/metadata.json`, JSON.stringify(projectMeta));

  // 2) Seed build job metadata in the path BuildService expects (PROJECTS bucket)
  const buildJob = {
    buildId,
    projectId,
    status: 'queued',
    createdAt: now,
    retryCount: 0
  } as any;
  await (env as any).PROJECTS_BUCKET.put(`builds/${buildId}/metadata.json`, JSON.stringify(buildJob));

  // 3) Seed runId→buildId map for primary resolution path
  const runMap = {
    projectId,
    buildId,
    githubRunId: runId,
    createdAt: now
  };
  await (env as any).PROJECTS_BUCKET.put(`projects/${projectId}/github-runs/${runId}.json`, JSON.stringify(runMap));
}

describe('GitHub Callback → Automatic Deployment E2E Tests', () => {
  let env: Env;

  beforeEach(() => {
    env = createMockEnv();
    // Reset ServiceFactory instances
    (ServiceFactory as any).instances = {};
  });

  afterEach(() => {
    // Cleanup
    (ServiceFactory as any).instances = {};
  });

  describe('Successful Build Callback', () => {
    it('should automatically deploy when GitHub callback reports success with R2 path', async () => {
      // Arrange: Create a project
      const projectId = 'test-react-app-123';
      const projectService = ServiceFactory.getProjectService(env);
      
      await projectService.createProject({
        projectId,
        name: 'Test React App',
        framework: 'react',
        sourceFiles: {
          'App.tsx': 'export default function App() { return <div>Hello</div>; }',
          'main.tsx': 'import App from "./App"; render(<App />, document.getElementById("root"));'
        }
      });

      // Simulate build artifacts in R2 (as if GitHub Actions uploaded them)
      const buildPath = `builds/${projectId}/dist/`;
      const indexHtml = '<html><body><div id="root"></div><script src="/main.js"></script></body></html>';
      const mainJs = 'console.log("React app bundled code");';
      
      await env.BUILDS_BUCKET.put(`${projectId}/dist/index.html`, indexHtml);
      await env.BUILDS_BUCKET.put(`${projectId}/dist/main.js`, mainJs);

      // Seed project/build metadata + run map to enable completed path
      const buildId = `build-${projectId}-1`;
      await seedProjectAndBuild(env, { projectId, buildId, runId: '123456789', framework: 'react' });

      // Act: Simulate GitHub callback with success status
      const request = new Request('https://worker.dev/api/v2/github/callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_CALLBACK_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Request-ID': 'test-request-123'
        },
        body: JSON.stringify({
          project_id: projectId,
          status: 'success',
          github_run_id: '123456789',
          github_run_url: 'https://github.com/test/actions/runs/123456789',
          r2_build_path: buildPath,
          timestamp: new Date().toISOString()
        })
      });

      const response = await handleGitHubCallback(request, env);
      const responseData = await response.json() as any;

      // Assert: Check response
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data.status).toBe('completed');
      expect(responseData.data.deployment_url).toBeDefined();
      expect(responseData.data.deployment_url).toBe(`http://localhost:8787/sites/${projectId}/`);

      // Verify deployment artifacts were copied to sites bucket
      const deployedIndex = await env.DEPLOYMENTS_BUCKET.get(`${projectId}/index.html`);
      expect(deployedIndex).toBeTruthy();
      const deployedIndexContent = await deployedIndex!.text();
      expect(deployedIndexContent).toBe(indexHtml);

      const deployedMain = await env.DEPLOYMENTS_BUCKET.get(`${projectId}/main.js`);
      expect(deployedMain).toBeTruthy();
      const deployedMainContent = await deployedMain!.text();
      expect(deployedMainContent).toBe(mainJs);

      // Verify deployment metadata was written
      const metadata = await env.DEPLOYMENTS_BUCKET.get(`${projectId}/_deployment.json`);
      expect(metadata).toBeTruthy();
      const metadataContent = await metadata!.json() as any;
      expect(metadataContent.projectId).toBe(projectId);
      expect(metadataContent.status).toBe('deployed');
      expect(metadataContent.deployedFrom).toBe('github-callback');
    });

    it('should handle missing R2 build path gracefully', async () => {
      // Arrange: Create a project
      const projectId = 'test-vue-app-456';
      const projectService = ServiceFactory.getProjectService(env);
      
      await projectService.createProject({
        projectId,
        name: 'Test Vue App',
        framework: 'vue',
        sourceFiles: {
          'App.vue': '<template><div>Hello Vue</div></template>'
        }
      });

      // Seed metadata for completed path without deployment
      const buildId = `build-${projectId}-1`;
      await seedProjectAndBuild(env, { projectId, buildId, runId: '987654321', framework: 'vue' });

      // Act: Simulate callback WITHOUT r2_build_path
      const request = new Request('https://worker.dev/api/v2/github/callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_CALLBACK_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Request-ID': 'test-request-456'
        },
        body: JSON.stringify({
          project_id: projectId,
          status: 'success',
          github_run_id: '987654321',
          github_run_url: 'https://github.com/test/actions/runs/987654321'
          // NOTE: No r2_build_path provided
        })
      });

      const response = await handleGitHubCallback(request, env);
      const responseData = await response.json() as any;

      // Assert: Should acknowledge but not deploy
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data.status).toBe('completed');
      expect(responseData.data.deployment_url).toBeUndefined();
      expect(responseData.data.message).toContain('Build completed successfully');

      // Verify no deployment occurred
      const deployedFiles = await env.DEPLOYMENTS_BUCKET.list({ prefix: `${projectId}/` });
      expect(deployedFiles.objects.length).toBe(0);
    });

    it('should not deploy when build status is failure', async () => {
      // Arrange: Create a project
      const projectId = 'test-svelte-app-789';
      const projectService = ServiceFactory.getProjectService(env);
      
      await projectService.createProject({
        projectId,
        name: 'Test Svelte App',
        framework: 'svelte',
        sourceFiles: {
          'App.svelte': '<main>Hello Svelte</main>'
        }
      });

      // Seed metadata for failure path
      const buildId = `build-${projectId}-1`;
      await seedProjectAndBuild(env, { projectId, buildId, runId: '111222333', framework: 'svelte' });

      // Act: Simulate callback with failure status
      const request = new Request('https://worker.dev/api/v2/github/callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_CALLBACK_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Request-ID': 'test-request-789'
        },
        body: JSON.stringify({
          project_id: projectId,
          status: 'failure',
          github_run_id: '111222333',
          github_run_url: 'https://github.com/test/actions/runs/111222333',
          r2_build_path: `builds/${projectId}/dist/`,
          error: 'Build failed: TypeScript compilation error'
        })
      });

      const response = await handleGitHubCallback(request, env);
      const responseData = await response.json() as any;

      // Assert: Should record failure without attempting deployment
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data.status).toBe('failed');
      expect(responseData.data.deployment_url).toBeUndefined();
      expect(responseData.data.message).toContain('Build failure recorded');

      // Verify no deployment occurred
      const deployedFiles = await env.DEPLOYMENTS_BUCKET.list({ prefix: `${projectId}/` });
      expect(deployedFiles.objects.length).toBe(0);
    });
  });

  describe('Deployment Service Integration', () => {
    it('should handle deployment failures gracefully without failing callback', async () => {
      // Arrange: Create project but DON'T create build artifacts
      const projectId = 'test-missing-artifacts';
      const projectService = ServiceFactory.getProjectService(env);
      
      await projectService.createProject({
        projectId,
        name: 'Test Missing Artifacts',
        framework: 'react',
        sourceFiles: {
          'App.tsx': 'export default function App() { return <div>Test</div>; }'
        }
      });

      // Seed metadata
      const buildId = `build-${projectId}-1`;
      await seedProjectAndBuild(env, { projectId, buildId, runId: '555666777', framework: 'react' });

      // Act: Simulate callback with R2 path that doesn't exist
      const request = new Request('https://worker.dev/api/v2/github/callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_CALLBACK_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          project_id: projectId,
          status: 'success',
          github_run_id: '555666777',
          r2_build_path: `builds/${projectId}/nonexistent/`
        })
      });

      const response = await handleGitHubCallback(request, env);
      const responseData = await response.json() as any;

      // Assert: Callback should succeed even if deployment fails
      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data.status).toBe('completed');
      expect(responseData.data.deployment_url).toBeUndefined();
      
      // Build completion was recorded successfully
      expect(responseData.data.message).toContain('Build completed successfully');
    });

    it('should deploy multiple files correctly', async () => {
      // Arrange: Complex React app with multiple assets
      const projectId = 'complex-react-app';
      const projectService = ServiceFactory.getProjectService(env);
      
      await projectService.createProject({
        projectId,
        name: 'Complex React App',
        framework: 'react',
        sourceFiles: {
          'App.tsx': 'export default function App() { return <div>Complex</div>; }'
        }
      });

      // Simulate multiple build artifacts
      const files = {
        'index.html': '<!DOCTYPE html><html><head><link rel="stylesheet" href="/assets/style.css"></head><body><div id="root"></div></body></html>',
        'assets/main.js': 'console.log("Main bundle");',
        'assets/style.css': 'body { font-family: Arial; }',
        'assets/logo.svg': '<svg><circle cx="50" cy="50" r="40"/></svg>',
        'assets/vendor.js': 'console.log("Vendor bundle");'
      };

      for (const [path, content] of Object.entries(files)) {
        await env.BUILDS_BUCKET.put(`${projectId}/dist/${path}`, content);
      }

      // Seed metadata
      const buildId = `build-${projectId}-1`;
      await seedProjectAndBuild(env, { projectId, buildId, runId: '999888777', framework: 'react' });

      // Act: Trigger deployment via callback
      const request = new Request('https://worker.dev/api/v2/github/callback', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_CALLBACK_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          project_id: projectId,
          status: 'success',
          github_run_id: '999888777',
          r2_build_path: `builds/${projectId}/dist/`
        })
      });

      const response = await handleGitHubCallback(request, env);
      const responseData = await response.json() as any;

      // Assert: All files should be deployed
      expect(response.status).toBe(200);
      expect(responseData.data.deployment_url).toBeDefined();

      // Verify each file was deployed correctly
      for (const [path, expectedContent] of Object.entries(files)) {
        const deployedFile = await env.DEPLOYMENTS_BUCKET.get(`${projectId}/${path}`);
        expect(deployedFile).toBeTruthy();
        const actualContent = await deployedFile!.text();
        expect(actualContent).toBe(expectedContent);
      }
    });
  });

  describe('Concurrent Deployment Protection', () => {
    it('should serialize deployments for the same project', async () => {
      const projectId = 'concurrent-test';
      const projectService = ServiceFactory.getProjectService(env);
      
      await projectService.createProject({
        projectId,
        name: 'Concurrent Test',
        framework: 'react',
        sourceFiles: {
          'App.tsx': 'export default function App() { return <div>Concurrent</div>; }'
        }
      });

      // Create multiple build versions
      const buildVersions = ['v1', 'v2', 'v3'];
      for (const version of buildVersions) {
        await env.BUILDS_BUCKET.put(
          `${projectId}/${version}/dist/index.html`,
          `<html>Version ${version}</html>`
        );
      }

      // Seed metadata for each run
      for (const version of buildVersions) {
        const buildId = `build-${projectId}-${version}`;
        await seedProjectAndBuild(env, { projectId, buildId, runId: `run-${version}`, framework: 'react' });
      }

      // Act: Send multiple callbacks simultaneously
      const requests = buildVersions.map(version => 
        new Request('https://worker.dev/api/v2/github/callback', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.GITHUB_CALLBACK_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            project_id: projectId,
            status: 'success',
            github_run_id: `run-${version}`,
            r2_build_path: `builds/${projectId}/${version}/dist/`
          })
        })
      );

      // Execute callbacks concurrently
      const responses = await Promise.all(
        requests.map(req => handleGitHubCallback(req, env))
      );

      // Assert: All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200);
        const data = await response.json() as any;
        expect(data.success).toBe(true);
        expect(data.data.deployment_url).toBeDefined();
      }

      // The last deployment should win (v3)
      const finalDeployment = await env.DEPLOYMENTS_BUCKET.get(`${projectId}/index.html`);
      const finalContent = await finalDeployment!.text();
      expect(finalContent).toBe('<html>Version v3</html>');
    });
  });
});
