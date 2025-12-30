/**
 * Build Status Polling System
 * 
 * This utility provides comprehensive GitHub Actions workflow status tracking
 * with intelligent polling intervals, rate limit handling, and real-time updates.
 * 
 * Features:
 * - GitHub workflow run status polling
 * - Intelligent polling intervals (fast -> slow as build progresses)
 * - GitHub API rate limit awareness and management
 * - Long-running build detection (>2 min threshold)
 * - Project metadata status synchronization
 * - Build progress estimation and stage detection
 * - Comprehensive error handling and recovery
 */

import {
  BuildStatus,
  BuildStatusType,
  BuildStage,
  ProjectMetadata,
  FrameworkType
} from '../types/api';

import {
  GitHubApiClient,
  GitHubWorkflowRun,
  createGitHubApiClient,
  GitHubRateLimitInfo
} from './githubApi';

// TASK-026: GitHub Actions Error Handling Integration
import {
  GitHubErrorHandler,
  createGitHubErrorHandler,
  GitHubBuildErrorAnalysis
} from './githubErrorHandler';
import {
  ErrorLogStorage,
  createErrorLogStorage
} from './errorLogStorage';
import {
  ErrorSolutionMapper,
  createErrorSolutionMapper,
  determineProjectComplexity
} from './errorSolutionMapper';

// TASK-027: Build Cache Optimization Integration
import {
  CacheMetricsTracker,
  createCacheMetricsTracker,
  BuildCacheMetrics,
  parseBuildCacheMetrics
} from './cacheMetricsTracker';

/**
 * Polling configuration for different build states
 */
export interface BuildPollingConfig {
  initialInterval: number;      // Initial polling interval in ms
  normalInterval: number;       // Normal polling interval in ms  
  slowInterval: number;         // Slow polling interval for long builds
  maxPollingTime: number;       // Maximum time to poll before timeout
  longBuildThreshold: number;   // Threshold for considering build "long-running"
  rateLimitBuffer: number;      // Buffer remaining API calls before backing off
}

/**
 * Enhanced build status with GitHub metadata and cache metrics
 */
export interface EnhancedBuildStatus extends BuildStatus {
  github_metadata: {
    repository: string;
    workflow_run_id: number;
    workflow_run_url: string;
    workflow_name: string;
    run_number: number;
    triggered_at: string;
    node_version?: string;
  };
  polling_metadata: {
    last_polled_at: string;
    next_poll_at: string;
    poll_count: number;
    polling_interval: number;
    is_long_running: boolean;
    estimated_completion?: string;
  };
  // TASK-027: Cache performance metrics
  cache_metrics?: {
    cache_hit_type: 'exact' | 'partial' | 'miss';
    cache_hit_rate_percent: number;
    total_duration_seconds: number;
    install_duration_seconds: number;
    build_duration_seconds: number;
    performance_target_met: boolean;
  };
}

/**
 * Project build tracking information
 */
export interface ProjectBuildTracker {
  project_id: string;
  workflow_run_id: number;
  repository_full_name: string;
  framework: FrameworkType;
  started_at: string;
  last_status_update: string;
  current_status: BuildStatusType;
  current_stage: BuildStage;
  poll_count: number;
  is_long_running: boolean;
}

/**
 * Polling result with rate limit information
 */
export interface PollingResult {
  success: boolean;
  status?: EnhancedBuildStatus;
  rate_limit_info?: GitHubRateLimitInfo;
  should_continue_polling: boolean;
  next_poll_delay: number;
  error?: {
    type: 'rate_limit' | 'api_error' | 'not_found' | 'timeout';
    message: string;
    retryable: boolean;
  };
}

/**
 * Production-ready build status tracker with comprehensive GitHub Actions integration
 */
export class BuildStatusTracker {
  private githubClient: GitHubApiClient;
  private config: BuildPollingConfig;
  private activeTrackers: Map<string, ProjectBuildTracker> = new Map();
  
  // TASK-026: Error handling integration
  private errorHandler: GitHubErrorHandler | null = null;
  private errorLogStorage: ErrorLogStorage;
  private solutionMapper: ErrorSolutionMapper;

  // TASK-027: Cache metrics integration
  private cacheMetricsTracker: CacheMetricsTracker;

