/**
 * ProxyStatsService - Phase 3: Monitoring & Control
 * 
 * Provides comprehensive monitoring, quota management, and telemetry for the
 * external resource proxy system. Built on top of existing Worker + R2/KV stack.
 * 
 * Features:
 * - Per-project quota tracking (requests/day, bandwidth, storage)
 * - Usage metrics aggregation for dashboards
 * - Host/MIME reputation tracking with one-click block/unblock
 * - Telemetry events for billing and anomaly detection
 * 
 * Storage patterns:
 * - KV: proxy:usage:{projectId} - hot-path quota counters
 * - KV: proxy:host-policy:{host} - host allow/block policies
 * - R2: proxy-events/{date}/{projectId}/{eventId}.json - telemetry events
 */

import { Result, Ok, Err } from '../lib/result';
import { StorageError, StorageErrorCode } from '../lib/errors';
import { generateCacheKey, getCachePath, getCacheStats } from './ResourceProxyCacheService';

// Constants for quota configuration
const QUOTA_KEY_PREFIX = 'proxy:usage:';
const HOST_POLICY_PREFIX = 'proxy:host-policy:';
const TELEMETRY_PREFIX = 'proxy-events/';
const QUOTA_WINDOW_SECONDS = 24 * 60 * 60; // 24 hours

// Default quota limits (can be overridden per tier)
const DEFAULT_QUOTAS = {
  free: {
    requestsPerDay: 100_000,
    bandwidthBytesPerDay: 1024 * 1024 * 1024, // 1GB
    storageBytesMax: 1024 * 1024 * 1024,      // 1GB
  },
  basic: {
    requestsPerDay: 1_000_000,
    bandwidthBytesPerDay: 10 * 1024 * 1024 * 1024, // 10GB
    storageBytesMax: 10 * 1024 * 1024 * 1024,      // 10GB
  },
  pro: {
    requestsPerDay: -1, // Unlimited
    bandwidthBytesPerDay: 50 * 1024 * 1024 * 1024, // 50GB
    storageBytesMax: 50 * 1024 * 1024 * 1024,      // 50GB
  },
};

/**
 * Per-project usage counters stored in KV
 */
export interface ProjectUsage {
  projectId: string;
  requestCount: number;
  bandwidthBytes: number;
  cacheStorageBytes: number;
  lastReset: string;
  windowStart: string;
}

/**
 * Host policy for reputation-based blocking
 */
export interface HostPolicy {
  host: string;
  status: 'allowed' | 'blocked' | 'review';
  reason?: string;
  updatedAt: string;
  updatedBy: string;
  requestCount?: number;
  totalBytes?: number;
}

/**
 * Telemetry event for proxy requests
 */
export interface ProxyTelemetryEvent {
  eventId: string;
  timestamp: string;
  projectId: string;
  host: string;
  urlHash: string;
  mimeType?: string;
  sizeBytes?: number;
  cacheStatus: 'HIT' | 'MISS' | 'BYPASS' | 'STALE';
  responseStatus: number;
  durationMs?: number;
}

/**
 * Quota check result
 */
export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  usage: ProjectUsage;
  quotaLimit: {
    requestsPerDay: number;
    bandwidthBytesPerDay: number;
    storageBytesMax: number;
  };
  percentUsed: {
    requests: number;
    bandwidth: number;
    storage: number;
  };
}

/**
 * Aggregated proxy statistics for dashboards
 */
export interface ProxyStats {
  totalProxiedRequests: number;
  totalBandwidthBytes: number;
  cacheHitRate: number;
  cacheStorageBytes: number;
  uniqueHosts: number;
  topHosts: { host: string; count: number; bytes: number }[];
  blockedHosts: number;
  timestamp: string;
}

/**
 * Project-level proxy analytics
 */
export interface ProjectProxyAnalytics {
  projectId: string;
  usage: ProjectUsage;
  quotaRemaining: {
    requests: number;
    bandwidth: number;
  };
  recentEvents: ProxyTelemetryEvent[];
  timestamp: string;
}

/**
 * ProxyStatsService - Manages proxy monitoring and quotas
 */
export class ProxyStatsService {
  private readonly bucket: R2Bucket;
  private readonly kv: KVNamespace;

  constructor(bucket: R2Bucket, kv: KVNamespace) {
    this.bucket = bucket;
    this.kv = kv;
  }

  // ==================== Quota Management ====================

