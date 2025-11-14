/**
 * Authentication utilities for GPTHost API
 * TASK-029: Environment Token Auth
 *
 * Provides secure token validation with constant-time comparison
 * and proper Bearer token format handling.
 *
 * SECURITY FIX (Week 2): Uses structured logging with PII redaction
 */

import { createLogger } from './logger';

export type AuthType = 'legacy-token' | 'supabase-jwt' | 'test-bypass';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
  aud?: string;
  sessionId?: string;
}

export interface AuthValidationResult {
  isValid: boolean;
  error?: string;
  token?: string;
  authType?: AuthType;
  user?: AuthenticatedUser;
  rawPayload?: Record<string, unknown>;
}

export type AuthSuccessContext = AuthValidationResult & { isValid: true; authType: AuthType };

export type AuthenticatedRequest = Request & { authContext?: AuthSuccessContext };

/**
 * Extract Bearer token from Authorization header
 * Supports format: "Bearer <token>" or "bearer <token>"
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.trim().split(' ');
  if (parts.length !== 2) {
    return null;
  }

  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  if (!token || token.length === 0) {
    return null;
  }

  return token;
}

/**
 * Perform constant-time string comparison to prevent timing attacks
 * Uses subtle crypto API when available, falls back to simple comparison
 */
export async function constantTimeCompare(a: string, b: string): Promise<boolean> {
  // If lengths are different, they can't be equal
  if (a.length !== b.length) {
    return false;
  }

  // Try to use WebCrypto subtle API for constant-time comparison
  try {
    const encoder = new TextEncoder();
    const aBytes = encoder.encode(a);
    const bBytes = encoder.encode(b);
    
    // Import keys for comparison
    const keyA = await crypto.subtle.importKey(
      'raw',
      aBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const keyB = await crypto.subtle.importKey(
      'raw', 
      bBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Sign the same data with both keys
    const data = encoder.encode('constant-time-comparison');
    const signatureA = await crypto.subtle.sign('HMAC', keyA, data);
    const signatureB = await crypto.subtle.sign('HMAC', keyB, data);

    // Compare signatures (which should be identical if keys are identical)
    const arrayA = new Uint8Array(signatureA);
    const arrayB = new Uint8Array(signatureB);
    
    if (arrayA.length !== arrayB.length) {
      return false;
    }
    
    let result = 0;
    for (let i = 0; i < arrayA.length; i++) {
      result |= arrayA[i] ^ arrayB[i];
    }
    
    return result === 0;
    
  } catch (error) {
    console.warn('WebCrypto constant-time comparison failed, falling back to simple comparison:', error);
    
    // Fallback: simple comparison with artificial delay
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    
    // Add small delay to make timing more consistent
    await new Promise(resolve => setTimeout(resolve, 1));
    
    return result === 0;
  }
}

function base64UrlToString(segment: string): string {
  let normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding) {
    normalized += '='.repeat(4 - padding);
  }

  const bufferGlobal = (globalThis as any).Buffer;
  if (bufferGlobal) {
    return bufferGlobal.from(normalized, 'base64').toString('utf-8');
  }

  if (typeof atob === 'function') {
    return atob(normalized);
  }

  throw new Error('No base64 decoder available in this environment');
}

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bufferGlobal = (globalThis as any).Buffer;
  if (bufferGlobal) {
    return bufferGlobal.from(buffer)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/u, '');
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof btoa === 'function') {
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/u, '');
  }

  throw new Error('No base64 encoder available in this environment');
}

function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3;
}

interface SupabaseJwtSuccess {
  success: true;
  user: AuthenticatedUser;
  rawPayload: Record<string, unknown>;
}

interface SupabaseJwtFailure {
  success: false;
  error: string;
}

