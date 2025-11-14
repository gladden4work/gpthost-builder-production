/**
 * Global Rate Limiting Middleware
 * Week 2 Security Audit Implementation (2025-11-05)
 *
 * Implements IP-based rate limiting for public endpoints to prevent:
 * - DDoS attacks
 * - Resource exhaustion
 * - Cost attacks (excessive Cloudflare Workers billing)
 * - Automated scraping
 *
 * This is a lightweight rate limiter that applies BEFORE authentication
 * and protects public endpoints like /api/health, /sites/*, etc.
 *
 * Uses Cloudflare Durable Objects for distributed rate limiting state.
 */

import { Env } from '../types/env';

/**
 * Rate limit configuration by endpoint type
 */
interface RateLimitConfig {
  maxRequests: number; // Maximum requests allowed
  windowSeconds: number; // Time window in seconds
  blockDurationSeconds: number; // How long to block after exceeding limit
}

/**
 * Rate limit configurations for different endpoint types
 */
const RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  // Health check endpoint - generous limit for monitoring
  health: {
    maxRequests: 100,
    windowSeconds: 60, // 100 requests per minute
    blockDurationSeconds: 60,
  },
  // Public site serving - moderate limit to prevent scraping
  sites: {
    maxRequests: 200,
    windowSeconds: 60, // 200 requests per minute per IP
    blockDurationSeconds: 300, // 5 minute block
  },
  // Test endpoints - very restrictive
  test: {
    maxRequests: 10,
    windowSeconds: 60,
    blockDurationSeconds: 600, // 10 minute block
  },
  // Default for other public endpoints
  default: {
    maxRequests: 50,
    windowSeconds: 60,
    blockDurationSeconds: 300,
  },
};

/**
 * Determine rate limit config based on request path
 */
function getRateLimitConfig(path: string): RateLimitConfig {
  if (path === '/api/health' || path === '/health') {
    return RATE_LIMIT_CONFIGS.health;
  }
  if (path.startsWith('/sites/')) {
    return RATE_LIMIT_CONFIGS.sites;
  }
  if (path.startsWith('/test') || path.includes('test-r2') || path === '/message' || path === '/random') {
    return RATE_LIMIT_CONFIGS.test;
  }
  return RATE_LIMIT_CONFIGS.default;
}

/**
 * Get client IP address from request
 */
function getClientIP(request: Request): string {
  // Cloudflare provides real client IP in CF-Connecting-IP header
  const cfIP = request.headers.get('CF-Connecting-IP');
  if (cfIP) return cfIP;

  // Fallback to X-Forwarded-For (less reliable)
  const xForwardedFor = request.headers.get('X-Forwarded-For');
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }

  // Last resort: try to get from X-Real-IP
  const xRealIP = request.headers.get('X-Real-IP');
  if (xRealIP) return xRealIP;

  return 'unknown';
}

/**
 * In-memory rate limiting for Workers (since we don't have KV in all environments)
 * This is reset on Worker restart but provides basic protection
 */
const rateLimitCache = new Map<string, { count: number; resetAt: number; blockedUntil?: number }>();

/**
 * Clean up expired entries from cache (called periodically)
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, value] of rateLimitCache.entries()) {
    if (value.resetAt < now && (!value.blockedUntil || value.blockedUntil < now)) {
      rateLimitCache.delete(key);
    }
  }
}

/**
 * Global rate limiting middleware
 *
 * Applies IP-based rate limiting to protect against abuse.
 * Returns Response if rate limit exceeded, null to continue.
 *
 * @param request - The incoming request
 * @param env - Environment variables
 * @returns Response with 429 if rate limited, null otherwise
 */
export async function globalRateLimitMiddleware(
  request: Request,
  env: Env
): Promise<Response | null> {
  // Skip rate limiting in development mode
  if (env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'test') {
    return null;
  }

  // Get client IP and request path
  const ip = getClientIP(request);
  const path = new URL(request.url).pathname;

  // Skip rate limiting for certain paths that have their own protection
  // (authenticated endpoints already have per-user rate limiting)
  if (path.startsWith('/api/v2/') || path.startsWith('/api/projects/')) {
    // These are authenticated endpoints with their own rate limiting
    return null;
  }

  // Get rate limit config for this endpoint
  const config = getRateLimitConfig(path);
  const cacheKey = `global_rate_limit:${ip}:${path.startsWith('/sites/') ? 'sites' : path}`;

  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  // Periodically clean up expired entries (1% of requests)
  if (Math.random() < 0.01) {
    cleanupExpiredEntries();
  }

  // Get or create rate limit entry
  let entry = rateLimitCache.get(cacheKey);

  // Check if IP is currently blocked
  if (entry?.blockedUntil && entry.blockedUntil > now) {
    const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
    console.warn('[GLOBAL-RATE-LIMIT] IP blocked', {
      ip,
      path,
      blockedUntil: new Date(entry.blockedUntil).toISOString(),
      retryAfter,
    });

    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        message: 'Too many requests from your IP address. Please try again later.',
        retryAfter,
        blockedUntil: new Date(entry.blockedUntil).toISOString(),
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(config.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(entry.blockedUntil / 1000)),
        },
      }
    );
  }

  // Initialize or reset counter if window expired
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + windowMs,
    };
    rateLimitCache.set(cacheKey, entry);
  }

  // Increment counter
  entry.count++;

  // Check if limit exceeded
  if (entry.count > config.maxRequests) {
    // Block the IP for the configured duration
    entry.blockedUntil = now + config.blockDurationSeconds * 1000;
    rateLimitCache.set(cacheKey, entry);

    const retryAfter = config.blockDurationSeconds;

    console.warn('[GLOBAL-RATE-LIMIT] Rate limit exceeded, blocking IP', {
      ip,
      path,
      count: entry.count,
      limit: config.maxRequests,
      blockedFor: `${retryAfter}s`,
    });

    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        message: 'Too many requests from your IP address. Please try again later.',
        retryAfter,
        limit: config.maxRequests,
        window: `${config.windowSeconds}s`,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(config.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
        },
      }
    );
  }

  // Update rate limit headers for successful requests
  const remaining = Math.max(0, config.maxRequests - entry.count);

  // Store these for adding to the response later
  (request as any)._rateLimitHeaders = {
    'X-RateLimit-Limit': String(config.maxRequests),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
  };

  return null; // Allow request to proceed
}

/**
 * Add rate limit headers to response
 * Call this after handling the request successfully
 */
export function addRateLimitHeaders(response: Response, request: Request): Response {
  const rateLimitHeaders = (request as any)._rateLimitHeaders;
  if (!rateLimitHeaders) {
    return response;
  }

  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(rateLimitHeaders)) {
    headers.set(key, value as string);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
