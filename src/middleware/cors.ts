/**
 * CORS Middleware
 * Handles Cross-Origin Resource Sharing for API v2
 * Based on DAY5-TDD-STRATEGY.md specifications
 */

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'X-Request-ID'];

const DEFAULT_PRODUCTION_ORIGINS = [
  'https://app.gpthost.dev',
  'https://gpthost.dev'
];

const DEFAULT_LOCAL_ORIGINS = [
  'http://localhost:8080',
  'http://localhost:5173',
  'http://localhost:3000'
];

/**
 * Get allowed origins from environment or use defaults
 */
function getAllowedOrigins(env?: any): string[] {
  const envOrigins = env?.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((origin: string) => origin.trim()).filter(Boolean)
    : [];

  const combined = [...envOrigins, ...DEFAULT_PRODUCTION_ORIGINS, ...DEFAULT_LOCAL_ORIGINS];

  return Array.from(new Set(combined));
}

/**
 * Check if origin is allowed
 */
function isAllowedOrigin(origin: string | null, env?: any): boolean {
  if (!origin) return false;
  const allowedOrigins = getAllowedOrigins(env);
  return allowedOrigins.includes(origin);
}

/**
 * Add CORS headers to response
 *
 * SECURITY FIX (Week 2): Credentials only allowed for explicitly allowed origins
 * This prevents credential theft if a malicious origin is somehow added to allowlist
 */
export function addCorsHeaders(response: Response, request: Request, env?: any): Response {
  const origin = request.headers.get('Origin');
  const headers = new Headers(response.headers);
  const allowedOrigins = getAllowedOrigins(env);
  const isAllowed = isAllowedOrigin(origin, env);

  // Set CORS headers
  if (isAllowed && origin) {
    // For allowed origins: reflect the origin and allow credentials
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  } else if (origin) {
    // For non-allowed origins: reflect origin but deny credentials
    // This allows browsers to see the response but not access credentials
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'false');
  } else {
    // No origin header: default to first allowed origin (for non-browser clients)
    headers.set('Access-Control-Allow-Origin', allowedOrigins[0]);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }

  headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
  headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
  headers.set('Access-Control-Max-Age', '86400'); // 24 hours

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Handle CORS preflight requests
 *
 * SECURITY FIX (Week 2): Credentials only allowed for explicitly allowed origins
 */
export function handleCorsPreflightV2(request: Request, env?: any): Response | null {
  if (request.method !== 'OPTIONS') {
    return null;
  }

  const origin = request.headers.get('Origin');
  const headers = new Headers();
  const allowedOrigins = getAllowedOrigins(env);
  const isAllowed = isAllowedOrigin(origin, env);

  if (isAllowed && origin) {
    // For allowed origins: reflect the origin and allow credentials
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  } else if (origin) {
    // For non-allowed origins: reflect origin but deny credentials
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'false');
  } else {
    // No origin header: default to first allowed origin
    headers.set('Access-Control-Allow-Origin', allowedOrigins[0]);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }

  headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS.join(', '));
  headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS.join(', '));
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(null, {
    status: 204,
    headers
  });
}

/**
 * CORS middleware wrapper
 */
export function withCors<T extends (...args: any[]) => Promise<Response>>(
  handler: T,
  env?: any
): T {
  return (async (...args: Parameters<T>) => {
    const request = args[0] as Request;
    const actualEnv = env || args[1]; // Try to get env from args if not provided
    
    // Handle preflight
    const preflightResponse = handleCorsPreflightV2(request, actualEnv);
    if (preflightResponse) {
      return preflightResponse;
    }
    
    // Execute handler
    const response = await handler(...args);
    
    // Add CORS headers to response
    return addCorsHeaders(response, request, actualEnv);
  }) as T;
}
