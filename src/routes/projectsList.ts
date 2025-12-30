/**
 * Project List API Implementation - Simplified MVP
 * 
 * Simplified project list API endpoint for frontend dashboard
 * Uses existing project management infrastructure for reliable operation
 * 
 * Features:
 * - Basic pagination support
 * - Simple filtering by status and framework
 * - Sorting by common fields
 * - Integration with existing project management system
 * - TypeScript safe implementation
 */

// Removed multiProjectManager import - now using ServiceFactory
import {
  ProjectMetadata,
  ProjectStatus,
  FrameworkType
} from '../types/api';
import { corsResponse, successResponse, errorResponse } from '../utils/responses';
import { ServiceFactory } from '../services/ServiceFactory';
import { SubdomainService } from '../services/SubdomainService';
import { ManifestService } from '../services/ManifestService';
import { isManifestEnabled } from '../config/featureFlags';
import { OwnerProjectManifest, ManifestProjectSummary, MANIFEST_SCHEMA_VERSION } from '../domain/manifest';
import type { AuthenticatedRequest } from '../utils/authUtils';

const LEGACY_OWNER_ID = 'legacy-single-tenant';

/**
 * Simplified query parameters for project list API
 */
interface ProjectListQuery {
  // Pagination
  page?: string;
  per_page?: string;

  // Basic filtering
  status?: string;
  framework?: string;

  // Simple search
  search?: string;

  // Sorting
  sort_by?: string;
  sort_order?: 'asc' | 'desc';

  // View options
  view_mode?: 'grid' | 'list' | 'compact';
}

/**
 * Simplified project list response format
 */
