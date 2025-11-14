/**
 * TASK-025: Build Status Orchestrator
 * 
 * This utility orchestrates the complete build status polling system by integrating
 * all the components: GitHub Queue Bridge, Build Status Tracker, and SSE Manager.
 * 
 * Features:
 * - Automatic status tracking initiation when builds start
 * - Intelligent polling coordination with GitHub Actions
 * - Real-time SSE broadcasting of status updates
 * - Long-running build detection and timeout handling
 * - Project metadata synchronization
 * - Comprehensive error handling and recovery
 */

import {
  BuildStatusTracker,
  EnhancedBuildStatus,
  createBuildStatusTracker,
  shouldTrackProjectStatus,
  formatBuildDuration
} from './buildStatusTracker';

import {
  SSEManager,
  getSSEManager
} from './sseManager';

import {
  GitHubQueueBridge,
  createGitHubQueueBridge,
  GitHubBridgeResult
} from './githubQueueBridge';

import {
  BuildJob,
  BuildStatus,
  ProjectMetadata,
  FrameworkType
} from '../types/api';

/**
 * Build orchestration result
 */
export interface BuildOrchestrationResult {
  success: boolean;
  project_id: string;
  workflow_run_id?: number;
  workflow_run_url?: string;
  tracking_started: boolean;
  sse_connections: number;
  error?: {
    type: 'github_trigger' | 'tracking_start' | 'metadata_update';
    message: string;
    details?: any;
  };
}

/**
 * Status polling orchestration options
 */
export interface StatusPollingOptions {
  enable_sse: boolean;
  long_build_threshold_ms?: number;
  max_polling_duration_ms?: number;
  broadcast_interval_ms?: number;
}

/**
 * Build Status Orchestrator - coordinates all status tracking components
 */
export class BuildStatusOrchestrator {
  private statusTracker: BuildStatusTracker | null = null;
  private sseManager: SSEManager | null = null;
  private githubBridge: GitHubQueueBridge | null = null;
  private env: Env;
  private activePollingProjects: Map<string, { 
    workflowRunId: number; 
    lastPollTime: number; 
    pollCount: number; 
    options: StatusPollingOptions;
  }> = new Map(); // project_id -> polling_metadata

  constructor(env: Env) {
    this.env = env;
    this.initialize();
  }

  /**
   * Initialize all components
   */
  private initialize(): void {
    console.info('✅ [BUILD-STATUS-ORCHESTRATOR] Initializing components');

    // Initialize GitHub Queue Bridge
    this.githubBridge = createGitHubQueueBridge(this.env);
    if (!this.githubBridge) {
      console.warn('[BUILD-STATUS-ORCHESTRATOR] GitHub Queue Bridge not available');
    }

    // Initialize Build Status Tracker
    this.statusTracker = createBuildStatusTracker(this.env);
    if (!this.statusTracker) {
      console.warn('[BUILD-STATUS-ORCHESTRATOR] Build Status Tracker not available');
    }

    // Initialize SSE Manager
    this.sseManager = getSSEManager();

    console.info('✅ [BUILD-STATUS-ORCHESTRATOR] Components initialized', {
      github_bridge: !!this.githubBridge,
      status_tracker: !!this.statusTracker,
      sse_manager: !!this.sseManager
    });
  }

