/**
 * TASK-032: Project List API Implementation - Simplified MVP
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
  file_count?: number;
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
    });

    // Use ServiceFactory as specified in DAY3-TDD-STRATEGY.md
    const projectService = ServiceFactory.getProjectService(env);
    
    // Pull ALL projects from storage (avoid default 10-item limit inside service)
    const PAGE_SIZE = 1000;
    let offset = 0;
    let projects: any[] = [];
    while (true) {
      const pageResult = await projectService.listProjects({ limit: PAGE_SIZE, offset, ownerId });
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
    
    // Transform to summary format
    const projectSummaries = paginatedProjects.map(project => transformToProjectSummary(project));
    
    // Calculate metadata statistics
    const metadata = calculateMetadata(projects);
    
    // Build response
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
      metadata
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

/**
 * Transform project metadata to summary format
 */
function transformToProjectSummary(project: ProjectMetadata): ProjectSummary {
  // Normalize field names from mixed sources (camelCase vs snake_case)
  const createdAt = (project as any).created_at || (project as any).createdAt || new Date().toISOString();
  const updatedAt = (project as any).updated_at || (project as any).updatedAt || createdAt;
  const deploymentUrl = (project as any).deployment_url || (project as any).deploymentUrl;

  // Derive a frontend-friendly status that reflects deployment/build state
  let derivedStatus: any = project.status;

  // Prefer build metadata status when available
  const buildMeta: any = (project as any).build_metadata || {};
  const buildStatus: string | undefined = buildMeta.build_status;

  if (deploymentUrl) {
    derivedStatus = 'deployed';
  } else if (buildStatus === 'processing' || buildStatus === 'queued') {
    derivedStatus = 'building';
  } else if (buildStatus === 'failed' || buildStatus === 'timeout' || buildStatus === 'cancelled') {
    derivedStatus = 'failed';
  } else if ((project as any).status === 'active') {
    // 'active' here means present in the active directory but not necessarily deployed
    derivedStatus = 'pending';
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
function calculateMetadata(projects: any[]): ProjectListResponse['metadata'] {
  return {
    total_projects: projects.length,
    active_projects: projects.filter(p => p.status === 'deployed' || p.status === 'building').length,
    building_projects: projects.filter(p => p.status === 'building' || p.status === 'analyzing').length,
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
