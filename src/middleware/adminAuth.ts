/**
 * Admin Authentication Middleware
 * Phase 1: Super Admin Dashboard - Foundation & Auth
 *
 * Provides env-based allowlist authentication for super admin routes
 * No database lookups - checks against SUPER_ADMIN_EMAILS, SUPER_ADMIN_IDS, and SUPER_ADMIN_BEARER
 */

import type { AuthenticatedRequest, AuthSuccessContext } from '../utils/authUtils';
import { v2Error } from './envelope';

/**
 * Check if a user is a super admin based on env allowlist
 * Checks in priority order: SUPER_ADMIN_BEARER > SUPER_ADMIN_EMAILS > SUPER_ADMIN_IDS
 *
 * @param request - The authenticated request with authContext
 * @param env - Environment variables containing allowlists
 * @returns true if user is a super admin, false otherwise
 */
export function isSuperAdmin(request: AuthenticatedRequest, env: Env): boolean {
  // Check for emergency ops bearer token first
  const authHeader = request.headers.get('authorization');
  if (authHeader && env.SUPER_ADMIN_BEARER) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token === env.SUPER_ADMIN_BEARER) {
      return true;
    }
  }

  // Get authenticated user context
  const authContext: AuthSuccessContext | undefined = request.authContext;

  if (!authContext?.user?.id) {
    return false;
  }

  const userId = authContext.user.id;
  const userEmail = authContext.user.email;

  // Parse allowlists from env (comma-separated)
  const allowlistEmails = (env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  const allowlistIds = (env.SUPER_ADMIN_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  // Check email first (primary method)
  if (userEmail && allowlistEmails.includes(userEmail.toLowerCase())) {
    return true;
  }

  // Check user ID as fallback
  if (allowlistIds.includes(userId)) {
    return true;
  }

  return false;
}

/**
 * Middleware to require super admin access
 * Returns null if access granted, or error Response if denied
 *
 * Usage: Apply after authenticateRequest middleware
 *
 * @param request - The authenticated request
 * @param env - Environment variables
 * @param requestId - Optional request ID for tracking
 * @returns null if authorized, Response with 403 if not authorized
 */
export function requireAdmin(
  request: Request,
  env: Env,
  requestId?: string
): Response | null {
  const authRequest = request as AuthenticatedRequest;

  // Ensure user is authenticated first
  if (!authRequest.authContext?.user?.id) {
    return v2Error(
      'AUTH_UNAUTHORIZED',
      'Authentication required',
      401,
      requestId
    );
  }

  // Check super admin access
  if (!isSuperAdmin(authRequest, env)) {
    return v2Error(
      'AUTH_FORBIDDEN',
      'Super admin access required',
      403,
      requestId
    );
  }

  // Access granted
  return null;
}
