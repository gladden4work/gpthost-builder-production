/**
 * TASK-025: Build Status API Routes
 * 
 * Provides comprehensive build status tracking endpoints:
 * - GET /api/projects/{id}/status - Get current build status
 * - GET /api/projects/{id}/status-stream - Server-Sent Events for real-time updates
 * - POST /api/projects/{id}/status/poll - Trigger status polling and SSE broadcast (request-triggered architecture)
 * 
 * Features:
 * - Request-triggered GitHub Actions workflow status polling (Cloudflare Workers compatible)
 * - Server-Sent Events for live build updates  
 * - Long-running build detection and handling
 * - Comprehensive error handling and rate limit management
 * - Project metadata synchronization
 */

import { 
  BuildStatusTracker,
  EnhancedBuildStatus, 
  createBuildStatusTracker,
  shouldTrackProjectStatus,
  formatBuildDuration
} from '../utils/buildStatusTracker';

import {
  SSEManager,
  getSSEManager,
  createSSEHeaders
} from '../utils/sseManager';

import {
  GitHubQueueBridge,
  createGitHubQueueBridge
} from '../utils/githubQueueBridge';

import { 
  ProjectMetadata,
  BuildStatusType,
  FrameworkType
} from '../types/api';

import { 
  successResponse, 
  errorResponse,
  corsResponse
} from '../utils/responses';

import {
  getBuildStatusOrchestrator
} from '../utils/buildStatusOrchestrator';

/**
 * Build status response structure
 */
export interface BuildStatusResponse {
  success: boolean;
  project_id: string;
  status: EnhancedBuildStatus;
  tracking_info: {
    is_being_tracked: boolean;
    poll_count: number;
    last_updated: string;
    next_poll_in_seconds?: number;
  };
  github_info?: {
    repository: string;
    workflow_run_id: number;
    workflow_run_url: string;
  };
}

/**
 * Status stream response for SSE connections
 */
export interface StatusStreamResponse {
  success: boolean;
  connection_id: string;
  project_id: string;
  message: string;
}

// Global instances (singleton pattern for Cloudflare Workers)
let statusTracker: BuildStatusTracker | null = null;
let sseManager: SSEManager | null = null;

/**
 * GET /api/projects/{id}/status
 * Get current build status for a project
 */
