import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types/env';
import type { HostPolicy, ProjectUsage, ProxyTelemetryEvent, QuotaCheckResult } from '../services/ProxyStatsService';

const QUOTA_WINDOW_SECONDS = 24 * 60 * 60;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const FLUSH_REQUEST_THRESHOLD = 100;

const DEFAULT_QUOTAS = {
  free: {
    requestsPerDay: 100_000,
    bandwidthBytesPerDay: 1024 * 1024 * 1024,
    storageBytesMax: 1024 * 1024 * 1024,
  },
  basic: {
    requestsPerDay: 1_000_000,
    bandwidthBytesPerDay: 10 * 1024 * 1024 * 1024,
    storageBytesMax: 10 * 1024 * 1024 * 1024,
  },
  pro: {
    requestsPerDay: -1,
    bandwidthBytesPerDay: 50 * 1024 * 1024 * 1024,
    storageBytesMax: 50 * 1024 * 1024 * 1024,
  },
};

type TelemetryInput = Omit<ProxyTelemetryEvent, 'eventId' | 'timestamp'>;

interface TelemetryAggregate {
  date: string;
  projectId: string;
  host: string;
  requestCount: number;
  totalBytes: number;
  cacheHits: number;
  cacheMisses: number;
}

export class ProxyProjectUsageDO extends DurableObject<Env> {
  private readonly state: DurableObjectState;
  private readonly env: Env;
  private usage: ProjectUsage | null = null;
  private projectId: string | null = null;
  private telemetryAggregates = new Map<string, TelemetryAggregate>();
  private lastFlushAt = Date.now();
  private lastFlushedRequestCount = 0;
  private initializing: Promise<void> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.state = state;
    this.env = env;
  }

  async checkAndIncrement(
    projectId: string,
    bytesPlanned?: number,
    tier: keyof typeof DEFAULT_QUOTAS = 'free'
  ): Promise<QuotaCheckResult> {
    await this.initialize(projectId);
    this.ensureUsageWindow();

    const usage = this.usage!;
    const limits = DEFAULT_QUOTAS[tier];
    const projectedBandwidth = usage.bandwidthBytes + (bytesPlanned || 0);

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

    if (limits.requestsPerDay > 0 && usage.requestCount >= limits.requestsPerDay) {
      return {
        allowed: false,
        reason: 'Daily request quota exceeded',
        usage,
        quotaLimit: limits,
        percentUsed,
      };
    }

    if (limits.bandwidthBytesPerDay > 0 && projectedBandwidth >= limits.bandwidthBytesPerDay) {
      return {
        allowed: false,
        reason: 'Daily bandwidth quota exceeded',
        usage,
        quotaLimit: limits,
        percentUsed,
      };
    }

    usage.requestCount += 1;
    await this.maybeFlush();

    return {
      allowed: true,
      usage,
      quotaLimit: limits,
      percentUsed,
    };
  }

  async recordTelemetry(input: TelemetryInput): Promise<void> {
    await this.initialize(input.projectId);
    this.ensureUsageWindow();

    const usage = this.usage!;
    const sizeBytes = input.sizeBytes || 0;
    usage.bandwidthBytes += sizeBytes;

    const date = new Date().toISOString().split('T')[0];
    const cacheHit = input.cacheStatus === 'HIT' || input.cacheStatus === 'STALE';
    const key = `${date}:${input.host}`;
    const existing = this.telemetryAggregates.get(key) || {
      date,
      projectId: input.projectId,
      host: input.host,
      requestCount: 0,
      totalBytes: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };

    existing.requestCount += 1;
    existing.totalBytes += sizeBytes;
    if (cacheHit) {
      existing.cacheHits += 1;
    } else {
      existing.cacheMisses += 1;
    }

    this.telemetryAggregates.set(key, existing);
    await this.maybeFlush();
  }

  async updateCacheStorageSize(projectId: string, sizeBytes: number): Promise<void> {
    await this.initialize(projectId);
    this.ensureUsageWindow();

    const usage = this.usage!;
    usage.cacheStorageBytes = sizeBytes;
    await this.maybeFlush();
  }

  async flushToKv(): Promise<void> {
    if (!this.usage) {
      return;
    }

    const kv = (this.env as any).RATE_LIMIT_STORE as KVNamespace | undefined;
    const bucket = this.env.PROJECTS_BUCKET;
    const now = new Date().toISOString();

    try {
      if (kv) {
        const key = `proxy:usage:${this.usage.projectId}`;
        const expirationTtl = QUOTA_WINDOW_SECONDS + 3600;
        await kv.put(key, JSON.stringify(this.usage), { expirationTtl });
      }

      await this.flushHostPolicies(kv);
      await this.flushTelemetry(bucket, now);

      await this.state.storage.put('usage', this.usage);
      this.telemetryAggregates.clear();
      this.lastFlushAt = Date.now();
      this.lastFlushedRequestCount = this.usage.requestCount;
    } catch (error) {
      console.error('[ProxyProjectUsageDO] Flush failed:', {
        projectId: this.usage.projectId,
        requestCount: this.usage.requestCount,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - next flush will include this data
    }
  }

  private async initialize(projectId: string): Promise<void> {
    if (this.projectId === projectId && this.usage) {
      return;
    }

    if (this.initializing) {
      await this.initializing;
      if (this.projectId === projectId && this.usage) {
        return;
      }
    }

    this.initializing = this.loadState(projectId);
    await this.initializing;
    this.initializing = null;
  }

  private async loadState(projectId: string): Promise<void> {
    this.projectId = projectId;

    const stored = await this.state.storage.get<ProjectUsage>('usage');
    if (stored && stored.projectId === projectId) {
      this.usage = this.normalizeUsage(stored);
      this.lastFlushAt = Date.now();
      this.lastFlushedRequestCount = this.usage.requestCount;
      return;
    }

    const kv = (this.env as any).RATE_LIMIT_STORE as KVNamespace | undefined;
    if (kv) {
      const raw = await kv.get(`proxy:usage:${projectId}`);
      if (raw) {
        try {
          this.usage = this.normalizeUsage({ projectId, ...JSON.parse(raw) });
        } catch {
          this.usage = null;
        }
      }
    }

    if (!this.usage) {
      const now = new Date().toISOString();
      this.usage = {
        projectId,
        requestCount: 0,
        bandwidthBytes: 0,
        cacheStorageBytes: 0,
        lastReset: now,
        windowStart: now,
      };
    }

    await this.state.storage.put('usage', this.usage);
    this.lastFlushAt = Date.now();
    this.lastFlushedRequestCount = this.usage.requestCount;
  }

  private ensureUsageWindow(): void {
    if (!this.usage) {
      return;
    }

    const now = new Date();
    const windowStart = new Date(this.usage.windowStart);
    const elapsedSeconds = (now.getTime() - windowStart.getTime()) / 1000;

    if (!Number.isFinite(windowStart.getTime()) || elapsedSeconds >= QUOTA_WINDOW_SECONDS) {
      this.usage.requestCount = 0;
      this.usage.bandwidthBytes = 0;
      this.usage.lastReset = now.toISOString();
      this.usage.windowStart = now.toISOString();
    }

    this.usage.cacheStorageBytes = this.usage.cacheStorageBytes || 0;
  }

  private normalizeUsage(usage: ProjectUsage): ProjectUsage {
    const now = new Date().toISOString();
    const normalized: ProjectUsage = {
      projectId: usage.projectId || this.projectId || '',
      requestCount: usage.requestCount || 0,
      bandwidthBytes: usage.bandwidthBytes || 0,
      cacheStorageBytes: usage.cacheStorageBytes || 0,
      lastReset: usage.lastReset || usage.windowStart || now,
      windowStart: usage.windowStart || now,
    };

    this.usage = normalized;
    this.ensureUsageWindow();
    return this.usage!;
  }

  private async maybeFlush(): Promise<void> {
    if (!this.usage) {
      return;
    }

    const now = Date.now();
    const shouldFlushByTime = now - this.lastFlushAt >= FLUSH_INTERVAL_MS;
    const deltaRequests = this.usage.requestCount - this.lastFlushedRequestCount;
    const shouldFlushByCount = deltaRequests >= FLUSH_REQUEST_THRESHOLD;

    if (shouldFlushByTime || shouldFlushByCount) {
      await this.flushToKv();
    }
  }

  private async flushHostPolicies(kv?: KVNamespace): Promise<void> {
    if (!kv || this.telemetryAggregates.size === 0) {
      return;
    }

    const hostTotals = new Map<string, { requestCount: number; totalBytes: number }>();

    for (const aggregate of this.telemetryAggregates.values()) {
      const existing = hostTotals.get(aggregate.host) || { requestCount: 0, totalBytes: 0 };
      existing.requestCount += aggregate.requestCount;
      existing.totalBytes += aggregate.totalBytes;
      hostTotals.set(aggregate.host, existing);
    }

    for (const [host, totals] of hostTotals.entries()) {
      try {
        const key = `proxy:host-policy:${host}`;
        const raw = await kv.get(key);
        let policy: HostPolicy;

        if (raw) {
          policy = JSON.parse(raw) as HostPolicy;
        } else {
          policy = {
            host,
            status: 'allowed',
            updatedAt: new Date().toISOString(),
            updatedBy: 'system',
            requestCount: 0,
            totalBytes: 0,
          };
        }

        policy.requestCount = (policy.requestCount || 0) + totals.requestCount;
        policy.totalBytes = (policy.totalBytes || 0) + totals.totalBytes;

        await kv.put(key, JSON.stringify(policy));
      } catch (error) {
        console.error('[ProxyProjectUsageDO] Host policy flush failed:', {
          host,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
  }

  private async flushTelemetry(bucket: R2Bucket | undefined, flushedAt: string): Promise<void> {
    if (!bucket || this.telemetryAggregates.size === 0 || !this.usage) {
      return;
    }

    const aggregatesByDate = new Map<string, TelemetryAggregate[]>();

    for (const aggregate of this.telemetryAggregates.values()) {
      const list = aggregatesByDate.get(aggregate.date) || [];
      list.push(aggregate);
      aggregatesByDate.set(aggregate.date, list);
    }

    for (const [date, aggregates] of aggregatesByDate.entries()) {
      const path = `proxy-events/${date}/${this.usage.projectId}/aggregate-${Date.now()}.json`;
      const body = JSON.stringify({
        projectId: this.usage.projectId,
        date,
        generatedAt: flushedAt,
        aggregates,
      });

      await bucket.put(path, body, {
        httpMetadata: { contentType: 'application/json' },
      });
    }
  }
}

