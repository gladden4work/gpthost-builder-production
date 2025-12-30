/**
 * ManifestService - Manages per-owner project manifests
 *
 * Phase 4: Routes all operations through Durable Objects for true atomic updates.
 * Falls back to KV-based implementation when DO is not available.
 *
 * Architecture:
 * - One ManifestDO instance per ownerId (single-threaded execution)
 * - SQLite storage persists across hibernation
 * - Lazy migration from KV on first access
 * - No more race conditions from concurrent writes
 */

import {
  OwnerProjectManifest,
  ManifestProjectSummary,
  createEmptyManifest,
  recalculateMetadata,
  MANIFEST_SCHEMA_VERSION
} from '../domain/manifest';
import { Env } from '../types/env';
import { IStorageService } from './StorageService';
import { ProjectService } from './ProjectService';
import { SubdomainService } from './SubdomainService';
import type { ManifestDO, DOManifestMetrics } from '../durableObjects/ManifestDO';
import type { ProjectMetadata } from '../types/api';
import { buildOwnerAliasSet, projectMatchesOwnerAliases } from '../utils/ownerIdentity';

// ============================================================================
// Metrics Interface (for backward compatibility with admin endpoints)
// ============================================================================

/**
 * Metrics tracked for manifest operations
 */
export interface ManifestMetrics {
  manifestHits: number;
  manifestMisses: number;
  rebuilds: number;
  casRetries: number;
  casFailures: number;
}

/**
 * Aggregated metrics response including historical data
 */
export interface AggregatedMetrics {
  current: ManifestMetrics;
  historical: ManifestMetrics;
  hoursIncluded: number;
  hitRate: string;
  totalReads: number;
}

// Module-level metrics counter (for KV fallback mode)
let fallbackMetrics: ManifestMetrics = {
  manifestHits: 0,
  manifestMisses: 0,
  rebuilds: 0,
  casRetries: 0,
  casFailures: 0
};

/**
 * Get current manifest metrics (snapshot)
 * Note: In DO mode, this returns empty since metrics are in DO
 */
export function getManifestMetrics(): ManifestMetrics {
  return { ...fallbackMetrics };
}

/**
 * Reset manifest metrics (for testing)
 */
export function resetManifestMetrics(): void {
  fallbackMetrics = {
    manifestHits: 0,
    manifestMisses: 0,
    rebuilds: 0,
    casRetries: 0,
    casFailures: 0
  };
}

/**
 * Persist current in-memory metrics to KV (legacy - no-op when using DO)
 */
export async function persistMetricsToKV(kv: KVNamespace): Promise<void> {
  // No-op when using DO - metrics are persisted in DO SQLite
  // This function exists for backward compatibility
  const current = getManifestMetrics();
  const hasActivity = Object.values(current).some(v => v > 0);
  if (!hasActivity) return;

  const hourKey = `metrics:hourly:${new Date().toISOString().slice(0, 13)}`;

  try {
    const existing = await kv.get<ManifestMetrics>(hourKey, { type: 'json' });
    const merged: ManifestMetrics = {
      manifestHits: (existing?.manifestHits || 0) + current.manifestHits,
      manifestMisses: (existing?.manifestMisses || 0) + current.manifestMisses,
      rebuilds: (existing?.rebuilds || 0) + current.rebuilds,
      casRetries: (existing?.casRetries || 0) + current.casRetries,
      casFailures: (existing?.casFailures || 0) + current.casFailures
    };

    await kv.put(hourKey, JSON.stringify(merged), {
      expirationTtl: 60 * 60 * 24 * 7
    });

    resetManifestMetrics();
  } catch (error) {
    console.error('[ManifestService] Failed to persist metrics', {
      error: error instanceof Error ? error.message : 'Unknown'
    });
  }
}

/**
 * Get aggregated metrics (for admin endpoint)
 * Uses DO metrics when available, falls back to KV
 */
