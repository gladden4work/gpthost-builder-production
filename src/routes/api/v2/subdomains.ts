/**
 * Subdomain Management API Endpoints (v2)
 *
 * Provides REST API for subdomain operations:
 * - Check subdomain availability (public)
 * - Reserve subdomain for project (authenticated)
 * - Get subdomain for project (authenticated)
 * - Delete/release subdomain (authenticated)
 *
 * Uses KV storage via SubdomainService for fast edge lookups.
 *
 * @module routes/api/v2/subdomains
 */

import { v2Success, v2Error, getRequestId } from '../../../middleware/envelope';
import { validateV2Auth } from '../../../middleware/auth';
import { SubdomainService } from '../../../services/SubdomainService';

/**
 * Handle GET /api/v2/subdomains/check?subdomain=my-app
 *
 * Check if a subdomain is available for reservation.
 * This is a public endpoint - no authentication required.
 *
 * @param request - Incoming HTTP request
 * @param env - Cloudflare Worker environment bindings
 * @returns Response with availability status and suggestions if unavailable
 *
 * @example
 * GET /api/v2/subdomains/check?subdomain=todo-app
 *
 * Response (available):
 * {
 *   "success": true,
 *   "data": {
 *     "available": true,
 *     "subdomain": "todo-app"
 *   }
 * }
 *
 * Response (unavailable):
 * {
 *   "success": true,
 *   "data": {
 *     "available": false,
 *     "subdomain": "todo-app",
 *     "reason": "This subdomain is already taken",
 *     "suggestions": ["todo-app-1", "todo-app-2", "todo-app-app"]
 *   }
 * }
 */
export async function handleV2SubdomainCheck(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = getRequestId(request);

  try {
    // 1. Parse and validate query parameter
    const url = new URL(request.url);
    const subdomain = url.searchParams.get('subdomain');

    if (!subdomain) {
      return v2Error('VALIDATION_FAILED', 'subdomain query parameter is required', 422, requestId);
    }

    // 2. Check availability using SubdomainService
    const subdomainService = new SubdomainService(env);
    const normalizedSubdomain = subdomainService.normalizeSubdomainInput(subdomain);

    if (!normalizedSubdomain) {
      return v2Error('VALIDATION_FAILED', 'Subdomain is invalid after sanitization', 422, requestId);
    }

    const result = await subdomainService.subdomainExists(normalizedSubdomain);

    if (result.ok) {
      const exists = result.value;
      const available = !exists;  // Invert: exists=true means available=false

      // 3. Generate suggestions if unavailable
      const suggestions = available ? [] : [
        `${normalizedSubdomain}-1`,
        `${normalizedSubdomain}-2`,
        `${normalizedSubdomain}-app`
      ];

      const reason = available ? undefined : 'This subdomain is already taken';

      return v2Success({
        available,
        subdomain: normalizedSubdomain,
        ...(reason && { reason }),
        ...(suggestions.length > 0 && { suggestions })
      }, requestId);
    } else {
      // Handle KV error
      const status = result.error.code === 'SUBDOMAIN_KV_ERROR' ? 500 : 400;
      return v2Error(result.error.code, result.error.message, status, requestId);
    }

  } catch (error) {
    console.error('[SUBDOMAINS] Check error:', error);
    return v2Error('INTERNAL_ERROR', 'Failed to check subdomain availability', 500, requestId);
  }
}

