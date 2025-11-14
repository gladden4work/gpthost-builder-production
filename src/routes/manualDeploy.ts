/**
 * Manual deployment route for fixing stuck deployments
 * This is a temporary fix for projects that have successful GitHub builds
 * but failed deployment due to the bucket mismatch issue
 */

import { errorResponse, successResponse } from '../utils/responses';

/**
 * Manually deploy a project from GitHub build artifacts
 * POST /api/projects/:projectId/manual-deploy
 */
export async function manualDeployHandler(request: Request, env: Env, projectId: string): Promise<Response> {
  try {
    // TEMPORARY: Skip auth for manual deployment fix
    console.info(`[MANUAL-DEPLOY] Starting manual deployment for project ${projectId} (auth bypassed for fix)`);
    
    // Load project metadata - try both active and legacy paths
    const activePath = `projects/active/${projectId}/metadata.json`;
    const legacyPath = `projects/${projectId}/metadata.json`;
    
    let metadataObject = await env.PROJECTS_BUCKET.get(activePath);
    let metadataPath = activePath;
    
    if (!metadataObject) {
      console.info(`[MANUAL-DEPLOY] Not found in active path, trying legacy: ${legacyPath}`);
      metadataObject = await env.PROJECTS_BUCKET.get(legacyPath);
      metadataPath = legacyPath;
    }
    
    if (!metadataObject) {
      console.info(`[MANUAL-DEPLOY] Project not found in either path`);
      return errorResponse(
        'PROJECT_NOT_FOUND',
        `Project ${projectId} not found in active or legacy paths`,
        404
      );
    }
    
    console.info(`[MANUAL-DEPLOY] Found project metadata at: ${metadataPath}`);
    
    const metadata = JSON.parse(await metadataObject.text());
    
    // Check if there's a last build with R2 info
    const lastBuild = metadata.last_build;
    if (!lastBuild || !lastBuild.r2_path) {
      return errorResponse(
        'NO_BUILD_FOUND',
        `No GitHub build found for project ${projectId}`,
        404
      );
    }
    
    const buildPath = lastBuild.r2_path;
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
    
    // Copy files from builds to deployments bucket
    const sourcePath = buildPath.endsWith('/') ? buildPath : `${buildPath}/`;
    const distPath = `${sourcePath}dist/`;
    
    console.info(`[MANUAL-DEPLOY] Looking for files at: ${distPath} and ${sourcePath}`);
    
    // Try dist directory first (most common for GitHub builds)
    let sourcePrefix = distPath;
    let filesList = await env.BUILDS_BUCKET.list({ prefix: distPath, limit: 1000 });
    
    console.info(`[MANUAL-DEPLOY] Found ${filesList.objects?.length || 0} objects in dist/ directory`);
    
    // If no dist directory, try direct path
    if (!filesList.objects || filesList.objects.length === 0) {
      console.info(`[MANUAL-DEPLOY] No files in dist/, trying direct path: ${sourcePath}`);
      sourcePrefix = sourcePath;
      filesList = await env.BUILDS_BUCKET.list({ prefix: sourcePath, limit: 1000 });
      console.info(`[MANUAL-DEPLOY] Found ${filesList.objects?.length || 0} objects in direct path`);
    }
    
    // Filter out directories and get actual files
    const actualFiles = filesList.objects?.filter(obj => 
      !obj.key.endsWith('/') && 
      !obj.key.includes('.deployment.json') &&
      !obj.key.includes('.gitkeep')
    ) || [];
    
    console.info(`[MANUAL-DEPLOY] Found ${actualFiles.length} actual files to deploy`);
    
    if (actualFiles.length === 0) {
      // Log what we did find for debugging
      if (filesList.objects && filesList.objects.length > 0) {
        console.info(`[MANUAL-DEPLOY] Objects found but all filtered out. Sample:`, 
          filesList.objects.slice(0, 5).map(o => o.key));
      }
      
      return errorResponse(
        'NO_BUILD_ARTIFACTS',
        `No deployable files found. Searched: ${distPath} and ${sourcePath}`,
        404
      );
    }
    
    // Update filesList to use filtered files
    filesList.objects = actualFiles;
    
    console.info(`[MANUAL-DEPLOY] Found ${filesList.objects.length} files to deploy from ${sourcePrefix}`);
    
    let filesDeployed = 0;
    let totalSize = 0;
    
    // Copy each file to deployment bucket
    for (const object of filesList.objects) {
      // Skip directories and metadata files
      if (object.key.endsWith('/') || object.key.includes('.deployment.json')) {
        continue;
      }
      
      // Extract relative path properly
      let relativePath = object.key;
      if (relativePath.startsWith(sourcePrefix)) {
        relativePath = relativePath.substring(sourcePrefix.length);
      } else {
        console.warn(`[MANUAL-DEPLOY] File ${object.key} doesn't start with ${sourcePrefix}, using filename only`);
        const parts = object.key.split('/');
        relativePath = parts[parts.length - 1];
      }
      
      // Remove leading slash if present
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.substring(1);
      }
      
      const destKey = `${deploymentPath}${relativePath}`;
      
      console.info(`[MANUAL-DEPLOY] Copying ${object.key} -> ${destKey}`);
      
      // Get file from builds bucket
      const file = await env.BUILDS_BUCKET.get(object.key);
      if (!file) {
        console.warn(`[MANUAL-DEPLOY] Could not read file: ${object.key}`);
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
      
      console.info(`[MANUAL-DEPLOY] Deployed: ${destKey}`);
    }
    
    // Create deployment metadata
    const deploymentMetadata = {
      projectId,
      deploymentId,
      deploymentTimestamp,
      buildPath,
      deploymentPath,
      url: deploymentUrl,
      filesDeployed,
      totalSize,
      version: '1.0',
      source: 'manual-fix'
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
    
    // Update project metadata
    metadata.deployment = {
      status: 'deployed',
      url: deploymentUrl,
      deploymentId,
      deployedAt: deploymentTimestamp
    };
    metadata.status = 'deployed';
    metadata.deployment_url = deploymentUrl;
    metadata.updated_at = deploymentTimestamp;
    
    // Save updated metadata
    await env.PROJECTS_BUCKET.put(
      metadataPath,
      JSON.stringify(metadata, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          project_id: projectId,
          updated_at: deploymentTimestamp,
          deployment_status: 'deployed'
        }
      }
    );
    
    console.info(`[MANUAL-DEPLOY] Successfully deployed ${filesDeployed} files (${totalSize} bytes)`);
    console.info(`[MANUAL-DEPLOY] Deployment URL: ${deploymentUrl}`);
    
    return successResponse({
      message: 'Project manually deployed successfully',
      project_id: projectId,
      deployment_id: deploymentId,
      deployment_url: deploymentUrl,
      files_deployed: filesDeployed,
      total_size: totalSize,
      build_path: buildPath
    });
    
  } catch (error) {
    console.error('[MANUAL-DEPLOY] Deployment error:', error);
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
  // HTML files - shorter cache
  if (ext === 'html' || ext === 'htm') {
    return 'public, max-age=3600'; // 1 hour
  }
  
  // Assets with hashes - long cache
  if (ext === 'js' || ext === 'css' || ext === 'mjs') {
    return 'public, max-age=31536000, immutable'; // 1 year
  }
  
  // Images
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico'].includes(ext)) {
    return 'public, max-age=86400'; // 1 day
  }
  
  // Default
  return 'public, max-age=3600'; // 1 hour
}