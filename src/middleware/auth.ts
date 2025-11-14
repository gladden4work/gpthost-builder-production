/**
 * Authentication middleware helper for v2 API routes
 * Provides centralized authentication validation to avoid code duplication
 */

import { v2Error } from './envelope';
import { validateToken, type AuthSuccessContext, type AuthenticatedRequest } from '../utils/authUtils';
import { errorResponse } from '../utils/responses';

export interface V2AuthResult {
  response: Response | null;
  context?: AuthSuccessContext;
}

/**
 * Validate v2 API authentication
 * Returns structured result containing optional failure response and auth context
 * 
 * @param request - The incoming request
 * @param env - Environment variables
 * @param requestId - Request ID for tracking
 * @returns Response on failure, otherwise auth context for downstream handlers
 */
export async function validateV2Auth(
  request: Request,
  env: Env,
  requestId: string
): Promise<V2AuthResult> {
  const authHeader = request.headers.get('authorization');
  
  // In test environment, use simple token validation
  if (env.ENVIRONMENT === 'test') {
    if (!authHeader) {
      return { response: v2Error('AUTH_UNAUTHORIZED', 'Authentication required', 401, requestId) };
    }
    const token = authHeader.replace('Bearer ', '');
    // Only accept specific test token
    if (token !== 'test-token') {
      return { response: v2Error('AUTH_FORBIDDEN', 'Invalid token', 403, requestId) };
    }
    const context: AuthSuccessContext = {
      isValid: true,
      token,
      authType: 'test-bypass'
    };
    (request as AuthenticatedRequest).authContext = context;
    return { response: null, context };
  }
  
  // Production auth validation
  const validation = await validateToken(authHeader, env);
  
  if (!validation.isValid) {
    return {
      response: v2Error(
        'AUTH_UNAUTHORIZED',
        validation.error || 'Authentication required',
        401,
        requestId
      )
    };
  }

  const context: AuthSuccessContext = {
    ...validation,
    isValid: true,
    authType: validation.authType || 'legacy-token'
  };

  (request as AuthenticatedRequest).authContext = context;

  return { response: null, context };
}

/**
 * Legacy authentication middleware for non-v2 routes
 * Returns null if authentication passes, or an error Response if it fails
 * 
 * @param request - The incoming request
 * @param env - Environment variables
 * @returns null if auth passes, Response with error if auth fails
 */
export async function authMiddleware(
  request: Request,
  env: Env
): Promise<Response | null> {
  const authHeader = request.headers.get('authorization');
  
  // In test environment, use simple token validation
  if (env.ENVIRONMENT === 'test') {
    if (!authHeader) {
      return errorResponse('AUTH_UNAUTHORIZED', 'Authentication required', 401);
    }
    const token = authHeader.replace('Bearer ', '');
    // Only accept specific test token
    if (token !== 'test-token') {
      return errorResponse('AUTH_FORBIDDEN', 'Invalid token', 403);
    }
    const context: AuthSuccessContext = {
      isValid: true,
      token,
      authType: 'test-bypass'
    };
    (request as AuthenticatedRequest).authContext = context;
    return null; // Auth passed
  }
  
  // Production auth validation
  const validation = await validateToken(authHeader, env);
  
  if (!validation.isValid) {
    return errorResponse(
      'AUTH_UNAUTHORIZED',
      validation.error || 'Authentication required',
      401
    );
  }
  const context: AuthSuccessContext = {
    ...validation,
    isValid: true,
    authType: validation.authType || 'legacy-token'
  };

  (request as AuthenticatedRequest).authContext = context;

  return null; // Auth passed
}