function normalizeSupabaseUrl(url: string): string {
  return url.replace(/\/*$/, '');
}

function getSupabaseRestConfig(env: Env): { url: string; apiKey: string } | null {
  const url = (env as any).SUPABASE_URL as string | undefined;
  const anonKey = (env as any).SUPABASE_SERVICE_ROLE_KEY as string | undefined
    ?? (env as any).SUPABASE_ANON_KEY as string | undefined;

  if (!url || !anonKey) {
    return null;
  }

  return {
    url: normalizeSupabaseUrl(url),
    apiKey: anonKey,
  };
}

function safeDecodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length < 2) return undefined;

  try {
    return JSON.parse(base64UrlToString(parts[1]));
  } catch {
    return undefined;
  }
}

async function validateSupabaseJwt(token: string, secret: string): Promise<SupabaseJwtSuccess | SupabaseJwtFailure> {
  if (!secret) {
    return {
      success: false,
      error: 'Supabase JWT validation requires SUPABASE_JWT_SECRET'
    };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return {
      success: false,
      error: 'Supabase JWT malformed — expected three segments'
    };
  }

  const [headerSegment, payloadSegment, signatureSegment] = parts;

  let headerJson: Record<string, unknown>;
  let payloadJson: Record<string, unknown>;

  try {
    headerJson = JSON.parse(base64UrlToString(headerSegment));
  } catch (error) {
    return {
      success: false,
      error: `Supabase JWT header decode failed: ${(error as Error).message}`
    };
  }

  if ((headerJson?.alg as string | undefined)?.toUpperCase() !== 'HS256') {
    return {
      success: false,
      error: 'Supabase JWT unsupported algorithm — expected HS256'
    };
  }

  try {
    payloadJson = JSON.parse(base64UrlToString(payloadSegment));
  } catch (error) {
    return {
      success: false,
      error: `Supabase JWT payload decode failed: ${(error as Error).message}`
    };
  }

  const textEncoder = new TextEncoder();
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const expectedSignatureBuffer = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signingInput));
  const expectedSignature = arrayBufferToBase64Url(expectedSignatureBuffer);

  const signatureValid = await constantTimeCompare(signatureSegment, expectedSignature);
  if (!signatureValid) {
    return {
      success: false,
      error: 'Supabase JWT signature mismatch'
    };
  }

  const exp = payloadJson?.exp as number | undefined;
  if (typeof exp === 'number') {
    const now = Math.floor(Date.now() / 1000);
    if (exp < now) {
      return {
        success: false,
        error: 'Supabase JWT expired'
      };
    }
  }

  const sub = payloadJson?.sub;
  if (typeof sub !== 'string' || sub.length === 0) {
    return {
      success: false,
      error: 'Supabase JWT missing subject (sub) claim'
    };
  }

  return {
    success: true,
    user: {
      id: sub,
      email: typeof payloadJson?.email === 'string' ? payloadJson.email : undefined,
      role: typeof payloadJson?.role === 'string' ? payloadJson.role : undefined,
      aud: typeof payloadJson?.aud === 'string' ? payloadJson.aud : undefined,
      sessionId: typeof payloadJson?.session_id === 'string' ? payloadJson.session_id : undefined
    },
    rawPayload: payloadJson
  };
}

async function validateSupabaseJwtViaRest(token: string, env: Env): Promise<SupabaseJwtSuccess | SupabaseJwtFailure> {
  const config = getSupabaseRestConfig(env);
  if (!config) {
    return {
      success: false,
      error: 'Supabase REST validation requires SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY)'
    };
  }

  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: config.apiKey
      }
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const message = detail ? `Supabase REST validation failed (${response.status}): ${detail}` : `Supabase REST validation failed (${response.status})`;
      return {
        success: false,
        error: message
      };
    }

    const supabaseUser = await response.json() as Record<string, unknown>;

    const userId = typeof supabaseUser.id === 'string' && supabaseUser.id.length > 0
      ? supabaseUser.id
      : undefined;

    if (!userId) {
      return {
        success: false,
        error: 'Supabase REST validation failed: missing user id'
      };
    }

    const payload = safeDecodeJwtPayload(token);

    const email = typeof payload?.email === 'string'
      ? payload.email
      : typeof supabaseUser.email === 'string'
        ? supabaseUser.email
        : undefined;
    const role = typeof payload?.role === 'string'
      ? payload.role
      : typeof supabaseUser.role === 'string'
        ? supabaseUser.role
        : undefined;
    const aud = typeof payload?.aud === 'string'
      ? payload.aud
      : typeof supabaseUser.aud === 'string'
        ? supabaseUser.aud
        : undefined;
    const sessionId = typeof payload?.session_id === 'string'
      ? payload.session_id
      : undefined;

    return {
      success: true,
      user: {
        id: userId,
        email,
        role,
        aud,
        sessionId
      },
      rawPayload: payload ?? { source: 'supabase-rest', user: supabaseUser }
    };
  } catch (error) {
    return {
      success: false,
      error: `Supabase REST validation error: ${(error as Error).message}`
    };
  }
}

/**
 * Validate Bearer token against environment variable
 * Returns validation result with detailed error information
 */
export async function validateToken(authHeader: string | null, env: Env): Promise<AuthValidationResult> {
  // SECURITY FIX (Week 2): Initialize logger for secure logging
  const logger = createLogger(env);

  try {
    // In test environment, bypass auth to allow contract tests to assert
    // validation and content-type behavior independently of auth.
    if ((env as any).ENVIRONMENT === 'test') {
      return {
        isValid: true,
        token: 'test-bypass',
        authType: 'test-bypass'
      };
    }

    const supabaseSecret = (env as any).SUPABASE_JWT_SECRET as string | undefined;

    if (!env.MVP_ACCESS_TOKEN && !supabaseSecret) {
      return {
        isValid: false,
        error: 'Authentication not configured - set MVP_ACCESS_TOKEN or SUPABASE_JWT_SECRET'
      };
    }

    // Extract token from Authorization header
    const providedToken = extractBearerToken(authHeader);
    if (!providedToken) {
      return {
        isValid: false,
        error: 'Missing or invalid Authorization header - expected format: Bearer <token>'
      };
    }

    // Legacy Bearer token check remains first to preserve existing automation behaviour
    if (env.MVP_ACCESS_TOKEN) {
      const legacyMatch = await constantTimeCompare(providedToken, env.MVP_ACCESS_TOKEN);
      if (legacyMatch) {
        // SECURITY FIX (Week 2): No token prefix logging, logger handles PII
        logger.info('Authentication successful via legacy MVP token', {
          authType: 'legacy-token',
          tokenLength: providedToken.length,
        });

        return {
          isValid: true,
          token: providedToken,
          authType: 'legacy-token'
        };
      }
    }

    const tokenLooksJwt = looksLikeJwt(providedToken);

    if (tokenLooksJwt) {
      let supabaseFailure: string | undefined;

      if (supabaseSecret) {
        const supabaseResult = await validateSupabaseJwt(providedToken, supabaseSecret);

        if (supabaseResult.success) {
          // SECURITY FIX (Week 2): Logger automatically hashes user_id (PII)
          logger.info('Authentication successful via Supabase JWT', {
            authType: 'supabase-jwt',
            userId: supabaseResult.user.id,
            role: supabaseResult.user.role,
          });

          return {
            isValid: true,
            token: providedToken,
            authType: 'supabase-jwt',
            user: supabaseResult.user,
            rawPayload: supabaseResult.rawPayload
          };
        }

        supabaseFailure = supabaseResult.error;
      }

      const restResult = await validateSupabaseJwtViaRest(providedToken, env);

      if (restResult.success) {
        // SECURITY FIX (Week 2): Logger automatically hashes user_id (PII)
        logger.info('Authentication successful via Supabase REST fallback', {
          authType: 'supabase-jwt',
          source: 'supabase-rest',
          userId: restResult.user.id,
          role: restResult.user.role,
        });

        return {
          isValid: true,
          token: providedToken,
          authType: 'supabase-jwt',
          user: restResult.user,
          rawPayload: restResult.rawPayload
        };
      }

      return {
        isValid: false,
        error: supabaseFailure ?? restResult.error ?? 'Invalid Supabase JWT'
      };
    }

    // If Supabase is configured but token clearly isn't JWT, fall through to standard error
    // Otherwise maintain previous generic error for legacy invalid tokens
    const errorDetail = supabaseSecret
      ? 'Invalid Supabase JWT'
      : 'Invalid access token';

    // SECURITY FIX (Week 2): No token prefix logging
    logger.warn('Authentication failed: Invalid token provided', {
      tokenLength: providedToken.length,
      errorDetail,
    });

    return {
      isValid: false,
      error: errorDetail
    };

  } catch (error) {
    // SECURITY FIX (Week 2): Error logging with proper context
    logger.error('Error during token validation', error as Error);
    return {
      isValid: false,
      error: 'Internal authentication error'
    };
  }
}

/**
 * Check if a route should bypass authentication
 * Public routes that don't require authentication
 */
export function isPublicRoute(path: string, method: string, env?: Env): boolean {
  const publicRoutes = [
    // Health check endpoint
    { path: '/api/health', method: 'GET' },

    // Test routes (should be removed in production)
    { path: '/test-r2', method: 'GET' },
    { path: '/message', method: 'GET' },
    { path: '/random', method: 'GET' },

    // CORS preflight requests
    { path: '*', method: 'OPTIONS' },
  ];

  // Check exact matches
  for (const route of publicRoutes) {
    if (route.method === method || route.method === '*') {
      if (route.path === '*' || route.path === path) {
        return true;
      }
    }
  }

  // SECURITY FIX (Week 1): Emergency endpoints gated behind feature flag
  // Only allow public access when ENABLE_EMERGENCY_ENDPOINTS is explicitly enabled
  if (env && env.ENABLE_EMERGENCY_ENDPOINTS === 'true') {
    // EMERGENCY MODE: Allow manual-deploy endpoint for fixing stuck deployments
    if (path.match(/^\/api\/projects\/[^/]+\/manual-deploy$/) && method === 'POST') {
      console.warn('[AUTH] EMERGENCY MODE: Allowing public access to manual-deploy endpoint (ENABLE_EMERGENCY_ENDPOINTS=true)');
      return true;
    }

    // EMERGENCY MODE: Allow emergency deployment endpoint
    if (path.match(/^\/api\/emergency\/deploy\/[^/]+$/) && method === 'POST') {
      console.warn('[AUTH] EMERGENCY MODE: Allowing public access to emergency deploy endpoint (ENABLE_EMERGENCY_ENDPOINTS=true)');
      return true;
    }
  }

  // Special handling for non-API routes (deployed sites)
  if (!path.startsWith('/api/')) {
    return true; // Site routing is public
  }

  return false;
}

/**
 * Generate authentication error response
 * Consistent format for all auth failures
 */
export function createAuthErrorResponse(error: string, status: number = 401): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: status === 401 ? 'UNAUTHORIZED' : 'AUTHENTICATION_ERROR',
        message: error,
        timestamp: new Date().toISOString()
      }
    }), 
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="GPTHost API"',
        // CORS headers for auth errors
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    }
  );
}
