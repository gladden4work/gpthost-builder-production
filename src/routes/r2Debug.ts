/**
 * R2 Debug Routes - Critical Deployment Debugging
 * 
 * These endpoints help diagnose R2 bucket access issues and verify
 * that GitHub Actions uploads are accessible to the Worker.
 */

import { successResponse, errorResponse } from '../utils/responses';

/**
 * List all objects in R2 buckets for debugging
 * GET /api/debug/r2/list
 */
export async function listR2BucketsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get('project_id');
    const bucket = url.searchParams.get('bucket') || 'builds'; // builds, projects, deployments
    const prefix = url.searchParams.get('prefix') || '';
    const limit = parseInt(url.searchParams.get('limit') || '100');
    
    let targetBucket: R2Bucket;
    switch (bucket) {
      case 'builds':
        targetBucket = env.BUILDS_BUCKET;
        break;
      case 'projects':
        targetBucket = env.PROJECTS_BUCKET;
        break;
      case 'deployments':
        targetBucket = env.DEPLOYMENTS_BUCKET;
        break;
      default:
        return errorResponse('INVALID_BUCKET', 'Invalid bucket name', 400);
    }
    
    // Build the prefix
    let searchPrefix = prefix;
    if (projectId) {
      if (bucket === 'builds') {
        searchPrefix = `builds/${projectId}/`;
      } else if (bucket === 'projects') {
        searchPrefix = `projects/${projectId}/`;
      } else if (bucket === 'deployments') {
        searchPrefix = `sites/${projectId}/`;
      }
    }
    
    console.info(`[R2-DEBUG] Listing ${bucket} bucket with prefix: "${searchPrefix}"`);
    
    const result = await targetBucket.list({
      prefix: searchPrefix,
      limit,
      delimiter: undefined // Don't use delimiter to see all nested files
    });
    
    const objects = result.objects.map(obj => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded,
      etag: obj.etag,
      httpEtag: obj.httpEtag,
      checksums: obj.checksums,
      customMetadata: obj.customMetadata
    }));
    
    // Group objects by directory for better visualization
    const directories = new Set<string>();
    const files: any[] = [];
    
    objects.forEach(obj => {
      const relativePath = obj.key.substring(searchPrefix.length);
      const parts = relativePath.split('/');
      
      if (parts.length > 1) {
        // Add parent directories
        for (let i = 1; i < parts.length; i++) {
          directories.add(parts.slice(0, i).join('/') + '/');
        }
      }
      
      if (!obj.key.endsWith('/')) {
        files.push({
          ...obj,
          relativePath,
          directory: parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '/'
        });
      }
    });
    
    return successResponse({
      bucket,
      prefix: searchPrefix,
      truncated: result.truncated,
      cursor: result.cursor,
      total_objects: objects.length,
      directories: Array.from(directories).sort(),
      files: files.sort((a, b) => a.key.localeCompare(b.key)),
      summary: {
        total_files: files.length,
        total_directories: directories.size,
        total_size: files.reduce((sum, f) => sum + f.size, 0)
      }
    });
    
  } catch (error) {
    console.error('[R2-DEBUG] List error:', error);
    return errorResponse(
      'LIST_FAILED',
      'Failed to list R2 objects',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Find build artifacts for a project across all possible locations
 * GET /api/debug/r2/find-artifacts/{projectId}
 */
export async function findBuildArtifactsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const projectId = pathParts[pathParts.length - 1];
    
    if (!projectId) {
      return errorResponse('MISSING_PROJECT_ID', 'Project ID is required', 400);
    }
    
    console.info(`[R2-DEBUG] Finding build artifacts for project: ${projectId}`);
    
    const searchResults: any[] = [];
    
    // Search in BUILDS_BUCKET
    const buildsPrefix = `builds/${projectId}/`;
    const buildsResult = await env.BUILDS_BUCKET.list({
      prefix: buildsPrefix,
      limit: 1000,
      delimiter: undefined
    });
    
    searchResults.push({
      bucket: 'BUILDS_BUCKET',
      prefix: buildsPrefix,
      found: buildsResult.objects.length,
      objects: buildsResult.objects.map(o => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded
      }))
    });
    
    // Search in PROJECTS_BUCKET
    const projectsPrefix = `projects/${projectId}/`;
    const projectsResult = await env.PROJECTS_BUCKET.list({
      prefix: projectsPrefix,
      limit: 1000,
      delimiter: undefined
    });
    
    searchResults.push({
      bucket: 'PROJECTS_BUCKET',
      prefix: projectsPrefix,
      found: projectsResult.objects.length,
      objects: projectsResult.objects.map(o => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded
      }))
    });
    
    // Search in DEPLOYMENTS_BUCKET
    const deploymentsPrefix = `sites/${projectId}/`;
    const deploymentsResult = await env.DEPLOYMENTS_BUCKET.list({
      prefix: deploymentsPrefix,
      limit: 1000,
      delimiter: undefined
    });
    
    searchResults.push({
      bucket: 'DEPLOYMENTS_BUCKET',
      prefix: deploymentsPrefix,
      found: deploymentsResult.objects.length,
      objects: deploymentsResult.objects.map(o => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded
      }))
    });
    
    // Analyze the results
    const analysis = {
      project_id: projectId,
      has_builds: searchResults[0].found > 0,
      has_project_metadata: searchResults[1].objects.some((o: any) => o.key.includes('metadata.json')),
      has_deployment: searchResults[2].found > 0,
      latest_build_path: null as string | null,
      build_timestamps: [] as string[],
      deployment_status: 'not_found' as string
    };
    
    // Find latest build
    if (searchResults[0].found > 0) {
      const buildDirs = new Set<string>();
      searchResults[0].objects.forEach((obj: any) => {
        const match = obj.key.match(/builds\/[^\/]+\/(\d{4}-\d{2}-\d{2}T[\d:.-]+Z?)\//);
        if (match) {
          buildDirs.add(match[1]);
        }
      });
      
      analysis.build_timestamps = Array.from(buildDirs).sort().reverse();
      if (analysis.build_timestamps.length > 0) {
        analysis.latest_build_path = `builds/${projectId}/${analysis.build_timestamps[0]}/`;
      }
    }
    
    // Check deployment status
    if (searchResults[2].found > 0) {
      if (searchResults[2].objects.some((o: any) => o.key.includes('index.html'))) {
        analysis.deployment_status = 'deployed';
      } else {
        analysis.deployment_status = 'partial';
      }
    } else if (analysis.has_builds) {
      analysis.deployment_status = 'pending_deployment';
    }
    
    return successResponse({
      analysis,
      search_results: searchResults,
      recommendations: generateRecommendations(analysis)
    });
    
  } catch (error) {
    console.error('[R2-DEBUG] Find artifacts error:', error);
    return errorResponse(
      'FIND_FAILED',
      'Failed to find build artifacts',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Test R2 access by writing and reading a test file
 * POST /api/debug/r2/test-access
 */
export async function testR2AccessHandler(request: Request, env: Env): Promise<Response> {
  try {
    const testId = `test-${Date.now()}`;
    const testContent = `Test file created at ${new Date().toISOString()}`;
    const results: any[] = [];
    
    // Test BUILDS_BUCKET
    try {
      const buildsKey = `test/${testId}.txt`;
      await env.BUILDS_BUCKET.put(buildsKey, testContent);
      const buildsRead = await env.BUILDS_BUCKET.get(buildsKey);
      const buildsContent = buildsRead ? await buildsRead.text() : null;
      await env.BUILDS_BUCKET.delete(buildsKey);
      
      results.push({
        bucket: 'BUILDS_BUCKET',
        write: 'success',
        read: buildsContent === testContent ? 'success' : 'failed',
        delete: 'success'
      });
    } catch (e) {
      results.push({
        bucket: 'BUILDS_BUCKET',
        error: e instanceof Error ? e.message : String(e)
      });
    }
    
    // Test PROJECTS_BUCKET
    try {
      const projectsKey = `test/${testId}.txt`;
      await env.PROJECTS_BUCKET.put(projectsKey, testContent);
      const projectsRead = await env.PROJECTS_BUCKET.get(projectsKey);
      const projectsContent = projectsRead ? await projectsRead.text() : null;
      await env.PROJECTS_BUCKET.delete(projectsKey);
      
      results.push({
        bucket: 'PROJECTS_BUCKET',
        write: 'success',
        read: projectsContent === testContent ? 'success' : 'failed',
        delete: 'success'
      });
    } catch (e) {
      results.push({
        bucket: 'PROJECTS_BUCKET',
        error: e instanceof Error ? e.message : String(e)
      });
    }
    
    // Test DEPLOYMENTS_BUCKET
    try {
      const deploymentsKey = `test/${testId}.txt`;
      await env.DEPLOYMENTS_BUCKET.put(deploymentsKey, testContent);
      const deploymentsRead = await env.DEPLOYMENTS_BUCKET.get(deploymentsKey);
      const deploymentsContent = deploymentsRead ? await deploymentsRead.text() : null;
      await env.DEPLOYMENTS_BUCKET.delete(deploymentsKey);
      
      results.push({
        bucket: 'DEPLOYMENTS_BUCKET',
        write: 'success',
        read: deploymentsContent === testContent ? 'success' : 'failed',
        delete: 'success'
      });
    } catch (e) {
      results.push({
        bucket: 'DEPLOYMENTS_BUCKET',
        error: e instanceof Error ? e.message : String(e)
      });
    }
    
    const allSuccess = results.every(r => !r.error && r.read === 'success');
    
    return successResponse({
      test_id: testId,
      all_buckets_accessible: allSuccess,
      results,
      message: allSuccess ? 'All R2 buckets are accessible' : 'Some R2 buckets have issues'
    });
    
  } catch (error) {
    console.error('[R2-DEBUG] Test access error:', error);
    return errorResponse(
      'TEST_FAILED',
      'Failed to test R2 access',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Create minimal project metadata for an existing deployment/build
 * POST /api/debug/register-project
 * Body: { "project_id": "<id>", "deployment_url"?: "https://..." }
 */
export async function registerProjectHandler(request: Request, env: Env): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);
    }
    const body = await request.json().catch(() => ({})) as any;
    const projectId: string | undefined = body.project_id || body.projectId;
    const deploymentUrl: string | undefined = body.deployment_url || body.deploymentUrl;
    if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
      return errorResponse('INVALID_REQUEST', 'project_id is required', 400);
    }

    const primaryPath = `projects/${projectId}/metadata.json`;
    const activePath = `projects/active/${projectId}/metadata.json`;

    // If already exists, return success with existing state
    const existing = await env.PROJECTS_BUCKET.get(primaryPath);
    if (existing) {
      return successResponse({ project_id: projectId, registered: false, message: 'Already exists' });
    }

    const now = new Date().toISOString();
    const metadata = {
      id: projectId,
      status: 'deployed',
      name: projectId,
      framework: 'unknown',
      files: [],
      created_at: now,
      updated_at: now,
      deployment_url: deploymentUrl,
      analysis: { primaryFramework: 'unknown', componentType: 'unknown', totalComponents: 0 }
    } as any;

    await env.PROJECTS_BUCKET.put(primaryPath, JSON.stringify(metadata), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { projectId, type: 'metadata', created: now, source: 'manual-register' }
    });
    await env.PROJECTS_BUCKET.put(activePath, JSON.stringify(metadata), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { projectId, type: 'metadata', created: now, source: 'manual-register' }
    }).catch(() => {});

    return successResponse({ project_id: projectId, registered: true, deployment_url: deploymentUrl });
  } catch (error) {
    return errorResponse('REGISTER_FAILED', 'Failed to register project', 500, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Force deployment from builds to sites
 * POST /api/debug/r2/force-deploy/{projectId}
 */
export async function forceDeployHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const projectId = pathParts[pathParts.length - 1];
    
    if (!projectId) {
      return errorResponse('MISSING_PROJECT_ID', 'Project ID is required', 400);
    }
    
    // Find the latest build
    const buildsPrefix = `builds/${projectId}/`;
    const buildsResult = await env.BUILDS_BUCKET.list({
      prefix: buildsPrefix,
      limit: 10000,
      delimiter: undefined
    });
    
    if (buildsResult.objects.length === 0) {
      return errorResponse('NO_BUILDS', `No builds found for project ${projectId}`, 404);
    }
    
    // Find the latest timestamp
    const timestamps = new Set<string>();
    buildsResult.objects.forEach(obj => {
      const match = obj.key.match(/builds\/[^\/]+\/(\d{4}-\d{2}-\d{2}T[\d:.-]+Z?)\//);
      if (match) {
        timestamps.add(match[1]);
      }
    });
    
    const sortedTimestamps = Array.from(timestamps).sort().reverse();
    if (sortedTimestamps.length === 0) {
      return errorResponse('NO_BUILD_TIMESTAMP', 'Could not determine build timestamp', 404);
    }
    
    const latestTimestamp = sortedTimestamps[0];
    const buildPath = `builds/${projectId}/${latestTimestamp}/`;
    
    console.info(`[FORCE-DEPLOY] Deploying from ${buildPath} to sites/${projectId}/`);
    
    // Filter files to deploy
    const filesToDeploy = buildsResult.objects.filter(obj => 
      obj.key.startsWith(buildPath) &&
      !obj.key.endsWith('/') &&
      !obj.key.includes('.deployment.json')
    );
    
    const deploymentPath = `sites/${projectId}/`;
    let deployed = 0;
    let failed = 0;
    const errors: string[] = [];
    
    for (const obj of filesToDeploy) {
      try {
        // Calculate relative path
        let relativePath = obj.key.substring(buildPath.length);
        
        // Handle dist/ or build/ subdirectories
        if (relativePath.startsWith('dist/')) {
          relativePath = relativePath.substring(5);
        } else if (relativePath.startsWith('build/')) {
          relativePath = relativePath.substring(6);
        }
        
        const destKey = `${deploymentPath}${relativePath}`;
        
        // Get the file from builds
        const file = await env.BUILDS_BUCKET.get(obj.key);
        if (!file) {
          errors.push(`Failed to read: ${obj.key}`);
          failed++;
          continue;
        }
        
        // Copy to deployments
        await env.DEPLOYMENTS_BUCKET.put(destKey, file.body, {
          httpMetadata: file.httpMetadata as any,
          customMetadata: {
            ...((file.customMetadata as any) || {}),
            project_id: projectId,
            deployed_at: new Date().toISOString(),
            source_path: obj.key
          }
        });
        
        deployed++;
        console.info(`[FORCE-DEPLOY] Deployed: ${obj.key} -> ${destKey}`);
      } catch (e) {
        errors.push(`Error deploying ${obj.key}: ${e}`);
        failed++;
      }
    }
    
    // Create deployment metadata
    const deploymentMetadata = {
      projectId,
      deploymentId: crypto.randomUUID(),
      deploymentTimestamp: new Date().toISOString(),
      buildPath,
      deploymentPath,
      filesDeployed: deployed,
      filesFailed: failed,
      source: 'force-deploy-debug'
    };
    
    await env.DEPLOYMENTS_BUCKET.put(
      `${deploymentPath}.deployment.json`,
      JSON.stringify(deploymentMetadata, null, 2),
      {
        httpMetadata: { contentType: 'application/json' }
      }
    );
    
    const workersUrl = url.origin;
    const deploymentUrl = `${workersUrl}/sites/${projectId}/`;
    
    return successResponse({
      success: deployed > 0,
      project_id: projectId,
      build_path: buildPath,
      deployment_url: deploymentUrl,
      files_deployed: deployed,
      files_failed: failed,
      errors: errors.length > 0 ? errors : undefined,
      message: `Force deployed ${deployed} files from ${buildPath}`
    });
    
  } catch (error) {
    console.error('[FORCE-DEPLOY] Error:', error);
    return errorResponse(
      'DEPLOY_FAILED',
      'Failed to force deploy',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Generate recommendations based on analysis
 */
function generateRecommendations(analysis: any): string[] {
  const recommendations: string[] = [];
  
  if (!analysis.has_project_metadata) {
    recommendations.push('Project metadata is missing - create project first via /api/upload or /api/paste');
  }
  
  if (!analysis.has_builds && analysis.has_project_metadata) {
    recommendations.push('No builds found - trigger a build via GitHub Actions');
  }
  
  if (analysis.has_builds && analysis.deployment_status === 'not_found') {
    recommendations.push('Builds exist but not deployed - use /api/debug/r2/force-deploy to deploy');
  }
  
  if (analysis.deployment_status === 'partial') {
    recommendations.push('Partial deployment detected - some files may be missing');
  }
  
  if (analysis.build_timestamps.length > 5) {
    recommendations.push('Multiple old builds found - consider cleanup to save storage');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('Everything looks good! Project is properly deployed.');
  }
  
  return recommendations;
}