  /**
   * Trigger build with integrated status tracking
   */
  async triggerBuildWithStatusTracking(
    buildJob: BuildJob,
    options?: StatusPollingOptions
  ): Promise<BuildOrchestrationResult> {
    const projectId = buildJob.project_id;
    
    console.info('🚀 [BUILD-STATUS-ORCHESTRATOR] Triggering build with status tracking', {
      project_id: projectId,
      job_id: buildJob.job_id,
      framework: buildJob.framework,
      options
    });

    const result: BuildOrchestrationResult = {
      success: false,
      project_id: projectId,
      tracking_started: false,
      sse_connections: 0
    };

    try {
      // Step 1: Trigger GitHub Actions build
      if (!this.githubBridge) {
        result.error = {
          type: 'github_trigger',
          message: 'GitHub Queue Bridge not available - builds cannot be triggered'
        };
        return result;
      }

      const buildResult = await this.githubBridge.triggerBuildFromQueue(buildJob);

      if (!buildResult.success) {
        result.error = {
          type: 'github_trigger',
          message: buildResult.error?.message || 'Failed to trigger GitHub Actions build',
          details: buildResult.error
        };
        return result;
      }

      result.workflow_run_id = buildResult.workflowRunId;
      result.workflow_run_url = buildResult.workflowRunUrl;

      console.info('✅ [BUILD-STATUS-ORCHESTRATOR] GitHub Actions build triggered', {
        project_id: projectId,
        workflow_run_id: buildResult.workflowRunId,
        workflow_run_url: buildResult.workflowRunUrl
      });

      // Step 2: Update project metadata with build tracking info
      if (buildResult.workflowRunId) {
        try {
          const { startProjectBuildTracking } = await import('./projectMetadataManager');
          const repositoryInfo = this.githubBridge.getRepositoryInfo();
          
          await startProjectBuildTracking(
            projectId,
            buildResult.workflowRunId,
            buildResult.workflowRunUrl || `https://github.com/${repositoryInfo.fullName}/actions/runs/${buildResult.workflowRunId}`,
            repositoryInfo.fullName,
            this.env
          );

          console.info('✅ [BUILD-STATUS-ORCHESTRATOR] Project metadata updated with build tracking', {
            project_id: projectId,
            workflow_run_id: buildResult.workflowRunId
          });

        } catch (metadataError) {
          console.warn('[BUILD-STATUS-ORCHESTRATOR] Failed to update project metadata with build tracking', {
            project_id: projectId,
            error: metadataError instanceof Error ? metadataError.message : String(metadataError)
          });
        }
      }

      // Step 3: Start status tracking
      if (this.statusTracker && buildResult.workflowRunId) {
        const repositoryInfo = this.githubBridge.getRepositoryInfo();
        
        const trackingResult = await this.statusTracker.startTracking(
          projectId,
          buildResult.workflowRunId,
          repositoryInfo.fullName,
          buildJob.framework
        );

        if (trackingResult.success) {
          result.tracking_started = true;
          console.info('✅ [BUILD-STATUS-ORCHESTRATOR] Status tracking started', {
            project_id: projectId,
            workflow_run_id: buildResult.workflowRunId
          });

          // Step 4: Register for intelligent polling
          this.registerForPolling(
            projectId, 
            buildResult.workflowRunId,
            options || { enable_sse: true }
          );

        } else {
          console.warn('[BUILD-STATUS-ORCHESTRATOR] Failed to start status tracking', {
            project_id: projectId,
            error: trackingResult.error
          });
        }
      }

      // Step 4: Get current SSE connections for this project
      if (this.sseManager) {
        const stats = this.sseManager.getConnectionStats();
        result.sse_connections = stats.connections_by_project[projectId] || 0;
      }

      result.success = true;
      
      console.info('🎉 [BUILD-STATUS-ORCHESTRATOR] Build orchestration completed successfully', {
        project_id: projectId,
        workflow_run_id: result.workflow_run_id,
        tracking_started: result.tracking_started,
        sse_connections: result.sse_connections
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ [BUILD-STATUS-ORCHESTRATOR] Build orchestration failed', {
        project_id: projectId,
        error: errorMessage
      });

      result.error = {
        type: 'github_trigger',
        message: errorMessage,
        details: error
      };

      return result;
    }
  }

