/**
 * Enhanced Metadata API Routes
 * 
 * REST API endpoints for comprehensive project metadata management:
 * - GET /api/metadata/{id} - Get enhanced metadata for a project
 * - PUT /api/metadata/{id} - Update project metadata
 * - DELETE /api/metadata/{id} - Delete project metadata
 * - POST /api/metadata/search - Search projects by metadata
 * - POST /api/metadata/batch - Batch operations on metadata
 * - GET /api/metadata/analytics - Get metadata analytics
 * - GET /api/metadata/{id}/versions - Get metadata version history
 */

import type { Env } from '../../worker-configuration';
import { 
  getEnhancedMetadataManager,
  EnhancedMetadataManager 
} from '../utils/enhancedMetadataManager';

import {
  MetadataUpdateRequest,
  MetadataSearchOptions,
  BatchMetadataRequest,
  MetadataAnalyticsRequest
} from '../types/api';

import { corsResponse, successResponse, errorResponse } from '../utils/responses';
import { validateToken } from '../utils/authUtils';
import { migrateAllProjects, getMigrationStats, needsMigration } from '../utils/metadataMigration';
import { normalizeDeploymentUrls } from '../utils/urlNormalization';

/**
 * Get enhanced metadata for a project
 * GET /api/metadata/{id}
 */
