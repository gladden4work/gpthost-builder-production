/**
 * Build Warning API Endpoints - TASK-020
 * 
 * RESTful API endpoints for accessing build warning analysis, analytics, and management.
 * Provides comprehensive warning information for code quality improvement.
 */

import { Request } from '@cloudflare/workers-types';
import { successResponse, errorResponse } from '../utils/responses';
import { 
  createBuildWarningParser, 
  WarningQueryFilters,
  BuildWarningAnalysis,
  WarningResolutionSuggestion,
  BuildWarningsSummary
} from '../utils/buildWarningParser';
import { createWarningStorageManager } from '../utils/warningStorage';
import { FrameworkType, BuildStage } from '../types/api';

/**
 * Warning response interfaces
 */
interface WarningResponse {
  projectId: string;
  buildId?: string;
  warnings: BuildWarningAnalysis[];
  summary: BuildWarningsSummary | null;
  suggestions: WarningResolutionSuggestion[];
  analytics?: any;
  timestamp: string;
  metadata?: {
    total_warnings: number;
    critical_warnings: number;
    fixable_warnings: number;
    auto_fixable_warnings?: number;
  };
}

interface WarningHistoryResponse {
  projectId: string;
  warnings: BuildWarningAnalysis[];
  metadata: any[];
  totalCount: number;
  filteredCount: number;
  hasMore: boolean;
  responseMetadata?: {
    total_count: number;
    filtered_count: number;
    offset: number;
    limit: number;
  };
}

interface WarningAnalyticsResponse {
  projectId: string;
  analytics: any;
  timeRange: {
    start: string;
    end: string;
  };
  generatedAt: string;
  metadata?: {
    total_warnings: number;
    total_builds: number;
    average_warnings: number;
    top_categories: string[];
  };
}

/**
 * GET /api/warnings/{project_id}
 * Get all warnings for a specific project
 */
