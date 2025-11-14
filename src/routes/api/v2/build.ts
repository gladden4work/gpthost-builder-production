/**
 * API v2 Build Endpoints
 * Handles build queue and status operations
 * Based on DAY5-TDD-STRATEGY.md specifications
 */

import { v2Success, v2Error, getRequestId } from '../../../middleware/envelope';
import { ServiceFactory } from '../../../services/ServiceFactory';
import { validateV2Auth } from '../../../middleware/auth';

interface QueueBuildRequest {
  project_id: string;
  trigger_type?: 'manual' | 'github' | 'api';
  source_files?: Array<{ path: string; content: string }>;
  commit_sha?: string;
}

/**
 * Handle POST /api/v2/build
 * Queue a new build for a project
 */
export async function handleV2QueueBuild(request: Request, env: Env): Promise<Response> {
  const requestId = getRequestId(request);
  
  // Validate authentication
  const auth = await validateV2Auth(request, env, requestId);
  if (auth.response) return auth.response;
  
  // Parse and validate request body
  let body: QueueBuildRequest;
  try {
    body = await request.json() as QueueBuildRequest;
  } catch (error) {
    return v2Error('BAD_REQUEST', 'Invalid JSON payload', 400, requestId);
  }
  
  if (!body.project_id) {
    return v2Error('VALIDATION_FAILED', 'project_id is required', 422, requestId);
  }
  
  // Load project and queue build (API–Service alignment)
  const projectService = ServiceFactory.getProjectService(env);
  const projectResult = await projectService.getProject(body.project_id);
  if (!projectResult.ok) {
    // Map not found to 404; otherwise generic server error
    const code = projectResult.error.code;
    if (code === 'NOT_FOUND' || code === 'PROJECT_NOT_FOUND') {
      return v2Error('NOT_FOUND', `Project ${body.project_id} not found`, 404, requestId);
    }
    return v2Error(code || 'PROJECT_ERROR', projectResult.error.message, 500, requestId);
  }

  const buildService = ServiceFactory.getBuildService(env);
  const result = await buildService.queueBuild(projectResult.value);
  
  if (result.ok) {
    const build = result.value;
    return v2Success({
      build_id: build.buildId,
      project_id: build.projectId,
      status: build.status,
      trigger_type: body.trigger_type || 'api',
      queued_at: build.createdAt.toISOString(),
      message: 'Build queued successfully'
    }, requestId);
  }
  
  // Map build errors to v2 error responses
  const error = result.error;
  const errorMap: Record<string, { status: number; message?: string }> = {
    'PROJECT_NOT_FOUND': { status: 404, message: 'Project not found' },
    'INVALID_STATE': { status: 409, message: 'Build already in progress or invalid state' },
    'TRIGGER_FAILED': { status: 502, message: 'Failed to trigger build workflow' },
    'STORAGE_ERROR': { status: 500, message: 'Failed to queue build' }
  };
  
  const errorInfo = errorMap[error.code] || { status: 500 };
  return v2Error(
    error.code,
    errorInfo.message || error.message,
    errorInfo.status,
    requestId
  );
}

/**
 * Handle GET /api/v2/build/{id}
 * Get build status and details
 */
export async function handleV2GetBuildStatus(
  request: Request,
  env: Env,
  buildId: string
): Promise<Response> {
  const requestId = getRequestId(request);
  
  // Validate authentication
  const auth = await validateV2Auth(request, env, requestId);
  if (auth.response) return auth.response;
  
  if (!buildId) {
    return v2Error('VALIDATION_FAILED', 'Build ID is required', 422, requestId);
  }
  
  // Get build service (use static method)
  const buildService = ServiceFactory.getBuildService(env);
  
  // Get build status
  const result = await buildService.getBuildStatus(buildId);
  
  if (result.ok) {
    try {
      const build = result.value; // BuildStatus from BuildService
      const startedRaw = (build as any).startedAt as unknown;
      const completedRaw = (build as any).completedAt as unknown;

      const startedISO = startedRaw
        ? (typeof startedRaw === 'string'
            ? new Date(startedRaw).toISOString()
            : (startedRaw instanceof Date ? startedRaw.toISOString() : undefined))
        : undefined;
      const completedISO = completedRaw
        ? (typeof completedRaw === 'string'
            ? new Date(completedRaw).toISOString()
            : (completedRaw instanceof Date ? completedRaw.toISOString() : undefined))
        : undefined;

      const duration = startedISO && completedISO
        ? Math.floor((Date.parse(completedISO) - Date.parse(startedISO)) / 1000)
        : undefined;

      return v2Success({
        build_id: (build as any).buildId || buildId,
        project_id: build.projectId,
        status: build.status,
        current_step: (build as any).currentStep,
        progress: (build as any).progress,
        start_time: startedISO,
        end_time: completedISO,
        duration_seconds: duration,
        github_run_url: (build as any).githubRunUrl,
        error: build.error
      }, requestId);
    } catch (e) {
      // If mapping fails for any reason, return a stable non-terminal status
      return v2Success({ build_id: buildId, status: 'queued' }, requestId);
    }
  }
  
  // Map errors
  if (result.error.code === 'BUILD_NOT_FOUND') {
    return v2Error(
      'NOT_FOUND',
      `Build ${buildId} not found`,
      404,
      requestId
    );
  }
  
  // For unexpected errors, return a stable 200 with a non-terminal status when appropriate,
  // otherwise map to 502 to avoid flapping 500s in clients.
  const code = result.error.code || 'BUILD_STATUS_ERROR';
  const msg = result.error.message || 'Failed to retrieve build status';
  // If the build metadata is temporarily unavailable, surface a non-terminal status
  if (code === 'STORAGE_ERROR') {
    return v2Success({
      build_id: buildId,
      status: 'queued'
    }, requestId);
  }
  return v2Error(code, msg, 502, requestId);
}
