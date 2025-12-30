/**
 * Admin API Router
 * Phase 1: Super Admin Dashboard - Foundation & Auth
 *
 * Handles all /api/admin/* routes with super admin authentication
 * All routes require super admin access via env-based allowlist
 */

import { validateV2Auth } from '../../../middleware/auth';
import { requireAdmin } from '../../../middleware/adminAuth';
import { v2Success, v2Error, getRequestId } from '../../../middleware/envelope';
import { addCorsHeaders } from '../../../middleware/cors';
import { addSecurityHeaders } from '../../../middleware/securityHeaders';
import {
  extractBearerToken,
  type AuthSuccessContext,
  type AuthenticatedRequest,
} from '../../../utils/authUtils';
import { ServiceFactory } from '../../../services/ServiceFactory';
import { createAdminStatsService } from '../../../services/AdminStatsService';
import { ProjectService } from '../../../services/ProjectService';
import { SubdomainService } from '../../../services/SubdomainService';
import { ManifestService, getManifestMetrics, resetManifestMetrics, getManifestKey, getAggregatedMetrics, persistMetricsToKV } from '../../../services/ManifestService';
import { triggerManualDriftCheck } from '../../../scheduled/manifestDriftCheck';
import type { IStorageService } from '../../../services/StorageService';
import type { Project } from '../../../domain/models';
import type { LogEvent } from '../../../utils/sharedLogger';
import { ProjectErrorCode, StorageErrorCode } from '../../../lib/errors';

/**
 * Phase 3: User Management Helper Functions
 */

interface UserListQuery {
  page: number;
  limit: number;
  search: string;
}

interface UserSummary {
  id: string;
  email?: string;
  projectCount: number;
  firstSeen: string;
}

interface UserListResponse {
  users: UserSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

/**
 * Lightweight helpers for mixed date shapes and Supabase admin fetches
 */
function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value as any);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function firstValidDate(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const parsed = parseDate(candidate);
    if (parsed) return parsed.toISOString();
  }
  return new Date().toISOString();
}

interface SupabaseUser {
  id: string;
  email?: string;
  created_at?: string;
}

async function fetchSupabaseUsers(
  env: Env,
  query: UserListQuery
): Promise<{ users: SupabaseUser[]; total: number; perPage: number; page: number } | null> {
  const supabaseUrl = (env as any).SUPABASE_URL as string | undefined;
  const serviceKey = (env as any).SUPABASE_SERVICE_ROLE_KEY as string | undefined;

  if (!supabaseUrl || !serviceKey) {
    return null;
  }

  try {
    const url = new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users`);
    const perPage = Math.max(1, query.limit || 50);
    const page = Math.max(1, query.page || 1);

    url.searchParams.set('per_page', perPage.toString());
    url.searchParams.set('page', page.toString());
    if (query.search) {
      url.searchParams.set('email', query.search);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[ADMIN] Supabase user fetch failed: ${response.status} ${errorText}`);
      return null;
    }

    const data = (await response.json()) as any;
    const users: SupabaseUser[] = Array.isArray(data.users) ? data.users : Array.isArray(data) ? data : [];
    const total = typeof data.total === 'number'
      ? data.total
      : typeof data.total_count === 'number'
        ? data.total_count
        : users.length;
    const perPageResponse = typeof data.per_page === 'number' ? data.per_page : perPage;
    const pageResponse = typeof data.page === 'number' ? data.page : page;

    return { users, total, perPage: perPageResponse, page: pageResponse };
  } catch (error) {
    console.error('[ADMIN] Failed to fetch Supabase users', error);
    return null;
  }
}

/**
 * Get list of users derived from project metadata
 */
async function getAdminUsers(
  storage: IStorageService,
  env: Env,
  query: UserListQuery
): Promise<UserListResponse> {
  const projectService = new ProjectService(storage);

  // Get all projects (no owner filter for admin)
  const projectsResult = await projectService.listProjects({ limit: 10000 });
  if (!projectsResult.ok) {
    throw new Error(`Failed to list projects: ${projectsResult.error.message}`);
  }

  const allProjects = projectsResult.value.projects;

  // Group projects by owner
  const userMap = new Map<string, { projects: Project[]; email?: string; firstSeen: Date }>();

  for (const project of allProjects) {
    const ownerId = (project as any).ownerId || (project as any).owner_id;
    if (!ownerId) continue;

    const ownerEmail = (project as any).ownerEmail || (project as any).owner_email;
    const createdAt = parseDate((project as any).createdAt || (project as any).created_at) || new Date();

    if (!userMap.has(ownerId)) {
      userMap.set(ownerId, { projects: [], email: ownerEmail, firstSeen: createdAt });
    }

    const userData = userMap.get(ownerId)!;
    userData.projects.push(project);

    // Update email if we didn't have one
    if (!userData.email && ownerEmail) {
      userData.email = ownerEmail;
    }

    // Update firstSeen if this project is older
    if (createdAt < userData.firstSeen) {
      userData.firstSeen = createdAt;
    }
  }

  // Prefer Supabase admin stream when credentials exist; fall back to derived owners
  const supabaseUsers = await fetchSupabaseUsers(env, query);

  let users: UserSummary[];
  let total = 0;
  let limit = query.limit || 50;
  let page = query.page || 1;

  if (supabaseUsers) {
    limit = supabaseUsers.perPage;
    page = supabaseUsers.page;
    total = supabaseUsers.total || supabaseUsers.users.length;

    users = supabaseUsers.users.map((u) => {
      const projectData = userMap.get(u.id);
      const firstSeen = firstValidDate(
        u.created_at,
        projectData?.firstSeen,
        projectData?.projects[0]?.createdAt,
        projectData?.projects[0] && (projectData.projects[0] as any).created_at
      );

      return {
        id: u.id,
        email: u.email,
        projectCount: projectData ? projectData.projects.length : 0,
        firstSeen,
      };
    });

    // Include owners present in projects but not the current Supabase page
    for (const [ownerId, data] of userMap.entries()) {
      if (!users.find((u) => u.id === ownerId)) {
        users.push({
          id: ownerId,
          email: data.email,
          projectCount: data.projects.length,
          firstSeen: data.firstSeen.toISOString(),
        });
      }
    }
  } else {
    users = Array.from(userMap.entries()).map(([id, data]) => ({
      id,
      email: data.email,
      projectCount: data.projects.length,
      firstSeen: data.firstSeen.toISOString(),
    }));
    total = users.length;
  }

  // Apply search filter
  if (query.search) {
    const searchLower = query.search.toLowerCase();
    users = users.filter(
      (u) =>
        u.id.toLowerCase().includes(searchLower) ||
        (u.email && u.email.toLowerCase().includes(searchLower))
    );
  }
  total = users.length;

  // Sort by project count (descending)
  users.sort((a, b) => b.projectCount - a.projectCount);

  // Apply pagination
  const pages = Math.max(1, Math.ceil(users.length / limit));
  const startIndex = (page - 1) * limit;
  const paginatedUsers = users.slice(startIndex, startIndex + limit);

  return {
    users: paginatedUsers,
    pagination: {
      page,
      limit,
      total,
      pages,
    },
  };
}

