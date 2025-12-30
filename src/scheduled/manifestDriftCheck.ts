/**
 * Manifest Drift Check - Scheduled Handler
 * Phase 3: Observability & Drift Control
 *
 * Runs nightly to detect and repair drift between KV manifests and R2 reality.
 * - Compares manifest project counts with actual R2 projects
 * - Auto-rebuilds manifests with major drift
 * - Stores drift report for admin dashboard
 */

import { ManifestService, persistMetricsToKV } from '../services/ManifestService';
import { ProjectService } from '../services/ProjectService';
import { ServiceFactory } from '../services/ServiceFactory';
import { Env } from '../types/env';

/**
 * Helper: Fetch ALL projects with proper pagination.
 * Prevents the 10k limit bug that skips owners beyond the first page.
 */
async function getAllProjectsPaginated(
  projectService: ProjectService,
  filter?: { ownerId?: string }
): Promise<any[]> {
  const allProjects: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;

  while (true) {
    const result = await projectService.listProjects({
      ...filter,
      limit: PAGE_SIZE,
      offset
    });

    if (!result.ok) {
      throw new Error(`Failed to list projects: ${result.error.message}`);
    }

    allProjects.push(...result.value.projects);

    // Check if there are more pages
    if (!result.value.hasMore || result.value.projects.length === 0) {
      break;
    }

    offset += PAGE_SIZE;
  }

  return allProjects;
}

/**
 * Drift classification for a single owner
 */
export type DriftLevel = 'none' | 'minor' | 'major';

/**
 * Drift report for a single owner
 */
export interface OwnerDriftReport {
  ownerId: string;
  manifestProjects: number;
  r2Projects: number;
  drift: DriftLevel;
  details?: string;
}

/**
 * Summary of drift check results
 */
export interface DriftCheckSummary {
  totalOwners: number;
  noDrift: number;
  minorDrift: number;
  majorDrift: number;
  rebuiltCount: number;
  durationMs: number;
}

/**
 * Complete drift report stored in KV
 */
export interface DriftReport {
  timestamp: string;
  summary: DriftCheckSummary;
  reports: OwnerDriftReport[]; // Only owners with drift
}

/**
 * Classify drift level based on project count difference
 */
function classifyDrift(manifestCount: number, r2Count: number, manifestExists: boolean): DriftLevel {
  if (!manifestExists) {
    return 'major'; // Missing manifest is always major drift
  }

  const difference = Math.abs(manifestCount - r2Count);

  if (difference === 0) {
    return 'none';
  } else if (difference <= 5) {
    return 'minor';
  } else {
    return 'major';
  }
}

/**
 * Scheduled handler for manifest drift detection
 * Runs daily to ensure manifests stay in sync with R2
 *
 * @param event - Scheduled event from Cloudflare
 * @param env - Worker environment bindings
 * @param ctx - Execution context for waitUntil
 */
