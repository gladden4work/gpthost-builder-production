/**
 * Unified Deployment Handler (uses R2DeploymentManager)
 * POST /api/projects/{projectId}/deploy
 */
import { DeploymentRequest } from '../types/api';
import { createDeploymentManager } from '../utils/deploymentManager';
import { 
  getProjectMetadata,
  getBuildStatus,
  createErrorResponse,
  createSuccessResponse,
  extractProjectIdFromPath
} from '../utils/projectHelpers';

export async function deploymentHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = extractProjectIdFromPath(url.pathname);
    if (!projectId) {
      return createErrorResponse('MISSING_PROJECT_ID', 'Project ID is required', undefined, 400);
    }

    // Parse optional request body
    let body: DeploymentRequest = {};
    try {
      if (request.body) {
        const text = await request.text();
        if (text.trim()) body = JSON.parse(text);
      }
    } catch (e) {
      return createErrorResponse('INVALID_JSON', 'Request body must be valid JSON', undefined, 400);
    }

    // Basic validations
    const project = await getProjectMetadata(projectId, env);
    if (!project) {
      return createErrorResponse('PROJECT_NOT_FOUND', `Project ${projectId} not found`, undefined, 404);
    }

    // Detect static HTML projects and bypass build requirement
    const framework = project.analysis?.primaryFramework || project.framework;
    const componentType = project.analysis?.componentType;
    const hasHtmlFiles = Array.isArray(project.files) && project.files.some((f: any) => typeof f.name === 'string' && f.name.toLowerCase().endsWith('.html'));
    const isStaticHtml = framework === 'html' || (componentType === 'full-application' && hasHtmlFiles);

    const manager = createDeploymentManager(env);

    if (isStaticHtml) {
      console.info(`[DEPLOY] Static HTML project detected for ${projectId}. Deploying original files...`);
      const result = await manager.deployStaticSite(projectId);
      if (!result.success) {
        return createErrorResponse(result.error?.code || 'STATIC_DEPLOY_FAILED', result.error?.message || 'Static deployment failed', result.error, 500);
      }
      return createSuccessResponse({ url: result.url, deploymentId: result.deploymentId, timestamp: result.timestamp, static: true });
    }

    // Non-static projects require a completed build
    const build = await getBuildStatus(projectId, env);
    if (!build || build.status !== 'completed') {
      return createErrorResponse(
        'BUILD_NOT_COMPLETED',
        'Project must have a completed build before deployment',
        { currentBuildStatus: build?.status || 'no_build' },
        400
      );
    }

    // Delegate to unified deployment manager (writes to DEPLOYMENTS_BUCKET and updates metadata)
    const result = await manager.deployProject(projectId, body.buildId);

    if (!result.success) {
      return createErrorResponse(result.error?.code || 'DEPLOYMENT_FAILED', result.error?.message || 'Deployment failed', result.error, 500);
    }

    return createSuccessResponse({ url: result.url, deploymentId: result.deploymentId, timestamp: result.timestamp });

  } catch (error) {
    console.error('[DEPLOY] Unified deployment handler error:', error);
    return createErrorResponse('INTERNAL_ERROR', 'Deployment failed due to internal error', { error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
