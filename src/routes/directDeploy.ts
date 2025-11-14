/**
 * Direct deployment route for emergency fixes
 * This bypasses all metadata checks and deploys directly from builds to deployments
 */

import { errorResponse, successResponse } from '../utils/responses';

/**
 * Emergency direct deployment
 * POST /api/emergency/deploy/:projectId
 */
export async function directDeployHandler(request: Request, env: Env, projectId: string): Promise<Response> {
  try {
    console.info(`[DIRECT-DEPLOY] Emergency deployment for project ${projectId}`);
    
    const deploymentId = crypto.randomUUID();
    const deploymentTimestamp = new Date().toISOString();
    const deploymentPath = `sites/${projectId}/`;
    
    // Determine deployment URL
    let workersUrl: string;
    if ((env.ENVIRONMENT as string) === 'production') {
      workersUrl = 'https://gpthost-builder.gladden4work.workers.dev';
    } else if ((env.ENVIRONMENT as string) === 'staging') {
      workersUrl = 'https://gpthost-builder-staging.gladden4work.workers.dev';
    } else {
      workersUrl = 'http://localhost:8787';
    }
    const deploymentUrl = `${workersUrl}/${deploymentPath}`;
    
    // Known build path for this specific project
    const knownBuildPaths = [
      `builds/${projectId}/20250120/dist/`,
      `builds/${projectId}/20250120/`,
      `builds/${projectId}/latest/dist/`,
      `builds/${projectId}/latest/`,
      `builds/${projectId}/dist/`,
      `builds/${projectId}/`
    ];
    
    let sourcePrefix = '';
    let filesList: R2Objects | null = null;
    
    // Try each known path
    for (const path of knownBuildPaths) {
      console.info(`[DIRECT-DEPLOY] Checking path: ${path}`);
      const result = await env.BUILDS_BUCKET.list({ prefix: path, limit: 1 });
      
      if (result.objects && result.objects.length > 0) {
        sourcePrefix = path;
        filesList = await env.BUILDS_BUCKET.list({ prefix: path });
        console.info(`[DIRECT-DEPLOY] Found files at: ${path}`);
        break;
      }
    }
    
    if (!filesList || !filesList.objects || filesList.objects.length === 0) {
      return errorResponse(
        'NO_BUILD_FOUND',
        `No build artifacts found for project ${projectId} in any known location`,
        404
      );
    }
    
    console.info(`[DIRECT-DEPLOY] Deploying ${filesList.objects.length} files from ${sourcePrefix}`);
    
    let filesDeployed = 0;
    let totalSize = 0;
    const deployedFiles: string[] = [];
    
    // Copy each file to deployment bucket
    for (const object of filesList.objects) {
      // Skip directories
      if (object.key.endsWith('/')) {
        continue;
      }
      
      const relativePath = object.key.replace(sourcePrefix, '');
      const destKey = `${deploymentPath}${relativePath}`;
      
      // Get file from builds bucket
      const file = await env.BUILDS_BUCKET.get(object.key);
      if (!file) {
        console.warn(`[DIRECT-DEPLOY] Could not read file: ${object.key}`);
        continue;
      }
      
      // Determine content type
      const ext = relativePath.split('.').pop()?.toLowerCase() || '';
      const contentType = getContentType(ext);
      
      // Copy to deployments bucket
      await env.DEPLOYMENTS_BUCKET.put(destKey, file.body, {
        httpMetadata: {
          contentType,
          cacheControl: getCacheControl(ext)
        },
        customMetadata: {
          project_id: projectId,
          deployment_id: deploymentId,
          deployed_at: deploymentTimestamp,
          source_path: object.key
        }
      });
      
      filesDeployed++;
      totalSize += object.size || 0;
      deployedFiles.push(destKey);
      
      console.info(`[DIRECT-DEPLOY] Deployed: ${destKey} (${contentType})`);
    }
    
    // Create deployment metadata
    const deploymentMetadata = {
      projectId,
      deploymentId,
      deploymentTimestamp,
      buildPath: sourcePrefix,
      deploymentPath,
      url: deploymentUrl,
      filesDeployed,
      totalSize,
      version: '1.0',
      source: 'emergency-direct-deploy'
    };
    
    // Store deployment metadata
    await env.DEPLOYMENTS_BUCKET.put(
      `${deploymentPath}.deployment.json`,
      JSON.stringify(deploymentMetadata, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          project_id: projectId,
          deployment_id: deploymentId,
          deployed_at: deploymentTimestamp
        }
      }
    );
    
    // Also create/update minimal project metadata for future reference
    const projectMetadata = {
      id: projectId,
      name: `project-${projectId}`,
      status: 'deployed',
      deployment: {
        status: 'deployed',
        url: deploymentUrl,
        deploymentId,
        deployedAt: deploymentTimestamp
      },
      deployment_url: deploymentUrl,
      created_at: deploymentTimestamp,
      updated_at: deploymentTimestamp,
      last_emergency_deploy: {
        timestamp: deploymentTimestamp,
        source_path: sourcePrefix,
        files_deployed: filesDeployed
      }
    };
    
    // Save to both paths for compatibility
    await Promise.all([
      env.PROJECTS_BUCKET.put(
        `projects/${projectId}/metadata.json`,
        JSON.stringify(projectMetadata, null, 2),
        { httpMetadata: { contentType: 'application/json' } }
      ),
      env.PROJECTS_BUCKET.put(
        `projects/active/${projectId}/metadata.json`,
        JSON.stringify(projectMetadata, null, 2),
        { httpMetadata: { contentType: 'application/json' } }
      )
    ]);
    
    console.info(`[DIRECT-DEPLOY] Successfully deployed ${filesDeployed} files (${totalSize} bytes)`);
    console.info(`[DIRECT-DEPLOY] Deployment URL: ${deploymentUrl}`);
    
    return successResponse({
      message: 'Emergency deployment completed successfully',
      project_id: projectId,
      deployment_id: deploymentId,
      deployment_url: deploymentUrl,
      files_deployed: filesDeployed,
      total_size: totalSize,
      source_path: sourcePrefix,
      deployed_files: deployedFiles.slice(0, 10) // Show first 10 files
    });
    
  } catch (error) {
    console.error('[DIRECT-DEPLOY] Emergency deployment error:', error);
    return errorResponse(
      'DEPLOYMENT_FAILED',
      error instanceof Error ? error.message : String(error),
      500
    );
  }
}

// Helper function to determine content type
function getContentType(ext: string): string {
  const types: Record<string, string> = {
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'mjs': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'txt': 'text/plain',
    'xml': 'application/xml',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'otf': 'font/otf'
  };
  return types[ext] || 'application/octet-stream';
}

// Helper function to determine cache control
function getCacheControl(ext: string): string {
  if (ext === 'html' || ext === 'htm') {
    return 'public, max-age=3600'; // 1 hour
  }
  if (ext === 'js' || ext === 'css' || ext === 'mjs') {
    return 'public, max-age=31536000, immutable'; // 1 year
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico'].includes(ext)) {
    return 'public, max-age=86400'; // 1 day
  }
  return 'public, max-age=3600'; // 1 hour default
}