export async function handleManifestDriftCheck(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  // Check if drift detection is enabled
  if (env.ENABLE_MANIFEST_DRIFT_CHECK !== 'true') {
    console.info('[ManifestDriftCheck] Drift detection disabled via feature flag');
    return;
  }

  // Ensure KV namespace is configured
  if (!env.PROJECT_LIST_MANIFEST) {
    console.error('[ManifestDriftCheck] PROJECT_LIST_MANIFEST KV namespace not configured');
    return;
  }

  console.info('[ManifestDriftCheck] Starting drift check', {
    event: 'drift_check_start',
    scheduledTime: new Date(event.scheduledTime).toISOString()
  });

  const startTime = Date.now();

  try {
    const storage = ServiceFactory.getStorageService(env);
    const projectService = new ProjectService(storage, env);
    const manifestService = new ManifestService(env);

    // Get ALL projects with proper pagination (fixes 10k limit bug)
    const allProjects = await getAllProjectsPaginated(projectService);

    // Extract unique owner IDs
    const ownerIds = new Set<string>();
    for (const project of allProjects) {
      const ownerId = (project as any).ownerId || (project as any).owner_id;
      if (ownerId) {
        ownerIds.add(ownerId);
      }
    }

    const ownerIdArray = Array.from(ownerIds);
    console.info('[ManifestDriftCheck] Checking drift for owners', {
      ownerCount: ownerIdArray.length
    });

    const reports: OwnerDriftReport[] = [];
    let rebuiltCount = 0;

    // Process each owner
    for (const ownerId of ownerIdArray) {
      try {
        // Get manifest
        const manifest = await manifestService.getManifest(ownerId);
        const manifestCount = manifest?.projects.length || 0;
        const manifestExists = manifest !== null;

        // Get R2 project count for this owner (with pagination)
        let r2Count: number;
        try {
          const ownerProjects = await getAllProjectsPaginated(projectService, { ownerId });
          r2Count = ownerProjects.length;
        } catch (error) {
          console.warn('[ManifestDriftCheck] Failed to list projects for owner', {
            ownerId,
            error: error instanceof Error ? error.message : 'Unknown'
          });
          continue;
        }

        // Classify drift
        const drift = classifyDrift(manifestCount, r2Count, manifestExists);

        // Build report details
        let details: string | undefined;
        if (!manifestExists) {
          details = 'Manifest missing';
        } else if (drift !== 'none') {
          details = `Manifest has ${manifestCount} projects, R2 has ${r2Count}`;
        }

        const report: OwnerDriftReport = {
          ownerId,
          manifestProjects: manifestCount,
          r2Projects: r2Count,
          drift,
          details
        };

        reports.push(report);

        // Auto-rebuild on major drift
        if (drift === 'major') {
          console.warn('[ManifestDriftCheck] Major drift detected, rebuilding manifest', {
            event: 'drift_rebuild',
            ownerId,
            manifestCount,
            r2Count
          });

          try {
            await manifestService.rebuildManifest(ownerId, storage);
            rebuiltCount++;
          } catch (rebuildError) {
            console.error('[ManifestDriftCheck] Failed to rebuild manifest', {
              ownerId,
              error: rebuildError instanceof Error ? rebuildError.message : 'Unknown'
            });
          }
        }
      } catch (error) {
        console.error('[ManifestDriftCheck] Drift check failed for owner', {
          ownerId,
          error: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }

    const durationMs = Date.now() - startTime;

    // Build summary
    const summary: DriftCheckSummary = {
      totalOwners: ownerIdArray.length,
      noDrift: reports.filter(r => r.drift === 'none').length,
      minorDrift: reports.filter(r => r.drift === 'minor').length,
      majorDrift: reports.filter(r => r.drift === 'major').length,
      rebuiltCount,
      durationMs
    };

    console.info('[ManifestDriftCheck] Drift check complete', {
      event: 'drift_check_complete',
      ...summary
    });

    // Store report in KV (only drift cases to save space)
    const driftReport: DriftReport = {
      timestamp: new Date().toISOString(),
      summary,
      reports: reports.filter(r => r.drift !== 'none')
    };

    await env.PROJECT_LIST_MANIFEST.put(
      'drift_report:latest',
      JSON.stringify(driftReport),
      { expirationTtl: 60 * 60 * 24 * 7 } // 7 days TTL
    );

    // Persist accumulated metrics to KV at end of scheduled job
    await persistMetricsToKV(env.PROJECT_LIST_MANIFEST);

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error('[ManifestDriftCheck] Drift check failed', {
      event: 'drift_check_failure',
      durationMs,
      error: error instanceof Error ? error.message : 'Unknown'
    });
  }
}

/**
 * Manual drift check trigger (for admin endpoint)
 * Same logic as scheduled handler but can be invoked on-demand
 */
export async function triggerManualDriftCheck(
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  // Create a mock scheduled event
  const mockEvent = {
    scheduledTime: Date.now(),
    cron: 'manual'
  } as ScheduledEvent;

  // Temporarily enable drift check for manual trigger
  const originalFlag = env.ENABLE_MANIFEST_DRIFT_CHECK;
  (env as any).ENABLE_MANIFEST_DRIFT_CHECK = 'true';

  try {
    await handleManifestDriftCheck(mockEvent, env, ctx);
  } finally {
    // Restore original flag
    (env as any).ENABLE_MANIFEST_DRIFT_CHECK = originalFlag;
  }
}