export async function getAggregatedMetrics(
  kv: KVNamespace,
  hoursBack: number = 24
): Promise<AggregatedMetrics> {
  const current = getManifestMetrics();

  // Build list of hour keys to fetch from KV (legacy metrics)
  const now = new Date();
  const hourKeys: string[] = [];
  for (let i = 0; i < hoursBack; i++) {
    const hourDate = new Date(now.getTime() - i * 60 * 60 * 1000);
    hourKeys.push(`metrics:hourly:${hourDate.toISOString().slice(0, 13)}`);
  }

  const buckets = await Promise.all(
    hourKeys.map(key => kv.get<ManifestMetrics>(key, { type: 'json' }))
  );

  const historical: ManifestMetrics = {
    manifestHits: 0,
    manifestMisses: 0,
    rebuilds: 0,
    casRetries: 0,
    casFailures: 0
  };

  let hoursIncluded = 0;
  for (const bucket of buckets) {
    if (bucket) {
      historical.manifestHits += bucket.manifestHits;
      historical.manifestMisses += bucket.manifestMisses;
      historical.rebuilds += bucket.rebuilds;
      historical.casRetries += bucket.casRetries;
      historical.casFailures += bucket.casFailures;
      hoursIncluded++;
    }
  }

  const totalHits = current.manifestHits + historical.manifestHits;
  const totalMisses = current.manifestMisses + historical.manifestMisses;
  const totalReads = totalHits + totalMisses;
  const hitRate = totalReads > 0
    ? ((totalHits / totalReads) * 100).toFixed(2) + '%'
    : 'N/A';

  return {
    current,
    historical,
    hoursIncluded,
    hitRate,
    totalReads
  };
}

/**
 * Get the KV key for an owner's manifest (for legacy fallback)
 */
export function getManifestKey(ownerId: string): string {
  return `project_list:${ownerId}`;
}

/**
 * Pick the first valid ISO date string from a list of candidates
 */
function pickFirstDateIso(...candidates: Array<string | Date | undefined | null>): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate instanceof Date) {
      if (!isNaN(candidate.getTime())) return candidate.toISOString();
      continue;
    }
    const parsed = new Date(candidate);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Derive manifest-ready fields (status, signals, deployment URL, timestamps) from project metadata.
 * Exported for testing to lock in status derivation rules.
 */
export function deriveManifestFields(
  project: ProjectMetadata | any,
  subdomain: string | null,
  baseDomain: string
): {
  status: ManifestProjectSummary['status'];
  deploymentUrl: string | null;
  buildSignals: ManifestProjectSummary['build_signals'];
  createdAt: string;
  updatedAt: string;
} {
  const rawStatus = (project.status || '').toString().toLowerCase();

  // Prefer subdomain URL when present; otherwise fall back to deployment info in metadata
  const deploymentUrlFromProject =
    (project as any).deployment_url ||
    (project as any).deploymentUrl ||
    (project as any).deployment?.url ||
    (project as any).deployment_info?.public_url_base ||
    (project as any).last_build?.public_url_base ||
    null;

  const deploymentUrl = subdomain
    ? `https://${subdomain}.${baseDomain}`
    : deploymentUrlFromProject;

  const buildMeta: any = (project as any).buildMetadata || (project as any).build_metadata || {};
  const buildStatus = (buildMeta.build_status || buildMeta.status || '').toString().toLowerCase();
  const lastBuildId =
    project.buildId ||
    buildMeta.buildId ||
    buildMeta.build_id ||
    buildMeta.last_build_id ||
    null;

  const successStatuses = new Set(['deployed', 'completed', 'success']);
  const failureStatuses = new Set(['failed', 'timeout', 'cancelled', 'deployment_failed']);

  const hasFailure = failureStatuses.has(rawStatus) || failureStatuses.has(buildStatus);
  let hasSuccess = successStatuses.has(rawStatus) || successStatuses.has(buildStatus) || Boolean(deploymentUrl);
  if (hasFailure) {
    // Failure takes precedence; do not mark as success even if a deployment URL exists
    hasSuccess = false;
  }

  const statusMap: Record<string, ManifestProjectSummary['status']> = {
    deployed: 'deployed',
    scaffolded: 'queueing',
    scaffolding: 'queueing',
    analyzing: 'pending',
    pending: 'pending',
    queueing: 'queueing',
    queued: 'queueing',
    building: 'building',
    deploying: 'building',
    failed: 'failed'
  };

  const baseStatus = statusMap[rawStatus] || 'pending';
  const status: ManifestProjectSummary['status'] = hasFailure
    ? 'failed'
    : hasSuccess
      ? 'deployed'
      : baseStatus;

  const createdAt = pickFirstDateIso(
    project.createdAt,
    (project as any).created_at,
    (project as any).metadata?.created_at,
    (project as any).timestamps?.created_at
  );

  const updatedAt = pickFirstDateIso(
    project.updatedAt,
    (project as any).updated_at,
    (project as any).metadata?.updated_at,
    (project as any).timestamps?.updated_at
  );

  return {
    status,
    deploymentUrl: deploymentUrl || null,
    buildSignals: {
      has_success: hasSuccess,
      has_failure: hasFailure,
      last_build_id: lastBuildId
    },
    createdAt,
    updatedAt
  };
}

