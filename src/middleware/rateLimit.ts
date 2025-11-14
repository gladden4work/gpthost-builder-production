/**
 * Rate Limiting Middleware
 * Enforces rate limits using token bucket algorithm
 * Applies AFTER authentication (requires user context)
 */

import { checkRateLimit } from '../utils/rateLimiter';
import type {
  RateLimitTier,
  RateLimitEndpoint,
  RateLimitError
} from '../types/rateLimit';
import type { AuthenticatedRequest } from '../utils/authUtils';

/**
 * Determine rate limit endpoint from request path
 */
function getEndpointFromPath(path: string, method: string): RateLimitEndpoint | null {
  // Specific endpoint checks
  if (method === 'POST' && path === '/api/paste') {
    return 'paste';
  }

  if (method === 'POST' && /^\/api\/projects\/[^/]+\/build$/.test(path)) {
    return 'build';
  }

  // Global rate limit applies to all authenticated API endpoints
  if (path.startsWith('/api/')) {
    return 'global';
  }

  return null; // No rate limiting for non-API routes
}

/**
 * Get user tier from auth context
 * Phase 1: Always returns 'free' tier
 * Phase 2: Will check user's subscription status
 */
function getUserTier(request: AuthenticatedRequest): RateLimitTier {
  // Phase 1: All users are free tier
  // Phase 2: Check request.authContext.user?.subscription_tier or similar
  return 'free';
}

/**
 * Extract user ID from authenticated request
 * Returns null if no auth context (shouldn't happen after auth middleware)
 */
function getUserId(request: AuthenticatedRequest): string | null {
  const authContext = request.authContext;

  if (!authContext) {
    console.warn('[RATE_LIMIT] No authContext found');
    return null;
  }

  // Supabase JWT: use user.id
  if (authContext.user?.id) {
    return authContext.user.id;
  }

  // Legacy token: use token hash as user ID
  if (authContext.authType === 'legacy-token' && authContext.token) {
    // For legacy tokens, use a consistent user ID
    return 'legacy-single-tenant';
  }

  // Test bypass
  if (authContext.authType === 'test-bypass') {
    return 'test-user';
  }

  console.warn('[RATE_LIMIT] Could not determine user ID from authContext');
  return null;
}

/**
 * Add rate limit headers to response
 */
function addRateLimitHeaders(
  response: Response,
  limit: number,
  remaining: number,
  resetAt: number
): Response {
  const headers = new Headers(response.headers);

  headers.set('RateLimit-Limit', limit.toString());
  headers.set('RateLimit-Remaining', Math.max(0, remaining).toString());
  headers.set('RateLimit-Reset', Math.floor(resetAt / 1000).toString()); // Unix timestamp

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Create 429 Too Many Requests response
 */
function createRateLimitErrorResponse(
  endpoint: RateLimitEndpoint,
  limit: number,
  retryAfter: number,
  resetAt: number
): Response {
  const windowName = endpoint === 'build' ? 'day' : 'minute';

  const error: RateLimitError = {
    code: endpoint === 'global' ? 'GLOBAL_RATE_LIMIT' : 'RATE_LIMIT_EXCEEDED',
    message: endpoint === 'global'
      ? 'Too many requests. Please slow down.'
      : `${endpoint.charAt(0).toUpperCase() + endpoint.slice(1)} limit exceeded (${limit} per ${windowName}). Resets at ${new Date(resetAt).toISOString()}`,
    retry_after_seconds: retryAfter,
    limit,
    window: windowName,
    used: limit
  };

  const headers = new Headers({
    'Content-Type': 'application/json',
    'RateLimit-Limit': limit.toString(),
    'RateLimit-Remaining': '0',
    'RateLimit-Reset': Math.floor(resetAt / 1000).toString(),
    'Retry-After': retryAfter.toString()
  });

  return new Response(JSON.stringify({ error }, null, 2), {
    status: 429,
    headers
  });
}

/**
 * Rate limit middleware - checks and enforces rate limits
 *
 * Apply this AFTER authentication middleware (requires user context)
 * Apply this BEFORE route handlers
 *
 * @param request - Authenticated request with user context
 * @param env - Worker environment
 * @param path - Request path
 * @param method - HTTP method
 * @returns null if allowed, 429 Response if rate limit exceeded
 */
export async function rateLimitMiddleware(
  request: AuthenticatedRequest,
  env: Env,
  path: string,
  method: string
): Promise<Response | null> {
  try {
    // Determine endpoint for rate limiting
    const endpoint = getEndpointFromPath(path, method);

    if (!endpoint) {
      // No rate limiting for this endpoint
      return null;
    }

    // Extract user ID from auth context
    const userId = getUserId(request);

    if (!userId) {
      // No user context - shouldn't happen after auth middleware
      // Log warning but allow request (fail open)
      console.warn('[RATE_LIMIT] No user ID in authenticated request - failing open');
      return null;
    }

    // Get user tier
    const tier = getUserTier(request);

    // Check rate limit
    const result = await checkRateLimit(userId, endpoint, tier, env);

    if (!result.allowed) {
      // Rate limit exceeded - return 429
      console.info(`[RATE_LIMIT] Blocked: user=${userId}, endpoint=${endpoint}, tier=${tier}`);
      return createRateLimitErrorResponse(
        endpoint,
        result.limit,
        result.retry_after || 60,
        result.reset_at
      );
    }

    // Store rate limit info for adding headers to successful response
    (request as any).rateLimitInfo = {
      limit: result.limit,
      remaining: result.remaining,
      resetAt: result.reset_at
    };

    return null; // Request allowed

  } catch (error) {
    // On error, fail open (allow request) for availability
    console.error('[RATE_LIMIT] Middleware error - failing open:', error);
    return null;
  }
}

/**
 * Add rate limit headers to successful response
 * Call this when returning successful responses from route handlers
 *
 * @param response - Original response
 * @param request - Request with rate limit info
 * @returns Response with rate limit headers added
 */
export function addRateLimitHeadersToResponse(
  response: Response,
  request: AuthenticatedRequest
): Response {
  const rateLimitInfo = (request as any).rateLimitInfo;

  if (!rateLimitInfo) {
    // No rate limit info - return response as-is
    return response;
  }

  return addRateLimitHeaders(
    response,
    rateLimitInfo.limit,
    rateLimitInfo.remaining,
    rateLimitInfo.resetAt
  );
}
