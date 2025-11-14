/**
 * API v2 Deploy Endpoint
 * Handles deployment requests with v2 envelope format
 * Based on DAY5-TDD-STRATEGY.md specifications
 */

import { v2Success, v2Error, getRequestId } from '../../../middleware/envelope';
import { ServiceFactory } from '../../../services/ServiceFactory';
import { validateV2Auth } from '../../../middleware/auth';
import { getFeatureFlags } from '../../../config/featureFlags';
import { DeploymentErrorCode } from '../../../lib/errors';

interface DeployRequest {
  build_id: string;
}

/**
 * Handle POST /api/v2/deploy
 * Deploy a completed build to production
 */
export async function handleV2Deploy(request: Request, env: Env): Promise<Response> {
  const requestId = getRequestId(request);
  
  // Check feature flag
  const flags = getFeatureFlags(env);
  if (!flags.useNewDeployService) {
    return v2Error('NOT_IMPLEMENTED', 'New deploy service is disabled', 501, requestId);
  }
  
  // Validate authentication
  const auth = await validateV2Auth(request, env, requestId);
  if (auth.response) return auth.response;
  
  // Parse and validate request body
  let body: DeployRequest;
  try {
    body = await request.json() as DeployRequest;
  } catch (error) {
    return v2Error('BAD_REQUEST', 'Invalid JSON payload', 400, requestId);
  }
  
  if (!body.build_id) {
    return v2Error('VALIDATION_FAILED', 'build_id is required', 422, requestId);
  }
  
  // Get deploy service (use static method)
  const deployService = ServiceFactory.getDeployService(env);
  
  // Execute deployment
  const result = await deployService.deployBuild(body.build_id);
  
  if (result.ok) {
    const deployment = result.value;
    return v2Success({
      deployment_id: deployment.projectId,
      project_id: deployment.projectId,
      build_id: body.build_id,
      deployment_url: deployment.deploymentUrl,
      status: deployment.status,
      deployed_at: deployment.deployedAt.toISOString()
    }, requestId);
  }
  
  // Map deployment errors to v2 error responses
  const error = result.error;
  let status = 500;
  if (error.code === DeploymentErrorCode.BUILD_NOT_READY) status = 400;
  else if (error.code === DeploymentErrorCode.INVALID_ARTIFACTS) status = 400;
  else if (error.code === DeploymentErrorCode.NOT_FOUND) status = 404;
  
  return v2Error(
    error.code,
    error.message,
    status,
    requestId
  );
}