interface UserDetailResponse {
  profile: {
    id: string;
    email?: string;
    created_at?: string;
  };
  stats: {
    projectCount: number;
    subdomainCount: number;
    storageUsed: number;
  };
  projects: Array<{
    id: string;
    project_name: string;
    status: string;
    created_at: string;
  }>;
}

/**
 * Get detailed user information
 */
async function getAdminUserDetail(
  storage: IStorageService,
  env: Env,
  userId: string
): Promise<UserDetailResponse> {
  const projectService = new ProjectService(storage);
  const subdomainService = new SubdomainService(env);

  // Get all projects for this user
  const projectsResult = await projectService.listProjects({ limit: 10000 });
  if (!projectsResult.ok) {
    throw new Error(`Failed to list projects: ${projectsResult.error.message}`);
  }

  const userProjects = projectsResult.value.projects.filter((p) => {
    const ownerId = (p as any).ownerId || (p as any).owner_id;
    return ownerId === userId;
  });

  // Calculate stats
  let email: string | undefined;
  let createdAt: string | undefined;
  let storageUsed = 0;

  for (const project of userProjects) {
    const ownerEmail = (project as any).ownerEmail || (project as any).owner_email;
    if (!email && ownerEmail) {
      email = ownerEmail;
    }

    const projectCreatedAt = (project as any).createdAt || (project as any).created_at;
    if (!createdAt || (projectCreatedAt && new Date(projectCreatedAt) < new Date(createdAt))) {
      createdAt = projectCreatedAt;
    }

    // Estimate storage (rough approximation)
    storageUsed += 1024 * 1024; // 1MB per project as rough estimate
  }

  // Get subdomain count
  const subdomainMapResult = await subdomainService.listProjectSubdomainMap();
  let subdomainCount = 0;
  if (subdomainMapResult.ok) {
    for (const [, projectId] of subdomainMapResult.value) {
      if (userProjects.some((p) => p.id === projectId)) {
        subdomainCount++;
      }
    }
  }

  return {
    profile: {
      id: userId,
      email,
      created_at: createdAt,
    },
    stats: {
      projectCount: userProjects.length,
      subdomainCount,
      storageUsed,
    },
    projects: userProjects.map((p) => ({
      id: p.id,
      project_name: (p as any).name || 'Unnamed Project',
      status: p.status,
      created_at: (p as any).createdAt || (p as any).created_at || new Date().toISOString(),
    })),
  };
}

/**
 * Phase 3: Project Management Helper Functions
 */

interface ProjectListQuery {
  page: number;
  limit: number;
  status: string;
}

interface ProjectSummary {
  id: string;
  name: string;
  owner: string;
  framework: string;
  status: string;
  subdomain?: string;
  createdAt: string;
}

function deriveDeploymentSignals(project: Project): { status: string; deploymentUrl?: string } {
  const buildMeta: any = (project as any).build_metadata || (project as any).buildMetadata || {};
  const lastBuild: any = (project as any).last_build || {};
  const deploymentInfo: any = (project as any).deployment_info || {};
  const deploymentDetails: any = (project as any).deployment || {};

  const deploymentUrl =
    (project as any).deployment_url ||
    (project as any).deploymentUrl ||
    deploymentDetails.url ||
    deploymentInfo.public_url_base ||
    lastBuild.public_url_base;

  const statusCandidates = [
    buildMeta.build_status,
    buildMeta.status,
    deploymentInfo.status,
    lastBuild.status,
    project.status,
  ]
    .map((status) => (status ? status.toString().toLowerCase() : undefined))
    .filter(Boolean) as string[];

  const successSignals = new Set(['deployed', 'completed', 'success', 'succeeded', 'ready', 'active']);
  const failureSignals = new Set(['failed', 'timeout', 'cancelled', 'deployment_failed']);

  const hasSuccess = statusCandidates.some((s) => successSignals.has(s));
  const hasFailure = statusCandidates.some((s) => failureSignals.has(s));

  let derivedStatus = hasFailure
    ? 'failed'
    : hasSuccess
      ? 'deployed'
      : (project.status || 'pending').toLowerCase();

  if (
    deploymentUrl &&
    !hasFailure &&
    ['pending', 'queueing', 'scaffolding', 'scaffolded', 'building', 'deploying'].includes(derivedStatus)
  ) {
    derivedStatus = 'deployed';
  }

  return { status: derivedStatus, deploymentUrl };
}