/**
 * Handle POST /api/v2/subdomains/reserve
 *
 * Reserve a subdomain for a specific project.
 * Requires authentication via JWT or Bearer token.
 *
 * @param request - Incoming HTTP request with JSON body
 * @param env - Cloudflare Worker environment bindings
 * @returns Response with reserved subdomain details
 *
 * @example
 * POST /api/v2/subdomains/reserve
 * Authorization: Bearer <token>
 * Content-Type: application/json
 *
 * {
 *   "subdomain": "my-app",
 *   "project_id": "proj-123-abc"
 * }
 *
 * Response (success):
 * {
 *   "success": true,
 *   "data": {
 *     "id": "my-app-1731661800000",
 *     "subdomain": "my-app",
 *     "project_id": "proj-123-abc",
 *     "user_id": "user-456-def",
 *     "created_at": "2025-11-15T10:30:00.000Z",
 *     "is_active": true
 *   }
 * }
 *
 * Response (conflict - 409):
 * {
 *   "success": false,
 *   "error": {
 *     "code": "SUBDOMAIN_ALREADY_EXISTS",
 *     "message": "Subdomain already registered: my-app"
 *   }
 * }
 */
export async function handleV2SubdomainReserve(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = getRequestId(request);

  // 1. Validate authentication
  const auth = await validateV2Auth(request, env, requestId);
  if (auth.response) return auth.response;  // Early return on auth failure

  const userId = auth.context?.user?.id;
  if (!userId) {
    return v2Error('UNAUTHORIZED', 'User ID not found in authentication context', 401, requestId);
  }

  try {
    // 2. Parse and validate request body
    let body: { subdomain: string; project_id: string };
    try {
      body = await request.json();
    } catch {
      return v2Error('BAD_REQUEST', 'Invalid JSON in request body', 400, requestId);
    }

    const { subdomain, project_id } = body;

    if (!subdomain || !project_id) {
      return v2Error('VALIDATION_FAILED', 'subdomain and project_id are required', 422, requestId);
    }

    // 3. Reserve subdomain using SubdomainService
    const subdomainService = new SubdomainService(env);

    // Strip environment suffix from user-provided subdomain to get raw project name
    // registerSubdomain() will re-add the suffix via generateSubdomain()
    // This prevents double-suffix bug (e.g., "test-project-staging-staging")
    const subdomainSuffix = env.SUBDOMAIN_SUFFIX || '-staging';
    const projectName = subdomain.endsWith(subdomainSuffix)
      ? subdomain.slice(0, -subdomainSuffix.length)
      : subdomain;

    const result = await subdomainService.registerSubdomain(projectName, project_id, userId);

    if (result.ok) {
      // KV value now includes userId and metadata (JSON object)
      // 4. Return success response
      const createdAt = new Date().toISOString();
      return v2Success({
        id: `${subdomain}-${Date.now()}`,  // Generate temp ID
        subdomain,
        project_id,
        user_id: userId,
        created_at: createdAt,
        is_active: true
      }, requestId);
    } else {
      // Map error codes to HTTP status
      const errorStatusMap: Record<string, number> = {
        'SUBDOMAIN_ALREADY_EXISTS': 409,  // Conflict
        'SUBDOMAIN_INVALID_NAME': 422,    // Unprocessable Entity
        'SUBDOMAIN_KV_ERROR': 500,        // Internal Server Error
      };

      const status = errorStatusMap[result.error.code] || 500;
      return v2Error(result.error.code, result.error.message, status, requestId);
    }

  } catch (error) {
    console.error('[SUBDOMAINS] Reserve error:', error);
    const message = error instanceof Error ? error.message : 'Failed to reserve subdomain';
    return v2Error('INTERNAL_ERROR', message, 500, requestId);
  }
}

/**
 * Handle GET /api/v2/subdomains/project/:projectId
 *
 * Get the subdomain associated with a specific project.
 * Requires authentication via JWT or Bearer token.
 *
 * @param request - Incoming HTTP request
 * @param env - Cloudflare Worker environment bindings
 * @param projectId - Project ID from URL path parameter
 * @returns Response with subdomain and full URL
 *
 * @example
 * GET /api/v2/subdomains/project/proj-123-abc
 * Authorization: Bearer <token>
 *
 * Response (success):
 * {
 *   "success": true,
 *   "data": {
 *     "subdomain": "my-app",
 *     "url": "https://my-app.gpthost.online"
 *   }
 * }
 *
 * Response (not found - 404):
 * {
 *   "success": false,
 *   "error": {
 *     "code": "NOT_FOUND",
 *     "message": "No subdomain found for this project"
 *   }
 * }
 */