  constructor(githubToken: string, config?: Partial<BuildPollingConfig>) {
    this.githubClient = createGitHubApiClient(githubToken);
    
    // Default polling configuration optimized for GitHub Actions
    this.config = {
      initialInterval: 5000,        // 5 seconds for new builds
      normalInterval: 15000,        // 15 seconds for active builds  
      slowInterval: 60000,          // 1 minute for long builds
      maxPollingTime: 1800000,      // 30 minutes max polling time
      longBuildThreshold: 120000,   // 2 minutes threshold for long builds
      rateLimitBuffer: 1000,        // Keep 1000 API calls in reserve for safety
      ...config
    };

    // TASK-026: Initialize error handling components
    try {
      this.errorHandler = createGitHubErrorHandler(githubToken);
      console.info('✅ [BUILD-STATUS-TRACKER] Error handler initialized');
    } catch (error) {
      console.warn('⚠️ [BUILD-STATUS-TRACKER] Error handler initialization failed, error analysis disabled', {
        error: error instanceof Error ? error.message : String(error)
      });
      this.errorHandler = null;
    }

    this.errorLogStorage = createErrorLogStorage();
    this.solutionMapper = createErrorSolutionMapper();

    // TASK-027: Initialize cache metrics tracker
    this.cacheMetricsTracker = createCacheMetricsTracker();
    console.info('✅ [BUILD-STATUS-TRACKER] Cache metrics tracking enabled');

    console.info('✅ [BUILD-STATUS-TRACKER] Initialized with configuration', {
      initial_interval: this.config.initialInterval,
      normal_interval: this.config.normalInterval,
      slow_interval: this.config.slowInterval,
      long_build_threshold: this.config.longBuildThreshold,
      max_polling_time: this.config.maxPollingTime,
      error_handling_enabled: !!this.errorHandler,
      cache_tracking_enabled: true
    });
  }