/**
 * ManifestService - Routes manifest operations through Durable Objects
 *
 * All operations are atomic within a single owner's manifest due to
 * the single-threaded nature of Durable Objects.
 */
export class ManifestService {
  private readonly useDO: boolean;

  constructor(private readonly env: Env) {
    // Use DO when MANIFEST_DO binding is available
    this.useDO = !!env.MANIFEST_DO;

    if (!this.useDO && !env.PROJECT_LIST_MANIFEST) {
      throw new Error('Neither MANIFEST_DO nor PROJECT_LIST_MANIFEST is configured');
    }

    console.info('[ManifestService] Initialized', {
      mode: this.useDO ? 'durable-object' : 'kv-fallback'
    });
  }

  /**
   * Get a DO stub for the given owner
   * Returns a stub with RPC methods from ManifestDO class
   */
  private getStub(ownerId: string) {
    if (!this.env.MANIFEST_DO) {
      throw new Error('MANIFEST_DO not configured');
    }
    const id = this.env.MANIFEST_DO.idFromName(ownerId);
    return this.env.MANIFEST_DO.get(id);
  }

  /**
   * Get manifest for an owner
   */
  async getManifest(ownerId: string): Promise<OwnerProjectManifest | null> {
    if (this.useDO) {
      try {
        const stub = this.getStub(ownerId);
        const manifest = await stub.getManifest(ownerId);
        if (manifest && manifest.version === MANIFEST_SCHEMA_VERSION) {
          return manifest;
        }
        return null;
      } catch (error) {
        console.error('[ManifestService] DO getManifest failed', {
          ownerId,
          error: error instanceof Error ? error.message : 'Unknown'
        });
        // Fall through to KV fallback
      }
    }

    // KV fallback
    return this.getManifestFromKV(ownerId);
  }

