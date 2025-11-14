#!/usr/bin/env node

/**
 * Direct E2E Test Runner for React/Vue/Svelte Build Pipeline
 * Runs comprehensive tests against the staging Worker
 */

const fs = require('fs');
const path = require('path');

// Read .dev.vars
function readDevVars() {
  try {
    const content = fs.readFileSync('.dev.vars', 'utf-8');
    const vars = {};
    content.split('\n').forEach(line => {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) {
        let value = match[2];
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        vars[match[1]] = value;
      }
    });
    return vars;
  } catch (error) {
    console.error('Error reading .dev.vars:', error);
    return {};
  }
}

const vars = readDevVars();
const WORKER_URL = vars.WORKER_URL || 'https://gpthost-builder-staging.gladden4work.workers.dev';
const MVP_TOKEN = vars.MVP_ACCESS_TOKEN || 'test-valid-token-12345';
const GITHUB_OWNER = vars.GITHUB_OWNER || 'gladden4work';
const GITHUB_REPO = vars.GITHUB_REPO || 'gpthost-build-test';

console.log('\n🚀 Starting Comprehensive E2E Tests for Framework Build Pipeline');
console.log('=' .repeat(80));
console.log('Configuration:');
console.log(`  Worker URL: ${WORKER_URL}`);
console.log(`  GitHub Repo: ${GITHUB_OWNER}/${GITHUB_REPO}`);
console.log(`  Auth Token: ${MVP_TOKEN.substring(0, 10)}...`);
console.log('=' .repeat(80));

// Test components
const TEST_COMPONENTS = {
  react: {
    files: [
      {
        path: 'src/App.tsx',
        content: `import React from 'react';

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
      }
    ],
    framework: 'react'
  },
  vue: {
    files: [
      {
        path: 'src/App.vue',
        content: `<template>
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
      }
    ],
    framework: 'vue'
  },
  svelte: {
    files: [
      {
        path: 'src/App.svelte',
        content: `<script>
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
      }
    ],
    framework: 'svelte'
  }
};

// Test results storage
const testResults = [];

// Helper function to sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Main test function
async function testFrameworkBuild(framework) {
  const startTime = Date.now();
  const result = {
    framework,
    success: false,
    error: null,
    buildId: null,
    projectId: null,
    deploymentUrl: null,
    githubRunUrl: null,
    duration: null,
    requests: []
  };

  try {
    console.log(`\n📦 Testing ${framework.toUpperCase()} Build`);
    console.log('-'.repeat(40));

    const testData = TEST_COMPONENTS[framework];
    const headers = {
      'Authorization': `Bearer ${MVP_TOKEN}`,
      'Content-Type': 'application/json'
    };

    // Step 1: Create project
    console.log('  1️⃣ Creating project...');
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

    if (!createResp.ok || !createJson.success) {
      throw new Error(`Failed to create project: ${JSON.stringify(createJson)}`);
    }

    result.projectId = createJson.data.id;
    console.log(`     ✓ Project created: ${result.projectId}`);

    // Step 2: Queue build using v2 endpoint
    console.log('  2️⃣ Queuing build via /api/v2/build...');
    const buildResp = await fetch(`${WORKER_URL}/api/v2/build`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project_id: result.projectId,
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

    if (!buildResp.ok || !buildJson.success) {
      throw new Error(`Failed to queue build: ${JSON.stringify(buildJson)}`);
    }

    result.buildId = buildJson.data.build_id;
    console.log(`     ✓ Build queued: ${result.buildId}`);

    // Step 3: Poll build status
    console.log('  3️⃣ Polling build status...');
    const pollStart = Date.now();
    const TIMEOUT_MS = 900000; // 15 minutes
    const POLL_MS = 5000; // 5 seconds
    let status = 'queued';
    let lastStatus = '';
    let githubRunId = null;

    while (Date.now() - pollStart < TIMEOUT_MS) {
      await sleep(POLL_MS);
      
      const statusResp = await fetch(`${WORKER_URL}/api/v2/build/${encodeURIComponent(result.buildId)}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${MVP_TOKEN}` }
      });

      if (statusResp.ok) {
        const statusJson = await statusResp.json();
        status = statusJson.data?.status || 'unknown';
        githubRunId = statusJson.data?.github_run_id;
        
        // Only log on status change
        if (status !== lastStatus) {
          console.log(`     Status: ${status}`);
          lastStatus = status;
        }

        if (status === 'success' || status === 'failed' || status === 'cancelled') {
          break;
        }
      }
    }

    if (githubRunId) {
      result.githubRunUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${githubRunId}`;
      console.log(`     GitHub Action: ${result.githubRunUrl}`);
    }

    if (status !== 'success') {
      throw new Error(`Build failed with status: ${status}`);
    }

    console.log(`     ✓ Build completed successfully`);

    // Step 4: Check deployment
    console.log('  4️⃣ Checking deployment...');
    const projectResp = await fetch(`${WORKER_URL}/api/v2/projects/${encodeURIComponent(result.projectId)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${MVP_TOKEN}` }
    });

    if (projectResp.ok) {
      const projectJson = await projectResp.json();
      result.deploymentUrl = projectJson.data?.deployment_url;
      
      if (result.deploymentUrl) {
        console.log(`     ✓ Deployment URL: ${result.deploymentUrl}`);
        
        // Try to fetch the deployed site
        try {
          const siteResp = await fetch(result.deploymentUrl);
          if (siteResp.ok) {
            console.log(`     ✓ Site is accessible (HTTP ${siteResp.status})`);
          }
        } catch (e) {
          console.log(`     ⚠ Could not verify site accessibility`);
        }
      }
    }

    result.success = true;
    result.duration = (Date.now() - startTime) / 1000;
    console.log(`\n  ✅ ${framework.toUpperCase()} build completed in ${result.duration.toFixed(1)}s`);

  } catch (error) {
    result.error = error.message;
    result.duration = (Date.now() - startTime) / 1000;
    console.error(`\n  ❌ ${framework.toUpperCase()} build failed: ${error.message}`);
  }

  testResults.push(result);
  return result;
}

