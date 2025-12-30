/**
 * Per-Owner Project Manifest
 *
 * Compact representation of an owner's projects for fast dashboard loading.
 * Schema version allows for future migrations without breaking existing manifests.
 */

export const MANIFEST_SCHEMA_VERSION = 2;

/**
 * Build status signals for quick dashboard indicators
 */
export interface BuildSignals {
  has_success: boolean;
  has_failure: boolean;
  last_build_id: string | null;
}

/**
 * Compact project summary for manifest storage
 * Only includes fields needed for dashboard display
 */
export interface ManifestProjectSummary {
  id: string;
  name: string;
  framework: 'react' | 'vue' | 'svelte' | 'html' | 'unknown';
  status: 'pending' | 'queueing' | 'building' | 'deployed' | 'failed';
  created_at: string;
  updated_at: string;
  deployment_url: string | null;
  subdomain: string | null;
  file_count: number;
  build_signals: BuildSignals;
  /**
   * Field-level timestamps for CAS conflict resolution.
   * Tracks when each field was last updated (epoch ms).
   * Used by updateProjectFieldsAtomic for field-level merge.
   * Optional for backward compatibility with existing manifests.
   */
  _fieldTimestamps?: Record<string, number>;
}

/**
 * Aggregated metadata for quick stats
 */
export interface ManifestMetadata {
  total_projects: number;
  active_projects: number;
  building_projects: number;
  failed_projects: number;
}

/**
 * Complete manifest structure stored in KV
 * Key format: project_list:<ownerId>
 */
export interface OwnerProjectManifest {
  version: number;
  owner_id: string;
  updated_at: string;
  projects: ManifestProjectSummary[];
  metadata: ManifestMetadata;
}

/**
 * Create an empty manifest for a new owner
 */
export function createEmptyManifest(ownerId: string): OwnerProjectManifest {
  return {
    version: MANIFEST_SCHEMA_VERSION,
    owner_id: ownerId,
    updated_at: new Date().toISOString(),
    projects: [],
    metadata: {
      total_projects: 0,
      active_projects: 0,
      building_projects: 0,
      failed_projects: 0
    }
  };
}

/**
 * Recalculate metadata from projects array
 */
export function recalculateMetadata(projects: ManifestProjectSummary[]): ManifestMetadata {
  return {
    total_projects: projects.length,
    active_projects: projects.filter(p => p.status === 'deployed').length,
    building_projects: projects.filter(p => p.status === 'building').length,
    failed_projects: projects.filter(p => p.status === 'failed').length
  };
}