interface ProjectListResponse {
  projects: ProjectSummary[];
  pagination: {
    total_count: number;
    page: number;
    per_page: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
  filters: {
    applied: Record<string, any>;
  };
  sorting: {
    sort_by: string;
    sort_order: string;
  };
  metadata: {
    source?: 'manifest' | 'legacy';
    manifest_updated_at?: string;
    total_projects: number;
    active_projects: number;
    building_projects: number;
    failed_projects: number;
  };
}

/**
 * Simplified project data for list view
 */
interface ProjectSummary {
  id: string;
  name: string;
  description?: string;
  framework: FrameworkType;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  deployment_url?: string;
  subdomain?: string;
  file_count?: number;
}

interface DeploymentSignals {
  deploymentUrl?: string;
  derivedStatus: ProjectStatus;
  hasSuccessfulBuild: boolean;
  hasFailedBuild: boolean;
}

interface BuildStatusSnapshot {
  status?: string;
  current_stage?: string;
  metadata?: Record<string, any>;
  deployment?: Record<string, any>;
  deployment_url?: string;
  error?: Record<string, any>;
}

/**
 * Simplified Project List API Handler
 * GET /api/projects/list
 */
export async function projectListHandler(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();

  try {
    console.info('[API-PROJECT-LIST] Processing simplified project list request');

    const url = new URL(request.url);
    const query = parseQueryParameters(url.searchParams);

    const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
    const perPage = Math.max(1, parseInt(query.per_page || '20', 10) || 20);

    const authContext = (request as AuthenticatedRequest).authContext;
    const ownerId = authContext?.authType === 'legacy-token'
      ? LEGACY_OWNER_ID
      : authContext?.user?.id ?? null;
    const ownerEmail = authContext?.user?.email || null;
    const ownerAliases = ownerEmail ? [ownerEmail] : undefined;

    if (!ownerId) {
      console.warn('[API-PROJECT-LIST] Missing ownerId in auth context; returning empty result set');
      const emptyResponse: ProjectListResponse = {
        projects: [],
        pagination: {
          total_count: 0,
          page,
          per_page: perPage,
          total_pages: 0,
          has_next: false,
          has_prev: false,
        },
        filters: {
          applied: extractAppliedFilters(query),
        },
        sorting: {
          sort_by: query.sort_by || 'updated_at',
          sort_order: query.sort_order || 'desc',
        },
        metadata: {
          total_projects: 0,
          active_projects: 0,
          building_projects: 0,
          failed_projects: 0,
        },
      };

      return successResponse(emptyResponse);
    }

    console.info('[API-PROJECT-LIST] Query parameters', {
      search: query.search,
      status: query.status,
      framework: query.framework,
      pagination: {
        page,
        per_page: perPage
      },
      sorting: {
        sort_by: query.sort_by,
        sort_order: query.sort_order
      },
      ownerId,
      manifestEnabled: isManifestEnabled(env)
    });

    // Phase 2: Try manifest-first path when enabled
    if (isManifestEnabled(env)) {
      try {
        const manifestResult = await serveFromManifest(ownerId, query, env, ownerAliases);
        if (manifestResult) {
          const processingTime = Date.now() - startTime;
          console.info('✅ [API-PROJECT-LIST] Served from manifest', {
            projects_returned: manifestResult.projects.length,
            total_processing_time_ms: processingTime
          });
          return successResponse(manifestResult);
        }
        // manifestResult is null means manifest not found or error, fall through to legacy
        console.info('[API-PROJECT-LIST] Manifest path returned null, falling back to legacy');
      } catch (manifestError) {
        console.error('[API-PROJECT-LIST] Manifest path error, falling back to legacy', {
          ownerId,
          error: manifestError instanceof Error ? manifestError.message : 'Unknown'
        });
        // Fall through to legacy path
      }
    }

    // Legacy path: enumerate R2 (slow path ~4s)
    console.info('[API-PROJECT-LIST] Using legacy R2 enumeration path', { ownerId });

    // Use ServiceFactory as specified in DAY3-TDD-STRATEGY.md
    const projectService = ServiceFactory.getProjectService(env);

    // Pull ALL projects from storage (avoid default 10-item limit inside service)
    const PAGE_SIZE = 1000;
    let offset = 0;
    let projects: any[] = [];
    while (true) {
      const pageResult = await projectService.listProjects({
        limit: PAGE_SIZE,
        offset,
        ownerId,
        ownerAliases
      });
      if (!pageResult.ok) {
        return errorResponse(
          'PROJECT_LIST_FAILED',
          pageResult.error.message || 'Failed to list projects',
          500,
          pageResult.error
        );
      }
      const pageProjects = pageResult.value.projects || [];
      projects = projects.concat(pageProjects);
      if (!pageResult.value.hasMore || pageProjects.length === 0) break;
      offset += PAGE_SIZE;
    }

    console.info('[API-PROJECT-LIST] Retrieved projects from manager', {
      total_projects: projects.length
    });

    // Apply filters
    projects = applyFilters(projects, query);

    console.info('[API-PROJECT-LIST] Applied filters', {
      filtered_projects: projects.length
    });

    // Apply sorting
    projects = applySorting(projects, query);

    // Calculate pagination
    const totalPages = Math.ceil(projects.length / perPage);
    const startIndex = (page - 1) * perPage;
    const paginatedProjects = projects.slice(startIndex, startIndex + perPage);

    // Build subdomain map once to avoid repeated KV lookups
    const subdomainRoutingEnabled = (env.ENABLE_SUBDOMAIN_ROUTING || '').toLowerCase() === 'true' || !!env.SUBDOMAIN_MAPPINGS;
    const baseDomain = env.BASE_DOMAIN || 'gpthost.online';
    let subdomainMap: Map<string, string> | null = null;

    if (subdomainRoutingEnabled && env.SUBDOMAIN_MAPPINGS) {
      try {
        const subdomainService = new SubdomainService(env);
        const subdomainResult = await subdomainService.listProjectSubdomainMap();

        if (subdomainResult.ok) {
          subdomainMap = subdomainResult.value;
        } else {
          console.warn('[API-PROJECT-LIST] Failed to load subdomain mappings', subdomainResult.error);
        }
      } catch (error) {
        console.warn('[API-PROJECT-LIST] Subdomain map load error', error);
      }
    }

    // Load build-status snapshots for the current page to make status accurate even when metadata lags
    const buildStatusMap = await loadBuildStatusSnapshots(paginatedProjects, env);

    // Transform to summary format and prefer subdomain URLs when available
    const projectSummaries = await Promise.all(paginatedProjects.map(async project => {
      const buildStatus = buildStatusMap.get(project.id);
      const deploymentSignals = deriveDeploymentSignals(project, buildStatus);
      const summary = transformToProjectSummary(project, deploymentSignals, buildStatus);

      const subdomain = subdomainMap?.get(summary.id);
      let deploymentUrl = summary.deployment_url || deploymentSignals.deploymentUrl;
      let status = summary.status;

      if (subdomain) {
        const fallbackUrl = `https://${subdomain}.${baseDomain}`;
        const hasSuccessfulSignals = deploymentSignals.hasSuccessfulBuild;

        // SANITY CHECK: Detect stale build-status for projects with subdomains
        // If subdomain exists (deployment is ready) but status is "building/queueing/pending",
        // the build-status.json MIGHT be stale (from before callback fix).
        // Check file age to distinguish stale (>10 min) from fresh builds (<10 min).
        const isStaleProcessingStatus = (
          status === 'building' ||
          status === 'queueing' ||
          status === 'pending'
        );

        if (isStaleProcessingStatus) {
          // HYBRID FIX: Check if build is actually stale using LOGICAL timestamp from build-status.json content
          // Previous bug: Used R2's physical 'uploaded' timestamp which refreshes on every write
          // Correct approach: Use metadata.queued_at from file content to determine actual build age
          const buildStatusPath = `projects/${summary.id}/build-status.json`;
          const buildStatusObj = await env.PROJECTS_BUCKET.get(buildStatusPath);

          let fileAgeMinutes = 999; // Default: assume very stale if no file exists

          if (buildStatusObj) {
            try {
              // Parse build-status.json content to get logical timestamp
              const buildStatus = await buildStatusObj.json() as {
                status?: string;
                metadata?: {
                  queued_at?: string;
                  callback_received_at?: string;
                  job_id?: string;
                };
              };

              // If build has received callback, it's complete (not stale)
              if (buildStatus.metadata?.callback_received_at) {
                fileAgeMinutes = 0; // Build is complete, not stale
              }
              // If we have queued_at, use it (logical timestamp)
              else if (buildStatus.metadata?.queued_at) {
                const queuedTime = new Date(buildStatus.metadata.queued_at).getTime();
                fileAgeMinutes = (Date.now() - queuedTime) / 60000;
              }
              // Fallback to R2 physical timestamp (backward compatibility for old builds)
              else {
                fileAgeMinutes = (Date.now() - buildStatusObj.uploaded.getTime()) / 60000;
                console.warn(`[projectsList] No metadata.queued_at for project ${summary.id}, using R2 uploaded time`);
              }
            } catch (parseError) {
              // JSON parsing failed - fallback to R2 physical timestamp
              fileAgeMinutes = (Date.now() - buildStatusObj.uploaded.getTime()) / 60000;
              console.error(`[projectsList] Failed to parse build-status.json for project ${summary.id}:`, parseError);
            }
          }

          if (fileAgeMinutes > 10) {
            // Truly stale (queued >10 min ago) - subdomain exists proves deployment succeeded
            deploymentUrl = fallbackUrl;
            status = 'deployed';
          }
          // else: Fresh build in progress (<10 min since queued) - keep "building" status
        } else if (!deploymentUrl && hasSuccessfulSignals) {
          // Original logic: Only surface the subdomain as a live URL when we have success signals
          deploymentUrl = fallbackUrl;
        } else if (deploymentUrl && hasSuccessfulSignals && status !== 'failed') {
          // Original logic: Preserve real-time build states; promote to deployed only when we have success signals and a URL
          status = 'deployed';
        }

        return {
          ...summary,
          subdomain,
          deployment_url: deploymentUrl,
          status
        };
      }

      return {
        ...summary,
        deployment_url: deploymentUrl,
        status
      };
    }));

    // Calculate metadata statistics
    const metadata = calculateMetadata(projectSummaries);

    // Build response (legacy path)
    const response: ProjectListResponse = {
      projects: projectSummaries,
      pagination: {
        total_count: projects.length,
        page,
        per_page: perPage,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1
      },
      filters: {
        applied: extractAppliedFilters(query)
      },
      sorting: {
        sort_by: query.sort_by || 'updated_at',
        sort_order: query.sort_order || 'desc'
      },
      metadata: {
        ...metadata,
        source: 'legacy' as const
      }
    };

    const processingTime = Date.now() - startTime;

    console.info('✅ [API-PROJECT-LIST] Request completed successfully', {
      projects_returned: projectSummaries.length,
      total_processing_time_ms: processingTime
    });

    return successResponse(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;

    console.error('[API-PROJECT-LIST] Request failed', {
      error: error instanceof Error ? error.message : String(error),
      processing_time_ms: processingTime
    });

    return errorResponse(
      'PROJECT_LIST_FAILED',
      'Failed to retrieve project list',
      500,
      {
        error: error instanceof Error ? error.message : String(error),
        processing_time_ms: processingTime
      }
    );
  }
}

/**
 * Parse and validate query parameters
 */
function parseQueryParameters(searchParams: URLSearchParams): ProjectListQuery {
  return {
    // Pagination
    page: searchParams.get('page') || undefined,
    per_page: searchParams.get('per_page') || undefined,

    // Basic filtering
    status: searchParams.get('status') || undefined,
    framework: searchParams.get('framework') || undefined,

    // Simple search
    search: searchParams.get('search') || searchParams.get('q') || undefined,

    // Sorting
    sort_by: searchParams.get('sort_by') || searchParams.get('sort') || undefined,
    sort_order: (searchParams.get('sort_order') || searchParams.get('order')) as 'asc' | 'desc' || 'desc',

    // View options
    view_mode: (searchParams.get('view_mode') || searchParams.get('view')) as 'grid' | 'list' | 'compact' || 'grid'
  };
}

/**
 * Apply filters to project list
 */
function applyFilters(projects: any[], query: ProjectListQuery): any[] {
  return projects.filter(project => {
    // Status filter
    if (query.status) {
      const statusFilters = query.status.split(',').map(s => s.trim());
      if (!statusFilters.includes(project.status)) {
        return false;
      }
    }

    // Framework filter
    if (query.framework) {
      const frameworkFilters = query.framework.split(',').map(f => f.trim());
      if (!frameworkFilters.includes(project.framework)) {
        return false;
      }
    }

    // Simple search
    if (query.search) {
      const searchTerm = query.search.toLowerCase();
      const searchText = `${project.id} ${project.name || ''} ${project.description || ''} ${project.framework || ''}`.toLowerCase();
      if (!searchText.includes(searchTerm)) {
        return false;
      }
    }

    return true;
  });
}

async function loadBuildStatusSnapshots(projects: ProjectMetadata[], env: Env): Promise<Map<string, BuildStatusSnapshot>> {
  const map = new Map<string, BuildStatusSnapshot>();

  await Promise.all(projects.map(async (project) => {
    try {
      const statusKey = `projects/${project.id}/build-status.json`;
      const statusObj = await env.PROJECTS_BUCKET.get(statusKey);
      if (!statusObj) return;

      const statusJson = await statusObj.json<BuildStatusSnapshot>();
      map.set(project.id, statusJson);
    } catch (error) {
      console.warn('[API-PROJECT-LIST] Failed to load build status snapshot', {
        projectId: project.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }));

  return map;
}

/**
 * Derive deployment signals from project metadata and build status snapshot.
 *
 * SIMPLIFIED: When build-status.json exists (buildStatus provided), trust it as canonical source.
 * Only fall back to metadata aggregation for legacy projects without build-status.json.
 */
function deriveDeploymentSignals(project: ProjectMetadata, buildStatus?: BuildStatusSnapshot): DeploymentSignals {
  // Extract deployment URL from various sources (for backward compatibility)
  const buildMeta: any = (project as any).build_metadata || {};
  const lastBuild: any = (project as any).last_build || {};
  const deploymentInfo: any = (project as any).deployment_info || {};
  const deploymentDetails: any = (project as any).deployment || {};

  const deploymentUrl = (project as any).deployment_url
    || (project as any).deploymentUrl
    || deploymentDetails.url
    || deploymentInfo.public_url_base
    || lastBuild.public_url_base;

  // If we have fresh build-status.json, trust it (simple path)
  if (buildStatus?.status) {
    const status = buildStatus.status.toString().toLowerCase();
    const statusMap: Record<string, ProjectStatus> = {
      'success': 'deployed',
      'completed': 'deployed',
      'failed': 'failed',
      'timeout': 'failed',
      'cancelled': 'failed',
      'deployment_failed': 'failed', // Handle explicit deployment failures
      'building': 'building',
      'deploying': 'deploying',
      'processing': 'building',
      'running': 'building',
      'in_progress': 'building',
      'in-progress': 'building',
      'queued': 'queueing',
      'queueing': 'queueing',
      'pending': 'pending'
    };

    const derivedStatus = statusMap[status] || 'pending';

    // SANITY CHECK: Detect stale build-status.json from before callback fix
    // If build-status shows "processing/building/queueing/pending" BUT deployment URL exists,
    // the build actually succeeded and deployed. Trust deployment evidence over stale file.
    const isStaleProcessingStatus = (
      derivedStatus === 'building' ||
      derivedStatus === 'queueing' ||
      derivedStatus === 'pending' ||
      derivedStatus === 'deploying'
    );

    if (isStaleProcessingStatus && deploymentUrl) {
      // Deployment URL exists = build succeeded, build-status.json is stale
      return {
        deploymentUrl,
        derivedStatus: 'deployed',
        hasSuccessfulBuild: true,
        hasFailedBuild: false
      };
    }

    const hasSuccessfulBuild = derivedStatus === 'deployed';
    const hasFailedBuild = derivedStatus === 'failed';

    return { deploymentUrl, derivedStatus, hasSuccessfulBuild, hasFailedBuild };
  }

  // Fallback: Aggregate from metadata (legacy path for old projects)
  const statusCandidates = [
    lastBuild.status,
    buildMeta.build_status || buildMeta.status,
    deploymentInfo.status,
    (project as any).status
  ]
    .map(status => status ? status.toString().toLowerCase() : undefined)
    .filter(Boolean) as string[];

  const successSignals = new Set(['deployed', 'completed', 'success', 'succeeded', 'ready', 'active']);
  const failedSignals = new Set(['failed', 'timeout', 'cancelled']);

  const hasSuccessfulBuild = statusCandidates.some(status => successSignals.has(status));
  const hasFailedBuild = statusCandidates.some(status => failedSignals.has(status));

  let derivedStatus: ProjectStatus = hasFailedBuild ? 'failed'
    : hasSuccessfulBuild ? 'deployed'
      : (project as any).status || 'pending';

  return { deploymentUrl, derivedStatus, hasSuccessfulBuild, hasFailedBuild };
}

/**
 * Transform project metadata to summary format
 *
 * SIMPLIFIED: Trust deriveDeploymentSignals for status logic.
 * Removed redundant buildStatusFromMeta aggregation.
 */
function transformToProjectSummary(project: ProjectMetadata, signals?: DeploymentSignals, buildStatus?: BuildStatusSnapshot): ProjectSummary {
  const deploymentSignals = signals ?? deriveDeploymentSignals(project, buildStatus);

  // Normalize field names from mixed sources (camelCase vs snake_case)
  const createdAt = (project as any).created_at || (project as any).createdAt || new Date().toISOString();
  const updatedAt = (project as any).updated_at || (project as any).updatedAt || createdAt;
  const deploymentUrl = deploymentSignals.deploymentUrl
    || (project as any).deployment_url
    || (project as any).deploymentUrl;

  // Use status from deriveDeploymentSignals (already handles snapshot vs metadata)
  let derivedStatus = deploymentSignals.derivedStatus;

  // Special case: If we have a deployment URL but status is pending/unknown, mark as deployed
  if (!deploymentSignals.hasFailedBuild && deploymentUrl && derivedStatus === 'pending') {
    derivedStatus = 'deployed';
  }

  return {
    id: project.id,
    name: project.name || project.id,
    description: project.description,
    framework: project.framework || 'unknown',
    status: derivedStatus,
    created_at: createdAt,
    updated_at: updatedAt,
    deployment_url: deploymentUrl,
    file_count: project.files?.length || 0
  };
}

/**
 * Apply sorting to project list
 */
function applySorting(projects: any[], query: ProjectListQuery): any[] {
  const sortField = query.sort_by || 'updated_at';
  const sortOrder = query.sort_order || 'desc';

  return projects.sort((a, b) => {
    let valueA: any;
    let valueB: any;

    // Get sort values based on field
    switch (sortField) {
      case 'name':
        valueA = a.name || a.id;
        valueB = b.name || b.id;
        break;
      case 'created_at':
      case 'updated_at':
        valueA = new Date(a[sortField]);
        valueB = new Date(b[sortField]);
        break;
      case 'status':
        valueA = a.status;
        valueB = b.status;
        break;
      case 'framework':
        valueA = a.framework;
        valueB = b.framework;
        break;
      default:
        valueA = a.updated_at;
        valueB = b.updated_at;
    }

    // Convert to comparable values
    if (typeof valueA === 'string') valueA = valueA.toLowerCase();
    if (typeof valueB === 'string') valueB = valueB.toLowerCase();

    let comparison = 0;
    if (valueA > valueB) comparison = 1;
    if (valueA < valueB) comparison = -1;

    return sortOrder === 'desc' ? -comparison : comparison;
  });
}

/**
 * Calculate metadata statistics
 */
function calculateMetadata(projects: Array<{ status: ProjectStatus }>): ProjectListResponse['metadata'] {
  return {
    total_projects: projects.length,
    active_projects: projects.filter(p => p.status === 'deployed' || p.status === 'building' || p.status === 'deploying').length,
    building_projects: projects.filter(p => p.status === 'building' || p.status === 'deploying' || p.status === 'analyzing').length,
    failed_projects: projects.filter(p => p.status === 'failed').length
  };
}

/**
 * Extract applied filters for response
 */
function extractAppliedFilters(query: ProjectListQuery): Record<string, any> {
  const filters: Record<string, any> = {};

  if (query.search) filters.search = query.search;
  if (query.status) filters.status = query.status.split(',');
  if (query.framework) filters.framework = query.framework.split(',');

  return filters;
}

/**
 * Serve project list from KV manifest (Phase 2 fast path)
 * Returns null if manifest not found or error (triggers fallback to legacy)
 */
async function serveFromManifest(
  ownerId: string,
  query: ProjectListQuery,
  env: Env,
  ownerAliases?: string[]
): Promise<ProjectListResponse | null> {
  const startTime = Date.now();

  try {
    const manifestService = new ManifestService(env);

    // Try to get manifest from KV/DO
    let manifest = await manifestService.getManifest(ownerId);
    const manifestOutdated = manifest?.version !== MANIFEST_SCHEMA_VERSION;

    if (!manifest || manifest.projects.length === 0 || manifestOutdated) {
      console.info('[API-PROJECT-LIST] Manifest miss/empty/outdated, triggering rebuild', {
        ownerId,
        manifestProjects: manifest?.projects?.length || 0,
        manifestVersion: manifest?.version
      });

      try {
        const storage = ServiceFactory.getStorageService(env);
        manifest = await manifestService.rebuildManifest(ownerId, storage, {
          ownerAliases
        });
      } catch (rebuildError) {
        console.error('[API-PROJECT-LIST] Lazy rebuild failed, falling back to legacy', {
          ownerId,
          error: rebuildError instanceof Error ? rebuildError.message : 'Unknown'
        });
        return null;
      }
    }

    if (!manifest || manifest.projects.length === 0) {
      return null;
    }

    // Apply filters to manifest projects
    let projects = [...manifest.projects];

    // Status filter
    if (query.status) {
      const statusFilters = query.status.split(',').map(s => s.trim().toLowerCase());
      projects = projects.filter(p => statusFilters.includes(p.status));
    }

    // Framework filter
    if (query.framework) {
      const frameworkFilters = query.framework.split(',').map(f => f.trim().toLowerCase());
      projects = projects.filter(p => frameworkFilters.includes(p.framework));
    }

    // Search filter (case-insensitive on name/subdomain)
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      projects = projects.filter(p =>
        p.name.toLowerCase().includes(searchLower) ||
        p.subdomain?.toLowerCase().includes(searchLower) ||
        p.id.toLowerCase().includes(searchLower)
      );
    }

    // Apply sorting
    const sortField = query.sort_by || 'updated_at';
    const sortOrder = query.sort_order === 'asc' ? 1 : -1;

    projects.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case 'name':
          aVal = a.name?.toLowerCase() || '';
          bVal = b.name?.toLowerCase() || '';
          break;
        case 'created_at':
          aVal = a.created_at || '';
          bVal = b.created_at || '';
          break;
        case 'updated_at':
          aVal = a.updated_at || '';
          bVal = b.updated_at || '';
          break;
        case 'status':
          aVal = a.status || '';
          bVal = b.status || '';
          break;
        case 'framework':
          aVal = a.framework || '';
          bVal = b.framework || '';
          break;
        default:
          aVal = a.updated_at || '';
          bVal = b.updated_at || '';
      }

      if (aVal < bVal) return -1 * sortOrder;
      if (aVal > bVal) return 1 * sortOrder;
      return 0;
    });

    // Apply pagination
    const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
    const perPage = Math.max(1, parseInt(query.per_page || '20', 10) || 20);
    const startIndex = (page - 1) * perPage;
    const paginatedProjects = projects.slice(startIndex, startIndex + perPage);
    const totalPages = Math.ceil(projects.length / perPage);

    // ------------------------------------------------------------------------
    // Subdomain healing (manifest drift fix)
    //
    // The dashboard reads from the manifest fast-path. If a subdomain mapping was
    // created outside the v2 reserve endpoint (e.g. legacy /api/paste auto-register),
    // the manifest can lag behind and omit `subdomain`, causing the UI to show the
    // internal Worker/R2 deployment URL instead of `{subdomain}.gpthost.online`.
    //
    // To keep the manifest trustworthy without expensive KV scans, we:
    // 1) Derive the expected subdomain from the project name (same sanitization logic)
    // 2) Verify SUBDOMAIN_MAPPINGS has a mapping for that subdomain → this project id
    // 3) Persist the healed subdomain into the manifest (DO/KV) so future reads are correct
    // ------------------------------------------------------------------------
    const canHealSubdomains = Boolean(env.SUBDOMAIN_MAPPINGS) && (
      (env.ENABLE_SUBDOMAIN_ROUTING || '').toLowerCase() === 'true' || !!env.SUBDOMAIN_MAPPINGS
    );

    if (canHealSubdomains) {
      const baseDomain = env.BASE_DOMAIN || 'gpthost.online';
      const subdomainService = new SubdomainService(env);
      const healTargets = paginatedProjects.filter(p => !p.subdomain && p.name);

      if (healTargets.length > 0) {
        await Promise.all(healTargets.map(async (p) => {
          try {
            const candidate = subdomainService.generateSubdomain(p.name);
            if (!candidate) return;

            const mappingValue = await env.SUBDOMAIN_MAPPINGS!.get(candidate);
            if (!mappingValue) return;

            let mappedProjectId: string | null = null;
            try {
              const parsed = JSON.parse(mappingValue) as { projectId?: string };
              mappedProjectId = parsed?.projectId ?? null;
            } catch {
              mappedProjectId = mappingValue;
            }

            if (mappedProjectId !== p.id) return;

            const deploymentUrl = `https://${candidate}.${baseDomain}`;
            p.subdomain = candidate;
            p.deployment_url = deploymentUrl;

            await manifestService.updateSubdomain(ownerId, p.id, candidate, deploymentUrl);
          } catch (error) {
            console.warn('[API-PROJECT-LIST] Failed to heal subdomain from KV mapping', {
              ownerId,
              projectId: p.id,
              error: error instanceof Error ? error.message : 'Unknown'
            });
          }
        }));
      }
    }

    // Transform manifest summaries to response format
    const projectSummaries: ProjectSummary[] = paginatedProjects.map(p => ({
      id: p.id,
      name: p.name,
      framework: p.framework as FrameworkType,
      status: p.status as ProjectStatus,
      created_at: p.created_at,
      updated_at: p.updated_at,
      deployment_url: p.deployment_url || undefined,
      subdomain: p.subdomain || undefined,
      file_count: p.file_count
    }));

    const duration = Date.now() - startTime;
    console.info('[API-PROJECT-LIST] Served from manifest', {
      ownerId,
      totalProjects: manifest.projects.length,
      filteredProjects: projects.length,
      returnedProjects: paginatedProjects.length,
      durationMs: duration
    });

    return {
      projects: projectSummaries,
      pagination: {
        total_count: projects.length,
        page,
        per_page: perPage,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1
      },
      filters: {
        applied: extractAppliedFilters(query)
      },
      sorting: {
        sort_by: sortField,
        sort_order: query.sort_order || 'desc'
      },
      metadata: {
        source: 'manifest',
        manifest_updated_at: manifest.updated_at,
        total_projects: manifest.metadata.total_projects,
        active_projects: manifest.metadata.active_projects,
        building_projects: manifest.metadata.building_projects,
        failed_projects: manifest.metadata.failed_projects
      }
    };
  } catch (error) {
    console.error('[API-PROJECT-LIST] Manifest read failed, falling back to legacy', {
      ownerId,
      error: error instanceof Error ? error.message : 'Unknown'
    });
    return null; // Fall back to legacy path
  }
}

/**
 * Simplified Bulk Operations Handler
 * POST /api/projects/bulk
 */
export async function projectBulkHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[API-PROJECT-BULK] Processing simplified bulk operation request');

