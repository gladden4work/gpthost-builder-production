import type { ExecutionContext } from '@cloudflare/workers-types';
import type { Env } from '../types/env';
import {
  createProxyStatsService,
  type HostPolicy,
  type ProxyStatsService,
  type ProxyTelemetryEvent,
  type QuotaCheckResult,
} from './ProxyStatsService';

const HOST_POLICY_TTL_MS = 2 * 60 * 1000;
const hostPolicyCache = new Map<string, { blocked: boolean; expiresAt: number }>();

export interface ProxyUsageService {
  checkQuota(projectId: string): Promise<QuotaCheckResult>;
  isHostBlocked(host: string): Promise<boolean>;
  recordUsage(projectId: string, bytesTransferred: number, ctx?: ExecutionContext): Promise<void>;
  recordTelemetryEvent(
    event: Omit<ProxyTelemetryEvent, 'eventId' | 'timestamp'>,
    ctx?: ExecutionContext
  ): Promise<void>;
}

class KvProxyUsageService implements ProxyUsageService {
  constructor(private readonly statsService: ProxyStatsService, private readonly env: Env) {}

  async checkQuota(projectId: string): Promise<QuotaCheckResult> {
    return this.statsService.checkQuota(projectId);
  }

  async isHostBlocked(host: string): Promise<boolean> {
    return getHostBlockedWithCache(this.env, host, this.statsService);
  }

  async recordUsage(projectId: string, bytesTransferred: number, ctx?: ExecutionContext): Promise<void> {
    await this.statsService.recordUsage(projectId, bytesTransferred, ctx);
  }

  async recordTelemetryEvent(
    event: Omit<ProxyTelemetryEvent, 'eventId' | 'timestamp'>,
    ctx?: ExecutionContext
  ): Promise<void> {
    await this.statsService.recordTelemetryEvent(event, ctx);
  }
}

class DurableObjectProxyUsageService implements ProxyUsageService {
  constructor(private readonly env: Env) {}

  async checkQuota(projectId: string): Promise<QuotaCheckResult> {
    const stub = this.getStub(projectId);
    return stub.checkAndIncrement(projectId);
  }

  async isHostBlocked(host: string): Promise<boolean> {
    return getHostBlockedWithCache(this.env, host);
  }

  async recordUsage(
    _projectId: string,
    _bytesTransferred: number,
    _ctx?: ExecutionContext
  ): Promise<void> {
    return;
  }

  async recordTelemetryEvent(
    event: Omit<ProxyTelemetryEvent, 'eventId' | 'timestamp'>,
    _ctx?: ExecutionContext
  ): Promise<void> {
    const stub = this.getStub(event.projectId);
    await stub.recordTelemetry(event);
  }

  private getStub(projectId: string) {
    if (!this.env.PROXY_USAGE_DO) {
      throw new Error('PROXY_USAGE_DO not configured');
    }
    const id = this.env.PROXY_USAGE_DO.idFromName(projectId);
    return this.env.PROXY_USAGE_DO.get(id);
  }
}

export function createProxyUsageService(env: Env): ProxyUsageService | null {
  const backend = (env.PROXY_STATS_BACKEND || 'kv').toLowerCase();

  if (backend === 'do' && env.PROXY_USAGE_DO) {
    return new DurableObjectProxyUsageService(env);
  }

  const statsService = createProxyStatsService(env);
  if (!statsService) {
    return null;
  }

  return new KvProxyUsageService(statsService, env);
}

async function getHostBlockedWithCache(
  env: Env,
  host: string,
  statsService?: ProxyStatsService
): Promise<boolean> {
  const cacheKey = host.toLowerCase();
  const now = Date.now();
  const cached = hostPolicyCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.blocked;
  }

  const policy = await getHostPolicy(env, cacheKey, statsService);
  const blocked = policy?.status === 'blocked';

  hostPolicyCache.set(cacheKey, {
    blocked,
    expiresAt: now + HOST_POLICY_TTL_MS,
  });

  return blocked;
}

async function getHostPolicy(
  env: Env,
  host: string,
  statsService?: ProxyStatsService
): Promise<HostPolicy | null> {
  if (statsService) {
    return statsService.getHostPolicy(host);
  }

  const kv = (env as any).RATE_LIMIT_STORE as KVNamespace | undefined;
  if (!kv) {
    return null;
  }

  const raw = await kv.get(`proxy:host-policy:${host}`);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as HostPolicy;
  } catch {
    return null;
  }
}
