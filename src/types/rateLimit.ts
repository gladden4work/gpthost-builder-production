/**
 * Rate Limiting Type Definitions
 * Phase 1: Free tier only with token bucket algorithm
 */

/**
 * User tier for rate limiting
 * Phase 1: Only 'free' tier implemented
 * Phase 2 will add 'pro' and 'enterprise'
 */
export type RateLimitTier = 'free' | 'pro' | 'enterprise';

/**
 * Endpoint identifier for rate limiting
 */
export type RateLimitEndpoint = 'paste' | 'build' | 'global';

/**
 * Token bucket state stored in KV
 */
export interface TokenBucket {
  /** Current number of tokens available */
  tokens: number;
  /** Timestamp of last token refill (milliseconds since epoch) */
  last_refill: number;
}

/**
 * Rate limit configuration for a specific endpoint
 */
export interface RateLimitConfig {
  /** Maximum tokens in bucket */
  max_tokens: number;
  /** Token refill rate (tokens per minute) */
  refill_rate: number;
  /** Time window for the limit (in minutes for per-minute limits, 1440 for per-day) */
  window_minutes: number;
}

/**
 * Complete tier configuration
 */
export interface TierConfig {
  global_per_minute: RateLimitConfig;
  paste_per_minute: RateLimitConfig;
  build_per_day: RateLimitConfig;
}

/**
 * Result of rate limit check
 */
export interface RateLimitResult {
  /** Whether request is allowed */
  allowed: boolean;
  /** Remaining tokens (rounded down) */
  remaining: number;
  /** Total limit */
  limit: number;
  /** Unix timestamp when tokens will reset to full */
  reset_at: number;
  /** Seconds to wait before retrying (if not allowed) */
  retry_after?: number;
}

/**
 * Rate limit error details
 */
export interface RateLimitError {
  code: 'RATE_LIMIT_EXCEEDED' | 'GLOBAL_RATE_LIMIT';
  message: string;
  retry_after_seconds: number;
  limit: number;
  window: string;
  used: number;
}

/**
 * Free tier rate limits (Phase 1)
 */
export const FREE_TIER_CONFIG: TierConfig = {
  global_per_minute: {
    max_tokens: 100,
    refill_rate: 100, // 100 tokens per minute
    window_minutes: 1
  },
  paste_per_minute: {
    max_tokens: 10,
    refill_rate: 10, // 10 tokens per minute
    window_minutes: 1
  },
  build_per_day: {
    max_tokens: 3,
    refill_rate: 3 / 1440, // 3 tokens per day = 3/1440 per minute
    window_minutes: 1440 // 24 hours
  }
};

/**
 * Pro tier rate limits (Phase 2 - not yet implemented)
 */
export const PRO_TIER_CONFIG: TierConfig = {
  global_per_minute: {
    max_tokens: 300,
    refill_rate: 300,
    window_minutes: 1
  },
  paste_per_minute: {
    max_tokens: 30,
    refill_rate: 30,
    window_minutes: 1
  },
  build_per_day: {
    max_tokens: 20,
    refill_rate: 20 / 1440,
    window_minutes: 1440
  }
};

/**
 * Get tier configuration based on user tier
 */
export function getTierConfig(tier: RateLimitTier): TierConfig {
  switch (tier) {
    case 'free':
      return FREE_TIER_CONFIG;
    case 'pro':
      return PRO_TIER_CONFIG;
    case 'enterprise':
      // Enterprise has custom limits - for Phase 1, treat as pro
      return PRO_TIER_CONFIG;
    default:
      // Default to free tier for safety
      return FREE_TIER_CONFIG;
  }
}