  /**
   * Get current usage for a project
   */
  async getProjectUsage(projectId: string): Promise<ProjectUsage> {
    const key = `${QUOTA_KEY_PREFIX}${projectId}`;
    const stored = await this.kv.get(key);

    if (!stored) {
      const now = new Date();
      return {
        projectId,
        requestCount: 0,
        bandwidthBytes: 0,
        cacheStorageBytes: 0,
        lastReset: now.toISOString(),
        windowStart: now.toISOString(),
      };
    }

    try {
      const usage = JSON.parse(stored) as ProjectUsage;
      
      // Check if we need to reset the window
      const windowStart = new Date(usage.windowStart);
      const now = new Date();
      const elapsedSeconds = (now.getTime() - windowStart.getTime()) / 1000;
      
      if (elapsedSeconds >= QUOTA_WINDOW_SECONDS) {
        // Reset counters for new window
        return {
          projectId,
          requestCount: 0,
          bandwidthBytes: 0,
          cacheStorageBytes: usage.cacheStorageBytes, // Storage persists
          lastReset: now.toISOString(),
          windowStart: now.toISOString(),
        };
      }

      return usage;
    } catch {
      return {
        projectId,
        requestCount: 0,
        bandwidthBytes: 0,
        cacheStorageBytes: 0,
        lastReset: new Date().toISOString(),
        windowStart: new Date().toISOString(),
      };
    }
  }