  /**
   * Add a new project to the manifest
   */
  async addProject(ownerId: string, project: ManifestProjectSummary): Promise<void> {
    if (this.useDO) {
      try {
        const stub = this.getStub(ownerId);
        await stub.addProject(ownerId, project);
        return;
      } catch (error) {
        console.error('[ManifestService] DO addProject failed, falling back to KV', {
          ownerId,
          projectId: project.id,
          error: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }

    // KV fallback
    await this.addProjectToKV(ownerId, project);
  }

  /**
   * Update an existing project in the manifest
   */
  async updateProject(
    ownerId: string,
    projectId: string,
    updates: Partial<ManifestProjectSummary>
  ): Promise<void> {
    if (this.useDO) {
      try {
        const stub = this.getStub(ownerId);
        await stub.updateProject(ownerId, projectId, updates);
        return;
      } catch (error) {
        console.error('[ManifestService] DO updateProject failed', {
          ownerId,
          projectId,
          error: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }

    // KV fallback - use the legacy upsert pattern
    await this.updateProjectInKV(ownerId, projectId, updates);
  }

  /**
   * Update build status for a project
   */
  async updateBuildStatus(
    ownerId: string,
    projectId: string,
    status: ManifestProjectSummary['status'],
    buildId?: string,
    deploymentUrl?: string
  ): Promise<void> {
    if (this.useDO) {
      try {
        const stub = this.getStub(ownerId);
        await stub.updateBuildStatus(ownerId, projectId, status, buildId, deploymentUrl);
        return;
      } catch (error) {
        console.error('[ManifestService] DO updateBuildStatus failed', {
          ownerId,
          projectId,
          status,
          error: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }

    // KV fallback
    await this.updateBuildStatusInKV(ownerId, projectId, status, buildId, deploymentUrl);
  }

  /**
   * Update subdomain for a project
   */
  async updateSubdomain(
    ownerId: string,
    projectId: string,
    subdomain: string | null,
    deploymentUrl: string | null
  ): Promise<void> {
    if (this.useDO) {
      try {
        const stub = this.getStub(ownerId);
        await stub.updateSubdomain(ownerId, projectId, subdomain, deploymentUrl);
        return;
      } catch (error) {
        console.error('[ManifestService] DO updateSubdomain failed', {
          ownerId,
          projectId,
          error: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }

    // KV fallback
    await this.updateSubdomainInKV(ownerId, projectId, subdomain, deploymentUrl);
  }

  /**
   * Remove a project from the manifest
   */
  async removeProject(ownerId: string, projectId: string): Promise<void> {
    if (this.useDO) {
      try {
        const stub = this.getStub(ownerId);
        await stub.removeProject(ownerId, projectId);
        return;
      } catch (error) {
        console.error('[ManifestService] DO removeProject failed', {
          ownerId,
          projectId,
          error: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }

    // KV fallback
    await this.removeProjectFromKV(ownerId, projectId);
  }

  /**
   * Rebuild manifest from R2 metadata
   */
  async rebuildManifest(
    ownerId: string,
    storage: IStorageService,
    options?: { ownerAliases?: string[] }
  ): Promise<OwnerProjectManifest> {
    // Fetch projects from R2 (duplicate detection logs are emitted by ProjectService)
    const projects = await this.fetchProjectsFromR2(ownerId, storage, options?.ownerAliases);

    // Log rebuild summary
    console.info('[MANIFEST-REBUILD] Completed rebuild from R2', {
      ownerId,
      totalProjects: projects.length,
      deployedCount: projects.filter(p => p.status === 'deployed').length,
      pendingCount: projects.filter(p => p.status === 'pending').length,
      failedCount: projects.filter(p => p.status === 'failed').length
    });

    if (this.useDO) {
      try {
        const stub = this.getStub(ownerId);
        const manifest = await stub.rebuildManifest(ownerId, projects);
        // Also persist to KV as a fallback cache so list endpoint never returns stale/partial data
        const key = getManifestKey(ownerId);
        await this.env.PROJECT_LIST_MANIFEST!.put(key, JSON.stringify(manifest), {
          expirationTtl: 60 * 60 * 24 * 30
        });
        return manifest;
      } catch (error) {
        console.error('[ManifestService] DO rebuildManifest failed', {
          ownerId,
          error: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }

    // KV fallback
    return this.rebuildManifestInKV(ownerId, projects);
  }

  /**
   * Delete manifest for an owner
   */
  async deleteManifest(ownerId: string): Promise<void> {
    if (this.useDO) {
      try {
        const stub = this.getStub(ownerId);
        await stub.deleteManifest(ownerId);
        return;
      } catch (error) {
        console.error('[ManifestService] DO deleteManifest failed', {
          ownerId,
          error: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }

    // KV fallback
    const key = getManifestKey(ownerId);
    await this.env.PROJECT_LIST_MANIFEST!.delete(key);
  }

  // ============================================================================
  // KV Fallback Methods (for backward compatibility)
  // ============================================================================

  private async getManifestFromKV(ownerId: string): Promise<OwnerProjectManifest | null> {
    const key = getManifestKey(ownerId);
    const manifest = await this.env.PROJECT_LIST_MANIFEST!.get<OwnerProjectManifest>(key, { type: 'json' });

    if (!manifest) {
      fallbackMetrics.manifestMisses++;
      return null;
    }

    if (manifest.version !== MANIFEST_SCHEMA_VERSION) {
      fallbackMetrics.manifestMisses++;
      return null;
    }

    fallbackMetrics.manifestHits++;
    return manifest;
  }

  private async addProjectToKV(ownerId: string, project: ManifestProjectSummary): Promise<void> {
    const key = getManifestKey(ownerId);
    const current = await this.env.PROJECT_LIST_MANIFEST!.get<OwnerProjectManifest>(key, { type: 'json' });

    const draft = current ?? createEmptyManifest(ownerId);
    const existingIndex = draft.projects.findIndex(p => p.id === project.id);
    if (existingIndex >= 0) {
      draft.projects[existingIndex] = project;
    } else {
      draft.projects.push(project);
    }

    draft.metadata = recalculateMetadata(draft.projects);
    draft.updated_at = new Date().toISOString();

    await this.env.PROJECT_LIST_MANIFEST!.put(key, JSON.stringify(draft), {
      expirationTtl: 60 * 60 * 24 * 30
    });
  }

  private async updateProjectInKV(
    ownerId: string,
    projectId: string,
    updates: Partial<ManifestProjectSummary>
  ): Promise<void> {
    const key = getManifestKey(ownerId);
    const current = await this.env.PROJECT_LIST_MANIFEST!.get<OwnerProjectManifest>(key, { type: 'json' });

    if (!current) return;

    const project = current.projects.find(p => p.id === projectId);
    if (project) {
      Object.assign(project, updates, { updated_at: new Date().toISOString() });
      current.metadata = recalculateMetadata(current.projects);
      current.updated_at = new Date().toISOString();

      await this.env.PROJECT_LIST_MANIFEST!.put(key, JSON.stringify(current), {
        expirationTtl: 60 * 60 * 24 * 30
      });
    }
  }

  private async updateBuildStatusInKV(
    ownerId: string,
    projectId: string,
    status: ManifestProjectSummary['status'],
    buildId?: string,
    deploymentUrl?: string
  ): Promise<void> {
    const key = getManifestKey(ownerId);
    const current = await this.env.PROJECT_LIST_MANIFEST!.get<OwnerProjectManifest>(key, { type: 'json' });

    if (!current) return;

    const project = current.projects.find(p => p.id === projectId);
    if (project) {
      project.status = status;
      if (deploymentUrl) project.deployment_url = deploymentUrl;
      if (buildId) project.build_signals.last_build_id = buildId;
      if (status === 'deployed') project.build_signals.has_success = true;
      if (status === 'failed') project.build_signals.has_failure = true;
      project.updated_at = new Date().toISOString();

      current.metadata = recalculateMetadata(current.projects);
      current.updated_at = new Date().toISOString();

      await this.env.PROJECT_LIST_MANIFEST!.put(key, JSON.stringify(current), {
        expirationTtl: 60 * 60 * 24 * 30
      });
    }
  }

  private async updateSubdomainInKV(
    ownerId: string,
    projectId: string,
    subdomain: string | null,
    deploymentUrl: string | null
  ): Promise<void> {
    const key = getManifestKey(ownerId);
    const current = await this.env.PROJECT_LIST_MANIFEST!.get<OwnerProjectManifest>(key, { type: 'json' });

    if (!current) return;

    const project = current.projects.find(p => p.id === projectId);
    if (project) {
      project.subdomain = subdomain;
      project.deployment_url = deploymentUrl;
      project.updated_at = new Date().toISOString();

      current.metadata = recalculateMetadata(current.projects);
      current.updated_at = new Date().toISOString();

      await this.env.PROJECT_LIST_MANIFEST!.put(key, JSON.stringify(current), {
        expirationTtl: 60 * 60 * 24 * 30
      });
    }
  }

  private async removeProjectFromKV(ownerId: string, projectId: string): Promise<void> {
    const key = getManifestKey(ownerId);
    const current = await this.env.PROJECT_LIST_MANIFEST!.get<OwnerProjectManifest>(key, { type: 'json' });

    if (!current) return;

    current.projects = current.projects.filter(p => p.id !== projectId);
    current.metadata = recalculateMetadata(current.projects);
    current.updated_at = new Date().toISOString();

    await this.env.PROJECT_LIST_MANIFEST!.put(key, JSON.stringify(current), {
      expirationTtl: 60 * 60 * 24 * 30
    });
  }

  private async rebuildManifestInKV(
    ownerId: string,
    projects: ManifestProjectSummary[]
  ): Promise<OwnerProjectManifest> {
    fallbackMetrics.rebuilds++;

    const manifest: OwnerProjectManifest = {
      version: MANIFEST_SCHEMA_VERSION,
      owner_id: ownerId,
      updated_at: new Date().toISOString(),
      projects,
      metadata: recalculateMetadata(projects)
    };

    const key = getManifestKey(ownerId);
    await this.env.PROJECT_LIST_MANIFEST!.put(key, JSON.stringify(manifest), {
      expirationTtl: 60 * 60 * 24 * 30
    });

    return manifest;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Fetch projects from R2 for rebuild
   */
  private async fetchProjectsFromR2(
    ownerId: string,
    storage: IStorageService,
    ownerAliases?: string[]
  ): Promise<ManifestProjectSummary[]> {
    const projectService = new ProjectService(storage, this.env);
    const baseDomain = this.env.BASE_DOMAIN || 'gpthost.online';

    // Paginate through all projects
    const PAGE_SIZE = 1000;
    let offset = 0;
    const allProjects: any[] = [];

    while (true) {
      // Pull all projects, filter by owner after normalization to avoid missing snake_case owner_id
      const listResult = await projectService.listProjects({
        limit: PAGE_SIZE,
        offset
      });

      if (!listResult.ok) {
        throw new Error(`Failed to list projects: ${listResult.error.message}`);
      }

      allProjects.push(...listResult.value.projects);

      if (!listResult.value.hasMore || listResult.value.projects.length === 0) {
        break;
      }
      offset += PAGE_SIZE;
    }

    // Normalize ownerId and filter to the requested owner
    const aliasSet = buildOwnerAliasSet(ownerId, allProjects, ownerAliases || []);
    const ownerProjects = allProjects.filter(project =>
      projectMatchesOwnerAliases(project, aliasSet)
    );

    // Get subdomain mappings
    let subdomainMap: Map<string, string> = new Map();
    try {
      const subdomainService = new SubdomainService(this.env);
      const mapResult = await subdomainService.listProjectSubdomainMap();
      if (mapResult.ok) {
        subdomainMap = mapResult.value;
      }
    } catch (error) {
      console.warn('[ManifestService] Subdomain lookup failed during rebuild');
    }

    // Convert to manifest summaries
    return ownerProjects.map((project) => {
      const subdomain = subdomainMap.get(project.id) || null;
      const { status, deploymentUrl, buildSignals, createdAt, updatedAt } = deriveManifestFields(
        project,
        subdomain,
        baseDomain
      );

      return {
        id: project.id,
        name: project.name,
        framework: this.normalizeFramework(project.framework),
        status,
        created_at: createdAt,
        updated_at: updatedAt,
        deployment_url: deploymentUrl,
        subdomain: subdomain,
        file_count: project.files?.length || 0,
        build_signals: buildSignals
      };
    });
  }

  /**
   * Normalize framework to manifest-compatible type
   */
  private normalizeFramework(framework: string | undefined): ManifestProjectSummary['framework'] {
    if (!framework) return 'unknown';
    const normalized = framework.toLowerCase();
    if (normalized === 'react') return 'react';
    if (normalized === 'vue') return 'vue';
    if (normalized === 'svelte') return 'svelte';
    if (normalized === 'html') return 'html';
    return 'unknown';
  }
}
