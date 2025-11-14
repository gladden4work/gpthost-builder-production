/**
 * Deployment Routes - TASK-018
 * 
 * API endpoints for managing the deployment pipeline that serves
 * built applications as live websites from R2 CDN.
 * 
 * Endpoints:
 * - POST /api/deploy/{project_id} - Deploy built project
 * - GET /api/deploy/{project_id}/status - Get deployment status
 * - GET /api/deploy/{project_id}/url - Get deployment URL
 * - DELETE /api/deploy/{project_id} - Remove deployment
 */

import { 
  DeploymentRequest,
  DeploymentResponse, 
  DeploymentStatusResponse,
  DeploymentURLResponse,
  RemoveDeploymentResponse 
} from '../types/api';
import { createDeploymentManager } from '../utils/deploymentManager';
import { corsResponse, errorResponse, successResponse } from '../utils/responses';

/**
 * Deploy a project by copying build artifacts to public serving location
 * POST /api/deploy/{project_id}
 */
export async function deployProjectHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3];

    if (!projectId) {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in URL path',
        400,
        { path: url.pathname }
      );
    }

    // Parse request body for deployment options
    let deploymentRequest: DeploymentRequest = {};
    try {
      const body = await request.text();
      if (body.trim()) {
        deploymentRequest = JSON.parse(body);
      }
    } catch (error) {
      // If JSON parsing fails, continue with empty request (use defaults)
      console.warn(`[DEPLOY] Invalid JSON in deployment request for ${projectId}, using defaults`);
    }

    // Create deployment manager
    const deploymentManager = createDeploymentManager(env);

    // Determine if project is a static HTML site eligible for direct deploy
    let isStaticHtml = false;
    try {
      const metaObj = await env.PROJECTS_BUCKET.get(`projects/${projectId}/metadata.json`);
      if (metaObj) {
        const metadata = JSON.parse(await metaObj.text());
        const framework = metadata.analysis?.primaryFramework || metadata.framework;
        const componentType = metadata.analysis?.componentType;
        const hasHtmlFiles = Array.isArray(metadata.files) && metadata.files.some((f: any) => typeof f.name === 'string' && f.name.toLowerCase().endsWith('.html'));
        isStaticHtml = framework === 'html' || (componentType === 'full-application' && hasHtmlFiles);
      }
    } catch (e) {
      console.warn('[DEPLOY] Could not load project metadata for static detection:', e);
    }

    // Validate that project has a build unless this is a static HTML deployment
    const buildExists = isStaticHtml ? true : await deploymentManager.validateBuildExists(projectId, deploymentRequest.buildId);
    if (!buildExists && !isStaticHtml) {
      return errorResponse(
        'NO_BUILDS_AVAILABLE',
        'No completed builds found for this project. Please run a build first.',
        404,
        {
          projectId,
          buildId: deploymentRequest.buildId,
          suggestion: 'Use POST /api/build/queue/{project_id} to create a build'
        }
      );
    }

    console.info(`[DEPLOY] Starting deployment for project ${projectId}...`);

    // Deploy the project (static direct deploy if applicable)
    const deploymentResult = isStaticHtml
      ? await deploymentManager.deployStaticSite(projectId)
      : await deploymentManager.deployProject(projectId, deploymentRequest.buildId);

    if (deploymentResult.success) {
      const response: DeploymentResponse = {
        success: true,
        data: deploymentResult,
        timestamp: new Date().toISOString()
      };

      return successResponse(response.data, 201);

    } else {
      return errorResponse(
        deploymentResult.error?.code || 'DEPLOYMENT_FAILED',
        deploymentResult.error?.message || 'Deployment failed for unknown reason',
        500,
        {
          projectId,
          deploymentId: deploymentResult.deploymentId,
          error: deploymentResult.error
        }
      );
    }

  } catch (error) {
    console.error('[DEPLOY] Error in deployProjectHandler:', error);
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred during deployment',
      500,
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Get deployment status for a project
 * GET /api/deploy/{project_id}/status
 */
export async function getDeploymentStatusHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3];

    if (!projectId) {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in URL path',
        400,
        { path: url.pathname }
      );
    }

    // Create deployment manager and get status
    const deploymentManager = createDeploymentManager(env);
    const status = await deploymentManager.getDeploymentStatus(projectId);

    const response: DeploymentStatusResponse = {
      success: true,
      data: status,
      timestamp: new Date().toISOString()
    };

    return successResponse(response.data, 200);

  } catch (error) {
    console.error('[DEPLOY] Error in getDeploymentStatusHandler:', error);
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while retrieving deployment status',
      500,
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Get deployment URL for a project
 * GET /api/deploy/{project_id}/url
 */
export async function getDeploymentURLHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3];

    if (!projectId) {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in URL path',
        400,
        { path: url.pathname }
      );
    }

    // Create deployment manager and get URL
    const deploymentManager = createDeploymentManager(env);
    const deploymentUrl = await deploymentManager.getDeploymentURL(projectId);

    const response: DeploymentURLResponse = {
      success: true,
      data: {
        projectId,
        url: deploymentUrl
      },
      timestamp: new Date().toISOString()
    };

    return successResponse(response.data, 200);

  } catch (error) {
    console.error('[DEPLOY] Error in getDeploymentURLHandler:', error);
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while retrieving deployment URL',
      500,
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Remove deployment for a project
 * DELETE /api/deploy/{project_id}
 */
export async function removeDeploymentHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3];

    if (!projectId) {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in URL path',
        400,
        { path: url.pathname }
      );
    }

    // Create deployment manager and remove deployment
    const deploymentManager = createDeploymentManager(env);
    const removed = await deploymentManager.removeDeployment(projectId);

    const response: RemoveDeploymentResponse = {
      success: true,
      data: {
        projectId,
        removed
      },
      timestamp: new Date().toISOString()
    };

    const message = removed 
      ? 'Deployment removed successfully' 
      : 'No deployment found to remove';

    return successResponse(response.data, 200);

  } catch (error) {
    console.error('[DEPLOY] Error in removeDeploymentHandler:', error);
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while removing deployment',
      500,
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * List available builds for deployment (utility endpoint)
 * GET /api/deploy/{project_id}/builds
 */
export async function listProjectBuildsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3];

    if (!projectId) {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in URL path',
        400,
        { path: url.pathname }
      );
    }

    // Create deployment manager and list builds
    const deploymentManager = createDeploymentManager(env);
    const builds = await deploymentManager.listProjectBuilds(projectId);

    return successResponse({
      projectId,
      builds,
      count: builds.length,
      latest: builds[0] || null
    }, 200);

  } catch (error) {
    console.error('[DEPLOY] Error in listProjectBuildsHandler:', error);
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while listing project builds',
      500,
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Health check endpoint for deployment system
 * GET /api/deploy/health
 */
export async function deploymentHealthHandler(request: Request, env: Env): Promise<Response> {
  try {
    // Test DEPLOYMENTS_BUCKET connectivity
    const testKey = `health-check-${Date.now()}`;
    const testContent = `Health check at ${new Date().toISOString()}`;

    // Test write operation
    await env.DEPLOYMENTS_BUCKET.put(testKey, testContent, {
      httpMetadata: { contentType: 'text/plain' }
    });

    // Test read operation
    const retrieved = await env.DEPLOYMENTS_BUCKET.get(testKey);
    const content = await retrieved?.text();

    // Clean up test object
    await env.DEPLOYMENTS_BUCKET.delete(testKey);

    const deploymentBucketWorking = content === testContent;

    // Test BUILDS_BUCKET connectivity (read-only check)
    let buildsBucketWorking = false;
    try {
      await env.BUILDS_BUCKET.list({ limit: 1 });
      buildsBucketWorking = true;
    } catch (error) {
      console.error('[DEPLOY-HEALTH] BUILDS_BUCKET health check failed:', error);
    }

    const overallHealth = deploymentBucketWorking && buildsBucketWorking;

    return successResponse({
      status: overallHealth ? 'healthy' : 'degraded',
      deployments_bucket: deploymentBucketWorking ? 'healthy' : 'failed',
      builds_bucket: buildsBucketWorking ? 'healthy' : 'failed',
      timestamp: new Date().toISOString(),
      version: '1.0'
    }, overallHealth ? 200 : 503);

  } catch (error) {
    console.error('[DEPLOY-HEALTH] Health check failed:', error);
    return errorResponse(
      'HEALTH_CHECK_FAILED',
      'Deployment system health check failed',
      503,
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}