export async function handleV2SubdomainGet(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const requestId = getRequestId(request);

  // 1. Validate authentication
  const auth = await validateV2Auth(request, env, requestId);
  if (auth.response) return auth.response;

  const userId = auth.context?.user?.id;
  if (!userId) {
    return v2Error('UNAUTHORIZED', 'User ID not found in authentication context', 401, requestId);
  }

  try {
    // 2. Find subdomain for project using SubdomainService
    const subdomainService = new SubdomainService(env);
    const result = await subdomainService.getSubdomainForProject(projectId);

    if (result.ok) {
      const subdomain = result.value;

      if (!subdomain) {
        return v2Error('NOT_FOUND', 'No subdomain found for this project', 404, requestId);
      }

      // 3. Return subdomain and full URL
      const baseDomain = env.BASE_DOMAIN || 'gpthost.online';
      return v2Success({
        subdomain,
        url: `https://${subdomain}.${baseDomain}`
      }, requestId);
    } else {
      const status = result.error.code === 'SUBDOMAIN_NOT_FOUND' ? 404 : 500;
      return v2Error(result.error.code, result.error.message, status, requestId);
    }

  } catch (error) {
    console.error('[SUBDOMAINS] Get error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get subdomain';
    return v2Error('INTERNAL_ERROR', message, 500, requestId);
  }
}

/**
 * Handle DELETE /api/v2/subdomains/:subdomain
 *
 * Release/delete a subdomain, making it available for re-use.
 * Requires authentication via JWT or Bearer token.
 * Only the owner can delete their subdomain.
 *
 * @param request - Incoming HTTP request
 * @param env - Cloudflare Worker environment bindings
 * @param subdomain - Subdomain name from URL path parameter
 * @returns Response confirming deletion
 *
 * @example
 * DELETE /api/v2/subdomains/my-app
 * Authorization: Bearer <token>
 *
 * Response (success):
 * {
 *   "success": true,
 *   "data": {
 *     "message": "Subdomain released successfully",
 *     "subdomain": "my-app"
 *   }
 * }
 *
 * Response (not found - 404):
 * {
 *   "success": false,
 *   "error": {
 *     "code": "SUBDOMAIN_NOT_FOUND",
 *     "message": "Subdomain not found: my-app"
 *   }
 * }
 */
export async function handleV2SubdomainDelete(
  request: Request,
  env: Env,
  subdomain: string
): Promise<Response> {
  const requestId = getRequestId(request);

  // 1. Validate authentication
  const auth = await validateV2Auth(request, env, requestId);
  if (auth.response) return auth.response;

  const userId = auth.context?.user?.id;
  if (!userId) {
    return v2Error('UNAUTHORIZED', 'User ID not found in authentication context', 401, requestId);
  }

  try {
    const subdomainService = new SubdomainService(env);

    // 2. Delete subdomain with ownership validation
    const result = await subdomainService.deleteSubdomain(subdomain, userId);

    if (result.ok) {
      // 4. Return success response
      return v2Success({
        message: 'Subdomain released successfully',
        subdomain
      }, requestId);
    } else {
      // Map error codes to HTTP status
      const errorStatusMap: Record<string, number> = {
        'SUBDOMAIN_NOT_FOUND': 404,
        'SUBDOMAIN_UNAUTHORIZED': 403,  // Forbidden - user doesn't own this subdomain
        'SUBDOMAIN_KV_ERROR': 500,
      };

      const status = errorStatusMap[result.error.code] || 500;
      return v2Error(result.error.code, result.error.message, status, requestId);
    }

  } catch (error) {
    console.error('[SUBDOMAINS] Delete error:', error);
    const message = error instanceof Error ? error.message : 'Failed to release subdomain';
    return v2Error('INTERNAL_ERROR', message, 500, requestId);
  }
}
