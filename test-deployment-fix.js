#!/usr/bin/env node

/**
 * Test script to verify the GitHub deployment path fix
 * This tests both path normalization and the actual deployment process
 */

console.log('🧪 Testing GitHub Deployment Path Fix\n');

// First, test the path normalization logic
function testPathNormalization() {
  console.log('📝 Testing Path Normalization Logic\n');
  
  // Test cases for path normalization
  const testCases = [
    {
      input: 'projects/6540e203-97c6-4d54-b5a3-072f162a0cab/builds/2025-08-21T14-58-14Z',
      expected: 'builds/6540e203-97c6-4d54-b5a3-072f162a0cab/2025-08-21T14-58-14Z',
      description: 'Old format with projects/ prefix'
    },
    {
      input: 'builds/6540e203-97c6-4d54-b5a3-072f162a0cab/2025-08-21T14-58-14Z',
      expected: 'builds/6540e203-97c6-4d54-b5a3-072f162a0cab/2025-08-21T14-58-14Z',
      description: 'Correct format - no change needed'
    },
    {
      input: 'builds/6540e203-97c6-4d54-b5a3-072f162a0cab/2025-08-21T14-58-14Z/',
      expected: 'builds/6540e203-97c6-4d54-b5a3-072f162a0cab/2025-08-21T14-58-14Z',
      description: 'Trailing slash removal'
    },
    {
      input: '6540e203-97c6-4d54-b5a3-072f162a0cab/2025-08-21T14-58-14Z',
      expected: 'builds/6540e203-97c6-4d54-b5a3-072f162a0cab/2025-08-21T14-58-14Z',
      description: 'Missing builds/ prefix'
    }
  ];

  // Path normalization logic from the fix
  function normalizeBuildPath(buildPath) {
    let normalizedBuildPath = buildPath;
    
    // Remove any trailing slashes
    normalizedBuildPath = normalizedBuildPath.replace(/\/$/, '');
    
    // If path doesn't start with 'builds/', add it
    if (!normalizedBuildPath.startsWith('builds/')) {
      // Handle old format: projects/{id}/builds/{timestamp}
      if (normalizedBuildPath.startsWith('projects/')) {
        // Extract the meaningful part: {id}/builds/{timestamp}
        const match = normalizedBuildPath.match(/projects\/([^\/]+)\/builds\/(.+)/);
        if (match) {
          normalizedBuildPath = `builds/${match[1]}/${match[2]}`;
        }
      } else {
        // Assume it's missing the builds/ prefix
        normalizedBuildPath = `builds/${normalizedBuildPath}`;
      }
    }
    
    return normalizedBuildPath;
  }

  // Run tests
  let passed = 0;
  let failed = 0;

  testCases.forEach((test, index) => {
    const result = normalizeBuildPath(test.input);
    const isPass = result === test.expected;
    
    if (isPass) {
      passed++;
      console.log(`✅ Test ${index + 1}: ${test.description}`);
    } else {
      failed++;
      console.log(`❌ Test ${index + 1}: ${test.description}`);
      console.log(`   Input:    ${test.input}`);
      console.log(`   Expected: ${test.expected}`);
      console.log(`   Got:      ${result}`);
    }
  });

  console.log('\n📊 Path Normalization Results:');
  console.log(`   Passed: ${passed}/${testCases.length}`);
  console.log(`   Failed: ${failed}/${testCases.length}`);
  
  return failed === 0;
}

const baseUrl = process.env.API_URL || 'http://localhost:8787';

// Test project IDs from the issue report
const testProjects = [
  { id: '92118771-5d61-4e71-9e78-667f2d104100', name: 'test21' },
  { id: '53ef2911-d1d9-462e-8572-ae65cd544e00', name: 'test22' },
  { id: 'a2494ecd-9ea1-403a-bcdc-0328340bce71', name: 'UAT test' }
];

async function simulateGitHubCallback(projectId, projectName) {
  console.log(`\n📦 Testing deployment for ${projectName} (${projectId})...`);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const payload = {
    project_id: projectId,
    status: 'completed',
    github_run_id: `test-${Date.now()}`,
    github_run_url: 'https://github.com/test/test/actions',
    framework: 'react',
    node_version: '20.x',
    r2_build_path: `builds/${projectId}/${timestamp}`,
    public_url: `https://test.workers.dev/sites/${projectId}/`,
    build_metadata: {
      build_timestamp: timestamp,
      build_duration_seconds: 60,
      github_sha: 'test123',
      workflow_name: 'gpthost-build.yml',
      runner_os: 'ubuntu-latest'
    }
  };
  
  try {
    console.log('📡 Sending callback to:', `${baseUrl}/api/v2/github/build-callback`);
    console.log('📋 Payload:', JSON.stringify(payload, null, 2));
    
    const response = await fetch(`${baseUrl}/api/v2/github/build-callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Callback successful:', result.message);
      if (result.deployment_url) {
        console.log('🔗 Deployment URL:', result.deployment_url);
      }
      if (result.auto_deploy) {
        console.log('🚀 Auto-deploy:', result.auto_deploy);
      }
    } else {
      console.error('❌ Callback failed:', result);
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Error sending callback:', error.message);
    return null;
  }
}

async function checkDeploymentStatus(projectId, projectName) {
  console.log(`\n🔍 Checking deployment status for ${projectName}...`);
  
  try {
    // Check project status
    const statusResponse = await fetch(`${baseUrl}/api/projects/${projectId}/status`);
    if (statusResponse.ok) {
      const status = await statusResponse.json();
      console.log('📊 Project status:', status.data?.status || 'unknown');
      console.log('🔗 Deployment URL:', status.data?.deployment_url || 'none');
    }
    
    // Try to access the site
    const siteUrl = `${baseUrl}/sites/${projectId}/`;
    console.log(`🌐 Checking site at: ${siteUrl}`);
    
    const siteResponse = await fetch(siteUrl);
    console.log(`📄 Site response: ${siteResponse.status} ${siteResponse.statusText}`);
    
    if (siteResponse.status === 200) {
      console.log('✅ Site is accessible!');
      const contentType = siteResponse.headers.get('content-type');
      console.log('📋 Content-Type:', contentType);
    } else if (siteResponse.status === 404) {
      console.error('❌ Site returns 404 - deployment may have failed');
    }
    
  } catch (error) {
    console.error('❌ Error checking deployment:', error.message);
  }
}

async function runTests() {
  console.log('🧪 GPTHost Deployment Fix Test');
  console.log('================================');
  console.log('Testing against:', baseUrl);
  console.log('');
  
  // First run path normalization tests
  const pathTestsPassed = testPathNormalization();
  
  if (!pathTestsPassed) {
    console.log('\n❌ Path normalization tests failed. Fix the path logic first!');
    process.exit(1);
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📡 Testing Actual Deployment Process\n');
  
  for (const project of testProjects) {
    // Simulate GitHub callback
    const result = await simulateGitHubCallback(project.id, project.name);
    
    if (result) {
      // Wait a bit for deployment to complete
      console.log('⏳ Waiting 2 seconds for deployment to complete...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check deployment status
      await checkDeploymentStatus(project.id, project.name);
    }
    
    console.log('\n' + '='.repeat(50));
  }
  
  console.log('\n✅ Test complete!');
  console.log('\nSummary:');
  console.log('- If sites return 200: Fix is working ✅');
  console.log('- If sites return 404: Deployment issue persists ❌');
  console.log('- Check Worker logs for detailed deployment information');
}

// Run tests
runTests().catch(console.error);