export async function getProjectWarnings(
  request: Request,
  env: Env,
  project_id: string
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const buildId = url.searchParams.get('build_id');
    const category = url.searchParams.get('category');
    const severity = url.searchParams.get('severity');
    const stage = url.searchParams.get('stage');
    const fixable = url.searchParams.get('fixable');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

    const storageManager = createWarningStorageManager();

    // If specific build requested, get warnings for that build
    if (buildId) {
      const warningData = await storageManager.getWarningsForBuild(
        project_id,
        buildId,
        env
      );

      if (!warningData) {
        return successResponse({
          projectId: project_id,
          buildId,
          warnings: [],
          summary: null,
          suggestions: [],
          timestamp: new Date().toISOString(),
          metadata: {
            total_warnings: 0,
            critical_warnings: 0,
            fixable_warnings: 0
          }
        } as WarningResponse);
      }

      return successResponse({
        projectId: project_id,
        buildId,
        warnings: warningData.warnings,
        summary: warningData.summary,
        suggestions: warningData.suggestions,
        analytics: warningData.analytics,
        timestamp: new Date().toISOString(),
        metadata: {
          total_warnings: warningData.warnings.length,
          critical_warnings: warningData.warnings.filter(w => w.severity === 'critical').length,
          fixable_warnings: warningData.warnings.filter(w => w.fixable).length
        }
      } as WarningResponse);
    }

    // Build query filters
    const filters: WarningQueryFilters = {
      limit,
      category: category ? [category as any] : undefined,
      severity: severity ? [severity as any] : undefined,
      stage: stage ? [stage as any] : undefined,
      fixable: fixable !== null ? fixable === 'true' : undefined
    };

    // Get project warnings with filters
    const result = await storageManager.getWarningsForProject(
      project_id,
      filters,
      env
    );

    return successResponse({
      projectId: project_id,
      warnings: result.warnings,
      summary: {
        totalWarnings: result.totalCount,
        filteredWarnings: result.filteredCount,
        hasMore: result.filteredCount === limit && result.totalCount > limit
      } as BuildWarningsSummary,
      suggestions: [],
      timestamp: new Date().toISOString(),
      metadata: {
        total_warnings: result.totalCount,
        critical_warnings: result.warnings.filter(w => w.severity === 'critical').length,
        fixable_warnings: result.warnings.filter(w => w.fixable).length
      }
    } as WarningResponse);

  } catch (error) {
    console.error('[WARNING-API] Error retrieving project warnings:', error);
    return errorResponse(
      'RETRIEVE_WARNINGS_ERROR',
      'Failed to retrieve project warnings',
      500,
      {
        project_id,
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * GET /api/warnings/{project_id}/history
 * Get warning history for a project with filtering and pagination
 */
export async function getWarningHistory(
  request: Request,
  env: Env,
  project_id: string
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const category = url.searchParams.get('category');
    const severity = url.searchParams.get('severity');
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');

    // Build query filters
    const filters: WarningQueryFilters = {
      limit,
      offset,
      category: category ? [category as any] : undefined,
      severity: severity ? [severity as any] : undefined,
      dateRange: startDate && endDate ? {
        start: startDate,
        end: endDate
      } : undefined
    };

    const storageManager = createWarningStorageManager();
    const result = await storageManager.getWarningsForProject(
      project_id,
      filters,
      env
    );

    return successResponse({
      projectId: project_id,
      warnings: result.warnings,
      metadata: result.metadata,
      totalCount: result.totalCount,
      filteredCount: result.filteredCount,
      hasMore: result.filteredCount === limit,
      responseMetadata: {
        total_count: result.totalCount,
        filtered_count: result.filteredCount,
        offset,
        limit
      }
    } as WarningHistoryResponse);

  } catch (error) {
    console.error('[WARNING-API] Error retrieving warning history:', error);
    return errorResponse(
      'RETRIEVE_WARNING_HISTORY_ERROR',
      'Failed to retrieve warning history',
      500,
      {
        project_id,
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * GET /api/warnings/{project_id}/analytics
 * Get warning analytics and trends for a project
 */
export async function getWarningAnalytics(
  request: Request,
  env: Env,
  project_id: string
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '30');
    
    // Calculate time range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const timeRange = {
      start: startDate.toISOString(),
      end: endDate.toISOString()
    };

    const storageManager = createWarningStorageManager();
    const analytics = await storageManager.getWarningAnalytics(
      project_id,
      timeRange,
      env
    );

    return successResponse({
      projectId: project_id,
      analytics,
      timeRange,
      generatedAt: new Date().toISOString(),
      metadata: {
        total_warnings: analytics.summary.totalWarnings,
        total_builds: analytics.summary.totalBuilds,
        average_warnings: analytics.summary.averageWarningsPerBuild,
        top_categories: analytics.categories.slice(0, 3).map(c => c.category)
      }
    } as WarningAnalyticsResponse);

  } catch (error) {
    console.error('[WARNING-API] Error generating warning analytics:', error);
    return errorResponse(
      'GENERATE_ANALYTICS_ERROR',
      'Failed to generate warning analytics',
      500,
      {
        project_id,
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * GET /api/warnings/{project_id}/{build_id}
 * Get warnings for a specific build
 */
export async function getBuildWarnings(
  request: Request,
  env: Env,
  project_id: string,
  build_id: string
): Promise<Response> {
  try {
    const storageManager = createWarningStorageManager();
    const warningData = await storageManager.getWarningsForBuild(
      project_id,
      build_id,
      env
    );

    if (!warningData) {
      return errorResponse(
        'WARNING_DATA_NOT_FOUND',
        'No warning data found for this build',
        404,
        { project_id, build_id }
      );
    }

    // Generate fresh resolution suggestions
    const warningParser = createBuildWarningParser();
    const freshSuggestions = warningParser.generateResolutionSuggestions(
      warningData.warnings
    );

    return successResponse({
      projectId: project_id,
      buildId: build_id,
      warnings: warningData.warnings,
      summary: warningData.summary,
      suggestions: freshSuggestions,
      analytics: warningData.analytics,
      timestamp: warningData.metadata.timestamp,
      metadata: {
        total_warnings: warningData.warnings.length,
        critical_warnings: warningData.summary.criticalWarnings,
        fixable_warnings: warningData.summary.fixableWarnings,
        auto_fixable_warnings: warningData.summary.autoFixableWarnings
      }
    } as WarningResponse);

  } catch (error) {
    console.error('[WARNING-API] Error retrieving build warnings:', error);
    return errorResponse(
      'RETRIEVE_BUILD_WARNINGS_ERROR',
      'Failed to retrieve build warnings',
      500,
      {
        project_id,
        build_id,
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * POST /api/warnings/{project_id}/clear
 * Clear (acknowledge) specific warnings for a project
 */
export async function clearWarnings(
  request: Request,
  env: Env,
  project_id: string
): Promise<Response> {
  try {
    const body = await request.json() as {
      warning_ids: string[];
      reason?: string;
    };

    if (!body.warning_ids || !Array.isArray(body.warning_ids)) {
      return errorResponse(
        'INVALID_REQUEST',
        'Invalid request: warning_ids array is required',
        400,
        { project_id }
      );
    }

    const storageManager = createWarningStorageManager();
    const result = await storageManager.clearAcknowledgedWarnings(
      project_id,
      body.warning_ids,
      env
    );

    return successResponse({
      project_id,
      cleared_warnings: result.clearedCount,
      success: result.success,
      reason: body.reason || 'Manual acknowledgment',
      timestamp: new Date().toISOString(),
      metadata: {
        cleared_count: result.clearedCount
      }
    });

  } catch (error) {
    console.error('[WARNING-API] Error clearing warnings:', error);
    return errorResponse(
      'CLEAR_WARNINGS_ERROR',
      'Failed to clear warnings',
      500,
      {
        project_id,
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * GET /api/warnings/analytics
 * Get global warning analytics across all projects
 */
export async function getGlobalWarningAnalytics(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '30');
    const framework = url.searchParams.get('framework') as FrameworkType;

    // For MVP, we'll provide a simplified global analytics
    // In production, this would aggregate across all projects
    
    const timeRange = {
      start: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
      end: new Date().toISOString()
    };

    const analytics = {
      summary: {
        totalProjects: 0,
        totalWarnings: 0,
        averageWarningsPerProject: 0,
        mostCommonCategory: 'unknown',
        improvementTrend: 'stable'
      },
      categoryDistribution: {},
      frameworkBreakdown: {},
      recommendations: [
        'Global analytics feature is in development',
        'Use project-specific analytics for detailed insights',
        'Consider implementing consistent warning resolution practices'
      ],
      timeRange,
      generatedAt: new Date().toISOString()
    };

    return successResponse({
      analytics,
      filters: {
        days,
        framework: framework || 'all'
      },
      note: 'Global analytics are limited in MVP version',
      metadata: {
        analytics_scope: 'global',
        time_range_days: days
      }
    });

  } catch (error) {
    console.error('[WARNING-API] Error generating global analytics:', error);
    return errorResponse(
      'GENERATE_GLOBAL_ANALYTICS_ERROR',
      'Failed to generate global warning analytics',
      500,
      {
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * Helper function to validate warning query parameters
 */
function validateWarningQueryParams(searchParams: URLSearchParams): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Validate limit
  const limit = searchParams.get('limit');
  if (limit && (isNaN(parseInt(limit)) || parseInt(limit) < 1 || parseInt(limit) > 100)) {
    errors.push('limit must be a number between 1 and 100');
  }
  
  // Validate offset
  const offset = searchParams.get('offset');
  if (offset && (isNaN(parseInt(offset)) || parseInt(offset) < 0)) {
    errors.push('offset must be a non-negative number');
  }
  
  // Validate category
  const category = searchParams.get('category');
  const validCategories = ['typescript', 'eslint', 'dependency', 'performance', 'security', 'accessibility', 'framework', 'build', 'unknown'];
  if (category && !validCategories.includes(category)) {
    errors.push(`category must be one of: ${validCategories.join(', ')}`);
  }
  
  // Validate severity
  const severity = searchParams.get('severity');
  const validSeverities = ['info', 'warning', 'critical'];
  if (severity && !validSeverities.includes(severity)) {
    errors.push(`severity must be one of: ${validSeverities.join(', ')}`);
  }
  
  // Validate stage
  const stage = searchParams.get('stage');
  const validStages = ['npm-install', 'build', 'optimization', 'cleanup'];
  if (stage && !validStages.includes(stage)) {
    errors.push(`stage must be one of: ${validStages.join(', ')}`);
  }
  
  // Validate date range
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  
  if (startDate && isNaN(Date.parse(startDate))) {
    errors.push('start_date must be a valid ISO date string');
  }
  
  if (endDate && isNaN(Date.parse(endDate))) {
    errors.push('end_date must be a valid ISO date string');
  }
  
  if (startDate && endDate && Date.parse(startDate) > Date.parse(endDate)) {
    errors.push('start_date must be before end_date');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Middleware for validating warning API requests
 */
export async function validateWarningRequest(
  request: Request,
  env: Env,
  next: () => Promise<Response>
): Promise<Response> {
  const url = new URL(request.url);
  const validation = validateWarningQueryParams(url.searchParams);
  
  if (!validation.valid) {
    return errorResponse(
      'INVALID_QUERY_PARAMETERS',
      'Invalid query parameters',
      400,
      {
        errors: validation.errors,
        valid_parameters: 'See API documentation for valid parameter values'
      }
    );
  }
  
  return next();
}