interface ProjectListResponse {
  projects: ProjectSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

/**
 * Get list of projects with admin scope (bypasses owner filter)
 */
export function matchesAdminProjectStatus(status: string, filter?: string): boolean {
  if (!filter) return true;

  const normalizedStatus = (status || '').toLowerCase();
  const normalizedFilter = filter.toLowerCase();

  // Group related backend statuses under the same admin filter buckets
  const statusGroups: Record<string, string[]> = {
    deployed: ['deployed', 'ready'],
    building: ['building', 'deploying'],
    failed: ['failed'],
    pending: ['pending', 'queueing', 'queued', 'scaffolding', 'scaffolded', 'analyzing'],
  };

  if (statusGroups[normalizedFilter]) {
    return statusGroups[normalizedFilter].includes(normalizedStatus);
  }

  return normalizedStatus === normalizedFilter;
}

async function getAdminProjects(
  storage: IStorageService,
  env: Env,
  query: ProjectListQuery
): Promise<ProjectListResponse> {
  const projectService = new ProjectService(storage);
  const subdomainService = new SubdomainService(env);

  // Get all projects (no owner filter for admin)
  const projectsResult = await projectService.listProjects({ limit: 10000 });
  if (!projectsResult.ok) {
    throw new Error(`Failed to list projects: ${projectsResult.error.message}`);
  }

  const projects = projectsResult.value.projects;

  // Get subdomain mappings
  const subdomainMapResult = await subdomainService.listProjectSubdomainMap();
  const subdomainMap = new Map<string, string>();
  if (subdomainMapResult.ok) {
    for (const [projectId, subdomain] of subdomainMapResult.value) {
      subdomainMap.set(projectId, subdomain);
    }
  }

  // Convert to summaries
  const summaries: ProjectSummary[] = projects.map((p) => {
    const { status } = deriveDeploymentSignals(p);
    const createdAt = firstValidDate(
      (p as any).createdAt,
      (p as any).created_at,
      (p as any).metadata?.created_at,
      (p as any).updatedAt,
      (p as any).updated_at
    );

    return {
      id: p.id,
      name: (p as any).name || 'Unnamed Project',
      owner: (p as any).ownerEmail || (p as any).ownerId || 'Unknown',
      framework: p.framework || 'unknown',
      status,
      subdomain: subdomainMap.get(p.id),
      createdAt,
    };
  });

  // Apply status filter using derived status
  const filteredSummaries = query.status
    ? summaries.filter((p) => matchesAdminProjectStatus(p.status, query.status))
    : summaries;

  // Sort by creation date (newest first)
  filteredSummaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Apply pagination
  const total = filteredSummaries.length;
  const pages = Math.ceil(total / query.limit);
  const startIndex = (query.page - 1) * query.limit;
  const paginatedProjects = filteredSummaries.slice(startIndex, startIndex + query.limit);

  return {
    projects: paginatedProjects,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages,
    },
  };
}

