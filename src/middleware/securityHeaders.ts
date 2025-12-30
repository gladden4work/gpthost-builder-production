/**
 * Security Headers Middleware
 * Week 2 Security Audit Implementation (2025-11-05)
 *
 * Adds comprehensive security headers to all API responses to protect against:
 * - XSS attacks (Content-Security-Policy)
 * - Clickjacking (X-Frame-Options)
 * - MIME sniffing (X-Content-Type-Options)
 * - Information disclosure (various headers)
 *
 * IMPORTANT: Does not wrap Server-Sent Events (SSE) streams to avoid breaking real-time updates.
 */

import { Env } from '../types/env';

/**
 * Check if response is a Server-Sent Events stream
 */
function isSSEResponse(response: Response): boolean {
  const contentType = response.headers.get('Content-Type');
  return contentType?.includes('text/event-stream') || false;
}

/**
 * Generate Content Security Policy based on environment
 * 
 * NOTE: Our product goal is "unblock by default" for AI-generated code.
 * So we allow external resources over HTTPS broadly (scripts, styles, fonts, images).
 *
 * Security posture still relies on:
 * - tight defaults (default-src 'self')
 * - no framing (frame-ancestors 'none')
 * - restricted base/form
 */
function generateCSP(env: Env): string {
  const isProduction = env.ENVIRONMENT === 'production';

  // Base CSP directives (allow-by-default HTTPS for external assets)
  const directives = [
    "default-src 'self'",
    // Allow inline styles for React components + HTTPS styles
    "style-src 'self' 'unsafe-inline' https:",
    // Allow images from self, data URIs, blobs, and HTTPS
    "img-src 'self' data: blob: https:",
    // Allow fonts from self, data URIs, and HTTPS
    "font-src 'self' data: https:",
    // Allow connections to self, Supabase, R2, and any HTTPS/WSS
    `connect-src 'self' https: wss: https://najxejmynucgnqsgqvek.supabase.co ${env.WORKER_URL || 'https://*.workers.dev'} https://*.r2.cloudflarestorage.com`,
    // Allow media from self, blobs, and HTTPS
    "media-src 'self' blob: https:",
    // Allow workers from self and blobs (for service workers, web workers)
    "worker-src 'self' blob:",
    // Disallow plugins/Flash/etc.
    "object-src 'none'",
    // Prevent framing (also covered by X-Frame-Options)
    "frame-ancestors 'none'",
    // Restrict base URI
    "base-uri 'self'",
    // Restrict form actions
    "form-action 'self'",
  ];

  if (isProduction) {
    // Production: allow scripts from self + any HTTPS (unblock-by-default)
    directives.splice(1, 0, "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:");
    directives.push("upgrade-insecure-requests");
  } else {
    // Development: Also allow localhost for dev tools
    directives.splice(1, 0, "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http://localhost:*");
  }

  return directives.join('; ');
}

/**
 * Add security headers to response
 *
 * @param response - The original response
 * @param env - Environment variables
 * @param request - Optional request object for context
 * @returns Response with security headers added
 */
export function addSecurityHeaders(
  response: Response,
  env: Env,
  request?: Request
): Response {
  // Skip wrapping SSE streams to avoid breaking real-time updates
  if (isSSEResponse(response)) {
    console.debug('[SECURITY] Skipping header wrapping for SSE stream');
    return response;
  }

  const headers = new Headers(response.headers);

  // Content Security Policy - Prevents XSS attacks
  const csp = generateCSP(env);
  headers.set('Content-Security-Policy', csp);

  // Prevent MIME type sniffing
  headers.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking (frame embedding)
  headers.set('X-Frame-Options', 'SAMEORIGIN');

  // Force HTTPS (HTTP Strict Transport Security)
  // 1 year, include subdomains, allow preloading
  headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains; preload'
  );

  // Control referrer information leakage
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Control browser features (deny access to sensitive APIs)
  headers.set(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
  );

  // Cross-Origin Resource Policy - Restrict resource loading
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  // Cross-Origin Opener Policy - Isolate browsing context
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  // X-Permitted-Cross-Domain-Policies - Restrict Adobe products
  headers.set('X-Permitted-Cross-Domain-Policies', 'none');

  // Remove server information disclosure
  headers.delete('Server');
  headers.delete('X-Powered-By');

  // For sensitive endpoints (auth, debug, admin), disable caching
  if (request) {
    const path = new URL(request.url).pathname;
    const isSensitiveEndpoint =
      path.includes('/auth') ||
      path.includes('/debug') ||
      path.includes('/admin') ||
      path.includes('/emergency');

    if (isSensitiveEndpoint) {
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      headers.set('Pragma', 'no-cache');
      headers.set('Expires', '0');
    }
  }

  // Return new response with security headers
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Add minimal security headers for SSE responses
 * (called manually in SSE manager since we can't wrap the body)
 */
export function getSSESecurityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}
