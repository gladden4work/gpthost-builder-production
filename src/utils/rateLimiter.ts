/**
 * Rate Limiter - Token Bucket Algorithm Implementation
 * Phase 1: Free tier enforcement with Cloudflare KV storage
 *
 * Algorithm:
 * 1. Fetch current bucket from KV (or create if doesn't exist)
 * 2. Calculate tokens to add based on elapsed time
 * 3. Add tokens (capped at max)
 * 4. Check if request can be allowed (>= 1 token)
 * 5. Deduct token if allowed
 * 6. Store updated bucket in KV
 */

import type {
  RateLimitTier,
  RateLimitEndpoint,
  RateLimitResult,
  TokenBucket,
  RateLimitConfig
} from '../types/rateLimit';
import { getTierConfig } from '../types/rateLimit';

/**
 * KV TTL for rate limit buckets (24 hours in seconds)
 * Buckets auto-expire after 24 hours of inactivity
 */
const KV_TTL_SECONDS = 24 * 60 * 60;

/**
 * Generate KV key for rate limit bucket
 * Format: rate_limit:{user_id}:{endpoint}
 */
export function getRateLimitKey(userId: string, endpoint: RateLimitEndpoint): string {
  return `rate_limit:${userId}:${endpoint}`;
}

/**
 * Calculate number of tokens to add based on elapsed time
 *
 * @param lastRefillMs - Last refill timestamp in milliseconds
 * @param nowMs - Current timestamp in milliseconds
 * @param refillRate - Tokens to add per minute
 * @returns Number of tokens to add
 */
export function calculateTokenRefill(
  lastRefillMs: number,
  nowMs: number,
  refillRate: number
): number {
  const elapsedMs = nowMs - lastRefillMs;
  const elapsedMinutes = elapsedMs / (60 * 1000);
  return elapsedMinutes * refillRate;
}

/**
 * Get rate limit configuration for endpoint and tier
 */
function getEndpointConfig(
  endpoint: RateLimitEndpoint,
  tier: RateLimitTier
): RateLimitConfig {
  const tierConfig = getTierConfig(tier);

  switch (endpoint) {
    case 'paste':
      return tierConfig.paste_per_minute;
    case 'build':
      return tierConfig.build_per_day;
    case 'global':
      return tierConfig.global_per_minute;
    default:
      // Default to global limit for unknown endpoints
      return tierConfig.global_per_minute;
  }
}

/**
 * Check rate limit for user and endpoint using token bucket algorithm
 *
 * Implementation notes:
 * - Uses KV with cacheTtl:0 to bypass edge caching and prevent lost updates
 * - Phase 1: KV-based with eventual consistency trade-offs
 * - Phase 2+: Consider Durable Objects for strong consistency guarantees
 *
 * @param userId - Unique user identifier
 * @param endpoint - Endpoint being accessed
 * @param tier - User's rate limit tier
 * @param env - Worker environment with KV namespace
 * @returns Rate limit result with allowed status and metadata
 */
export async function checkRateLimit(
  userId: string,
  endpoint: RateLimitEndpoint,
  tier: RateLimitTier,
  env: Env
): Promise<RateLimitResult> {
  try {
    // Check if KV namespace is available
    if (!env.RATE_LIMIT_STORE) {
      console.warn('[RATE_LIMIT] KV namespace not available - failing open');
      return {
        allowed: true,
        remaining: 999,
        limit: 999,
        reset_at: Date.now() + 60 * 1000
      };
    }

    const config = getEndpointConfig(endpoint, tier);
    const key = getRateLimitKey(userId, endpoint);
    const now = Date.now();

    // Fetch current bucket from KV
    // Use cacheTtl:0 to bypass edge cache and get latest value
    // This prevents lost updates due to KV eventual consistency
    let bucket: TokenBucket;
    const storedData = await env.RATE_LIMIT_STORE.get(key, { cacheTtl: 0 });

    const wasNewBucket = !storedData;

    if (storedData) {
      try {
        bucket = JSON.parse(storedData);
      } catch (parseError) {
        // Corrupted data - create new bucket
        console.warn(`[RATE_LIMIT] Corrupted bucket data for ${key}, creating new bucket`);
        bucket = {
          tokens: config.max_tokens,
          last_refill: now
        };
      }
    } else {
      // First request - create new bucket with full tokens
      bucket = {
        tokens: config.max_tokens,
        last_refill: now
      };
    }

    const tokensBeforeRefill = bucket.tokens;
    const lastRefillBefore = bucket.last_refill;

    // Calculate tokens to add based on elapsed time
    const tokensToAdd = calculateTokenRefill(bucket.last_refill, now, config.refill_rate);

    // Add tokens (capped at max)
    bucket.tokens = Math.min(config.max_tokens, bucket.tokens + tokensToAdd);
    bucket.last_refill = now;

    // Check if request can be allowed
    const allowed = bucket.tokens >= 1;

    const tokensAfterRefill = bucket.tokens;

    if (allowed) {
      // Deduct one token
      bucket.tokens -= 1;
    }

    const tokensAfterDeduct = bucket.tokens;

    // Log rate limit events for monitoring
    if (!allowed) {
      console.warn(`[RATE_LIMIT] Blocked: ${userId}:${endpoint} (tier=${tier})`);
    }

    // Store updated bucket in KV with TTL
    await env.RATE_LIMIT_STORE.put(
      key,
      JSON.stringify(bucket),
      { expirationTtl: KV_TTL_SECONDS }
    );

    // Calculate reset timestamp (when bucket will be full again)
    const tokensNeeded = config.max_tokens - bucket.tokens;
    const minutesUntilFull = tokensNeeded / config.refill_rate;
    const resetAt = now + (minutesUntilFull * 60 * 1000);

    // Build result
    const result: RateLimitResult = {
      allowed,
      remaining: Math.floor(bucket.tokens),
      limit: config.max_tokens,
      reset_at: Math.floor(resetAt)
    };

    if (!allowed) {
      // Calculate retry_after (seconds until 1 token available)
      const minutesUntilToken = 1 / config.refill_rate;
      result.retry_after = Math.ceil(minutesUntilToken * 60);
    }

    return result;

  } catch (error) {
    // On error, fail open (allow request) for availability
    console.error('[RATE_LIMIT] Error checking rate limit:', error);
    return {
      allowed: true,
      remaining: 999,
      limit: 999,
      reset_at: Date.now() + 60 * 1000
    };
  }
}
