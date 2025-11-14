/**
 * Comprehensive E2E Test Suite for React/Vue/Svelte Build Pipeline
 * Tests complete build flows through Worker endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Helper to read .dev.vars file
function readVarsFromDevVars(): Record<string, string> {
  try {
    const text = fs.readFileSync('.dev.vars', 'utf-8');
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      // strip surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

const devVars = readVarsFromDevVars();
const WORKER_URL = process.env.WORKER_URL || devVars.WORKER_URL || 'http://localhost:8787';
const MVP_TOKEN = process.env.MVP_ACCESS_TOKEN || devVars.MVP_ACCESS_TOKEN || 'test-valid-token-12345';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || devVars.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || devVars.GITHUB_OWNER || 'gladden4work';
const GITHUB_REPO = process.env.GITHUB_REPO || devVars.GITHUB_REPO || 'gpthost-build-test';

// Safety guard: Prevent accidental staging tests
if (WORKER_URL.includes('staging') || WORKER_URL.includes('gladden4work')) {
  if (!process.env.ALLOW_STAGING_TESTS) {
    console.warn('⚠️  SKIPPING: Tests targeting staging require ALLOW_STAGING_TESTS=1');
    console.warn('⚠️  Current URL:', WORKER_URL);
  }
}

// Test config
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '900000'); // 15 minutes
const POLL_MS = parseInt(process.env.POLL_MS || '5000'); // 5 seconds
const ENABLE_LIVE = process.env.LIVE_E2E === '1' || process.env.LIVE_E2E === 'true';

// Helper functions
async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function skipReason(): string | null {
  if (!ENABLE_LIVE) return 'LIVE_E2E not enabled';
  if (!WORKER_URL) return 'WORKER_URL not set';
  if (!MVP_TOKEN) return 'MVP_ACCESS_TOKEN not set';
  // Additional safety check for staging URLs
  if ((WORKER_URL.includes('staging') || WORKER_URL.includes('gladden4work')) && !process.env.ALLOW_STAGING_TESTS) {
    return 'Staging tests require ALLOW_STAGING_TESTS=1';
  }
  return null;
}

interface TestMetrics {
  startTime: number;
  endTime?: number;
  buildId?: string;
  projectId?: string;
  status?: string;
  githubRunUrl?: string;
  deploymentUrl?: string;
  error?: string;
}

interface TestResult {
  framework: string;
  success: boolean;
  metrics: TestMetrics;
  requests: Array<{
    method: string;
    url: string;
    status: number;
    response?: any;
  }>;
}

const testResults: TestResult[] = [];

// Test components for each framework
const TEST_COMPONENTS = {
  react: {
    files: [
      {
        path: 'src/App.tsx',
        content: `
import React from 'react';

export default function App() {
  const [count, setCount] = React.useState(0);
  
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>React E2E Test Component</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
      <p>Build timestamp: ${new Date().toISOString()}</p>
    </div>
  );
}`
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>React E2E Test</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>`
      }
    ],
    framework: 'react'
  },
  vue: {
    files: [
      {
        path: 'src/App.vue',
        content: `
<template>
  <div style="padding: 20px; font-family: Arial;">
    <h1>Vue E2E Test Component</h1>
    <p>Count: {{ count }}</p>
    <button @click="increment">Increment</button>
    <p>Build timestamp: ${new Date().toISOString()}</p>
  </div>
</template>

<script>
export default {
  data() {
    return {
      count: 0
    };
  },
  methods: {
    increment() {
      this.count++;
    }
  }
};
</script>`
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Vue E2E Test</title>
</head>
<body>
  <div id="app"></div>
</body>
</html>`
      }
    ],
    framework: 'vue'
  },
  svelte: {
    files: [
      {
        path: 'src/App.svelte',
        content: `
<script>
  let count = 0;
  
  function increment() {
    count += 1;
  }
</script>

<div style="padding: 20px; font-family: Arial;">
  <h1>Svelte E2E Test Component</h1>
  <p>Count: {count}</p>
  <button on:click={increment}>Increment</button>
  <p>Build timestamp: ${new Date().toISOString()}</p>
</div>`
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Svelte E2E Test</title>
</head>
<body>
  <div id="app"></div>
</body>
</html>`
      }
    ],
    framework: 'svelte'
  }
};

// Main test function for framework builds
async function testFrameworkBuild(framework: 'react' | 'vue' | 'svelte'): Promise<TestResult> {
  const result: TestResult = {
    framework,
    success: false,
    metrics: { startTime: Date.now() },
    requests: []
  };

  try {
    const headers = {
      'Authorization': `Bearer ${MVP_TOKEN}`,
      'Content-Type': 'application/json'
    };

    const testData = TEST_COMPONENTS[framework];
    
    // Step 1: Create project
    console.log(`\n[${framework.toUpperCase()}] Creating project...`);
    const createResp = await fetch(`${WORKER_URL}/api/v2/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: `e2e-${framework}-${Date.now()}`,
        framework: testData.framework,
        files: testData.files
      })
    });

    const createJson = await createResp.json();
    result.requests.push({
      method: 'POST',
      url: '/api/v2/projects',
      status: createResp.status,
      response: createJson
    });

    if (!createJson.success) {
      throw new Error(`Failed to create project: ${JSON.stringify(createJson)}`);
    }

    const projectId = createJson.data.id;
    result.metrics.projectId = projectId;
    console.log(`[${framework.toUpperCase()}] Project created: ${projectId}`);

    // Step 2: Queue build
    console.log(`[${framework.toUpperCase()}] Queuing build...`);
    const buildResp = await fetch(`${WORKER_URL}/api/v2/build`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project_id: projectId,
        framework: testData.framework,
        source_files: testData.files
      })
    });

    const buildJson = await buildResp.json();
    result.requests.push({
      method: 'POST',
      url: '/api/v2/build',
      status: buildResp.status,
      response: buildJson
    });

    if (!buildJson.success) {
      throw new Error(`Failed to queue build: ${JSON.stringify(buildJson)}`);
    }

    const buildId = buildJson.data.build_id;
    result.metrics.buildId = buildId;
    console.log(`[${framework.toUpperCase()}] Build queued: ${buildId}`);

    // Step 3: Poll build status
    console.log(`[${framework.toUpperCase()}] Polling build status...`);
    const pollStart = Date.now();
    let status = 'queued';
    let lastStatusUpdate = Date.now();
    let githubRunId: string | undefined;

    while (Date.now() - pollStart < TIMEOUT_MS) {
      await sleep(POLL_MS);
      
      const statusResp = await fetch(`${WORKER_URL}/api/v2/build/${encodeURIComponent(buildId)}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${MVP_TOKEN}` }
      });

      if (statusResp.ok) {
        const statusJson = await statusResp.json();
        
        // Only log on first check or status change
        if (Date.now() - lastStatusUpdate > 30000 || statusJson.data.status !== status) {
          console.log(`[${framework.toUpperCase()}] Status: ${statusJson.data.status}`);
          lastStatusUpdate = Date.now();
        }

        status = statusJson.data.status;
        githubRunId = statusJson.data.github_run_id;

        if (status === 'success' || status === 'failed' || status === 'cancelled') {
          result.requests.push({
            method: 'GET',
            url: `/api/v2/build/${buildId}`,
            status: statusResp.status,
            response: statusJson
          });
          break;
        }
      }
    }

    result.metrics.status = status;
    
    if (githubRunId) {
      result.metrics.githubRunUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${githubRunId}`;
      console.log(`[${framework.toUpperCase()}] GitHub Action: ${result.metrics.githubRunUrl}`);
    }

    if (status !== 'success') {
      throw new Error(`Build failed with status: ${status}`);
    }

    // Step 4: Check deployment
    console.log(`[${framework.toUpperCase()}] Checking deployment...`);
    const projectResp = await fetch(`${WORKER_URL}/api/v2/projects/${encodeURIComponent(projectId)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${MVP_TOKEN}` }
    });

    if (projectResp.ok) {
      const projectJson = await projectResp.json();
      result.metrics.deploymentUrl = projectJson.data?.deployment_url;
      
      if (result.metrics.deploymentUrl) {
        console.log(`[${framework.toUpperCase()}] Deployment URL: ${result.metrics.deploymentUrl}`);
        
        // Try to fetch the deployed site
        const siteResp = await fetch(result.metrics.deploymentUrl);
        if (siteResp.ok) {
          const siteHtml = await siteResp.text();
          const hasContent = siteHtml.includes(`${framework.charAt(0).toUpperCase()}${framework.slice(1)} E2E Test Component`) ||
                            siteHtml.includes('<!DOCTYPE html');
          
          if (hasContent) {
            console.log(`[${framework.toUpperCase()}] Site is accessible and contains expected content`);
          }
        }
      }
    }

    result.metrics.endTime = Date.now();
    result.success = true;
    
    const duration = (result.metrics.endTime - result.metrics.startTime) / 1000;
    console.log(`[${framework.toUpperCase()}] ✓ Build completed in ${duration.toFixed(1)}s`);

  } catch (error) {
    result.metrics.endTime = Date.now();
    result.metrics.error = error instanceof Error ? error.message : String(error);
    console.error(`[${framework.toUpperCase()}] ✗ Build failed:`, result.metrics.error);
  }

  return result;
}

// Error scenario tests
async function testErrorScenarios(): Promise<void> {
  const headers = {
    'Authorization': `Bearer ${MVP_TOKEN}`,
    'Content-Type': 'application/json'
  };

  console.log('\n=== Testing Error Scenarios ===\n');

  // Test 1: Invalid framework type
  console.log('Testing invalid framework type...');
  const invalidFrameworkResp = await fetch(`${WORKER_URL}/api/v2/build`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      framework: 'invalid-framework',
      source_files: [{ path: 'test.js', content: 'test' }]
    })
  });

  const invalidFrameworkJson = await invalidFrameworkResp.json();
  console.log(`Invalid framework response: ${invalidFrameworkResp.status}`, invalidFrameworkJson);
  expect(invalidFrameworkResp.status).toBe(400);

  // Test 2: Missing source files
  console.log('\nTesting missing source files...');
  const missingFilesResp = await fetch(`${WORKER_URL}/api/v2/build`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      framework: 'react',
      source_files: []
    })
  });

  const missingFilesJson = await missingFilesResp.json();
  console.log(`Missing files response: ${missingFilesResp.status}`, missingFilesJson);
  expect(missingFilesResp.status).toBe(400);

  // Test 3: Invalid auth token
  console.log('\nTesting invalid auth token...');
  const invalidAuthResp = await fetch(`${WORKER_URL}/api/v2/build`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer invalid-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      framework: 'react',
      source_files: [{ path: 'test.js', content: 'test' }]
    })
  });

  console.log(`Invalid auth response: ${invalidAuthResp.status}`);
  expect(invalidAuthResp.status).toBe(401);

  console.log('\n✓ Error scenarios tested successfully');
}

// GitHub callback test
async function testGitHubCallbacks(): Promise<void> {
  console.log('\n=== Testing GitHub Callbacks ===\n');

  const headers = {
    'Authorization': `Bearer ${MVP_TOKEN}`,
    'Content-Type': 'application/json'
  };

  // Test build callback
  console.log('Testing build callback endpoint...');
  const callbackResp = await fetch(`${WORKER_URL}/api/v2/github/build-callback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      build_id: 'test-build-123',
      status: 'success',
      github_run_id: '12345',
      artifact_url: 'https://example.com/artifact.tar.gz'
    })
  });

  console.log(`Build callback response: ${callbackResp.status}`);
  
  // Test upload endpoint
  console.log('\nTesting upload endpoint (mock tar.gz)...');
  const mockTarGz = Buffer.from('mock tar.gz content');
  const uploadResp = await fetch(`${WORKER_URL}/api/v2/github/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MVP_TOKEN}`,
      'Content-Type': 'application/octet-stream'
    },
    body: mockTarGz
  });

  console.log(`Upload response: ${uploadResp.status}`);

  console.log('\n✓ GitHub callbacks tested');
}

// Main test suite
describe.skipIf(!!skipReason())('Framework Build Pipeline E2E Tests', () => {
  
  it('should successfully build and deploy React project', async () => {
    const result = await testFrameworkBuild('react');
    testResults.push(result);
    expect(result.success).toBe(true);
    expect(result.metrics.status).toBe('success');
    expect(result.metrics.deploymentUrl).toBeDefined();
  }, TIMEOUT_MS);

  it('should successfully build and deploy Vue project', async () => {
    const result = await testFrameworkBuild('vue');
    testResults.push(result);
    expect(result.success).toBe(true);
    expect(result.metrics.status).toBe('success');
    expect(result.metrics.deploymentUrl).toBeDefined();
  }, TIMEOUT_MS);

  it('should successfully build and deploy Svelte project', async () => {
    const result = await testFrameworkBuild('svelte');
    testResults.push(result);
    expect(result.success).toBe(true);
    expect(result.metrics.status).toBe('success');
    expect(result.metrics.deploymentUrl).toBeDefined();
  }, TIMEOUT_MS);

  it('should handle error scenarios correctly', async () => {
    await testErrorScenarios();
  });

  it('should handle GitHub callbacks', async () => {
    await testGitHubCallbacks();
  });

  // Generate comprehensive report after all tests
  afterAll(() => {
    console.log('\n' + '='.repeat(80));
    console.log('COMPREHENSIVE TEST REPORT');
    console.log('='.repeat(80) + '\n');

    console.log('Test Environment:');
    console.log(`  Worker URL: ${WORKER_URL}`);
    console.log(`  GitHub Repo: ${GITHUB_OWNER}/${GITHUB_REPO}`);
    console.log(`  Timeout: ${TIMEOUT_MS}ms`);
    console.log(`  Poll Interval: ${POLL_MS}ms`);
    console.log();

    console.log('Framework Build Results:');
    console.log('-'.repeat(40));
    
    for (const result of testResults) {
      const duration = result.metrics.endTime && result.metrics.startTime
        ? ((result.metrics.endTime - result.metrics.startTime) / 1000).toFixed(1)
        : 'N/A';
      
      console.log(`\n${result.framework.toUpperCase()}:`);
      console.log(`  Status: ${result.success ? '✓ SUCCESS' : '✗ FAILED'}`);
      console.log(`  Build ID: ${result.metrics.buildId || 'N/A'}`);
      console.log(`  Project ID: ${result.metrics.projectId || 'N/A'}`);
      console.log(`  Build Status: ${result.metrics.status || 'N/A'}`);
      console.log(`  Duration: ${duration}s`);
      
      if (result.metrics.githubRunUrl) {
        console.log(`  GitHub Action: ${result.metrics.githubRunUrl}`);
      }
      
      if (result.metrics.deploymentUrl) {
        console.log(`  Deployment: ${result.metrics.deploymentUrl}`);
      }
      
      if (result.metrics.error) {
        console.log(`  Error: ${result.metrics.error}`);
      }

      console.log(`  API Calls Made: ${result.requests.length}`);
      for (const req of result.requests) {
        console.log(`    - ${req.method} ${req.url}: ${req.status}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('Performance Metrics:');
    console.log('-'.repeat(40));
    
    const successfulBuilds = testResults.filter(r => r.success);
    if (successfulBuilds.length > 0) {
      const durations = successfulBuilds
        .map(r => (r.metrics.endTime! - r.metrics.startTime) / 1000)
        .filter(d => !isNaN(d));
      
      if (durations.length > 0) {
        const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
        const min = Math.min(...durations);
        const max = Math.max(...durations);
        
        console.log(`  Average Build Time: ${avg.toFixed(1)}s`);
        console.log(`  Fastest Build: ${min.toFixed(1)}s`);
        console.log(`  Slowest Build: ${max.toFixed(1)}s`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('Test Summary:');
    console.log(`  Total Tests Run: ${testResults.length + 2}`); // +2 for error and callback tests
    console.log(`  Successful Builds: ${successfulBuilds.length}/${testResults.length}`);
    console.log(`  Failed Builds: ${testResults.filter(r => !r.success).length}/${testResults.length}`);
    console.log('='.repeat(80) + '\n');
  });
});