// Test error scenarios
async function testErrorScenarios() {
  console.log('\n🔥 Testing Error Scenarios');
  console.log('-'.repeat(40));

  const headers = {
    'Authorization': `Bearer ${MVP_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const errorTests = [];

  // Test 1: Invalid framework
  console.log('  Testing invalid framework...');
  try {
    const resp = await fetch(`${WORKER_URL}/api/v2/build`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        framework: 'invalid-framework',
        source_files: [{ path: 'test.js', content: 'test' }]
      })
    });
    errorTests.push({
      test: 'Invalid framework',
      expectedStatus: 400,
      actualStatus: resp.status,
      passed: resp.status === 400
    });
    console.log(`    ${resp.status === 400 ? '✓' : '✗'} Status: ${resp.status}`);
  } catch (e) {
    console.log(`    ✗ Error: ${e.message}`);
  }

  // Test 2: Missing source files
  console.log('  Testing missing source files...');
  try {
    const resp = await fetch(`${WORKER_URL}/api/v2/build`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        framework: 'react',
        source_files: []
      })
    });
    errorTests.push({
      test: 'Missing source files',
      expectedStatus: 400,
      actualStatus: resp.status,
      passed: resp.status === 400
    });
    console.log(`    ${resp.status === 400 ? '✓' : '✗'} Status: ${resp.status}`);
  } catch (e) {
    console.log(`    ✗ Error: ${e.message}`);
  }

  // Test 3: Invalid auth token
  console.log('  Testing invalid auth token...');
  try {
    const resp = await fetch(`${WORKER_URL}/api/v2/build`, {
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
    errorTests.push({
      test: 'Invalid auth token',
      expectedStatus: 401,
      actualStatus: resp.status,
      passed: resp.status === 401
    });
    console.log(`    ${resp.status === 401 ? '✓' : '✗'} Status: ${resp.status}`);
  } catch (e) {
    console.log(`    ✗ Error: ${e.message}`);
  }

  const passed = errorTests.filter(t => t.passed).length;
  console.log(`\n  ${passed === errorTests.length ? '✅' : '⚠️'} Error scenarios: ${passed}/${errorTests.length} passed`);

  return errorTests;
}

// Test GitHub callbacks
async function testGitHubCallbacks() {
  console.log('\n🔗 Testing GitHub Callbacks');
  console.log('-'.repeat(40));

  const headers = {
    'Authorization': `Bearer ${MVP_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const callbackTests = [];

  // Test build callback
  console.log('  Testing build callback endpoint...');
  try {
    const resp = await fetch(`${WORKER_URL}/api/v2/github/build-callback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        build_id: 'test-build-' + Date.now(),
        status: 'success',
        github_run_id: '12345',
        artifact_url: 'https://example.com/artifact.tar.gz'
      })
    });
    
    const json = await resp.json();
    callbackTests.push({
      test: 'Build callback',
      status: resp.status,
      success: resp.ok && json.success,
      response: json
    });
    console.log(`    ${resp.ok ? '✓' : '✗'} Status: ${resp.status}`);
  } catch (e) {
    console.log(`    ✗ Error: ${e.message}`);
  }

  // Test upload endpoint
  console.log('  Testing upload endpoint...');
  try {
    const mockTarGz = Buffer.from('mock tar.gz content');
    const resp = await fetch(`${WORKER_URL}/api/v2/github/upload?build_id=test-build-${Date.now()}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MVP_TOKEN}`,
        'Content-Type': 'application/octet-stream'
      },
      body: mockTarGz
    });
    
    callbackTests.push({
      test: 'Upload endpoint',
      status: resp.status,
      success: resp.ok
    });
    console.log(`    ${resp.ok ? '✓' : '✗'} Status: ${resp.status}`);
  } catch (e) {
    console.log(`    ✗ Error: ${e.message}`);
  }

  const passed = callbackTests.filter(t => t.success).length;
  console.log(`\n  ${passed === callbackTests.length ? '✅' : '⚠️'} Callback tests: ${passed}/${callbackTests.length} passed`);

  return callbackTests;
}

// Main execution
async function main() {
  console.log('\n🏁 Starting Test Suite\n');

  // Run framework build tests
  for (const framework of ['react', 'vue', 'svelte']) {
    await testFrameworkBuild(framework);
  }

  // Run error scenario tests
  const errorResults = await testErrorScenarios();

  // Run callback tests
  const callbackResults = await testGitHubCallbacks();

  // Generate comprehensive report
  console.log('\n' + '='.repeat(80));
  console.log('📊 COMPREHENSIVE TEST REPORT');
  console.log('='.repeat(80));

  console.log('\n🎯 Framework Build Results:');
  console.log('-'.repeat(40));
  
  for (const result of testResults) {
    console.log(`\n${result.framework.toUpperCase()}:`);
    console.log(`  Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    if (result.buildId) console.log(`  Build ID: ${result.buildId}`);
    if (result.projectId) console.log(`  Project ID: ${result.projectId}`);
    if (result.githubRunUrl) console.log(`  GitHub Action: ${result.githubRunUrl}`);
    if (result.deploymentUrl) console.log(`  Deployment: ${result.deploymentUrl}`);
    if (result.duration) console.log(`  Duration: ${result.duration.toFixed(1)}s`);
    if (result.error) console.log(`  Error: ${result.error}`);
    console.log(`  API Calls: ${result.requests.length}`);
  }

  console.log('\n⚡ Performance Metrics:');
  console.log('-'.repeat(40));
  
  const successfulBuilds = testResults.filter(r => r.success);
  if (successfulBuilds.length > 0) {
    const durations = successfulBuilds.map(r => r.duration).filter(d => d != null);
    if (durations.length > 0) {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);
      
      console.log(`  Average Build Time: ${avg.toFixed(1)}s`);
      console.log(`  Fastest Build: ${min.toFixed(1)}s`);
      console.log(`  Slowest Build: ${max.toFixed(1)}s`);
    }
  }

  console.log('\n📈 Test Summary:');
  console.log('-'.repeat(40));
  const totalFrameworkTests = testResults.length;
  const successfulFrameworkTests = testResults.filter(r => r.success).length;
  
  console.log(`  Framework Builds: ${successfulFrameworkTests}/${totalFrameworkTests} passed`);
  console.log(`  Error Scenarios: ${errorResults.filter(t => t.passed).length}/${errorResults.length} passed`);
  console.log(`  GitHub Callbacks: ${callbackResults.filter(t => t.success).length}/${callbackResults.length} passed`);
  
  const allPassed = successfulFrameworkTests === totalFrameworkTests;
  console.log(`\n${allPassed ? '✅' : '❌'} Overall Status: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  
  console.log('\n' + '='.repeat(80));
  console.log('Test run completed at:', new Date().toISOString());
  console.log('='.repeat(80) + '\n');

  // Save results to file
  const resultsFile = `test-results-${Date.now()}.json`;
  fs.writeFileSync(resultsFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: {
      workerUrl: WORKER_URL,
      githubRepo: `${GITHUB_OWNER}/${GITHUB_REPO}`
    },
    frameworkTests: testResults,
    errorTests: errorResults,
    callbackTests: callbackResults
  }, null, 2));
  
  console.log(`📄 Detailed results saved to: ${resultsFile}\n`);

  process.exit(allPassed ? 0 : 1);
}

// Run tests
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});