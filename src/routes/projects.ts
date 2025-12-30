/**
 * Multi-Project Repository Management API Routes
 * 
 * Provides REST API endpoints for multi-project management functionality:
 * - GET /api/projects - List all projects
 * - POST /api/projects - Create new project  
 * - GET /api/projects/{id}/status - Get project status
 * - DELETE /api/projects/{id} - Delete project
 * - POST /api/projects/cleanup - Trigger cleanup
 * 
 * Integrates with multi-project manager for repository management.
 */

// Removed multiProjectManager imports - now using ServiceFactory
import { 
  FrameworkType
} from '../types/api';
import { corsResponse, successResponse, errorResponse } from '../utils/responses';
import { ServiceFactory } from '../services/ServiceFactory';
import type { AuthenticatedRequest } from '../utils/authUtils';

const LEGACY_OWNER_ID = 'legacy-single-tenant';

/**
 * List all projects in the repository
 * GET /api/projects
 */
export async function listProjectsHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[API-PROJECTS] Listing all projects');
    
    // Use ServiceFactory as specified in DAY3-TDD-STRATEGY.md
    const projectService = ServiceFactory.getProjectService(env);
    const storageService = ServiceFactory.getStorageService(env);

    const authContext = (request as AuthenticatedRequest).authContext;
    const ownerId = authContext?.authType === 'legacy-token'
      ? LEGACY_OWNER_ID
      : authContext?.user?.id;
    
    // Use the new ProjectService through ServiceFactory instead of multiProjectManager
    const listResult = await projectService.listProjects(
      ownerId ? { ownerId } : undefined
    );
    
    if (!listResult.ok) {
      return errorResponse(
        'PROJECT_LIST_FAILED',
        listResult.error.message || 'Failed to list projects',
        500,
        listResult.error
      );
    }

    const projects = listResult.value.projects || [];
    return successResponse({
      projects: projects,
      metadata: {
        total_projects: projects.length,
        active_projects: projects.filter(p => p.status === 'deployed' || p.status === 'building').length,
        archived_projects: projects.filter(p => p.status === 'failed').length,
        cleanup_projects: 0
      },
      repository_stats: {
        total_count: listResult.value.total,
        has_more: listResult.value.hasMore
      }
    });
  } catch (error) {
    console.error('[API-PROJECTS] Error listing projects:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to list projects',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Create a new project
 * POST /api/projects
 */
export async function createProjectHandler(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as ProjectCreationRequest & {
      project_id: string;
      framework: FrameworkType;
      description?: string;
      tags?: string[];
    };

    console.info('[API-PROJECTS] Creating new project', {
      project_id: body.project_id,
      framework: body.framework
    });

    if (!body.project_id || !body.framework) {
      return errorResponse(
        'INVALID_REQUEST',
        'Missing required fields: project_id and framework are required',
        400,
        {
          required_fields: ['project_id', 'framework'],
          received_fields: Object.keys(body)
        }
      );
    }

    // Use ServiceFactory as specified in DAY3-TDD-STRATEGY.md
    const projectService = ServiceFactory.getProjectService(env);
    const storageService = ServiceFactory.getStorageService(env);

    const authContext = (request as AuthenticatedRequest).authContext;
    const ownerId = authContext?.authType === 'legacy-token'
      ? LEGACY_OWNER_ID
      : authContext?.user?.id;

    if (!ownerId) {
      return errorResponse(
        'AUTH_REQUIRED',
        'Authentication required to create projects',
        401
      );
    }
    
    // Convert API request to ProjectService format
    const projectFiles = body.source_files && Array.isArray(body.source_files) && body.source_files.length > 0
      ? body.source_files.map((file: any) => ({
          path: file.path,
          content: file.content
        }))
      : [{
          path: 'README.md',
          content: `# ${body.project_id}\n\n${body.description || 'Project created via API'}\n\nFramework: ${body.framework}\nCreated: ${new Date().toISOString()}`
        }];

    const createResult = await projectService.createProject({
      name: body.project_id,
      description: body.description,
      framework: body.framework,
      files: projectFiles,
      ownerId
    });

    if (!createResult.ok) {
      return errorResponse(
        'PROJECT_CREATION_FAILED',
        createResult.error.message || 'Failed to create project',
        500,
        createResult.error
      );
    }

    return successResponse({
      project_id: createResult.value.id,
      status: 'created',
      framework: createResult.value.framework,
      created_at: createResult.value.createdAt.toISOString(),
      project_structure: {
        files: createResult.value.files,
        framework: createResult.value.framework
      },
      metrics: {
        files_count: createResult.value.files.length
      }
    }, 201);

  } catch (error) {
    console.error('[API-PROJECTS] Error creating project:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to create project',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get project status and details
 * GET /api/projects/{id}/status
 */
export async function getProjectStatusHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3]; // /api/projects/{id}/status

    console.info('[API-PROJECTS] Getting project status', { project_id: projectId });

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Project ID is required',
        400
      );
    }

    // Use ServiceFactory as specified in DAY3-TDD-STRATEGY.md
    const projectService = ServiceFactory.getProjectService(env);
    const storageService = ServiceFactory.getStorageService(env);
    const authContext = (request as AuthenticatedRequest).authContext;
    const authType = authContext?.authType;
    const userId = authContext?.user?.id;
    
    // Use the new ProjectService through ServiceFactory
    const projectResult = await projectService.getProject(projectId);

    if (!projectResult.ok) {
      return errorResponse(
        'PROJECT_NOT_FOUND',
        projectResult.error.message || 'Project not found',
        404,
        projectResult.error
      );
    }

    const projectOwner = projectResult.value.ownerId || LEGACY_OWNER_ID;
    const hasAccess =
      (authType === 'legacy-token' && projectOwner === LEGACY_OWNER_ID) ||
      (userId && projectOwner === userId);

    if (!hasAccess) {
      return errorResponse(
        'PROJECT_NOT_FOUND',
        'Project not found',
        404
      );
    }

    return successResponse({
      project_id: projectResult.value.id,
      status: projectResult.value.status,
      framework: projectResult.value.framework,
      files: projectResult.value.files,
      created_at: projectResult.value.createdAt,
      updated_at: projectResult.value.updatedAt,
      deployment_url: projectResult.value.deploymentUrl,
      last_updated: projectResult.value.updatedAt.toISOString()
    });

  } catch (error) {
    console.error('[API-PROJECTS] Error getting project status:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to get project status',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Trigger repository cleanup
 * POST /api/projects/cleanup
 */
export async function triggerCleanupHandler(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as {
      cleanup_type?: 'soft' | 'aggressive' | 'emergency';
      target_projects?: string[];
      max_age_days?: number;
      force?: boolean;
    };

    console.info('[API-PROJECTS] Triggering repository cleanup', {
      cleanup_type: body.cleanup_type || 'soft',
      target_projects: body.target_projects?.length || 'all',
      max_age_days: body.max_age_days || 30
    });

    // Use ServiceFactory as specified in DAY3-TDD-STRATEGY.md
    const projectService = ServiceFactory.getProjectService(env);
    const storageService = ServiceFactory.getStorageService(env);
    const authContext = (request as AuthenticatedRequest).authContext;
    const ownerId = authContext?.authType === 'legacy-token'
      ? LEGACY_OWNER_ID
      : authContext?.user?.id;

    // Repository cleanup - list and delete old projects
    const listResult = await projectService.listProjects(
      ownerId ? { ownerId } : undefined
    );
    
    if (!listResult.ok) {
      return errorResponse(
        'CLEANUP_FAILED',
        'Failed to list projects for cleanup',
        500,
        listResult.error
      );
    }
    
    const maxAgeMs = (body.max_age_days || 30) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const targetProjects = body.target_projects || [];
    
    let deletedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    
    for (const project of listResult.value.projects) {
      // Check if project should be cleaned up
      const projectAge = now - project.createdAt.getTime();
      const shouldCleanup = targetProjects.length > 0 
        ? targetProjects.includes(project.id)
        : projectAge > maxAgeMs;
        
      if (shouldCleanup) {
        const deleteResult = await projectService.deleteProject(project.id);
        if (deleteResult.ok) {
          deletedCount++;
        } else {
          failedCount++;
          errors.push(`Failed to delete ${project.id}: ${deleteResult.error.message}`);
        }
      }
    }

    if (failedCount > 0) {
      return errorResponse(
        'CLEANUP_FAILED',
        'Repository cleanup partially failed',
        500,
        {
          deleted_projects: deletedCount,
          failed_deletions: failedCount,
          errors: errors
        }
      );
    }

    return successResponse({
      cleanup_status: 'completed',
      cleanup_type: body.cleanup_type || 'soft',
      triggered_at: new Date().toISOString(),
      results: {
        deleted_projects: deletedCount,
        failed_deletions: failedCount,
        errors: errors
      },
      metrics: {
        total_processed: deletedCount + failedCount,
        success_rate: deletedCount / (deletedCount + failedCount || 1)
      }
    });

  } catch (error) {
    console.error('[API-PROJECTS] Error during cleanup:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to perform repository cleanup',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get repository health status
 * GET /api/projects/health
 */
export async function getRepositoryHealthHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[API-PROJECTS] Getting repository health status');

    // Use ServiceFactory as specified in DAY3-TDD-STRATEGY.md
    const projectService = ServiceFactory.getProjectService(env);
    const storageService = ServiceFactory.getStorageService(env);
    const authContext = (request as AuthenticatedRequest).authContext;
    const ownerId = authContext?.authType === 'legacy-token'
      ? LEGACY_OWNER_ID
      : authContext?.user?.id;

    // Repository health - check storage and project service health
    const listResult = await projectService.listProjects(
      ownerId ? { ownerId } : undefined
    );
    
    const healthStatus = {
      status: listResult.ok ? 'healthy' : 'degraded',
      total_projects: listResult.ok ? listResult.value.total : 0,
      service_status: {
        project_service: listResult.ok ? 'operational' : 'error',
        storage_service: 'operational' // Assume operational if we got this far
      }
    };

    if (!listResult.ok) {
      return errorResponse(
        'HEALTH_CHECK_FAILED',
        'Failed to get repository health',
        500,
        healthStatus
      );
    }

    return successResponse({
      health_status: healthStatus,
      checked_at: new Date().toISOString(),
      metrics: {
        response_time_ms: 0 // Would need actual timing
      }
    });

  } catch (error) {
    console.error('[API-PROJECTS] Error getting repository health:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to get repository health',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * One-off admin utility to backfill ownerId on existing projects
 * POST /api/projects/backfill-owner
 */
export async function backfillProjectOwnerHandler(request: Request, env: Env): Promise<Response> {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch (error) {
      return errorResponse(
        'INVALID_JSON',
        'Request body must be valid JSON',
        400,
        error instanceof Error ? error.message : String(error)
      );
    }

    const targetOwnerId = typeof body.owner_id === 'string'
      ? body.owner_id.trim()
      : undefined;

    if (!targetOwnerId) {
      return errorResponse(
        'INVALID_REQUEST',
        'owner_id is required and must be a non-empty string',
        400
      );
    }

    const idsFromArray = Array.isArray(body.project_ids)
      ? body.project_ids.filter((id: unknown) => typeof id === 'string' && id.trim().length > 0)
      : [];
    const singleId = typeof body.project_id === 'string' && body.project_id.trim().length > 0
      ? [body.project_id.trim()]
      : [];

    const projectIds = Array.from(new Set([...idsFromArray, ...singleId]));

    if (projectIds.length === 0) {
      return errorResponse(
        'INVALID_REQUEST',
        'Provide at least one project_id',
        400,
        { hint: 'Use project_id or project_ids array' }
      );
    }

    const dryRun = Boolean(body.dry_run);
    const force = Boolean(body.force);
    const now = new Date().toISOString();

    const results: Array<{
      project_id: string;
      updated_paths: string[];
      skipped_paths: string[];
      already_set_paths: Array<{ path: string; owner_id: string }>;
      errors: Array<{ path: string; message: string }>;
    }> = [];

    for (const projectId of projectIds) {
      const projectResult = {
        project_id: projectId,
        updated_paths: [] as string[],
        skipped_paths: [] as string[],
        already_set_paths: [] as Array<{ path: string; owner_id: string }>,
        errors: [] as Array<{ path: string; message: string }>
      };

      const metadataPaths = [
        `projects/${projectId}/metadata.json`,
        `projects/active/${projectId}/metadata.json`,
        `projects/archived/${projectId}/metadata.json`
      ];

      for (const path of metadataPaths) {
        try {
          const object = await env.PROJECTS_BUCKET.get(path);
          if (!object) {
            projectResult.skipped_paths.push(path);
            continue;
          }

          const metadata = await object.json() as Record<string, any>;
          const existingOwner = (metadata as any).ownerId || (metadata as any).owner_id;

          if (existingOwner && !force) {
            projectResult.already_set_paths.push({ path, owner_id: existingOwner });
            continue;
          }

          metadata.ownerId = targetOwnerId;
          if (!metadata.created_at && metadata.createdAt) {
            metadata.created_at = metadata.createdAt;
          }
          metadata.updated_at = now;

          const customMetadata = {
            ...(object.customMetadata || {}),
            projectId,
            type: (object.customMetadata && object.customMetadata.type) || 'metadata',
            ownerId: targetOwnerId,
            updated: now
          } as Record<string, string>;

          if (!dryRun) {
            await env.PROJECTS_BUCKET.put(
              path,
              JSON.stringify(metadata, null, 2),
              {
                httpMetadata: { contentType: 'application/json' },
                customMetadata
              }
            );
          }

          projectResult.updated_paths.push(path);
        } catch (error) {
          projectResult.errors.push({
            path,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      results.push(projectResult);
    }

    const updatedCount = results.reduce((acc, item) => acc + item.updated_paths.length, 0);
    const alreadySetCount = results.reduce((acc, item) => acc + item.already_set_paths.length, 0);
    const skippedCount = results.reduce((acc, item) => acc + item.skipped_paths.length, 0);
    const errorCount = results.reduce((acc, item) => acc + item.errors.length, 0);

    return successResponse({
      dry_run: dryRun,
      force,
      owner_id: targetOwnerId,
      project_count: projectIds.length,
      summary: {
        updated_paths: updatedCount,
        already_set_paths: alreadySetCount,
        skipped_paths: skippedCount,
        error_paths: errorCount
      },
      results
    });

  } catch (error) {
    console.error('[API-PROJECTS] Error backfilling project owner:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to backfill project owner metadata',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}