export async function getProjectStatusHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/');
    const projectId = pathSegments[3]; // /api/projects/{id}/status

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Missing project ID in URL path',
        400
      );
    }

    console.info('[BUILD-STATUS] Getting project status', { project_id: projectId });

    // Initialize status tracker if not already done
    if (!statusTracker) {
      statusTracker = createBuildStatusTracker(env);
      if (!statusTracker) {
        return errorResponse(
          'SERVICE_UNAVAILABLE',
          'Build status tracking not available - GitHub integration not configured',
          503,
          {
            missing_config: ['GITHUB_TOKEN']
          }
        );
      }
    }

    // Check if project is being actively tracked
    const trackingInfo = statusTracker.getTrackingInfo(projectId);
    
    if (trackingInfo) {
      console.info('[BUILD-STATUS] Project is actively tracked, polling status', {
        project_id: projectId,
        workflow_run_id: trackingInfo.workflow_run_id,
        poll_count: trackingInfo.poll_count,
        is_long_running: trackingInfo.is_long_running
      });

      // Poll current status from GitHub
      const pollingResult = await statusTracker.pollBuildStatus(projectId);
      
      if (pollingResult.success && pollingResult.status) {
        const response: BuildStatusResponse = {
          success: true,
          project_id: projectId,
          status: pollingResult.status,
          tracking_info: {
            is_being_tracked: true,
            poll_count: trackingInfo.poll_count,
            last_updated: trackingInfo.last_status_update,
            next_poll_in_seconds: pollingResult.should_continue_polling ? 
              Math.round(pollingResult.next_poll_delay / 1000) : undefined
          },
          github_info: {
            repository: trackingInfo.repository_full_name,
            workflow_run_id: trackingInfo.workflow_run_id,
            workflow_run_url: `https://github.com/${trackingInfo.repository_full_name}/actions/runs/${trackingInfo.workflow_run_id}`
          }
        };

        // Broadcast status update via SSE if manager is available
        if (sseManager) {
          sseManager.broadcastStatusUpdate(pollingResult.status, { project_id: projectId });
        }

        return successResponse(response);
      } else {
        // Polling failed, return error with tracking info
        return errorResponse(
          'POLLING_FAILED',
          pollingResult.error?.message || 'Failed to poll build status from GitHub',
          500,
          {
            project_id: projectId,
            tracking_info: {
              is_being_tracked: true,
              poll_count: trackingInfo.poll_count,
              last_updated: trackingInfo.last_status_update,
              error_type: pollingResult.error?.type,
              retryable: pollingResult.error?.retryable
            }
          }
        );
      }
    }

    // Project not being tracked - try to load from project metadata to get GitHub run ID
    try {
      const { getProjectMetadataManager } = await import('../utils/projectMetadataManager');
      const metadataManager = getProjectMetadataManager(env);
      const trackingInfoResult = await metadataManager.getBuildTrackingInfo(projectId);

      // Check if project exists - if not, return 404
      if (!trackingInfoResult.success) {
        console.info('[BUILD-STATUS] Project metadata not found, returning 404', {
          project_id: projectId,
          error: trackingInfoResult.error
        });

        return errorResponse(
          'PROJECT_NOT_FOUND',
          'Project not found',
          404,
          { project_id: projectId }
        );
      }

      if (trackingInfoResult.tracking_info?.github_workflow_run_id) {
        // We have GitHub run ID in metadata - try to start tracking
        const buildTrackingInfo = trackingInfoResult.tracking_info;

        console.info('[BUILD-STATUS] Found GitHub run ID in metadata, attempting to start tracking', {
          project_id: projectId,
          workflow_run_id: buildTrackingInfo.github_workflow_run_id,
          repository: buildTrackingInfo.github_repository
        });

        // Try to determine framework from project metadata
        const projectMetadata = await metadataManager.loadProjectMetadata(projectId);
        const framework = projectMetadata?.framework || 'react';

        if (buildTrackingInfo.github_workflow_run_id && buildTrackingInfo.github_repository) {
          // Start tracking with existing GitHub run information
          const trackingResult = await statusTracker.startTracking(
            projectId,
            buildTrackingInfo.github_workflow_run_id,
            buildTrackingInfo.github_repository,
            framework as FrameworkType
          );

          if (trackingResult.success) {
            // Poll immediately to get current status
            const pollingResult = await statusTracker.pollBuildStatus(projectId);

            if (pollingResult.success && pollingResult.status) {
              const response: BuildStatusResponse = {
                success: true,
                project_id: projectId,
                status: pollingResult.status,
                tracking_info: {
                  is_being_tracked: true,
                  poll_count: 1,
                  last_updated: new Date().toISOString(),
                  next_poll_in_seconds: pollingResult.should_continue_polling ?
                    Math.round(pollingResult.next_poll_delay / 1000) : undefined
                },
                github_info: {
                  repository: buildTrackingInfo.github_repository,
                  workflow_run_id: buildTrackingInfo.github_workflow_run_id,
                  workflow_run_url: buildTrackingInfo.github_workflow_run_url ||
                    `https://github.com/${buildTrackingInfo.github_repository}/actions/runs/${buildTrackingInfo.github_workflow_run_id}`
                }
              };

              return successResponse(response);
            }
          }
        }
      }

      // No GitHub run ID found - return pending status (project exists but no build tracking)
      const response: BuildStatusResponse = {
        success: true,
        project_id: projectId,
        status: {
          status: 'pending' as BuildStatusType,
          progress: 0,
          current_stage: 'queued',
          logs: ['Project status tracking not active'],
          metadata: {
            queued_at: new Date().toISOString()
          },
          github_metadata: {
            repository: '',
            workflow_run_id: 0,
            workflow_run_url: '',
            workflow_name: '',
            run_number: 0,
            triggered_at: ''
          },
          polling_metadata: {
            last_polled_at: '',
            next_poll_at: '',
            poll_count: 0,
            polling_interval: 0,
            is_long_running: false
          }
        },
        tracking_info: {
          is_being_tracked: false,
          poll_count: 0,
          last_updated: new Date().toISOString()
        }
      };

      return successResponse(response);

    } catch (metadataError) {
      console.error('[BUILD-STATUS] Failed to load project metadata', {
        project_id: projectId,
        error: metadataError instanceof Error ? metadataError.message : String(metadataError)
      });

      return errorResponse(
        'METADATA_ERROR',
        'Failed to load project status from metadata',
        500,
        {
          project_id: projectId,
          error: metadataError instanceof Error ? metadataError.message : String(metadataError)
        }
      );
    }

  } catch (error) {
    console.error('[BUILD-STATUS] Error in getProjectStatusHandler:', error);
    
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while getting build status',
      500,
      {
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * GET /api/projects/{id}/status-stream
 * Server-Sent Events endpoint for real-time build status updates
 */
export async function getProjectStatusStreamHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/');
    const projectId = pathSegments[3]; // /api/projects/{id}/status-stream

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Missing project ID in URL path',
        400
      );
    }

    console.info('[BUILD-STATUS-STREAM] Creating SSE connection', { project_id: projectId });

    // Initialize SSE manager if not already done
    if (!sseManager) {
      sseManager = getSSEManager();
    }

    // Initialize status tracker for polling
    if (!statusTracker) {
      statusTracker = createBuildStatusTracker(env);
      if (!statusTracker) {
        return errorResponse(
          'SERVICE_UNAVAILABLE',
          'Build status streaming not available - GitHub integration not configured',
          503
        );
      }
    }

    // Create SSE connection
    const { response, connectionId } = sseManager.createConnection(projectId, request);

    if (!connectionId) {
      return response; // Connection rejected (e.g., limit exceeded)
    }

    console.info('✅ [BUILD-STATUS-STREAM] SSE connection created', {
      project_id: projectId,
      connection_id: connectionId
    });

    // Start status polling for this project if not already tracking
    const trackingInfo = statusTracker.getTrackingInfo(projectId);
    if (!trackingInfo) {
      console.info('[BUILD-STATUS-STREAM] Starting status tracking for project', {
        project_id: projectId,
        connection_id: connectionId
      });

      // TODO: Load GitHub run ID from project metadata to start tracking
      // For MVP, we'll assume tracking is started elsewhere
    }

    // SSE connection established - no automatic polling needed
    // Polling is request-triggered via the orchestrator's triggerPolling() method
    // The frontend must make API calls to trigger status updates which then broadcast via SSE
    console.info('✅ [BUILD-STATUS-STREAM] SSE connection ready for request-triggered updates', {
      project_id: projectId,
      connection_id: connectionId,
      message: 'Connection established - waiting for triggered status updates'
    });

    // Log connection establishment (SSE will receive updates when polling is triggered)
    console.info('✅ [BUILD-STATUS-STREAM] Initial SSE connection established', {
      project_id: projectId,
      connection_id: connectionId,
      message: 'Ready for request-triggered status updates'
    });

    return response;

  } catch (error) {
    console.error('[BUILD-STATUS-STREAM] Error in getProjectStatusStreamHandler:', error);
    
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while creating status stream',
      500,
      {
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * POST /api/projects/{id}/status-tracking/start
 * Start status tracking for a project with GitHub workflow run ID
 */
export async function startProjectStatusTrackingHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/');
    const projectId = pathSegments[3]; // /api/projects/{id}/status-tracking/start

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Missing project ID in URL path',
        400
      );
    }

    // Parse request body
    const body = await request.json() as any;
    const workflow_run_id = body.workflow_run_id as number;
    const repository_full_name = body.repository_full_name as string;
    const framework = body.framework as string;

    if (!workflow_run_id || !repository_full_name || !framework) {
      return errorResponse(
        'INVALID_REQUEST',
        'Missing required fields: workflow_run_id, repository_full_name, framework',
        400,
        { received_body: body }
      );
    }

    console.info('[BUILD-STATUS-TRACKING] Starting status tracking', {
      project_id: projectId,
      workflow_run_id: workflow_run_id,
      repository: repository_full_name,
      framework
    });

    // Initialize status tracker if not already done
    if (!statusTracker) {
      statusTracker = createBuildStatusTracker(env);
      if (!statusTracker) {
        return errorResponse(
          'SERVICE_UNAVAILABLE',
          'Build status tracking not available - GitHub integration not configured',
          503
        );
      }
    }

    // Start tracking
    const result = await statusTracker.startTracking(
      projectId,
      workflow_run_id,
      repository_full_name,
      framework as FrameworkType
    );

    if (result.success) {
      return successResponse({
        success: true,
        project_id: projectId,
        message: 'Build status tracking started',
        tracking_info: {
          workflow_run_id,
          repository_full_name,
          framework,
          started_at: new Date().toISOString()
        }
      });
    } else {
      return errorResponse(
        'TRACKING_START_FAILED',
        result.error || 'Failed to start build status tracking',
        500,
        {
          project_id: projectId,
          workflow_run_id,
          repository_full_name
        }
      );
    }

  } catch (error) {
    console.error('[BUILD-STATUS-TRACKING] Error starting tracking:', error);
    
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while starting status tracking',
      500,
      {
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * POST /api/projects/{id}/status/poll
 * Trigger build status polling and broadcast to SSE connections (request-triggered architecture)
 */
export async function triggerProjectStatusPollHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/');
    const projectId = pathSegments[3]; // /api/projects/{id}/status/poll

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Missing project ID in URL path',
        400
      );
    }

    console.info('[BUILD-STATUS-POLL] Triggering status poll', { project_id: projectId });

    // Get orchestrator instance
    const orchestrator = getBuildStatusOrchestrator(env);

    // Trigger polling which will also broadcast via SSE if connections exist
    const pollingResult = await orchestrator.triggerPolling(projectId);

    if (pollingResult.success) {
      return successResponse({
        success: true,
        project_id: projectId,
        status: pollingResult.status,
        polling_info: {
          is_registered: pollingResult.is_registered,
          is_timeout: pollingResult.is_timeout,
          should_poll_again: pollingResult.should_poll_again,
          next_poll_delay_ms: pollingResult.next_poll_delay,
          triggered_at: new Date().toISOString()
        },
        message: 'Status polling triggered and broadcast to SSE connections'
      });
    } else {
      return errorResponse(
        'POLLING_FAILED',
        pollingResult.error?.message || 'Failed to trigger status polling',
        pollingResult.is_timeout ? 408 : 500,
        {
          project_id: projectId,
          polling_info: {
            is_registered: pollingResult.is_registered,
            is_timeout: pollingResult.is_timeout,
            error_type: pollingResult.error?.type
          }
        }
      );
    }

  } catch (error) {
    console.error('[BUILD-STATUS-POLL] Error in triggerProjectStatusPollHandler:', error);
    
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while triggering status polling',
      500,
      {
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * DELETE /api/projects/{id}/status-tracking/stop  
 * Stop status tracking for a project
 */
export async function stopProjectStatusTrackingHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/');
    const projectId = pathSegments[3]; // /api/projects/{id}/status-tracking/stop

    if (!projectId) {
      return errorResponse(
        'INVALID_REQUEST',
        'Missing project ID in URL path',
        400
      );
    }

    console.info('[BUILD-STATUS-TRACKING] Stopping status tracking', { project_id: projectId });

    if (statusTracker) {
      statusTracker.stopTracking(projectId);
    }

    return successResponse({
      success: true,
      project_id: projectId,
      message: 'Build status tracking stopped'
    });

  } catch (error) {
    console.error('[BUILD-STATUS-TRACKING] Error stopping tracking:', error);
    
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while stopping status tracking',
      500,
      {
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}

/**
 * GET /api/status-tracking/stats
 * Get global status tracking statistics
 */
export async function getStatusTrackingStatsHandler(request: Request, env: Env): Promise<Response> {
  try {
    console.info('[BUILD-STATUS-STATS] Getting tracking statistics');

    const stats = {
      tracker_stats: statusTracker ? {
        active_trackers: statusTracker.getAllActiveTrackers().length,
        tracked_projects: statusTracker.getAllActiveTrackers().map(t => ({
          project_id: t.project_id,
          workflow_run_id: t.workflow_run_id,
          repository: t.repository_full_name,
          current_status: t.current_status,
          poll_count: t.poll_count,
          is_long_running: t.is_long_running,
          duration_ms: Date.now() - new Date(t.started_at).getTime()
        }))
      } : null,
      sse_stats: sseManager ? sseManager.getConnectionStats() : null,
      service_status: {
        tracker_available: statusTracker !== null,
        sse_available: sseManager !== null,
        github_configured: !!env.GITHUB_TOKEN
      }
    };

    return successResponse(stats);

  } catch (error) {
    console.error('[BUILD-STATUS-STATS] Error getting statistics:', error);
    
    return errorResponse(
      'INTERNAL_ERROR',
      'An unexpected error occurred while getting tracking statistics',
      500,
      {
        error: error instanceof Error ? error.message : String(error)
      }
    );
  }
}