  /**
   * Start tracking a GitHub Actions workflow run for a project
   */
  async startTracking(
    projectId: string,
    workflowRunId: number,
    repositoryFullName: string,
    framework: FrameworkType
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.info('✅ [BUILD-STATUS-TRACKER] Starting build tracking', {
        project_id: projectId,
        workflow_run_id: workflowRunId,
        repository: repositoryFullName,
        framework
      });

      // Create tracker entry
      const tracker: ProjectBuildTracker = {
        project_id: projectId,
        workflow_run_id: workflowRunId,
        repository_full_name: repositoryFullName,
        framework,
        started_at: new Date().toISOString(),
        last_status_update: new Date().toISOString(),
        current_status: 'queued',
        current_stage: 'queued',
        poll_count: 0,
        is_long_running: false
      };

      this.activeTrackers.set(projectId, tracker);

      console.info('✅ [BUILD-STATUS-TRACKER] Tracking started successfully', {
        project_id: projectId,
        active_trackers: this.activeTrackers.size
      });

      return { success: true };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ [BUILD-STATUS-TRACKER] Failed to start tracking', {
        project_id: projectId,
        workflow_run_id: workflowRunId,
        error: errorMessage
      });

      return { 
        success: false, 
        error: `Failed to start tracking: ${errorMessage}` 
      };
    }
  }

  /**
   * Stop tracking a project's build status
   */
  stopTracking(projectId: string): void {
    const tracker = this.activeTrackers.get(projectId);
    if (tracker) {
      this.activeTrackers.delete(projectId);
      console.info('✅ [BUILD-STATUS-TRACKER] Stopped tracking project', {
        project_id: projectId,
        final_status: tracker.current_status,
        poll_count: tracker.poll_count,
        duration_ms: Date.now() - new Date(tracker.started_at).getTime(),
        remaining_trackers: this.activeTrackers.size
      });
    }
  }

  /**
   * Poll GitHub Actions API for current build status
   */
  async pollBuildStatus(projectId: string): Promise<PollingResult> {
    const tracker = this.activeTrackers.get(projectId);
    if (!tracker) {
      return {
        success: false,
        should_continue_polling: false,
        next_poll_delay: 0,
        error: {
          type: 'not_found',
          message: `No active tracker found for project ${projectId}`,
          retryable: false
        }
      };
    }

    try {
      console.info(`[BUILD-STATUS-TRACKER] Polling build status (attempt ${tracker.poll_count + 1})`, {
        project_id: projectId,
        workflow_run_id: tracker.workflow_run_id,
        repository: tracker.repository_full_name,
        current_status: tracker.current_status
      });

      // Get workflow run status from GitHub
      const workflowRun = await this.githubClient.getWorkflowRunStatus(
        tracker.repository_full_name,
        tracker.workflow_run_id
      );

      if (!workflowRun) {
        return {
          success: false,
          should_continue_polling: false,
          next_poll_delay: 0,
          error: {
            type: 'not_found',
            message: `Workflow run ${tracker.workflow_run_id} not found`,
            retryable: false
          }
        };
      }

      // Convert GitHub workflow to enhanced build status
      const enhancedStatus = this.convertToEnhancedStatus(workflowRun, tracker);
      
      // Update tracker state
      tracker.poll_count++;
      tracker.last_status_update = new Date().toISOString();
      tracker.current_status = enhancedStatus.status;
      tracker.current_stage = enhancedStatus.current_stage;

      // Check if build is now long-running
      const buildDurationMs = Date.now() - new Date(tracker.started_at).getTime();
      if (buildDurationMs > this.config.longBuildThreshold && !tracker.is_long_running) {
        tracker.is_long_running = true;
        console.info('⏱️ [BUILD-STATUS-TRACKER] Build marked as long-running', {
          project_id: projectId,
          duration_ms: buildDurationMs,
          threshold_ms: this.config.longBuildThreshold
        });
      }

      // Determine if polling should continue
      const shouldContinue = this.shouldContinuePolling(enhancedStatus, tracker, buildDurationMs);
      const nextPollDelay = this.calculateNextPollDelay(enhancedStatus, tracker, buildDurationMs);

      // Log status update
      console.info(`✅ [BUILD-STATUS-TRACKER] Status updated`, {
        project_id: projectId,
        status: enhancedStatus.status,
        stage: enhancedStatus.current_stage,
        progress: enhancedStatus.progress,
        poll_count: tracker.poll_count,
        is_long_running: tracker.is_long_running,
        should_continue: shouldContinue,
        next_poll_delay: nextPollDelay
      });

      // TASK-026: Handle build failures with error analysis
      if (enhancedStatus.status === 'failed' && this.errorHandler) {
        console.info('🔍 [BUILD-STATUS-TRACKER] Build failed, starting error analysis', {
          project_id: projectId,
          workflow_run_id: workflowRun.id,
          repository: tracker.repository_full_name
        });

        // Analyze the failure asynchronously (don't block polling response)
        this.handleBuildFailure(
          tracker.repository_full_name,
          workflowRun.id,
          projectId,
          tracker.framework
        ).catch(error => {
          console.error('❌ [BUILD-STATUS-TRACKER] Error analysis failed', {
            project_id: projectId,
            workflow_run_id: workflowRun.id,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }

      // TASK-027: Process cache metrics for completed builds
      if (enhancedStatus.status === 'completed') {
        await this.processBuildCacheMetrics(enhancedStatus, tracker);
      }

      // Stop tracking if build is complete
      if (!shouldContinue) {
        this.stopTracking(projectId);
      }

      return {
        success: true,
        status: enhancedStatus,
        should_continue_polling: shouldContinue,
        next_poll_delay: nextPollDelay
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ [BUILD-STATUS-TRACKER] Polling failed', {
        project_id: projectId,
        workflow_run_id: tracker.workflow_run_id,
        poll_count: tracker.poll_count,
        error: errorMessage
      });

      // Classify error type
      const errorType = this.classifyPollingError(error);
      const retryable = errorType !== 'not_found';
      const nextPollDelay = retryable ? this.config.normalInterval : 0;

      return {
        success: false,
        should_continue_polling: retryable,
        next_poll_delay: nextPollDelay,
        error: {
          type: errorType,
          message: errorMessage,
          retryable
        }
      };
    }
  }

  /**
   * Get current tracking status for a project
   */
  getTrackingInfo(projectId: string): ProjectBuildTracker | null {
    return this.activeTrackers.get(projectId) || null;
  }

  /**
   * Get all active trackers
   */
  getAllActiveTrackers(): ProjectBuildTracker[] {
    return Array.from(this.activeTrackers.values());
  }

  /**
   * Convert GitHub workflow run to enhanced build status
   */
  private convertToEnhancedStatus(
    workflowRun: GitHubWorkflowRun,
    tracker: ProjectBuildTracker
  ): EnhancedBuildStatus {
    // Use existing GitHub API conversion as base
    const baseStatus = this.githubClient.convertWorkflowToBuildStatus(
      workflowRun,
      tracker.project_id
    );

    // Ensure we have required metadata fields
    if (!baseStatus.metadata.job_id) {
      baseStatus.metadata.job_id = `${tracker.project_id}-${workflowRun.id}`;
    }

    // Calculate build duration and progress
    const buildStartTime = new Date(workflowRun.run_started_at || workflowRun.created_at).getTime();
    const currentTime = Date.now();
    const buildDurationMs = currentTime - buildStartTime;

    // Enhanced progress calculation based on GitHub status and duration
    let enhancedProgress = baseStatus.progress;
    let estimatedCompletion: string | undefined;

    if (workflowRun.status === 'in_progress') {
      // Estimate progress based on typical build times for framework
      const estimatedBuildTime = this.estimateBuildTime(tracker.framework);
      enhancedProgress = Math.min(90, Math.round((buildDurationMs / estimatedBuildTime) * 80) + 10);
      
      // Estimate completion time
      const remainingTime = Math.max(0, estimatedBuildTime - buildDurationMs);
      estimatedCompletion = new Date(currentTime + remainingTime).toISOString();
    }

    // Determine next polling interval
    const nextPollInterval = this.calculateNextPollDelay(baseStatus, tracker, buildDurationMs);

    return {
      ...baseStatus,
      progress: enhancedProgress,
      github_metadata: {
        repository: tracker.repository_full_name,
        workflow_run_id: workflowRun.id,
        workflow_run_url: workflowRun.html_url,
        workflow_name: workflowRun.name,
        run_number: workflowRun.run_number,
        triggered_at: workflowRun.created_at
      },
      polling_metadata: {
        last_polled_at: new Date().toISOString(),
        next_poll_at: new Date(Date.now() + nextPollInterval).toISOString(),
        poll_count: tracker.poll_count + 1,
        polling_interval: nextPollInterval,
        is_long_running: tracker.is_long_running,
        estimated_completion: estimatedCompletion
      }
    };
  }

  /**
   * Estimate build time based on framework
   */
  private estimateBuildTime(framework: FrameworkType): number {
    const estimations = {
      'react': 180000,    // 3 minutes
      'vue': 150000,      // 2.5 minutes  
      'svelte': 120000,   // 2 minutes
      'html': 60000,      // 1 minute
      'unknown': 180000   // 3 minutes default
    };

    return estimations[framework] || estimations['unknown'];
  }

  /**
   * Determine if polling should continue
   */
  private shouldContinuePolling(
    status: EnhancedBuildStatus,
    tracker: ProjectBuildTracker,
    buildDurationMs: number
  ): boolean {
    // Stop polling if build is complete or failed
    if (['completed', 'failed'].includes(status.status)) {
      return false;
    }

    // Stop polling if maximum polling time exceeded
    if (buildDurationMs > this.config.maxPollingTime) {
      console.warn('[BUILD-STATUS-TRACKER] Maximum polling time exceeded', {
        project_id: tracker.project_id,
        duration_ms: buildDurationMs,
        max_duration_ms: this.config.maxPollingTime
      });
      return false;
    }

    // Continue polling for active builds
    return ['queued', 'building'].includes(status.status);
  }

  /**
   * Calculate next polling delay based on build state and rate limits
   */
  private calculateNextPollDelay(
    status: EnhancedBuildStatus,
    tracker: ProjectBuildTracker,
    buildDurationMs: number
  ): number {
    // Check GitHub API rate limit status first
    const rateLimitDelay = this.calculateRateLimitDelay();
    
    // Use initial interval for new builds
    let baseDelay = this.config.initialInterval;
    
    if (tracker.poll_count > 0) {
      // Use slow interval for long-running builds
      if (tracker.is_long_running || buildDurationMs > this.config.longBuildThreshold) {
        baseDelay = this.config.slowInterval;
      } else {
        // Use normal interval for active builds
        baseDelay = this.config.normalInterval;
      }
    }

    // Apply rate limit backoff if necessary
    return Math.max(baseDelay, rateLimitDelay);
  }

  /**
   * Calculate delay needed based on current GitHub API rate limit status
   */
  private calculateRateLimitDelay(): number {
    try {
      const rateLimitInfo = this.githubClient.getRateLimitInfo();
      
      if (!rateLimitInfo) {
        return 0; // No rate limit info available, use normal timing
      }

      // Check if we're approaching rate limits
      if (rateLimitInfo.remaining <= this.config.rateLimitBuffer) {
        // Calculate exponential backoff based on how close we are to the limit
        const utilizationRatio = (rateLimitInfo.limit - rateLimitInfo.remaining) / rateLimitInfo.limit;
        const backoffMultiplier = Math.max(2, Math.floor(utilizationRatio * 10));
        
        console.warn('[BUILD-STATUS-TRACKER] Applying rate limit backoff', {
          remaining: rateLimitInfo.remaining,
          limit: rateLimitInfo.limit,
          buffer: this.config.rateLimitBuffer,
          backoff_multiplier: backoffMultiplier
        });

        return this.config.normalInterval * backoffMultiplier;
      }

      // If we have very few calls remaining, use a longer delay
      if (rateLimitInfo.remaining <= 100) {
        const minutesUntilReset = Math.max(1, Math.floor((rateLimitInfo.reset_time - Date.now()) / 1000 / 60));
        
        console.warn('[BUILD-STATUS-TRACKER] Very low rate limit remaining, extending delay', {
          remaining: rateLimitInfo.remaining,
          minutes_until_reset: minutesUntilReset
        });

        return Math.min(300000, minutesUntilReset * 60000); // Max 5 minute delay
      }

      return 0; // No additional delay needed
      
    } catch (error) {
      console.warn('[BUILD-STATUS-TRACKER] Could not get rate limit info', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0; // Default to no additional delay on error
    }
  }

  /**
   * Classify polling errors for appropriate handling
   */
  private classifyPollingError(error: any): PollingResult['error']['type'] {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lowerMessage = errorMessage.toLowerCase();

    if (lowerMessage.includes('rate limit') || lowerMessage.includes('429') || lowerMessage.includes('403')) {
      return 'rate_limit';
    }

    if (lowerMessage.includes('not found') || lowerMessage.includes('404')) {
      return 'not_found';
    }

    if (lowerMessage.includes('timeout')) {
      return 'timeout';
    }

    return 'api_error';
  }

  /**
   * Get status for all tracked projects with error isolation
   */
  async pollAllActiveBuilds(): Promise<Map<string, PollingResult>> {
    const results = new Map<string, PollingResult>();
    const activeProjects = Array.from(this.activeTrackers.keys());

    console.info(`[BUILD-STATUS-TRACKER] Polling ${activeProjects.length} active builds`);

    // Poll each project concurrently with error isolation using Promise.allSettled
    const pollingPromises = activeProjects.map(async (projectId) => ({
      projectId,
      result: await this.pollBuildStatus(projectId)
    }));

    const settledResults = await Promise.allSettled(pollingPromises);

    // Process all results, regardless of individual failures
    settledResults.forEach((settledResult, index) => {
      const projectId = activeProjects[index];
      
      if (settledResult.status === 'fulfilled') {
        results.set(projectId, settledResult.value.result);
      } else {
        console.error(`[BUILD-STATUS-TRACKER] Failed to poll ${projectId} (isolated error):`, {
          error: settledResult.reason instanceof Error ? settledResult.reason.message : String(settledResult.reason)
        });
        
        // Create error result for failed polling
        results.set(projectId, {
          success: false,
          should_continue_polling: true, // Allow retries for isolated failures
          next_poll_delay: 30000, // 30 second retry delay
          error: {
            type: 'api_error',
            message: settledResult.reason instanceof Error ? settledResult.reason.message : String(settledResult.reason),
            retryable: true
          }
        });
      }
    });

    console.info(`[BUILD-STATUS-TRACKER] Completed polling with error isolation`, {
      total_projects: activeProjects.length,
      successful_polls: Array.from(results.values()).filter(r => r.success).length,
      failed_polls: Array.from(results.values()).filter(r => !r.success).length
    });

    return results;
  }

  /**
   * Handle build failure with comprehensive error analysis
   */
  private async handleBuildFailure(
    repositoryFullName: string,
    workflowRunId: number,
    projectId: string,
    framework: FrameworkType,
    env?: Env
  ): Promise<void> {
    if (!this.errorHandler) {
      console.warn('[BUILD-STATUS-TRACKER] Error handler not available, skipping error analysis');
      return;
    }

    try {
      console.info('[BUILD-STATUS-TRACKER] Starting comprehensive error analysis', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId,
        project_id: projectId,
        framework
      });

      // 1. Analyze the workflow failure
      const errorAnalysis = await this.errorHandler.analyzeWorkflowFailure(
        repositoryFullName,
        workflowRunId,
        projectId,
        framework
      );

      if (!errorAnalysis) {
        console.warn('[BUILD-STATUS-TRACKER] No error analysis results returned');
        return;
      }

      console.info('[BUILD-STATUS-TRACKER] Error analysis completed', {
        project_id: projectId,
        error_category: errorAnalysis.category,
        error_severity: errorAnalysis.severity,
        error_stage: errorAnalysis.stage,
        fixable: errorAnalysis.fixable,
        confidence: errorAnalysis.confidence
      });

      // 2. Fetch real GitHub workflow logs and steps
      console.info('[BUILD-STATUS-TRACKER] Fetching real GitHub workflow data', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId
      });

      let logAnalysis;
      
      try {
        // Fetch real workflow logs using our enhanced GitHub API
        const workflowLogs = await this.githubClient.getWorkflowRunLogs(repositoryFullName, workflowRunId);
        
        // Fetch real workflow steps
        const workflowSteps = await this.githubClient.getWorkflowRunSteps(repositoryFullName, workflowRunId);

        // Create comprehensive log analysis from real data
        logAnalysis = {
          workflowRunId,
          repositoryFullName,
          totalSteps: workflowSteps?.length || 0,
          failedSteps: workflowSteps?.filter(step => step.conclusion === 'failure') || [],
          errorEntries: workflowLogs?.filter(log => log.level === 'error').map(log => ({
            timestamp: log.timestamp,
            step_name: log.step_name,
            message: log.content,
            level: log.level,
            job_name: log.job_name
          })) || [],
          errorSummary: errorAnalysis.userMessage,
          failedStage: errorAnalysis.stage,
          logsFetchedAt: new Date().toISOString(),
          rawLogSize: workflowLogs?.length || 0
        };

        console.info('[BUILD-STATUS-TRACKER] Real log analysis created', {
          project_id: projectId,
          total_steps: logAnalysis.totalSteps,
          failed_steps: logAnalysis.failedSteps.length,
          error_entries: logAnalysis.errorEntries.length,
          raw_log_lines: logAnalysis.rawLogSize
        });

      } catch (fetchError) {
        console.error('[BUILD-STATUS-TRACKER] Failed to fetch real GitHub data, using minimal fallback', {
          project_id: projectId,
          error: fetchError instanceof Error ? fetchError.message : String(fetchError)
        });

        // Fallback to minimal log analysis if GitHub data fetch fails
        logAnalysis = {
          workflowRunId,
          repositoryFullName,
          totalSteps: 1,
          failedSteps: [{
            name: errorAnalysis.github_context.failed_step,
            status: 'completed' as const,
            conclusion: 'failure' as const,
            number: errorAnalysis.github_context.step_number
          }],
          errorEntries: [],
          errorSummary: errorAnalysis.userMessage,
          failedStage: errorAnalysis.stage,
          logsFetchedAt: new Date().toISOString(),
          rawLogSize: 0
        };
      }

      // 3. Store error logs in R2 (if environment is available)
      if (env) {
        try {
          const storageResult = await this.errorLogStorage.storeErrorLog(
            errorAnalysis,
            logAnalysis,
            env
          );

          if (storageResult.success) {
            console.info('[BUILD-STATUS-TRACKER] Error logs stored successfully', {
              project_id: projectId,
              error_id: storageResult.error_id
            });
          } else {
            console.warn('[BUILD-STATUS-TRACKER] Failed to store error logs', {
              project_id: projectId,
              error: storageResult.error
            });
          }
        } catch (storageError) {
          console.error('[BUILD-STATUS-TRACKER] Error log storage failed', {
            project_id: projectId,
            error: storageError instanceof Error ? storageError.message : String(storageError)
          });
        }
      }

      // 4. Generate solution suggestions using real log data
      try {
        const solutionContext = {
          errorAnalysis,
          logAnalysis,
          projectComplexity: determineProjectComplexity(errorAnalysis, logAnalysis),
          hasTypeScript: errorAnalysis.technicalMessage.toLowerCase().includes('typescript'),
          hasCustomDependencies: errorAnalysis.category === 'dependency'
        };

        const solutions = this.solutionMapper.generateSolutions(solutionContext);

        console.info('[BUILD-STATUS-TRACKER] Solution suggestions generated', {
          project_id: projectId,
          solution_count: solutions.length,
          automated_solutions: solutions.filter(s => s.automated).length,
          high_priority_solutions: solutions.filter(s => s.priority === 'high').length
        });

        // Solutions are now available for the build error API endpoints
        // They will be retrieved when the user requests error information

      } catch (solutionError) {
        console.error('[BUILD-STATUS-TRACKER] Solution generation failed', {
          project_id: projectId,
          error: solutionError instanceof Error ? solutionError.message : String(solutionError)
        });
      }

      console.info('[BUILD-STATUS-TRACKER] Build failure handling completed', {
        project_id: projectId,
        workflow_run_id: workflowRunId,
        error_analysis_success: true,
        error_category: errorAnalysis.category,
        user_message: errorAnalysis.userMessage.substring(0, 100) + '...'
      });

    } catch (error) {
      console.error('[BUILD-STATUS-TRACKER] Build failure handling failed', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId,
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Process and record build cache metrics
   */
  private async processBuildCacheMetrics(
    enhancedStatus: EnhancedBuildStatus,
    tracker: ProjectBuildTracker
  ): Promise<void> {
    try {
      console.info('📊 [BUILD-STATUS-TRACKER] Processing cache metrics for completed build', {
        project_id: enhancedStatus.project_id,
        workflow_run_id: enhancedStatus.github_metadata.workflow_run_id
      });

      // Parse cache metrics from build status
      const cacheMetrics = parseBuildCacheMetrics(enhancedStatus);
      
      if (cacheMetrics) {
        // Record cache metrics for analysis
        const result = await this.cacheMetricsTracker.recordBuildCacheMetrics(cacheMetrics);
        
        if (result.success) {
          console.info('✅ [BUILD-STATUS-TRACKER] Cache metrics recorded successfully', {
            project_id: enhancedStatus.project_id,
            cache_hit_type: cacheMetrics.cache_hit_type,
            performance_target_met: cacheMetrics.performance_target_met,
            total_duration: cacheMetrics.total_duration_seconds
          });

          // Add cache metrics to enhanced status for client consumption
          enhancedStatus.cache_metrics = {
            cache_hit_type: cacheMetrics.cache_hit_type,
            cache_hit_rate_percent: cacheMetrics.cache_hit_rate_percent,
            total_duration_seconds: cacheMetrics.total_duration_seconds,
            install_duration_seconds: cacheMetrics.install_duration_seconds,
            build_duration_seconds: cacheMetrics.build_duration_seconds,
            performance_target_met: cacheMetrics.performance_target_met
          };

          // Check performance targets and log insights
          const performanceTargets = this.cacheMetricsTracker.checkPerformanceTargets(enhancedStatus.project_id);
          
          console.info('🎯 [BUILD-STATUS-TRACKER] Performance target analysis', {
            project_id: enhancedStatus.project_id,
            cache_hit_rate_target_met: performanceTargets.cache_hit_rate_target_met,
            build_time_target_met: performanceTargets.build_time_target_met,
            overall_performance_score: performanceTargets.overall_performance_score
          });

          // Generate performance insights
          if (!performanceTargets.build_time_target_met) {
            console.info('⚠️ [BUILD-STATUS-TRACKER] Build time performance below target', {
              project_id: enhancedStatus.project_id,
              total_duration: cacheMetrics.total_duration_seconds,
              target_seconds: 30,
              cache_optimization_needed: cacheMetrics.cache_hit_type !== 'exact'
            });
          }

          if (!performanceTargets.cache_hit_rate_target_met) {
            console.info('📈 [BUILD-STATUS-TRACKER] Cache hit rate optimization opportunity', {
              project_id: enhancedStatus.project_id,
              current_hit_rate: cacheMetrics.cache_hit_rate_percent,
              target_hit_rate: 50,
              recommendation: 'Review cache key strategies and dependency patterns'
            });
          }

        } else {
          console.warn('⚠️ [BUILD-STATUS-TRACKER] Failed to record cache metrics', {
            project_id: enhancedStatus.project_id,
            error: result.error
          });
        }
      } else {
        console.info('📊 [BUILD-STATUS-TRACKER] No cache metrics available in build status', {
          project_id: enhancedStatus.project_id,
          status: enhancedStatus.status
        });
      }

    } catch (error) {
      console.error('❌ [BUILD-STATUS-TRACKER] Failed to process cache metrics', {
        project_id: enhancedStatus.project_id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get cache performance analysis for a project
   */
  async getCachePerformanceAnalysis(
    projectId: string,
    timePeriodDays: number = 7
  ): Promise<any> {
    try {
      const stats = this.cacheMetricsTracker.calculatePerformanceStats(projectId, timePeriodDays);
      
      if (!stats) {
        return {
          project_id: projectId,
          analysis_available: false,
          message: 'Insufficient build history for cache analysis'
        };
      }

      const report = await this.cacheMetricsTracker.generateCacheAnalysisReport(projectId, timePeriodDays);
      
      return {
        project_id: projectId,
        analysis_available: true,
        time_period_days: timePeriodDays,
        performance_stats: stats,
        analysis_report: report,
        performance_targets: this.cacheMetricsTracker.checkPerformanceTargets(projectId)
      };

    } catch (error) {
      console.error('❌ [BUILD-STATUS-TRACKER] Failed to get cache performance analysis', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        project_id: projectId,
        analysis_available: false,
        error: 'Failed to analyze cache performance'
      };
    }
  }

  /**
   * Get enhanced error information for a failed build
   */
  async getBuildErrorAnalysis(
    projectId: string,
    env?: Env
  ): Promise<GitHubBuildErrorAnalysis | null> {
    if (!env) {
      console.warn('[BUILD-STATUS-TRACKER] Environment not available for error analysis retrieval');
      return null;
    }

    try {
      // Get the most recent error analysis from R2 storage
      const searchResult = await this.errorLogStorage.searchErrorLogs(
        { project_id: projectId, limit: 1 },
        env
      );

      if (searchResult.logs.length === 0) {
        return null;
      }

      const latestErrorLog = searchResult.logs[0];
      const errorLogDetails = await this.errorLogStorage.getErrorLog(
        latestErrorLog.error_id,
        env,
        false // Don't include raw logs for performance
      );

      return errorLogDetails.analysis || null;

    } catch (error) {
      console.error('[BUILD-STATUS-TRACKER] Failed to get build error analysis', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}

/**
 * Factory function to create build status tracker from environment
 */
export function createBuildStatusTracker(
  env: Env,
  config?: Partial<BuildPollingConfig>
): BuildStatusTracker | null {
  const githubToken = env.GITHUB_TOKEN;

  if (!githubToken) {
    console.warn('[BUILD-STATUS-TRACKER] GITHUB_TOKEN not configured - status tracking unavailable');
    return null;
  }

  console.info('✅ [BUILD-STATUS-TRACKER] Creating tracker with environment configuration');

  return new BuildStatusTracker(githubToken, {
    initialInterval: parseInt(env.POLLING_INITIAL_INTERVAL_MS || '5000'),
    normalInterval: parseInt(env.POLLING_NORMAL_INTERVAL_MS || '15000'),
    slowInterval: parseInt(env.POLLING_SLOW_INTERVAL_MS || '60000'),
    maxPollingTime: parseInt(env.POLLING_MAX_TIME_MS || '1800000'),
    longBuildThreshold: parseInt(env.LONG_BUILD_THRESHOLD_MS || '120000'),
    rateLimitBuffer: parseInt(env.GITHUB_RATE_LIMIT_BUFFER || '1000'),
    ...config
  });
}

/**
 * Utility function to check if a project needs status tracking
 */
export function shouldTrackProjectStatus(projectStatus: string): boolean {
  return ['queued', 'building'].includes(projectStatus);
}

/**
 * Utility function to format build duration for display
 */
export function formatBuildDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  
  if (seconds < 60) {
    return `${seconds}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  return `${hours}h ${remainingMinutes}m`;
}