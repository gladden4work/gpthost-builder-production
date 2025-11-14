/**
 * API v2 Projects Endpoints
 * Handles project creation and retrieval
 * Based on DAY5-TDD-STRATEGY.md specifications
 */

import { v2Success, v2Error, getRequestId } from '../../../middleware/envelope';
import { ServiceFactory } from '../../../services/ServiceFactory';
import { validateV2Auth } from '../../../middleware/auth';
import type { CreateProjectInput, ProjectFile } from '../../../domain/models';

/**
 * Handle POST /api/v2/projects
 * Create a new project
 */
export async function handleV2CreateProject(request: Request, env: Env): Promise<Response> {
  const requestId = getRequestId(request);
  
  // Validate authentication
  const auth = await validateV2Auth(request, env, requestId);
  if (auth.response) return auth.response;
  
  // Parse and validate request body
  let body: Partial<CreateProjectInput>;
  try {
    body = await request.json() as Partial<CreateProjectInput>;
  } catch (error) {
    return v2Error('BAD_REQUEST', 'Invalid JSON payload', 400, requestId);
  }
  
  if (!body?.name || typeof body.name !== 'string') {
    return v2Error('VALIDATION_FAILED', 'Project name is required', 422, requestId);
  }

  // Validate files presence and shape (API–Service alignment)
  const files = (body as any).files as ProjectFile[] | undefined;
  if (!Array.isArray(files) || files.length === 0) {
    return v2Error('VALIDATION_FAILED', 'At least one file is required', 422, requestId);
  }
  const invalidFile = files.find(
    (f: any) => !f || typeof f.path !== 'string' || typeof f.content !== 'string'
  );
  if (invalidFile) {
    return v2Error('VALIDATION_FAILED', 'Each file must include path and content', 422, requestId);
  }
  
  // Get project service (use static method)
  const projectService = ServiceFactory.getProjectService(env);
  
  // Create project
  const input: CreateProjectInput = {
    name: body.name,
    description: body.description,
    framework: body.framework,
    files,
    ownerId: auth.context?.user?.id
  };
  const result = await projectService.createProject(input);
  
  if (result.ok) {
    const project = result.value;
    return v2Success({
      id: project.id,
      name: project.name,
      framework: project.framework,
      status: project.status,
      created_at: project.createdAt.toISOString(),
      updated_at: project.updatedAt.toISOString(),
      metadata: project.metadata,
      owner_id: project.ownerId
    }, requestId);
  }
  
  // Map project errors to v2 error responses
  const error = result.error;
  const errorMap: Record<string, { status: number; message?: string }> = {
    'INVALID_INPUT': { status: 422, message: 'Invalid project input' },
    'ALREADY_EXISTS': { status: 409, message: 'Project already exists' },
    'STORAGE_ERROR': { status: 500, message: 'Failed to save project' }
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
 * Handle GET /api/v2/projects/{id}
 * Retrieve project details
 */
export async function handleV2GetProject(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const requestId = getRequestId(request);
  
  // Validate authentication
  const auth = await validateV2Auth(request, env, requestId);
  if (auth.response) return auth.response;
  
  if (!projectId) {
    return v2Error('VALIDATION_FAILED', 'Project ID is required', 422, requestId);
  }
  
  // Get project service (use static method)
  const projectService = ServiceFactory.getProjectService(env);
  
  // Retrieve project
  const result = await projectService.getProject(projectId);
  
  if (result.ok) {
    const project = result.value;
    return v2Success({
      id: project.id,
      name: project.name,
      framework: project.framework,
      status: project.status,
      deployment_url: project.deploymentUrl,
      created_at: project.createdAt.toISOString(),
      updated_at: project.updatedAt.toISOString(),
      metadata: project.metadata,
      build_status: project.buildStatus,
      last_build_at: project.lastBuildAt?.toISOString(),
      owner_id: project.ownerId
    }, requestId);
  }
  
  // Map errors
  if (result.error.code === 'PROJECT_NOT_FOUND') {
    return v2Error(
      'NOT_FOUND',
      `Project ${projectId} not found`,
      404,
      requestId
    );
  }
  
  return v2Error(
    result.error.code,
    result.error.message,
    500,
    requestId
  );
}