    const body = await request.json() as {
      operation: 'delete' | 'archive';
      project_ids: string[];
      dry_run?: boolean;
    };

    if (!body.operation || !body.project_ids || body.project_ids.length === 0) {
      return errorResponse(
        'INVALID_REQUEST',
        'Operation and project_ids are required',
        400,
        {
          required_fields: ['operation', 'project_ids'],
          supported_operations: ['delete', 'archive']
        }
      );
    }

    console.info('[API-PROJECT-BULK] Bulk operation details', {
      operation: body.operation,
      project_count: body.project_ids.length,
      dry_run: body.dry_run || false
    });

    // For dry run, just return what would be affected
    if (body.dry_run) {
      return successResponse({
        operation: body.operation,
        would_affect: {
          project_count: body.project_ids.length,
          project_ids: body.project_ids
        },
        dry_run: true
      });
    }

    // Use ServiceFactory to get project service
    const projectService = ServiceFactory.getProjectService(env);
    let successful = 0;
    let failed = 0;

    for (const projectId of body.project_ids) {
      try {
        if (body.operation === 'delete') {
          const result = await projectService.deleteProject(projectId);
          if (result.ok) {
            successful++;
          } else {
            failed++;
          }
        } else {
          // Archive operation - for simplified version, treat as delete
          const result = await projectService.deleteProject(projectId);
          if (result.ok) {
            successful++;
          } else {
            failed++;
          }
        }
      } catch (error) {
        console.error('[API-PROJECT-BULK] Failed to process project', {
          project_id: projectId,
          error: error instanceof Error ? error.message : String(error)
        });
        failed++;
      }
    }

    console.info('✅ [API-PROJECT-BULK] Bulk operation completed', {
      operation: body.operation,
      successful,
      failed,
      total_processed: body.project_ids.length
    });

    return successResponse({
      operation: body.operation,
      results: {
        successful,
        failed,
        total_requested: body.project_ids.length
      }
    });

  } catch (error) {
    console.error('[API-PROJECT-BULK] Bulk operation failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    return errorResponse(
      'BULK_OPERATION_FAILED',
      'Failed to execute bulk operation',
      500,
      {
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * Handle OPTIONS request for CORS - Project List
 */
export async function projectListOptionsHandler(request: Request, env: Env): Promise<Response> {
  return corsResponse();
}

/**
 * Handle OPTIONS request for CORS - Bulk Operations
 */
export async function projectBulkOptionsHandler(request: Request, env: Env): Promise<Response> {
  return corsResponse();
}