type AdminProjectSourceResult =
  | {
      ok: true;
      data: {
        projectId: string;
        filename: string;
        path: string;
        size: number;
        contentType?: string;
        content: string;
        framework?: string;
      };
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

async function getAdminProjectSource(
  storage: IStorageService,
  projectId: string
): Promise<AdminProjectSourceResult> {
  const projectService = new ProjectService(storage);
  const projectResult = await projectService.getProject(projectId);

  if (!projectResult.ok) {
    const status = projectResult.error.code === ProjectErrorCode.NOT_FOUND ? 404 : 500;
    const code = projectResult.error.code === ProjectErrorCode.NOT_FOUND ? 'PROJECT_NOT_FOUND' : 'PROJECT_READ_FAILED';
    return { ok: false, status, code, message: projectResult.error.message };
  }

  const project = projectResult.value;
  const files = project.files || [];
  if (!files.length) {
    return { ok: false, status: 404, code: 'FILE_NOT_FOUND', message: 'Project has no source files saved' };
  }

  // Prefer a source/ file if present, otherwise fall back to the first file.
  const primaryFile =
    files.find((f) => f.path.includes('/source/')) ||
    files[0];

  const downloadResult = await storage.downloadFile(primaryFile.path);
  if (!downloadResult.ok) {
    const status = downloadResult.error.code === StorageErrorCode.NOT_FOUND ? 404 : 500;
    const code = downloadResult.error.code === StorageErrorCode.NOT_FOUND ? 'FILE_NOT_FOUND' : 'FILE_READ_FAILED';
    return { ok: false, status, code, message: downloadResult.error.message };
  }

  const buffer = downloadResult.value;
  const decoder = new TextDecoder();
  const content = decoder.decode(buffer);

  return {
    ok: true,
    data: {
      projectId: project.id,
      filename: primaryFile.path.split('/').pop() || primaryFile.path,
      path: primaryFile.path,
      size: buffer.byteLength,
      contentType: (primaryFile as any).contentType,
      content,
      framework: project.framework,
    },
  };
}

/**
 * Phase 4: Logs Management Helper Functions
 */

interface LogsQuery {
  page: number;
  limit: number;
  severity?: string;
  type?: string;
}

interface LogsResponse {
  logs: LogEvent[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

function deriveEventIdFromKey(key: string): string | undefined {
  const filename = key.split('/').pop();
  return filename?.replace('.json', '') || undefined;
}

/**
 * Get logs from R2 global events with filtering
 */
async function getAdminLogs(
  env: Env,
  query: LogsQuery
): Promise<LogsResponse> {
  const logs: LogEvent[] = [];

  // List global events from R2
  const listResult = await env.PROJECTS_BUCKET.list({
    prefix: 'global-events/',
    limit: 1000, // Fetch last 1000 events
  });

  // Fetch each event
  const fetchPromises = listResult.objects.map(async (obj) => {
    try {
      const eventObj = await env.PROJECTS_BUCKET.get(obj.key);
      if (eventObj) {
        const event = await eventObj.json() as LogEvent;
        const eventId = event.id ?? deriveEventIdFromKey(obj.key);

        if (!eventId) {
          return null;
        }

        const normalizedEvent: LogEvent = { ...event, id: eventId };

        // Apply filters
        if (query.severity && normalizedEvent.severity !== query.severity) {
          return null;
        }
        if (query.type && normalizedEvent.type !== query.type) {
          return null;
        }

        return normalizedEvent;
      }
    } catch (error) {
      console.warn('[ADMIN-LOGS] Failed to fetch event', {
        key: obj.key,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return null;
  });

  const results = await Promise.all(fetchPromises);
  logs.push(...results.filter((e): e is LogEvent => e !== null));

  // Sort by timestamp (newest first)
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Apply pagination
  const total = logs.length;
  const pages = Math.ceil(total / query.limit);
  const startIndex = (query.page - 1) * query.limit;
  const paginatedLogs = logs.slice(startIndex, startIndex + query.limit);

  return {
    logs: paginatedLogs,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages,
    },
  };
}

/**
 * Get a single log by ID
 */
async function getAdminLogDetail(
  env: Env,
  logId: string
): Promise<LogEvent | null> {
  try {
    // Try global events first
    const eventKey = `global-events/${logId}.json`;
    let eventObj = await env.PROJECTS_BUCKET.get(eventKey);

    if (eventObj) {
      const event = await eventObj.json() as LogEvent;
      return { ...event, id: event.id ?? logId };
    }

    // Try error logs
    const errorKey = `error-logs/global/${logId}.json`;
    eventObj = await env.PROJECTS_BUCKET.get(errorKey);

    if (eventObj) {
      const event = await eventObj.json() as LogEvent;
      return { ...event, id: event.id ?? logId };
    }

    return null;
  } catch (error) {
    console.error('[ADMIN-LOGS] Failed to fetch log detail', {
      logId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface UnsupportedPattern {
  framework: string;
  error: string;
  code: string;
  firstSeen: string;
  occurrences: number;
  codeHash: string;
}

interface UnsupportedPatternsResponse {
  patterns: UnsupportedPattern[];
  total: number;
  unique: number;
}

/**
 * Get unsupported code patterns with deduplication
 */
async function getUnsupportedPatterns(
  env: Env,
  framework?: string,
  limit: number = 50
): Promise<UnsupportedPatternsResponse> {
  const patternMap = new Map<string, UnsupportedPattern>();

  // List global events for unsupported_code type
  const listResult = await env.PROJECTS_BUCKET.list({
    prefix: 'global-events/',
    limit: 1000,
  });

  // Fetch and deduplicate patterns
  const fetchPromises = listResult.objects.map(async (obj) => {
    try {
      const eventObj = await env.PROJECTS_BUCKET.get(obj.key);
      if (eventObj) {
        const event = await eventObj.json() as LogEvent;

        // Filter for unsupported_code events
        if (event.type !== 'unsupported_code') {
          return;
        }

        // Apply framework filter
        const eventFramework = event.metadata?.framework;
        if (framework && eventFramework !== framework) {
          return;
        }

        // Use code hash for deduplication
        const codeHash = event.codeHash || event.metadata?.codeHash || '';
        if (!codeHash) return;

        if (patternMap.has(codeHash)) {
          // Increment occurrence count
          const existing = patternMap.get(codeHash)!;
          existing.occurrences++;

          // Update firstSeen if this is older
          if (new Date(event.timestamp) < new Date(existing.firstSeen)) {
            existing.firstSeen = event.timestamp;
          }
        } else {
          // New pattern
          patternMap.set(codeHash, {
            framework: eventFramework || 'unknown',
            error: event.metadata?.error || event.message,
            code: event.codeSnippet || event.metadata?.code || '',
            firstSeen: event.timestamp,
            occurrences: 1,
            codeHash,
          });
        }
      }
    } catch (error) {
      console.warn('[ADMIN-LOGS] Failed to process unsupported pattern', {
        key: obj.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await Promise.all(fetchPromises);

  // Convert to array and sort by occurrences (descending)
  let patterns = Array.from(patternMap.values());
  patterns.sort((a, b) => b.occurrences - a.occurrences);

  // Apply limit
  patterns = patterns.slice(0, limit);

  const totalOccurrences = Array.from(patternMap.values())
    .reduce((sum, p) => sum + p.occurrences, 0);

  return {
    patterns,
    total: totalOccurrences,
    unique: patternMap.size,
  };
}

interface FrequencyStats {
  total: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
}

/**
 * Get log frequency stats for a time period
 */
async function getLogFrequencyStats(
  env: Env,
  period: string = '24h'
): Promise<FrequencyStats> {
  const stats: FrequencyStats = {
    total: 0,
    bySeverity: {},
    byType: {},
  };

  // Calculate time window
  const now = Date.now();
  const periodMs = period === '24h' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const startTime = now - periodMs;

  // List and analyze events
  const listResult = await env.PROJECTS_BUCKET.list({
    prefix: 'global-events/',
    limit: 1000,
  });

  const fetchPromises = listResult.objects.map(async (obj) => {
    try {
      const eventObj = await env.PROJECTS_BUCKET.get(obj.key);
      if (eventObj) {
        const event = await eventObj.json() as LogEvent;

        // Check if within time window
        const eventTime = new Date(event.timestamp).getTime();
        if (eventTime < startTime) {
          return;
        }

        stats.total++;
        stats.bySeverity[event.severity] = (stats.bySeverity[event.severity] || 0) + 1;
        stats.byType[event.type] = (stats.byType[event.type] || 0) + 1;
      }
    } catch (error) {
      console.warn('[ADMIN-LOGS] Failed to process event for stats', {
        key: obj.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await Promise.all(fetchPromises);

  return stats;
}

/**
 * Admin router handler
 * Applies authentication and admin authorization to all admin routes
 */
export async function handleAdminRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response> {
  const requestId = getRequestId(request);
  const method = request.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    const response = new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
    return addSecurityHeaders(
      addCorsHeaders(response, request, env),
      env,
      request
    );
  }

  // Step 1: Authenticate the request
  // Allow an emergency SUPER_ADMIN_BEARER to bypass standard auth validation
  const bearerToken = extractBearerToken(request.headers.get('authorization'));
  const hasSuperAdminBypass =
    Boolean(env.SUPER_ADMIN_BEARER) && bearerToken === env.SUPER_ADMIN_BEARER;

  if (hasSuperAdminBypass) {
    const adminContext: AuthSuccessContext = {
      isValid: true,
      authType: 'super-admin-bearer',
      token: bearerToken,
      user: {
        id: 'super-admin-bearer',
        role: 'super-admin',
      },
    };
    (request as AuthenticatedRequest).authContext = adminContext;
  } else {
    const authResult = await validateV2Auth(request, env, requestId);
    if (authResult.response) {
      return addSecurityHeaders(
        addCorsHeaders(authResult.response, request, env),
        env,
        request
      );
    }
  }

  // Step 2: Require admin authorization
  const adminCheck = requireAdmin(request, env, requestId);
  if (adminCheck) {
    return addSecurityHeaders(
      addCorsHeaders(adminCheck, request, env),
      env,
      request
    );
  }

  // Route admin requests
  try {
    let response: Response;

    // Health check endpoint
    if (pathname === '/api/admin/health' && method === 'GET') {
      response = v2Success({
        status: 'ok',
        timestamp: new Date().toISOString(),
        message: 'Admin API is operational',
      }, requestId);
    }
    // Platform stats endpoint
    else if (pathname === '/api/admin/stats/overview' && method === 'GET') {
      const storage = ServiceFactory.getStorageService(env);
      const statsService = createAdminStatsService(storage, env);

      const stats = await statsService.getPlatformStats();
      response = v2Success(stats, requestId);
    }
    // Activity feed endpoint
    else if (pathname === '/api/admin/stats/activity' && method === 'GET') {
      const url = new URL(request.url);
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);

      const storage = ServiceFactory.getStorageService(env);
      const statsService = createAdminStatsService(storage, env);

      const activity = await statsService.getActivityFeed(limit);
      response = v2Success(activity, requestId);
    }
    // User management endpoints (Phase 3)
    else if (pathname === '/api/admin/users' && method === 'GET') {
      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const search = url.searchParams.get('search') || '';

      const storage = ServiceFactory.getStorageService(env);

      const users = await getAdminUsers(storage, env, { page, limit, search });
      response = v2Success(users, requestId);
    }
    else if (pathname.startsWith('/api/admin/users/') && method === 'GET') {
      const userId = pathname.split('/api/admin/users/')[1];

      const storage = ServiceFactory.getStorageService(env);

      const userDetail = await getAdminUserDetail(storage, env, userId);
      response = v2Success(userDetail, requestId);
    }
    // Project management endpoints (Phase 3)
    else if (pathname === '/api/admin/projects' && method === 'GET') {
      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const status = url.searchParams.get('status') || '';

      const storage = ServiceFactory.getStorageService(env);

      const projects = await getAdminProjects(storage, env, { page, limit, status });
      response = v2Success(projects, requestId);
    }
    else if (pathname.match(/^\/api\/admin\/projects\/[^/]+\/source$/) && method === 'GET') {
      const projectId = pathname.split('/api/admin/projects/')[1]?.split('/')[0];

      if (!projectId) {
        response = v2Error('INVALID_REQUEST', 'Project ID is required', 400, requestId);
      } else {
        const storage = ServiceFactory.getStorageService(env);
        const sourceResult = await getAdminProjectSource(storage, projectId);

        if (!sourceResult.ok) {
          response = v2Error(sourceResult.code, sourceResult.message, sourceResult.status, requestId);
        } else {
          response = v2Success(sourceResult.data, requestId);
        }
      }
    }
    // Phase 4: Logs endpoints
    else if (pathname === '/api/admin/logs' && method === 'GET') {
      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const severity = url.searchParams.get('severity') || '';
      const type = url.searchParams.get('type') || '';

      const logs = await getAdminLogs(env, {
        page,
        limit,
        severity: severity || undefined,
        type: type || undefined,
      });
      response = v2Success(logs, requestId);
    }
    else if (pathname.startsWith('/api/admin/logs/') && !pathname.includes('/stats/') && !pathname.includes('/unsupported/') && !pathname.endsWith('/full-code') && method === 'GET') {
      const logId = pathname.split('/api/admin/logs/')[1];

      const logDetail = await getAdminLogDetail(env, logId);
      if (!logDetail) {
        response = v2Error(
          'NOT_FOUND',
          `Log not found: ${logId}`,
          404,
          requestId
        );
      } else {
        response = v2Success(logDetail, requestId);
      }
    }
    // Fetch full code for a log entry (when code was truncated)
    else if (pathname.match(/^\/api\/admin\/logs\/[^/]+\/full-code$/) && method === 'GET') {
      const pathParts = pathname.split('/');
      const logId = pathParts[4]; // /api/admin/logs/{logId}/full-code

      const fullCodeKey = `global-events/${logId}-full-code.txt`;
      const fullCodeObj = await env.PROJECTS_BUCKET.get(fullCodeKey);

      if (fullCodeObj) {
        const fullCode = await fullCodeObj.text();
        response = v2Success({ fullCode }, requestId);
      } else {
        response = v2Error(
          'NOT_FOUND',
          'Full code not available for this log entry',
          404,
          requestId
        );
      }
    }
    else if (pathname === '/api/admin/logs/unsupported/patterns' && method === 'GET') {
      const url = new URL(request.url);
      const framework = url.searchParams.get('framework') || '';
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);

      const patterns = await getUnsupportedPatterns(
        env,
        framework || undefined,
        limit
      );
      response = v2Success(patterns, requestId);
    }
    else if (pathname === '/api/admin/logs/stats/frequency' && method === 'GET') {
      const url = new URL(request.url);
      const period = url.searchParams.get('period') || '24h';

      const stats = await getLogFrequencyStats(env, period);
      response = v2Success(stats, requestId);
    }
    // ========================================================================
    // Phase 3: Manifest Observability & Admin Endpoints
    // ========================================================================

    // GET /api/admin/manifest/metrics - Get aggregated manifest metrics (current + historical)
    // In DO mode, ownerId query param is REQUIRED for accurate metrics
    else if (pathname === '/api/admin/manifest/metrics' && method === 'GET') {
      const metricsUrl = new URL(request.url);
      const hoursBack = parseInt(metricsUrl.searchParams.get('hours') || '24', 10);
      const ownerId = metricsUrl.searchParams.get('ownerId');

      // In DO mode, ownerId is required - global aggregation not yet supported
      if (env.MANIFEST_DO && !ownerId) {
        response = v2Success({
          message: 'Durable Object mode is active. Provide ownerId query parameter for per-owner metrics.',
          hint: 'GET /api/admin/manifest/metrics?ownerId=<owner-id>&hours=24',
          mode: 'durable-object',
          note: 'Global aggregation across all owners is not yet supported in DO mode.',
          timestamp: new Date().toISOString()
        }, requestId);
      }
      // Route through DO if ownerId provided and DO available
      else if (ownerId && env.MANIFEST_DO) {
        try {
          const id = env.MANIFEST_DO.idFromName(ownerId);
          const stub = env.MANIFEST_DO.get(id);
          const doMetrics = await stub.getAggregatedMetrics(hoursBack);

          response = v2Success({
            current: {
              manifestHits: doMetrics.current.hits,
              manifestMisses: doMetrics.current.misses,
              rebuilds: doMetrics.current.rebuilds,
              migrations: doMetrics.current.migrations,
              casRetries: 0,  // Not applicable in DO mode
              casFailures: 0  // Not applicable in DO mode
            },
            historical: {
              manifestHits: doMetrics.historical.hits,
              manifestMisses: doMetrics.historical.misses,
              rebuilds: doMetrics.historical.rebuilds,
              migrations: doMetrics.historical.migrations,
              casRetries: 0,
              casFailures: 0
            },
            combined: {
              manifestHits: doMetrics.current.hits + doMetrics.historical.hits,
              manifestMisses: doMetrics.current.misses + doMetrics.historical.misses,
              rebuilds: doMetrics.current.rebuilds + doMetrics.historical.rebuilds,
              migrations: doMetrics.current.migrations + doMetrics.historical.migrations,
              hitRate: doMetrics.hitRate,
              totalReads: doMetrics.totalReads
            },
            ownerId,
            source: 'durable-object',
            timestamp: new Date().toISOString()
          }, requestId);
        } catch (error) {
          // Fall through to KV if DO call fails
          console.warn('[Admin] DO metrics failed, falling back to KV', {
            ownerId,
            error: error instanceof Error ? error.message : 'Unknown'
          });
        }
      }

      // Fallback: in-memory only if KV not configured
      if (!response && !env.PROJECT_LIST_MANIFEST) {
        const metrics = getManifestMetrics();
        const totalReads = metrics.manifestHits + metrics.manifestMisses;
        const hitRate = totalReads > 0
          ? (metrics.manifestHits / totalReads * 100).toFixed(2)
          : '0.00';

        response = v2Success({
          metrics: {
            ...metrics,
            hitRate: `${hitRate}%`,
            totalReads
          },
          source: 'in-memory-only',
          timestamp: new Date().toISOString()
        }, requestId);
      }

      // Fallback: KV aggregation
      if (!response && env.PROJECT_LIST_MANIFEST) {
        const aggregated = await getAggregatedMetrics(env.PROJECT_LIST_MANIFEST, hoursBack);

        response = v2Success({
          current: aggregated.current,
          historical: aggregated.historical,
          combined: {
            manifestHits: aggregated.current.manifestHits + aggregated.historical.manifestHits,
            manifestMisses: aggregated.current.manifestMisses + aggregated.historical.manifestMisses,
            rebuilds: aggregated.current.rebuilds + aggregated.historical.rebuilds,
            casRetries: aggregated.current.casRetries + aggregated.historical.casRetries,
            casFailures: aggregated.current.casFailures + aggregated.historical.casFailures,
            hitRate: aggregated.hitRate,
            totalReads: aggregated.totalReads
          },
          hoursIncluded: aggregated.hoursIncluded,
          source: 'kv-aggregated',
          timestamp: new Date().toISOString()
        }, requestId);
      }
    }
    // POST /api/admin/manifest/metrics/reset - Reset metrics (for testing)
    else if (pathname === '/api/admin/manifest/metrics/reset' && method === 'POST') {
      resetManifestMetrics();
      response = v2Success({
        message: 'Manifest metrics reset successfully',
        timestamp: new Date().toISOString()
      }, requestId);
    }
    // GET /api/admin/manifest/drift-report - Get latest drift report
    else if (pathname === '/api/admin/manifest/drift-report' && method === 'GET') {
      if (!env.PROJECT_LIST_MANIFEST) {
        response = v2Error(
          'NOT_CONFIGURED',
          'PROJECT_LIST_MANIFEST KV namespace not configured',
          503,
          requestId
        );
      } else {
        const report = await env.PROJECT_LIST_MANIFEST.get('drift_report:latest', { type: 'json' });

        if (!report) {
          response = v2Success({
            message: 'No drift report available',
            lastRun: null
          }, requestId);
        } else {
          response = v2Success(report, requestId);
        }
      }
    }
    // POST /api/admin/manifest/drift-check - Trigger manual drift check
    else if (pathname === '/api/admin/manifest/drift-check' && method === 'POST') {
      if (!env.PROJECT_LIST_MANIFEST) {
        response = v2Error(
          'NOT_CONFIGURED',
          'PROJECT_LIST_MANIFEST KV namespace not configured',
          503,
          requestId
        );
      } else {
        // Create a minimal execution context for the drift check
        const mockCtx: ExecutionContext = {
          waitUntil: (promise: Promise<any>) => { /* no-op for sync admin calls */ },
          passThroughOnException: () => {}
        };

        try {
          // Run drift check (this may take a while for large tenant bases)
          await triggerManualDriftCheck(env, mockCtx);

          response = v2Success({
            message: 'Drift check completed',
            note: 'Check /api/admin/manifest/drift-report for results'
          }, requestId);
        } catch (error) {
          response = v2Error(
            'DRIFT_CHECK_FAILED',
            `Drift check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            500,
            requestId
          );
        }
      }
    }
    // POST /api/admin/manifest/rebuild/:ownerId - Rebuild specific owner's manifest
    else if (pathname.match(/^\/api\/admin\/manifest\/rebuild\/[^/]+$/) && method === 'POST') {
      const ownerId = pathname.split('/api/admin/manifest/rebuild/')[1];
      let ownerAliases: string[] | undefined;
      try {
        const body = await request.json();
        if (body && Array.isArray(body.ownerAliases)) {
          ownerAliases = body.ownerAliases
            .map((alias: unknown) => typeof alias === 'string' ? alias : '')
            .filter(Boolean);
        }
      } catch {
        // Ignore body parse errors; treat as empty body
      }

      if (!env.PROJECT_LIST_MANIFEST) {
        response = v2Error(
          'NOT_CONFIGURED',
          'PROJECT_LIST_MANIFEST KV namespace not configured',
          503,
          requestId
        );
      } else {
        try {
          const storage = ServiceFactory.getStorageService(env);
          const manifestService = new ManifestService(env);

          const manifest = await manifestService.rebuildManifest(ownerId, storage, {
            ownerAliases
          });
          response = v2Success({
            message: 'Manifest rebuilt successfully',
            ownerId,
            projectCount: manifest.projects.length,
            updatedAt: manifest.updated_at
          }, requestId);
        } catch (error) {
          response = v2Error(
            'REBUILD_FAILED',
            `Failed to rebuild manifest: ${error instanceof Error ? error.message : 'Unknown error'}`,
            500,
            requestId
          );
        }
      }
    }
    // GET /api/admin/manifest/:ownerId - Get manifest for debugging
    else if (pathname.match(/^\/api\/admin\/manifest\/[^/]+$/) && method === 'GET' && !pathname.includes('/metrics') && !pathname.includes('/drift-')) {
      const ownerId = pathname.split('/api/admin/manifest/')[1];

      if (!env.PROJECT_LIST_MANIFEST) {
        response = v2Error(
          'NOT_CONFIGURED',
          'PROJECT_LIST_MANIFEST KV namespace not configured',
          503,
          requestId
        );
      } else {
        try {
          const manifestService = new ManifestService(env);
          const manifest = await manifestService.getManifest(ownerId);

          if (!manifest) {
            response = v2Error(
              'NOT_FOUND',
              `Manifest not found for owner: ${ownerId}`,
              404,
              requestId
            );
          } else {
            response = v2Success({
              manifest,
              key: getManifestKey(ownerId)
            }, requestId);
          }
        } catch (error) {
          response = v2Error(
            'FETCH_FAILED',
            `Failed to get manifest: ${error instanceof Error ? error.message : 'Unknown error'}`,
            500,
            requestId
          );
        }
      }
    }
    // DELETE /api/admin/manifest/:ownerId - Delete manifest (cleanup)
    else if (pathname.match(/^\/api\/admin\/manifest\/[^/]+$/) && method === 'DELETE') {
      const ownerId = pathname.split('/api/admin/manifest/')[1];

      if (!env.PROJECT_LIST_MANIFEST) {
        response = v2Error(
          'NOT_CONFIGURED',
          'PROJECT_LIST_MANIFEST KV namespace not configured',
          503,
          requestId
        );
      } else {
        try {
          const manifestService = new ManifestService(env);
          await manifestService.deleteManifest(ownerId);

          response = v2Success({
            message: 'Manifest deleted',
            ownerId
          }, requestId);
        } catch (error) {
          response = v2Error(
            'DELETE_FAILED',
            `Failed to delete manifest: ${error instanceof Error ? error.message : 'Unknown error'}`,
            500,
            requestId
          );
        }
      }
    }
    // End of manifest endpoints

    // ========================================================================
    // Phase 3: Resource Proxy Monitoring & Control
    // ========================================================================

    // GET /api/admin/proxy/stats - Get aggregated proxy statistics
    else if (pathname === '/api/admin/proxy/stats' && method === 'GET') {
      const { createProxyStatsService } = await import('../../../services/ProxyStatsService');
      const statsService = createProxyStatsService(env);

      if (!statsService) {
        response = v2Error(
          'NOT_CONFIGURED',
          'Proxy stats service not available (missing KV namespace)',
          503,
          requestId
        );
      } else {
        const stats = await statsService.getProxyStats();
        response = v2Success(stats, requestId);
      }
    }

    // GET /api/admin/proxy/project/:projectId - Get project-specific proxy analytics
    else if (pathname.match(/^\/api\/admin\/proxy\/project\/[^/]+$/) && method === 'GET') {
      const projectId = pathname.split('/api/admin/proxy/project/')[1];
      const { createProxyStatsService } = await import('../../../services/ProxyStatsService');
      const statsService = createProxyStatsService(env);

      if (!statsService) {
        response = v2Error(
          'NOT_CONFIGURED',
          'Proxy stats service not available',
          503,
          requestId
        );
      } else {
        const analytics = await statsService.getProjectProxyAnalytics(projectId);
        response = v2Success(analytics, requestId);
      }
    }

    // GET /api/admin/proxy/hosts - List all host policies
    else if (pathname === '/api/admin/proxy/hosts' && method === 'GET') {
      const url = new URL(request.url);
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      const { createProxyStatsService } = await import('../../../services/ProxyStatsService');
      const statsService = createProxyStatsService(env);

      if (!statsService) {
        response = v2Error(
          'NOT_CONFIGURED',
          'Proxy stats service not available',
          503,
          requestId
        );
      } else {
        const policies = await statsService.listHostPolicies(limit);
        response = v2Success({ policies, count: policies.length }, requestId);
      }
    }

    // POST /api/admin/proxy/hosts/:host/block - Block a host
    else if (pathname.match(/^\/api\/admin\/proxy\/hosts\/[^/]+\/block$/) && method === 'POST') {
      const host = decodeURIComponent(pathname.split('/api/admin/proxy/hosts/')[1].replace('/block', ''));
      const body = await request.json().catch(() => ({}));
      const reason = (body as any).reason || 'Blocked by admin';
      const adminId = authContext.userId || 'admin';

      const { createProxyStatsService } = await import('../../../services/ProxyStatsService');
      const statsService = createProxyStatsService(env);

      if (!statsService) {
        response = v2Error('NOT_CONFIGURED', 'Proxy stats service not available', 503, requestId);
      } else {
        const result = await statsService.setHostPolicy(host, 'blocked', reason, adminId);
        if (result.ok) {
          response = v2Success({ message: 'Host blocked', policy: result.value }, requestId);
        } else {
          response = v2Error('OPERATION_FAILED', result.error.message, 500, requestId);
        }
      }
    }

    // POST /api/admin/proxy/hosts/:host/allow - Allow a host
    else if (pathname.match(/^\/api\/admin\/proxy\/hosts\/[^/]+\/allow$/) && method === 'POST') {
      const host = decodeURIComponent(pathname.split('/api/admin/proxy/hosts/')[1].replace('/allow', ''));
      const body = await request.json().catch(() => ({}));
      const reason = (body as any).reason || 'Allowed by admin';
      const adminId = authContext.userId || 'admin';

      const { createProxyStatsService } = await import('../../../services/ProxyStatsService');
      const statsService = createProxyStatsService(env);

      if (!statsService) {
        response = v2Error('NOT_CONFIGURED', 'Proxy stats service not available', 503, requestId);
      } else {
        const result = await statsService.setHostPolicy(host, 'allowed', reason, adminId);
        if (result.ok) {
          response = v2Success({ message: 'Host allowed', policy: result.value }, requestId);
        } else {
          response = v2Error('OPERATION_FAILED', result.error.message, 500, requestId);
        }
      }
    }

    // GET /api/admin/proxy/cache - List cached resources
    else if (pathname === '/api/admin/proxy/cache' && method === 'GET') {
      const url = new URL(request.url);
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const { createProxyStatsService } = await import('../../../services/ProxyStatsService');
      const statsService = createProxyStatsService(env);

      if (!statsService) {
        response = v2Error('NOT_CONFIGURED', 'Proxy stats service not available', 503, requestId);
      } else {
        const cached = await statsService.listCachedResources(limit);
        response = v2Success(cached, requestId);
      }
    }

    // DELETE /api/admin/proxy/cache/url - Clear a specific cached URL
    else if (pathname === '/api/admin/proxy/cache/url' && method === 'DELETE') {
      const body = await request.json().catch(() => ({}));
      const url = (body as any).url;

      if (!url) {
        response = v2Error('INVALID_REQUEST', 'URL is required', 400, requestId);
      } else {
        const { createProxyStatsService } = await import('../../../services/ProxyStatsService');
        const statsService = createProxyStatsService(env);

        if (!statsService) {
          response = v2Error('NOT_CONFIGURED', 'Proxy stats service not available', 503, requestId);
        } else {
          const result = await statsService.clearCachedUrl(url);
          if (result.ok) {
            response = v2Success({ message: 'Cache cleared', url }, requestId);
          } else {
            response = v2Error('OPERATION_FAILED', result.error.message, 500, requestId);
          }
        }
      }
    }

    // DELETE /api/admin/proxy/cache/project/:projectId - Clear all cache for a project
    else if (pathname.match(/^\/api\/admin\/proxy\/cache\/project\/[^/]+$/) && method === 'DELETE') {
      const projectId = pathname.split('/api/admin/proxy/cache/project/')[1];
      const { createProxyStatsService } = await import('../../../services/ProxyStatsService');
      const statsService = createProxyStatsService(env);

      if (!statsService) {
        response = v2Error('NOT_CONFIGURED', 'Proxy stats service not available', 503, requestId);
      } else {
        const result = await statsService.clearProjectCache(projectId);
        if (result.ok) {
          response = v2Success({ message: 'Project cache cleared', projectId, deletedCount: result.value }, requestId);
        } else {
          response = v2Error('OPERATION_FAILED', result.error.message, 500, requestId);
        }
      }
    }

    // End of proxy admin endpoints

    // Audit projects for owner ID migration
    else if (method === 'GET' && pathname === '/api/admin/audit-projects') {
      const { handleAuditProjects } = await import('../../audit');
      return await handleAuditProjects(request, env);
    }

    // Migrate owner IDs for legacy projects
    else if (method === 'POST' && pathname === '/api/admin/migrate-owner-ids') {
      const { handleMigrateOwnerIds } = await import('../../migrate');
      return await handleMigrateOwnerIds(request, env);
    }

    else {
      response = v2Error(
        'NOT_FOUND',
        `Admin endpoint not found: ${method} ${pathname}`,
        404,
        requestId
      );
    }

    return addSecurityHeaders(
      addCorsHeaders(response, request, env),
      env,
      request
    );
  } catch (error: any) {
    console.error('[ADMIN] Error handling admin route:', error);
    const errorResponse = v2Error(
      'INTERNAL_ERROR',
      'An error occurred processing the admin request',
      500,
      requestId
    );
    return addSecurityHeaders(
      addCorsHeaders(errorResponse, request, env),
      env,
      request
    );
  }
}
