/**
 * Build Status Handler - Phase 4.1 Implementation
 * 
 * ATTEMPT 1/5: Basic build status functionality
 * 
 * Handles build status requests for queued/running builds:
 * - Retrieves current build status from R2
 * - Returns real-time progress information
 * - Includes build logs and error details
 * - Provides build artifacts information when complete
 * 
 * Success Criteria:
 * - Handle GET /api/projects/{id}/build/status requests
 * - Return current build status with progress (0-100)
 * - Include current stage and recent logs
 * - Handle completed/failed builds appropriately
 */

import { 
  BuildStatus, 
  BuildStatusRequest, 
  BuildStatusResponse,
  ProjectMetadata,
  FrameworkType 
} from '../types/api';
import { 
  getProjectMetadata, 
  getBuildStatus, 
  createErrorResponse, 
  createSuccessResponse, 
  extractProjectIdFromPath 
} from '../utils/projectHelpers';

/**
 * Handle build status requests
 * GET /api/projects/{projectId}/build/status
 */
export async function buildStatusHandler(
  request: Request, 
  env: Env
): Promise<Response> {
  try {
    // Extract project ID from URL
    const url = new URL(request.url);
    let projectId = extractProjectIdFromPath(url.pathname);
    // Fallback: accept non-UUID project IDs (e.g., human-readable names)
    if (!projectId) {
      const parts = url.pathname.split('/');
      // /api/projects/{projectId}/build/status => index 3
      projectId = parts[3] || null;
    }
    
    if (!projectId) {
      return createErrorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required',
        undefined,
        400
      );
    }

    // Parse query parameters
    const includeLogsParam = url.searchParams.get('include_logs');
    const maxLogLinesParam = url.searchParams.get('max_log_lines');
    
    const includeLogsFlag = includeLogsParam === 'true' || includeLogsParam === '1';
    const maxLogLines = maxLogLinesParam ? parseInt(maxLogLinesParam, 10) : 50;

    // Validate project exists
    const projectMetadata = await getProjectMetadata(projectId, env);
    if (!projectMetadata) {
      return createErrorResponse(
        'PROJECT_NOT_FOUND',
        `Project ${projectId} not found`,
        undefined,
        404
      );
    }

    // Get build status
    const buildStatus = await getBuildStatus(projectId, env);
    if (!buildStatus) {
      return createErrorResponse(
        'BUILD_STATUS_NOT_FOUND',
        'No build status found for this project',
        { suggestion: 'Start a build first with POST /api/projects/{id}/build' },
        404
      );
    }

    // Get build artifacts if build is completed
    let buildArtifacts;
    if (buildStatus.status === 'completed') {
      buildArtifacts = await getBuildArtifacts(projectId, buildStatus.metadata.job_id || 'unknown', env);
    }

    // Limit logs if requested
    let logs = buildStatus.logs;
    if (!includeLogsFlag) {
      logs = []; // No logs requested
    } else if (logs && logs.length > maxLogLines) {
      logs = logs.slice(-maxLogLines); // Get last N lines
    }

    // Create response
    const response: BuildStatusResponse = {
      project_id: projectId,
      job_id: buildStatus.metadata.job_id || 'unknown',
      build_status: {
        ...buildStatus,
        logs: logs || [],
      },
      scaffolding_info: {
        framework: projectMetadata.framework || 'unknown',
        file_count: projectMetadata.files.length,
        has_typescript: projectMetadata.analysis?.primaryFramework === 'react' && 
          projectMetadata.files.some(f => f.name.endsWith('.ts') || f.name.endsWith('.tsx')),
      },
      build_artifacts: buildArtifacts,
    };

    return createSuccessResponse(response);

  } catch (error) {
    console.error('Build status handler error:', error);
    return createErrorResponse(
      'INTERNAL_ERROR',
      'Internal server error during build status retrieval',
      { error: error.message }
    );
  }
}



/**
 * Get build artifacts information
 */
async function getBuildArtifacts(projectId: string, jobId: string, env: Env): Promise<any | undefined> {
  try {
    // Check for build artifacts in BUILDS_BUCKET
    const artifactsKey = `builds/${projectId}/${jobId}/artifacts.json`;
    const artifactsObject = await env.BUILDS_BUCKET.get(artifactsKey);
    
    if (!artifactsObject) {
      return undefined;
    }

    const artifacts = await artifactsObject.json();
    
    return {
      output_path: `builds/${projectId}/${jobId}`,
      size_bytes: calculateArtifactsSize(artifacts),
      file_count: artifacts.files ? artifacts.files.length : 0,
    };
  } catch (error) {
    console.warn(`Failed to get build artifacts for ${projectId}/${jobId}:`, error);
    return undefined;
  }
}

/**
 * Calculate total size of build artifacts
 */
function calculateArtifactsSize(artifacts: any): number {
  if (!artifacts.files || !Array.isArray(artifacts.files)) {
    return 0;
  }
  
  return artifacts.files.reduce((total: number, file: any) => {
    const size = file.size || file.content?.length || 0;
    return total + size;
  }, 0);
}

/**
 * Handle build logs endpoint
 * GET /api/projects/{projectId}/build/logs
 */
export async function buildLogsHandler(
  request: Request, 
  env: Env
): Promise<Response> {
  try {
    // Extract project ID from URL
    const url = new URL(request.url);
    let projectId = extractProjectIdFromPath(url.pathname);
    if (!projectId) {
      const parts = url.pathname.split('/');
      projectId = parts[3] || null;
    }
    
    if (!projectId) {
      return createErrorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required',
        undefined,
        400
      );
    }

    // Get build status for logs
    const buildStatus = await getBuildStatus(projectId, env);
    if (!buildStatus) {
      return createErrorResponse(
        'BUILD_STATUS_NOT_FOUND',
        'No build status found for this project',
        undefined,
        404
      );
    }

    // Parse pagination parameters
    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    
    const limit = limitParam ? parseInt(limitParam, 10) : 100;
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
    
    const logs = buildStatus.logs || [];
    const paginatedLogs = logs.slice(offset, offset + limit);
    
    // Format logs with timestamps and levels
    const formattedLogs = paginatedLogs.map((log, index) => ({
      timestamp: new Date(Date.now() - (logs.length - offset - index) * 1000).toISOString(),
      level: inferLogLevel(log),
      stage: buildStatus.current_stage,
      message: log,
    }));

    return createSuccessResponse({
      project_id: projectId,
      job_id: buildStatus.metadata.job_id || 'unknown',
      logs: formattedLogs,
      total_log_count: logs.length,
      has_more_logs: (offset + limit) < logs.length,
    });

  } catch (error) {
    console.error('Build logs handler error:', error);
    return createErrorResponse(
      'INTERNAL_ERROR',
      'Internal server error during build logs retrieval'
    );
  }
}

/**
 * Infer log level from message content
 */
function inferLogLevel(message: string): 'info' | 'warn' | 'error' {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('error') || lowerMessage.includes('failed') || lowerMessage.includes('exception')) {
    return 'error';
  }
  
  if (lowerMessage.includes('warn') || lowerMessage.includes('warning') || lowerMessage.includes('deprecated')) {
    return 'warn';
  }
  
  return 'info';
}