  /**
   * Record a proxy request and update usage counters
   */
  async recordUsage(
    projectId: string,
    bytesTransferred: number,
    ctx?: ExecutionContext
  ): Promise<Result<ProjectUsage, StorageError>> {
    try {
      const usage = await this.getProjectUsage(projectId);
      
      usage.requestCount += 1;
      usage.bandwidthBytes += bytesTransferred;

      const key = `${QUOTA_KEY_PREFIX}${projectId}`;
      const expirationTtl = QUOTA_WINDOW_SECONDS + 3600; // Add 1 hour buffer

      if (ctx) {
        ctx.waitUntil(
          this.kv.put(key, JSON.stringify(usage), { expirationTtl })
        );
      } else {
        await this.kv.put(key, JSON.stringify(usage), { expirationTtl });
      }

      return Ok(usage);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to record usage: ${(error as Error).message}`
      ));
    }
  }

  /**
   * Check if a project is within its quota limits
   */
  async checkQuota(
    projectId: string,
    tier: 'free' | 'basic' | 'pro' = 'free'
  ): Promise<QuotaCheckResult> {
    const usage = await this.getProjectUsage(projectId);
    const limits = DEFAULT_QUOTAS[tier];

    const percentUsed = {
      requests: limits.requestsPerDay > 0 
        ? (usage.requestCount / limits.requestsPerDay) * 100 
        : 0,
      bandwidth: limits.bandwidthBytesPerDay > 0 
        ? (usage.bandwidthBytes / limits.bandwidthBytesPerDay) * 100 
        : 0,
      storage: limits.storageBytesMax > 0 
        ? (usage.cacheStorageBytes / limits.storageBytesMax) * 100 
        : 0,
    };

    // Check request limit
    if (limits.requestsPerDay > 0 && usage.requestCount >= limits.requestsPerDay) {
      return {
        allowed: false,
        reason: 'Daily request quota exceeded',
        usage,
        quotaLimit: limits,
        percentUsed,
      };
    }

    // Check bandwidth limit
    if (limits.bandwidthBytesPerDay > 0 && usage.bandwidthBytes >= limits.bandwidthBytesPerDay) {
      return {
        allowed: false,
        reason: 'Daily bandwidth quota exceeded',
        usage,
        quotaLimit: limits,
        percentUsed,
      };
    }

    // Storage is a soft limit (we can still serve from cache)
    return {
      allowed: true,
      usage,
      quotaLimit: limits,
      percentUsed,
    };
  }

  /**
   * Update cache storage size for a project
   */
  async updateCacheStorageSize(
    projectId: string,
    sizeBytes: number
  ): Promise<Result<void, StorageError>> {
    try {
      const usage = await this.getProjectUsage(projectId);
      usage.cacheStorageBytes = sizeBytes;

      const key = `${QUOTA_KEY_PREFIX}${projectId}`;
      await this.kv.put(key, JSON.stringify(usage));

      return Ok(undefined);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to update cache storage size: ${(error as Error).message}`
      ));
    }
  }

  // ==================== Host Policy Management ====================

  /**
   * Get the policy for a specific host
   */
  async getHostPolicy(host: string): Promise<HostPolicy | null> {
    const key = `${HOST_POLICY_PREFIX}${host}`;
    const stored = await this.kv.get(key);

    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored) as HostPolicy;
    } catch {
      return null;
    }
  }

  /**
   * Set policy for a host (block/allow/review)
   */
  async setHostPolicy(
    host: string,
    status: HostPolicy['status'],
    reason: string,
    updatedBy: string
  ): Promise<Result<HostPolicy, StorageError>> {
    try {
      const existing = await this.getHostPolicy(host);
      
      const policy: HostPolicy = {
        host,
        status,
        reason,
        updatedAt: new Date().toISOString(),
        updatedBy,
        requestCount: existing?.requestCount || 0,
        totalBytes: existing?.totalBytes || 0,
      };

      const key = `${HOST_POLICY_PREFIX}${host}`;
      await this.kv.put(key, JSON.stringify(policy));

      return Ok(policy);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to set host policy: ${(error as Error).message}`
      ));
    }
  }

  /**
   * Check if a host is blocked
   */
  async isHostBlocked(host: string): Promise<boolean> {
    const policy = await this.getHostPolicy(host);
    return policy?.status === 'blocked';
  }

  /**
   * List all host policies (for admin dashboard)
   */
  async listHostPolicies(limit: number = 100): Promise<HostPolicy[]> {
    const policies: HostPolicy[] = [];
    let cursor: string | undefined;

    try {
      do {
        const list = await this.kv.list({
          prefix: HOST_POLICY_PREFIX,
          limit: Math.min(limit, 1000),
          cursor,
        });

        for (const key of list.keys) {
          const stored = await this.kv.get(key.name);
          if (stored) {
            try {
              policies.push(JSON.parse(stored));
            } catch {
              // Skip malformed entries
            }
          }

          if (policies.length >= limit) {
            return policies;
          }
        }

        cursor = list.list_complete ? undefined : list.cursor;
      } while (cursor);

      return policies;
    } catch (error) {
      console.error('[PROXY-STATS] Error listing host policies:', error);
      return [];
    }
  }

  // ==================== Telemetry ====================

  /**
   * Record a telemetry event for a proxy request
   */
  async recordTelemetryEvent(
    event: Omit<ProxyTelemetryEvent, 'eventId' | 'timestamp'>,
    ctx?: ExecutionContext
  ): Promise<Result<string, StorageError>> {
    try {
      const eventId = crypto.randomUUID();
      const timestamp = new Date();
      const dateStr = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD

      const fullEvent: ProxyTelemetryEvent = {
        ...event,
        eventId,
        timestamp: timestamp.toISOString(),
      };

      const path = `${TELEMETRY_PREFIX}${dateStr}/${event.projectId}/${eventId}.json`;
      const body = JSON.stringify(fullEvent);

      if (ctx) {
        ctx.waitUntil(this.bucket.put(path, body));
      } else {
        await this.bucket.put(path, body);
      }

      // Update host stats in background
      if (ctx) {
        ctx.waitUntil(this.updateHostStats(event.host, event.sizeBytes || 0));
      }

      return Ok(eventId);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to record telemetry: ${(error as Error).message}`
      ));
    }
  }

  /**
   * Update host-level stats (request count, bytes)
   */
  private async updateHostStats(host: string, bytes: number): Promise<void> {
    try {
      const existing = await this.getHostPolicy(host);
      
      const policy: HostPolicy = existing || {
        host,
        status: 'allowed',
        updatedAt: new Date().toISOString(),
        updatedBy: 'system',
        requestCount: 0,
        totalBytes: 0,
      };

      policy.requestCount = (policy.requestCount || 0) + 1;
      policy.totalBytes = (policy.totalBytes || 0) + bytes;

      const key = `${HOST_POLICY_PREFIX}${host}`;
      await this.kv.put(key, JSON.stringify(policy));
    } catch (error) {
      console.error('[PROXY-STATS] Error updating host stats:', error);
    }
  }

  // ==================== Analytics & Aggregation ====================

  /**
   * Get aggregated proxy statistics for the admin dashboard
   */
  async getProxyStats(): Promise<ProxyStats> {
    try {
      // Get cache stats from R2
      const cacheStats = await this.getCacheStatsFromR2();

      // Get all host policies to count unique hosts and blocked hosts
      const hostPolicies = await this.listHostPolicies(1000);
      const blockedHosts = hostPolicies.filter(p => p.status === 'blocked').length;

      // Sort hosts by request count for top hosts
      const sortedHosts = hostPolicies
        .filter(p => p.requestCount && p.requestCount > 0)
        .sort((a, b) => (b.requestCount || 0) - (a.requestCount || 0))
        .slice(0, 10)
        .map(p => ({
          host: p.host,
          count: p.requestCount || 0,
          bytes: p.totalBytes || 0,
        }));

      // Calculate total requests and bandwidth from host policies
      const totalRequests = hostPolicies.reduce((sum, p) => sum + (p.requestCount || 0), 0);
      const totalBandwidth = hostPolicies.reduce((sum, p) => sum + (p.totalBytes || 0), 0);

      return {
        totalProxiedRequests: totalRequests,
        totalBandwidthBytes: totalBandwidth,
        cacheHitRate: 0, // Would need telemetry analysis
        cacheStorageBytes: cacheStats.totalSizeBytes,
        uniqueHosts: hostPolicies.length,
        topHosts: sortedHosts,
        blockedHosts,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[PROXY-STATS] Error getting proxy stats:', error);
      return {
        totalProxiedRequests: 0,
        totalBandwidthBytes: 0,
        cacheHitRate: 0,
        cacheStorageBytes: 0,
        uniqueHosts: 0,
        topHosts: [],
        blockedHosts: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get cache statistics from R2
   */
  private async getCacheStatsFromR2(): Promise<{
    totalObjects: number;
    totalSizeBytes: number;
  }> {
    try {
      let totalObjects = 0;
      let totalSizeBytes = 0;
      let cursor: string | undefined;

      do {
        const list = await this.bucket.list({
          prefix: 'proxy-cache/',
          cursor,
          limit: 1000,
        });

        for (const obj of list.objects) {
          totalObjects++;
          totalSizeBytes += obj.size;
        }

        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);

      return { totalObjects, totalSizeBytes };
    } catch (error) {
      console.error('[PROXY-STATS] Error getting cache stats from R2:', error);
      return { totalObjects: 0, totalSizeBytes: 0 };
    }
  }

  /**
   * Get proxy analytics for a specific project
   */
  async getProjectProxyAnalytics(projectId: string): Promise<ProjectProxyAnalytics> {
    const usage = await this.getProjectUsage(projectId);
    const limits = DEFAULT_QUOTAS.free; // TODO: Get actual tier

    return {
      projectId,
      usage,
      quotaRemaining: {
        requests: Math.max(0, limits.requestsPerDay - usage.requestCount),
        bandwidth: Math.max(0, limits.bandwidthBytesPerDay - usage.bandwidthBytes),
      },
      recentEvents: [], // Would need to query telemetry
      timestamp: new Date().toISOString(),
    };
  }

  // ==================== Cache Management ====================

  /**
   * Clear all cached resources for a project
   */
  async clearProjectCache(projectId: string): Promise<Result<number, StorageError>> {
    try {
      // Note: Current cache uses URL-based keys without project prefix
      // This is a placeholder for when we implement project-specific cache prefixes
      console.info('[PROXY-STATS] clearProjectCache: project-specific cache not yet implemented');
      
      // For now, we can only clear the entire cache or specific URLs
      // In production, we'd track project→URL mappings in KV
      return Ok(0);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to clear project cache: ${(error as Error).message}`
      ));
    }
  }

  /**
   * Clear cached resource by URL
   */
  async clearCachedUrl(url: string): Promise<Result<boolean, StorageError>> {
    try {
      const cacheKey = await generateCacheKey(url);
      const cachePath = getCachePath(cacheKey);
      await this.bucket.delete(cachePath);
      return Ok(true);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to clear cached URL: ${(error as Error).message}`
      ));
    }
  }

  /**
   * Get list of cached resources (for admin inspection)
   */
  async listCachedResources(limit: number = 100): Promise<{
    resources: { url: string; size: number; cachedAt: string }[];
    total: number;
  }> {
    try {
      const resources: { url: string; size: number; cachedAt: string }[] = [];
      let total = 0;
      let cursor: string | undefined;

      do {
        const list = await this.bucket.list({
          prefix: 'proxy-cache/',
          cursor,
          limit: Math.min(limit - resources.length, 100),
          include: ['customMetadata'],
        });

        total += list.objects.length;

        for (const obj of list.objects) {
          if (resources.length >= limit) break;

          resources.push({
            url: obj.customMetadata?.originalUrl || obj.key,
            size: obj.size,
            cachedAt: obj.customMetadata?.cachedAt || obj.uploaded.toISOString(),
          });
        }

        cursor = list.truncated && resources.length < limit ? list.cursor : undefined;
      } while (cursor);

      return { resources, total };
    } catch (error) {
      console.error('[PROXY-STATS] Error listing cached resources:', error);
      return { resources: [], total: 0 };
    }
  }
}

/**
 * Factory function to create ProxyStatsService
 */
export function createProxyStatsService(env: Env): ProxyStatsService | null {
  const bucket = env.PROJECTS_BUCKET;
  const kv = (env as any).RATE_LIMIT_STORE as KVNamespace | undefined;

  if (!bucket || !kv) {
    console.warn('[PROXY-STATS] Missing PROJECTS_BUCKET or RATE_LIMIT_STORE');
    return null;
  }

  return new ProxyStatsService(bucket, kv);
}

// Type for execution context
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