export async function getEnhancedMetadataHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3]; // /api/metadata/{id}

    console.info('[API-ENHANCED-METADATA] Getting metadata', { project_id: projectId });

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Project ID is required',
        400
      );
    }

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    const authResult = await validateToken(authHeader, env);
    if (!authResult.isValid) {
      return errorResponse(
        'UNAUTHORIZED',
        authResult.error || 'Authentication required',
        401
      );
    }

    const metadataManager = getEnhancedMetadataManager(env);
    const metadata = await metadataManager.getMetadata(projectId);

    if (!metadata) {
      return errorResponse(
        'METADATA_NOT_FOUND',
        `Enhanced metadata not found for project ${projectId}`,
        404
      );
    }

    return successResponse({
      project_id: projectId,
      metadata: metadata,
      schema_version: metadata.metadata_version.schema_version,
      version: metadata.metadata_version.version,
      last_updated: metadata.updated_at
    });

  } catch (error) {
    console.error('[API-ENHANCED-METADATA] Error getting metadata:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to get enhanced metadata',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Update enhanced metadata for a project
 * PUT /api/metadata/{id}
 */
export async function updateEnhancedMetadataHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3]; // /api/metadata/{id}

    console.info('[API-ENHANCED-METADATA] Updating metadata', { project_id: projectId });

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Project ID is required',
        400
      );
    }

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    const authResult = await validateToken(authHeader, env);
    if (!authResult.isValid) {
      return errorResponse(
        'UNAUTHORIZED',
        authResult.error || 'Authentication required',
        401
      );
    }

    const body = await request.json() as Omit<MetadataUpdateRequest, 'project_id'>;
    
    if (!body.updates) {
      return errorResponse(
        'INVALID_REQUEST',
        'Updates are required',
        400
      );
    }

    const updateRequest: MetadataUpdateRequest = {
      project_id: projectId,
      updates: body.updates,
      reason: body.reason,
      validate: body.validate !== false,
      create_version: body.create_version !== false
    };

    const metadataManager = getEnhancedMetadataManager(env);
    const result = await metadataManager.updateMetadata(updateRequest);

    if (!result.success) {
      return errorResponse(
        result.error?.type?.toUpperCase() || 'UPDATE_FAILED',
        result.error?.message || 'Failed to update metadata',
        result.error?.type === 'not_found' ? 404 : 
        result.error?.type === 'validation_error' ? 400 : 500,
        result.error?.details
      );
    }

    return successResponse({
      project_id: projectId,
      updated: true,
      updated_fields: result.updated_fields,
      new_version: result.version,
      validation: result.validation
    });

  } catch (error) {
    console.error('[API-ENHANCED-METADATA] Error updating metadata:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to update enhanced metadata',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Delete enhanced metadata for a project
 * DELETE /api/metadata/{id}
 */
export async function deleteEnhancedMetadataHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3]; // /api/metadata/{id}

    console.info('[API-ENHANCED-METADATA] Deleting metadata', { project_id: projectId });

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Project ID is required',
        400
      );
    }

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    const authResult = await validateToken(authHeader, env);
    if (!authResult.isValid) {
      return errorResponse(
        'UNAUTHORIZED',
        authResult.error || 'Authentication required',
        401
      );
    }

    const metadataManager = getEnhancedMetadataManager(env);
    const result = await metadataManager.deleteMetadata(projectId);

    if (!result.success) {
      return errorResponse(
        'DELETE_FAILED',
        result.error?.message || 'Failed to delete metadata',
        500,
        result.error
      );
    }

    return successResponse({
      project_id: projectId,
      deleted: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API-ENHANCED-METADATA] Error deleting metadata:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to delete enhanced metadata',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Search projects by enhanced metadata criteria
 * POST /api/metadata/search
 */
export async function searchEnhancedMetadataHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[API-ENHANCED-METADATA] Searching projects');

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    const authResult = await validateToken(authHeader, env);
    if (!authResult.isValid) {
      return errorResponse(
        'UNAUTHORIZED',
        authResult.error || 'Authentication required',
        401
      );
    }

    const searchOptions: MetadataSearchOptions = await request.json();

    // Apply default pagination limits
    if (!searchOptions.limit) {
      searchOptions.limit = 20;
    }
    if (searchOptions.limit > 100) {
      searchOptions.limit = 100;
    }

    const metadataManager = getEnhancedMetadataManager(env);
    const result = await metadataManager.searchProjects(searchOptions);

    return successResponse({
      search_results: result,
      query: searchOptions,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API-ENHANCED-METADATA] Error searching metadata:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to search enhanced metadata',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Batch operations on enhanced metadata
 * POST /api/metadata/batch
 */
export async function batchEnhancedMetadataHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[API-ENHANCED-METADATA] Processing batch operations');

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    const authResult = await validateToken(authHeader, env);
    if (!authResult.isValid) {
      return errorResponse(
        'UNAUTHORIZED',
        authResult.error || 'Authentication required',
        401
      );
    }

    const batchRequest: BatchMetadataRequest = await request.json();

    if (!batchRequest.operations || batchRequest.operations.length === 0) {
      return errorResponse(
        'INVALID_REQUEST',
        'At least one operation is required',
        400
      );
    }

    // Limit batch size
    if (batchRequest.operations.length > 50) {
      return errorResponse(
        'INVALID_REQUEST',
        'Maximum 50 operations allowed per batch',
        400
      );
    }

    const metadataManager = getEnhancedMetadataManager(env);
    const result = await metadataManager.batchOperations(batchRequest);

    return successResponse({
      batch_result: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API-ENHANCED-METADATA] Error processing batch operations:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to process batch operations',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get metadata analytics
 * POST /api/metadata/analytics
 */
export async function getMetadataAnalyticsHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[API-ENHANCED-METADATA] Getting analytics');

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    const authResult = await validateToken(authHeader, env);
    if (!authResult.isValid) {
      return errorResponse(
        'UNAUTHORIZED',
        authResult.error || 'Authentication required',
        401
      );
    }

    const analyticsRequest: MetadataAnalyticsRequest = await request.json();

    if (!analyticsRequest.metrics || analyticsRequest.metrics.length === 0) {
      return errorResponse(
        'INVALID_REQUEST',
        'At least one metric is required',
        400
      );
    }

    const metadataManager = getEnhancedMetadataManager(env);
    const result = await metadataManager.getAnalytics(analyticsRequest);

    if (!result.success) {
      return errorResponse(
        'ANALYTICS_FAILED',
        'Failed to get analytics data',
        500
      );
    }

    return successResponse({
      analytics: result,
      request_params: analyticsRequest,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API-ENHANCED-METADATA] Error getting analytics:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to get metadata analytics',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get metadata version history for a project
 * GET /api/metadata/{id}/versions
 */
export async function getMetadataVersionHistoryHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.pathname.split('/')[3]; // /api/metadata/{id}/versions

    console.info('[API-ENHANCED-METADATA] Getting version history', { project_id: projectId });

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Project ID is required',
        400
      );
    }

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    const authResult = await validateToken(authHeader, env);
    if (!authResult.isValid) {
      return errorResponse(
        'UNAUTHORIZED',
        authResult.error || 'Authentication required',
        401
      );
    }

    const metadataManager = getEnhancedMetadataManager(env);
    const metadata = await metadataManager.getMetadata(projectId);

    if (!metadata) {
      return errorResponse(
        'METADATA_NOT_FOUND',
        `Enhanced metadata not found for project ${projectId}`,
        404
      );
    }

    const versionHistory = [
      metadata.metadata_version,
      ...(metadata.version_history || [])
    ].sort((a, b) => b.version - a.version);

    return successResponse({
      project_id: projectId,
      current_version: metadata.metadata_version.version,
      schema_version: metadata.metadata_version.schema_version,
      version_history: versionHistory,
      total_versions: versionHistory.length
    });

  } catch (error) {
    console.error('[API-ENHANCED-METADATA] Error getting version history:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to get version history',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get metadata health status
 * GET /api/metadata/health
 */
export async function getMetadataHealthHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[API-ENHANCED-METADATA] Getting metadata health status');

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    const authResult = await validateToken(authHeader, env);
    if (!authResult.isValid) {
      return errorResponse(
        'UNAUTHORIZED',
        authResult.error || 'Authentication required',
        401
      );
    }

    const metadataManager = getEnhancedMetadataManager(env);
    
    // Get a sample of projects to check health
    const searchResult = await metadataManager.searchProjects({ 
      limit: 10,
      sort_by: 'updated_at',
      sort_order: 'desc'
    });

    const health = {
      status: 'healthy',
      total_projects_sampled: searchResult.total_count,
      enhanced_metadata_available: searchResult.projects.length,
      search_performance_ms: searchResult.search_time_ms,
      schema_versions: searchResult.projects.reduce((acc, project) => {
        const version = project.metadata_version.schema_version;
        acc[version] = (acc[version] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      last_updated: new Date().toISOString()
    };

    return successResponse({
      metadata_health: health,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API-ENHANCED-METADATA] Error getting health status:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to get metadata health',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Migrate all existing projects to enhanced metadata
 * POST /api/metadata/migrate
 */
export async function migrateProjectsHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[API-ENHANCED-METADATA] Starting project migration');

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    const authResult = await validateToken(authHeader, env);
    if (!authResult.isValid) {
      return errorResponse(
        'UNAUTHORIZED',
        authResult.error || 'Authentication required',
        401
      );
    }

    const body = await request.json().catch(() => ({}));
    const options = {
      batch_size: body.batch_size || 10,
      skip_existing: body.skip_existing !== false,
      user_id: body.user_id || 'api-migration'
    };

    const result = await migrateAllProjects(env, options);

    if (!result.success) {
      return errorResponse(
        'MIGRATION_FAILED',
        'Project migration completed with errors',
        500,
        {
          migration_stats: result,
          errors: result.errors
        }
      );
    }

    return successResponse({
      migration_completed: true,
      migration_stats: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API-ENHANCED-METADATA] Error during migration:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to migrate projects',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get migration statistics
 * GET /api/metadata/migration/stats
 */
export async function getMigrationStatsHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[API-ENHANCED-METADATA] Getting migration statistics');

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    const authResult = await validateToken(authHeader, env);
    if (!authResult.isValid) {
      return errorResponse(
        'UNAUTHORIZED',
        authResult.error || 'Authentication required',
        401
      );
    }

    const stats = await getMigrationStats(env);

    return successResponse({
      migration_stats: stats,
      migration_progress: stats.total_projects > 0 
        ? (stats.enhanced_metadata_projects / stats.total_projects) * 100 
        : 100,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API-ENHANCED-METADATA] Error getting migration stats:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to get migration statistics',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Normalize deployment/public URLs to Workers domain
 * POST /api/metadata/normalize-urls
 */
export async function normalizeUrlsHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[API-ENHANCED-METADATA] Normalizing deployment URLs');

    // Verify authentication
    const authHeader = request.headers.get('authorization');
    const authResult = await validateToken(authHeader, env);
    if (!authResult.isValid) {
      return errorResponse(
        'UNAUTHORIZED',
        authResult.error || 'Authentication required',
        401
      );
    }

    const result = await normalizeDeploymentUrls(env);

    return successResponse({
      normalized: result.success,
      projects_scanned: result.projects_scanned,
      projects_updated: result.projects_updated,
      projects_unchanged: result.projects_unchanged,
      errors: result.errors,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[API-ENHANCED-METADATA] Error normalizing URLs:', error);
    return errorResponse(
      'INTERNAL_SERVER_ERROR',
      'Failed to normalize deployment URLs',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Handle preflight CORS requests
 */
export async function handleMetadataOptionsRequest(): Promise<Response> {
  return corsResponse();
}
