/**
 * Rate Limiter Tests
 * Test-Driven Development: These tests are written BEFORE implementation
 * Following the token bucket algorithm specification
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkRateLimit,
  getRateLimitKey,
  calculateTokenRefill
} from '../../src/utils/rateLimiter';
import type {
  RateLimitTier,
  RateLimitEndpoint,
  TokenBucket
} from '../../src/types/rateLimit';

// Mock KV namespace for testing
class MockKVNamespace {
  private store: Map<string, string> = new Map();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe('Rate Limiter - Token Bucket Algorithm', () => {
  let mockKV: MockKVNamespace;
  let mockEnv: Env;

  beforeEach(() => {
    mockKV = new MockKVNamespace();
    mockEnv = {
      RATE_LIMIT_STORE: mockKV as unknown as KVNamespace,
      ENVIRONMENT: 'test'
    } as Env;
  });

  describe('getRateLimitKey', () => {
    it('should generate correct key format', () => {
      const key = getRateLimitKey('user-123', 'paste');
      expect(key).toBe('rate_limit:user-123:paste');
    });

    it('should handle special characters in user ID', () => {
      const key = getRateLimitKey('user@example.com', 'build');
      expect(key).toBe('rate_limit:user@example.com:build');
    });

    it('should create unique keys for different endpoints', () => {
      const userId = 'user-456';
      const pasteKey = getRateLimitKey(userId, 'paste');
      const buildKey = getRateLimitKey(userId, 'build');
      const globalKey = getRateLimitKey(userId, 'global');

      expect(pasteKey).not.toBe(buildKey);
      expect(buildKey).not.toBe(globalKey);
      expect(pasteKey).not.toBe(globalKey);
    });
  });

  describe('calculateTokenRefill', () => {
    it('should calculate correct token refill for elapsed time', () => {
      const now = Date.now();
      const oneMinuteAgo = now - 60 * 1000;
      const refillRate = 10; // 10 tokens per minute

      const tokensToAdd = calculateTokenRefill(oneMinuteAgo, now, refillRate);
      expect(tokensToAdd).toBeCloseTo(10, 1);
    });

    it('should handle fractional minutes correctly', () => {
      const now = Date.now();
      const thirtySecondsAgo = now - 30 * 1000; // 0.5 minutes
      const refillRate = 10; // 10 tokens per minute

      const tokensToAdd = calculateTokenRefill(thirtySecondsAgo, now, refillRate);
      expect(tokensToAdd).toBeCloseTo(5, 1);
    });

    it('should return 0 for no elapsed time', () => {
      const now = Date.now();
      const refillRate = 10;

      const tokensToAdd = calculateTokenRefill(now, now, refillRate);
      expect(tokensToAdd).toBe(0);
    });

    it('should handle very small refill rates (daily limits)', () => {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const refillRate = 3 / 1440; // 3 tokens per day = 3/1440 per minute

      const tokensToAdd = calculateTokenRefill(oneHourAgo, now, refillRate);
      expect(tokensToAdd).toBeCloseTo(0.125, 3); // 3/24 hours
    });
  });

  describe('checkRateLimit - First Request (No Bucket Exists)', () => {
    it('should allow first request and create new bucket', async () => {
      const userId = 'user-new';
      const endpoint: RateLimitEndpoint = 'paste';
      const tier: RateLimitTier = 'free';

      const result = await checkRateLimit(userId, endpoint, tier, mockEnv);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // 10 max - 1 used
      expect(result.limit).toBe(10);
    });

    it('should store bucket in KV after first request', async () => {
      const userId = 'user-first';
      const endpoint: RateLimitEndpoint = 'build';
      const tier: RateLimitTier = 'free';

      await checkRateLimit(userId, endpoint, tier, mockEnv);

      const key = getRateLimitKey(userId, endpoint);
      const storedData = await mockKV.get(key);
      expect(storedData).not.toBeNull();

      const bucket: TokenBucket = JSON.parse(storedData!);
      expect(bucket.tokens).toBeCloseTo(2, 1); // 3 max - 1 used
      expect(bucket.last_refill).toBeGreaterThan(0);
    });
  });

  describe('checkRateLimit - Sequential Requests', () => {
    it('should decrement tokens on each request', async () => {
      const userId = 'user-sequential';
      const endpoint: RateLimitEndpoint = 'paste';
      const tier: RateLimitTier = 'free';

      // First request
      const result1 = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(9);

      // Second request (immediate)
      const result2 = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(8);

      // Third request
      const result3 = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result3.allowed).toBe(true);
      expect(result3.remaining).toBe(7);
    });

    it('should block request when tokens exhausted', async () => {
      const userId = 'user-exhaust';
      const endpoint: RateLimitEndpoint = 'build';
      const tier: RateLimitTier = 'free';

      // Build endpoint has 3 tokens per day for free tier
      const result1 = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2);

      const result2 = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1);

      const result3 = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result3.allowed).toBe(true);
      expect(result3.remaining).toBe(0);

      // Fourth request should be blocked
      const result4 = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result4.allowed).toBe(false);
      expect(result4.remaining).toBe(0);
      expect(result4.retry_after).toBeGreaterThan(0);
    });
  });

  describe('checkRateLimit - Token Refill Over Time', () => {
    it('should refill tokens after time passes', async () => {
      const userId = 'user-refill';
      const endpoint: RateLimitEndpoint = 'paste';
      const tier: RateLimitTier = 'free';

      // Use up all tokens
      for (let i = 0; i < 10; i++) {
        await checkRateLimit(userId, endpoint, tier, mockEnv);
      }

      // Next request should be blocked
      const blockedResult = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(blockedResult.allowed).toBe(false);

      // Manually update bucket to simulate 1 minute passing
      const key = getRateLimitKey(userId, endpoint);
      const storedData = await mockKV.get(key);
      const bucket: TokenBucket = JSON.parse(storedData!);

      bucket.last_refill = Date.now() - 60 * 1000; // 1 minute ago
      await mockKV.put(key, JSON.stringify(bucket));

      // After 1 minute, should have 10 tokens refilled (10 tokens/min rate)
      const refillResult = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(refillResult.allowed).toBe(true);
      expect(refillResult.remaining).toBeCloseTo(9, 0); // Should have refilled
    });

    it('should cap tokens at maximum', async () => {
      const userId = 'user-cap';
      const endpoint: RateLimitEndpoint = 'paste';
      const tier: RateLimitTier = 'free';

      // Make one request
      await checkRateLimit(userId, endpoint, tier, mockEnv);

      // Simulate 10 minutes passing (should refill 100 tokens, but cap at 10)
      const key = getRateLimitKey(userId, endpoint);
      const storedData = await mockKV.get(key);
      const bucket: TokenBucket = JSON.parse(storedData!);

      bucket.last_refill = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      await mockKV.put(key, JSON.stringify(bucket));

      // Should be capped at 10 tokens
      const result = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // 10 max - 1 used
      expect(result.limit).toBe(10);
    });
  });

  describe('checkRateLimit - Different Tiers', () => {
    it('should enforce free tier limits', async () => {
      const userId = 'user-free';
      const endpoint: RateLimitEndpoint = 'global';
      const tier: RateLimitTier = 'free';

      const result = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(100); // Free tier global limit
    });

    it('should enforce pro tier limits when implemented', async () => {
      const userId = 'user-pro';
      const endpoint: RateLimitEndpoint = 'global';
      const tier: RateLimitTier = 'pro';

      const result = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(300); // Pro tier global limit
    });
  });

  describe('checkRateLimit - Different Endpoints', () => {
    it('should track paste endpoint separately', async () => {
      const userId = 'user-separate';
      const tier: RateLimitTier = 'free';

      const pasteResult = await checkRateLimit(userId, 'paste', tier, mockEnv);
      expect(pasteResult.allowed).toBe(true);
      expect(pasteResult.limit).toBe(10);
    });

    it('should track build endpoint separately', async () => {
      const userId = 'user-separate';
      const tier: RateLimitTier = 'free';

      const buildResult = await checkRateLimit(userId, 'build', tier, mockEnv);
      expect(buildResult.allowed).toBe(true);
      expect(buildResult.limit).toBe(3);
    });

    it('should track global endpoint separately', async () => {
      const userId = 'user-separate';
      const tier: RateLimitTier = 'free';

      const globalResult = await checkRateLimit(userId, 'global', tier, mockEnv);
      expect(globalResult.allowed).toBe(true);
      expect(globalResult.limit).toBe(100);
    });

    it('should not affect other endpoints when one is exhausted', async () => {
      const userId = 'user-independent';
      const tier: RateLimitTier = 'free';

      // Exhaust build endpoint (3 requests)
      await checkRateLimit(userId, 'build', tier, mockEnv);
      await checkRateLimit(userId, 'build', tier, mockEnv);
      await checkRateLimit(userId, 'build', tier, mockEnv);

      const blockedBuild = await checkRateLimit(userId, 'build', tier, mockEnv);
      expect(blockedBuild.allowed).toBe(false);

      // Paste endpoint should still work
      const pasteResult = await checkRateLimit(userId, 'paste', tier, mockEnv);
      expect(pasteResult.allowed).toBe(true);
    });
  });

  describe('checkRateLimit - Error Handling', () => {
    it('should handle missing KV namespace gracefully', async () => {
      const envWithoutKV = {
        ENVIRONMENT: 'test'
      } as Env;

      const userId = 'user-no-kv';
      const endpoint: RateLimitEndpoint = 'paste';
      const tier: RateLimitTier = 'free';

      // Should fail open (allow request) when KV unavailable
      const result = await checkRateLimit(userId, endpoint, tier, envWithoutKV);
      expect(result.allowed).toBe(true);
    });

    it('should handle corrupted bucket data gracefully', async () => {
      const userId = 'user-corrupt';
      const endpoint: RateLimitEndpoint = 'paste';
      const tier: RateLimitTier = 'free';

      // Put corrupted data in KV
      const key = getRateLimitKey(userId, endpoint);
      await mockKV.put(key, 'invalid-json-data');

      // Should create new bucket when data is corrupted
      const result = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9); // Fresh bucket
    });
  });

  describe('checkRateLimit - Response Headers Data', () => {
    it('should provide correct reset_at timestamp', async () => {
      const userId = 'user-reset';
      const endpoint: RateLimitEndpoint = 'paste';
      const tier: RateLimitTier = 'free';

      const beforeRequest = Date.now();
      const result = await checkRateLimit(userId, endpoint, tier, mockEnv);
      const afterRequest = Date.now();

      expect(result.reset_at).toBeGreaterThanOrEqual(beforeRequest);
      expect(result.reset_at).toBeLessThanOrEqual(afterRequest + 60 * 1000); // Within 1 minute
    });

    it('should provide retry_after when blocked', async () => {
      const userId = 'user-retry';
      const endpoint: RateLimitEndpoint = 'build';
      const tier: RateLimitTier = 'free';

      // Exhaust all tokens
      await checkRateLimit(userId, endpoint, tier, mockEnv);
      await checkRateLimit(userId, endpoint, tier, mockEnv);
      await checkRateLimit(userId, endpoint, tier, mockEnv);

      // Should be blocked with retry_after
      const result = await checkRateLimit(userId, endpoint, tier, mockEnv);
      expect(result.allowed).toBe(false);
      expect(result.retry_after).toBeDefined();
      expect(result.retry_after).toBeGreaterThan(0);
    });
  });
});