  /**
   * Register project for request-triggered polling (Cloudflare Workers compatible)
   */
  private registerForPolling(
    projectId: string,
    workflowRunId: number,
    options: StatusPollingOptions
  ): void {
    console.info('📊 [BUILD-STATUS-ORCHESTRATOR] Registering project for request-triggered polling', {
      project_id: projectId,
      workflow_run_id: workflowRunId,
      options
    });

    this.activePollingProjects.set(projectId, {
      workflowRunId,
      lastPollTime: 0, // Will trigger immediate poll on first request
      pollCount: 0,
      options
    });
  }

  /**
   * Poll build status on-demand (called by frontend requests)
   * This replaces the setInterval-based approach with request-triggered polling
   */
  async pollProjectStatus(projectId: string): Promise<{
    success: boolean;
    status?: EnhancedBuildStatus;
    should_poll_again: boolean;
    next_poll_delay: number;
    error?: any;
  }> {
    const pollingData = this.activePollingProjects.get(projectId);
    if (!pollingData) {
      return {
        success: false,
        should_poll_again: false,
        next_poll_delay: 0,
        error: { message: 'Project not registered for polling' }
      };
    }

    if (!this.statusTracker) {
      return {
        success: false,
        should_poll_again: false,
        next_poll_delay: 0,
        error: { message: 'Status tracker not available' }
      };
    }

    const now = Date.now();
    const timeSinceLastPoll = now - pollingData.lastPollTime;
    const minPollInterval = pollingData.options.broadcast_interval_ms || 15000;

    // Implement intelligent polling intervals - don't poll too frequently
    if (timeSinceLastPoll < minPollInterval && pollingData.lastPollTime > 0) {
      const nextPollDelay = minPollInterval - timeSinceLastPoll;
      return {
        success: true,
        should_poll_again: true,
        next_poll_delay: nextPollDelay,
        error: { message: 'Too soon to poll again', retryable: true }
      };
    }

    try {
      // Update polling metadata
      pollingData.lastPollTime = now;
      pollingData.pollCount++;

      console.info('[BUILD-STATUS-ORCHESTRATOR] Polling build status on-demand', {
        project_id: projectId,
        poll_count: pollingData.pollCount,
        time_since_last_poll: timeSinceLastPoll
      });

      const pollingResult = await this.statusTracker.pollBuildStatus(projectId);

      if (pollingResult.success && pollingResult.status) {
        console.info('[BUILD-STATUS-ORCHESTRATOR] Status polled successfully', {
          project_id: projectId,
          status: pollingResult.status.status,
          progress: pollingResult.status.progress,
          stage: pollingResult.status.current_stage
        });

        // Broadcast via SSE if enabled
        if (pollingData.options.enable_sse && this.sseManager) {
          const broadcastResult = this.sseManager.broadcastStatusUpdate(
            pollingResult.status,
            { project_id: projectId }
          );

          console.info('[BUILD-STATUS-ORCHESTRATOR] SSE broadcast completed', {
            project_id: projectId,
            sent: broadcastResult.sent,
            failed: broadcastResult.failed
          });
        }

        // Check if build is complete or should stop polling
        if (!pollingResult.should_continue_polling) {
          console.info('🏁 [BUILD-STATUS-ORCHESTRATOR] Build completed, stopping polling', {
            project_id: projectId,
            final_status: pollingResult.status.status,
            duration: pollingResult.status.polling_metadata.polling_interval
          });

          // Send final notification via SSE
          if (pollingData.options.enable_sse && this.sseManager) {
            this.sseManager.broadcastBuildComplete(
              projectId,
              pollingResult.status
            );
          }

          // Remove from active polling
          this.activePollingProjects.delete(projectId);

          // Update project metadata with error isolation
          await this.updateProjectMetadataWithIsolation(projectId, pollingResult.status);

          return {
            success: true,
            status: pollingResult.status,
            should_poll_again: false,
            next_poll_delay: 0
          };
        }

        return {
          success: true,
          status: pollingResult.status,
          should_poll_again: true,
          next_poll_delay: pollingResult.next_poll_delay
        };

      } else {
        console.warn('[BUILD-STATUS-ORCHESTRATOR] Polling failed', {
          project_id: projectId,
          error: pollingResult.error?.message,
          retryable: pollingResult.error?.retryable
        });

        // Remove from active polling if error is not retryable
        if (!pollingResult.error?.retryable) {
          this.activePollingProjects.delete(projectId);
          
          return {
            success: false,
            should_poll_again: false,
            next_poll_delay: 0,
            error: pollingResult.error
          };
        }

        return {
          success: false,
          should_poll_again: true,
          next_poll_delay: pollingResult.next_poll_delay,
          error: pollingResult.error
        };
      }

    } catch (error) {
      console.error('[BUILD-STATUS-ORCHESTRATOR] Error in on-demand polling', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        should_poll_again: true,
        next_poll_delay: 30000, // Retry in 30 seconds on error
        error: { message: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * Check if project has exceeded maximum polling duration
   */
  isPollingTimedOut(projectId: string): boolean {
    const pollingData = this.activePollingProjects.get(projectId);
    if (!pollingData) return false;

    const maxDuration = pollingData.options.max_polling_duration_ms || 1800000; // 30 minutes default
    const pollingStartTime = pollingData.lastPollTime - (pollingData.pollCount * (pollingData.options.broadcast_interval_ms || 15000));
    
    return (Date.now() - pollingStartTime) > maxDuration;
  }

  /**
   * Update project metadata with final build status
   */
  private async updateProjectMetadata(
    projectId: string,
    status: EnhancedBuildStatus
  ): Promise<void> {
    try {
      console.info('[BUILD-STATUS-ORCHESTRATOR] Updating project metadata', {
        project_id: projectId,
        status: status.status,
        github_run_id: status.github_metadata.workflow_run_id
      });

      // Import metadata manager and update project metadata
      const { updateProjectWithBuildStatus } = await import('./projectMetadataManager');
      
      const updateResult = await updateProjectWithBuildStatus(
        projectId,
        status,
        this.env
      );

      if (updateResult.success) {
        console.info('✅ [BUILD-STATUS-ORCHESTRATOR] Project metadata updated successfully', {
          project_id: projectId,
          updated_fields: updateResult.updated_fields,
          final_status: status.status,
          build_duration: status.metadata.build_duration_ms
        });
      } else {
        console.error('[BUILD-STATUS-ORCHESTRATOR] Failed to update project metadata', {
          project_id: projectId,
          error: updateResult.error?.message,
          error_type: updateResult.error?.type
        });
      }

    } catch (error) {
      console.error('[BUILD-STATUS-ORCHESTRATOR] Error updating project metadata', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Update project metadata with error isolation to prevent cascading failures
   */
  private async updateProjectMetadataWithIsolation(
    projectId: string,
    status: EnhancedBuildStatus
  ): Promise<void> {
    // Wrap in Promise.allSettled for error isolation
    const [metadataResult] = await Promise.allSettled([
      this.updateProjectMetadata(projectId, status)
    ]);

    if (metadataResult.status === 'rejected') {
      console.error('[BUILD-STATUS-ORCHESTRATOR] Metadata update failed but isolated from other operations', {
        project_id: projectId,
        error: metadataResult.reason instanceof Error ? metadataResult.reason.message : String(metadataResult.reason)
      });
    }
  }

  /**
   * Stop polling for a specific project
   */
  stopPolling(projectId: string): boolean {
    const pollingData = this.activePollingProjects.get(projectId);
    
    if (pollingData) {
      this.activePollingProjects.delete(projectId);
      
      console.info('✅ [BUILD-STATUS-ORCHESTRATOR] Polling stopped', {
        project_id: projectId,
        poll_count: pollingData.pollCount
      });

      // Stop tracking in status tracker
      if (this.statusTracker) {
        this.statusTracker.stopTracking(projectId);
      }

      return true;
    }

    return false;
  }

  /**
   * Get orchestrator status and statistics
   */
  getOrchestratorStatus(): {
    components_status: {
      github_bridge: boolean;
      status_tracker: boolean;
      sse_manager: boolean;
    };
    active_polling: {
      project_count: number;
      project_ids: string[];
      polling_details: Record<string, {
        workflow_run_id: number;
        poll_count: number;
        last_poll_time: number;
      }>;
    };
    sse_connections: any;
    tracker_stats: any;
  } {
    const activePollingProjects = Array.from(this.activePollingProjects.keys());
    const pollingDetails: Record<string, any> = {};
    
    for (const [projectId, data] of Array.from(this.activePollingProjects)) {
      pollingDetails[projectId] = {
        workflow_run_id: data.workflowRunId,
        poll_count: data.pollCount,
        last_poll_time: data.lastPollTime
      };
    }
    
    return {
      components_status: {
        github_bridge: !!this.githubBridge,
        status_tracker: !!this.statusTracker,
        sse_manager: !!this.sseManager
      },
      active_polling: {
        project_count: activePollingProjects.length,
        project_ids: activePollingProjects,
        polling_details: pollingDetails
      },
      sse_connections: this.sseManager ? this.sseManager.getConnectionStats() : null,
      tracker_stats: this.statusTracker ? {
        active_trackers: this.statusTracker.getAllActiveTrackers().length,
        tracked_projects: this.statusTracker.getAllActiveTrackers()
      } : null
    };
  }

  /**
   * Cleanup all active polling projects (Cloudflare Workers compatible)
   */
  cleanup(): void {
    console.info('[BUILD-STATUS-ORCHESTRATOR] Cleaning up all active polling projects');

    // Clear all active polling projects
    for (const [projectId, pollingData] of Array.from(this.activePollingProjects)) {
      console.info(`[BUILD-STATUS-ORCHESTRATOR] Removed polling registration for ${projectId}`, {
        poll_count: pollingData.pollCount,
        last_poll_time: pollingData.lastPollTime
      });
    }

    this.activePollingProjects.clear();

    console.info('✅ [BUILD-STATUS-ORCHESTRATOR] Cleanup completed');
  }

  /**
   * Public method to trigger polling for a project (called by API endpoints)
   */
  async triggerPolling(projectId: string): Promise<{
    success: boolean;
    status?: EnhancedBuildStatus;
    should_poll_again: boolean;
    next_poll_delay: number;
    is_registered: boolean;
    is_timeout: boolean;
    error?: any;
  }> {
    // Check if project is registered for polling
    const isRegistered = this.activePollingProjects.has(projectId);
    
    if (!isRegistered) {
      return {
        success: false,
        should_poll_again: false,
        next_poll_delay: 0,
        is_registered: false,
        is_timeout: false,
        error: { message: 'Project not registered for polling. Build may not be active.' }
      };
    }

    // Check for timeout
    const isTimeout = this.isPollingTimedOut(projectId);
    if (isTimeout) {
      // Remove from active polling and broadcast timeout
      const pollingData = this.activePollingProjects.get(projectId)!;
      this.activePollingProjects.delete(projectId);
      
      if (pollingData.options.enable_sse && this.sseManager) {
        const maxDuration = pollingData.options.max_polling_duration_ms || 1800000;
        this.sseManager.broadcastBuildTimeout(projectId, maxDuration);
      }
      
      return {
        success: false,
        should_poll_again: false,
        next_poll_delay: 0,
        is_registered: true,
        is_timeout: true,
        error: { message: 'Build polling timeout exceeded' }
      };
    }

    // Trigger the actual polling
    const result = await this.pollProjectStatus(projectId);
    
    return {
      success: result.success,
      status: result.status,
      should_poll_again: result.should_poll_again,
      next_poll_delay: result.next_poll_delay,
      is_registered: true,
      is_timeout: false,
      error: result.error
    };
  }

  /**
   * Get polling status for a project without triggering a poll
   */
  getPollingStatus(projectId: string): {
    is_registered: boolean;
    is_timeout: boolean;
    poll_count: number;
    last_poll_time: number;
    next_allowed_poll_time: number;
  } {
    const pollingData = this.activePollingProjects.get(projectId);
    
    if (!pollingData) {
      return {
        is_registered: false,
        is_timeout: false,
        poll_count: 0,
        last_poll_time: 0,
        next_allowed_poll_time: 0
      };
    }
    
    const minInterval = pollingData.options.broadcast_interval_ms || 15000;
    const nextAllowedTime = pollingData.lastPollTime + minInterval;
    
    return {
      is_registered: true,
      is_timeout: this.isPollingTimedOut(projectId),
      poll_count: pollingData.pollCount,
      last_poll_time: pollingData.lastPollTime,
      next_allowed_poll_time: nextAllowedTime
    };
  }
}

/**
 * Global orchestrator instance (singleton for Cloudflare Workers)
 */
let globalOrchestrator: BuildStatusOrchestrator | null = null;

/**
 * Get or create global orchestrator instance
 */
export function getBuildStatusOrchestrator(env: Env): BuildStatusOrchestrator {
  if (!globalOrchestrator) {
    globalOrchestrator = new BuildStatusOrchestrator(env);
  }
  return globalOrchestrator;
}

/**
 * Factory function to create orchestrator with environment
 */
export function createBuildStatusOrchestrator(env: Env): BuildStatusOrchestrator {
  return new BuildStatusOrchestrator(env);
}

/**
 * Utility to integrate with existing build queue system
 */
export async function integrateWithBuildQueue(
  buildJob: BuildJob,
  env: Env,
  options?: StatusPollingOptions
): Promise<BuildOrchestrationResult> {
  const orchestrator = getBuildStatusOrchestrator(env);
  return await orchestrator.triggerBuildWithStatusTracking(buildJob, options);
}

/**
 * Utility to handle GitHub build callbacks with status updates
 */
export async function handleGitHubBuildCallback(
  projectId: string,
  workflowRunId: number,
  buildResult: any,
  env: Env
): Promise<void> {
  console.info('[BUILD-STATUS-ORCHESTRATOR] Processing GitHub build callback', {
    project_id: projectId,
    workflow_run_id: workflowRunId,
    result_status: buildResult.status
  });

  const orchestrator = getBuildStatusOrchestrator(env);
  const sseManager = orchestrator['sseManager'];

  if (sseManager && buildResult.status) {
    // Convert callback result to enhanced status format
    const enhancedStatus: EnhancedBuildStatus = {
      status: buildResult.status === 'success' ? 'completed' : 'failed',
      progress: buildResult.status === 'success' ? 100 : 0,
      current_stage: buildResult.status === 'success' ? 'deployment' : 'build',
      logs: buildResult.logs || [],
      metadata: {
        job_id: `${projectId}-${workflowRunId}`,
        queued_at: buildResult.queued_at || new Date().toISOString(),
        started_at: buildResult.started_at,
        completed_at: buildResult.completed_at || new Date().toISOString(),
        build_duration_ms: buildResult.build_duration_ms
      },
      github_metadata: {
        repository: buildResult.repository || '',
        workflow_run_id: workflowRunId,
        workflow_run_url: `https://github.com/${buildResult.repository}/actions/runs/${workflowRunId}`,
        workflow_name: buildResult.workflow_name || 'gpthost-build',
        run_number: buildResult.run_number || 0,
        triggered_at: buildResult.triggered_at || buildResult.queued_at || new Date().toISOString()
      },
      polling_metadata: {
        last_polled_at: new Date().toISOString(),
        next_poll_at: new Date().toISOString(),
        poll_count: 0,
        polling_interval: 0,
        is_long_running: false
      }
    };

    // Broadcast final status
    sseManager.broadcastBuildComplete(projectId, enhancedStatus);

    // Stop any active polling
    orchestrator.stopPolling(projectId);
  }
}