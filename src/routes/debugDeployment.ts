/**
 * Debug deployment issues - diagnostic endpoint
 * This helps identify where files are getting lost in the deployment pipeline
 */

import { successResponse, errorResponse } from '../utils/responses';

/**
 * Debug deployment status and file locations
 * GET /api/debug/deployment/:projectId
 */
export async function debugDeploymentHandler(request: Request, env: Env, projectId: string): Promise<Response> {
  try {
    console.info(`[DEBUG-DEPLOY] Starting diagnostic for project ${projectId}`);
    
    const diagnostics: any = {
      projectId,
      timestamp: new Date().toISOString(),
      metadata: {},
      builds_bucket: {},
      deployments_bucket: {},
      issues: []
    };
    
    // 1. Check project metadata
    const activePath = `projects/active/${projectId}/metadata.json`;
    const legacyPath = `projects/${projectId}/metadata.json`;
    
    let metadataObject = await env.PROJECTS_BUCKET.get(activePath);
    let metadataPath = activePath;
    
    if (!metadataObject) {
      metadataObject = await env.PROJECTS_BUCKET.get(legacyPath);
      metadataPath = legacyPath;
    }
    
    if (metadataObject) {
      const metadata = JSON.parse(await metadataObject.text());
      diagnostics.metadata = {
        found: true,
        path: metadataPath,
        status: metadata.status,
        deployment_url: metadata.deployment_url,
        last_build: metadata.last_build ? {
          status: metadata.last_build.status,
          r2_path: metadata.last_build.r2_path,
          github_run_id: metadata.last_build.github_run_id
        } : null
      };
    } else {
      diagnostics.metadata.found = false;
      diagnostics.issues.push('Project metadata not found');
    }
    
    // 2. Check BUILDS_BUCKET for build artifacts
    if (diagnostics.metadata.last_build?.r2_path) {
      const buildPath = diagnostics.metadata.last_build.r2_path;
      const sourcePath = buildPath.endsWith('/') ? buildPath : `${buildPath}/`;
      
      // Check for dist folder
      const distPath = `${sourcePath}dist/`;
      const distFiles = await env.BUILDS_BUCKET.list({ prefix: distPath, limit: 10 });
      
      // Check direct path
      const directFiles = await env.BUILDS_BUCKET.list({ prefix: sourcePath, limit: 10 });
      
      diagnostics.builds_bucket = {
        build_path: buildPath,
        dist_path: distPath,
        dist_files_count: distFiles.objects?.length || 0,
        dist_files_sample: distFiles.objects?.slice(0, 5).map(o => ({
          key: o.key,
          size: o.size,
          uploaded: o.uploaded
        })),
        direct_files_count: directFiles.objects?.length || 0,
        direct_files_sample: directFiles.objects?.slice(0, 5).map(o => ({
          key: o.key,
          size: o.size,
          uploaded: o.uploaded
        }))
      };
      
      if (!distFiles.objects?.length && !directFiles.objects?.length) {
        diagnostics.issues.push(`No files found in BUILDS_BUCKET at ${buildPath}`);
      }
    } else {
      diagnostics.builds_bucket.error = 'No build path in metadata';
      diagnostics.issues.push('No build path found in project metadata');
    }
    
    // 3. Check DEPLOYMENTS_BUCKET for deployed files
    const deploymentPath = `sites/${projectId}/`;
    const deployedFiles = await env.DEPLOYMENTS_BUCKET.list({ prefix: deploymentPath, limit: 10 });
    
    diagnostics.deployments_bucket = {
      deployment_path: deploymentPath,
      files_count: deployedFiles.objects?.length || 0,
      files_sample: deployedFiles.objects?.slice(0, 5).map(o => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded
      })),
      has_index_html: deployedFiles.objects?.some(o => o.key.endsWith('index.html')),
      has_deployment_json: deployedFiles.objects?.some(o => o.key.endsWith('.deployment.json'))
    };
    
    if (!deployedFiles.objects?.length) {
      diagnostics.issues.push(`No files found in DEPLOYMENTS_BUCKET at ${deploymentPath}`);
    }
    
    // 4. Analyze the issues
    if (diagnostics.metadata.status === 'deployed' && !diagnostics.deployments_bucket.files_count) {
      diagnostics.issues.push('CRITICAL: Project marked as deployed but no files in DEPLOYMENTS_BUCKET');
      diagnostics.recommendation = 'Run manual deployment to copy files from BUILDS_BUCKET to DEPLOYMENTS_BUCKET';
    }
    
    if (diagnostics.builds_bucket.dist_files_count === 0 && diagnostics.builds_bucket.direct_files_count > 0) {
      diagnostics.issues.push('Build files exist but not in expected dist/ subfolder');
      diagnostics.recommendation = 'Deployment logic should check both dist/ and direct paths';
    }
    
    // 5. Check if we can access the deployment URL
    if (diagnostics.metadata.deployment_url) {
      try {
        const testUrl = diagnostics.metadata.deployment_url;
        // Don't actually fetch to avoid CORS issues, just note the URL
        diagnostics.deployment_test = {
          url: testUrl,
          expected_status: diagnostics.deployments_bucket.has_index_html ? '200 OK' : '404 Not Found'
        };
      } catch (e) {
        diagnostics.deployment_test = { error: String(e) };
      }
    }
    
    return successResponse({
      message: 'Deployment diagnostics complete',
      diagnostics,
      issues_found: diagnostics.issues.length,
      needs_manual_fix: diagnostics.issues.some((i: string) => i.includes('CRITICAL'))
    });
    
  } catch (error) {
    console.error('[DEBUG-DEPLOY] Error:', error);
    return errorResponse(
      'DEBUG_FAILED',
      error instanceof Error ? error.message : String(error),
      500
    );
  }
}

/**
 * List all files in a bucket for a project
 * GET /api/debug/bucket/:bucketName/:projectId
 */
export async function debugBucketListHandler(
  request: Request, 
  env: Env, 
  bucketName: string, 
  projectId: string
): Promise<Response> {
  try {
    const bucket = bucketName === 'builds' ? env.BUILDS_BUCKET : 
                   bucketName === 'deployments' ? env.DEPLOYMENTS_BUCKET :
                   bucketName === 'projects' ? env.PROJECTS_BUCKET : null;
    
    if (!bucket) {
      return errorResponse('INVALID_BUCKET', `Unknown bucket: ${bucketName}`, 400);
    }
    
    // List all files related to this project
    const prefixes = [
      `${projectId}/`,
      `projects/${projectId}/`,
      `projects/active/${projectId}/`,
      `sites/${projectId}/`,
      `builds/${projectId}/`
    ];
    
    const allFiles: any[] = [];
    
    for (const prefix of prefixes) {
      const result = await bucket.list({ prefix, limit: 100 });
      if (result.objects && result.objects.length > 0) {
        allFiles.push({
          prefix,
          count: result.objects.length,
          files: result.objects.map(o => ({
            key: o.key,
            size: o.size,
            uploaded: o.uploaded,
            etag: o.etag
          }))
        });
      }
    }
    
    return successResponse({
      bucket: bucketName,
      projectId,
      total_prefixes_checked: prefixes.length,
      prefixes_with_files: allFiles.length,
      data: allFiles
    });
    
  } catch (error) {
    return errorResponse(
      'LIST_FAILED',
      error instanceof Error ? error.message : String(error),
      500
    );
  }
}