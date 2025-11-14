/**
 * Error Log Storage System - TASK-026
 * 
 * Comprehensive R2 storage system for GitHub Actions error logs and analysis.
 * Provides structured storage, retrieval, and management of build error logs
 * for debugging, analytics, and support purposes.
 * 
 * Features:
 * - Structured error log storage in R2 with proper organization
 * - Searchable error log metadata and indexing
 * - Log retention policies and cleanup
 * - Fast error log retrieval for debugging
 * - Analytics support for error trending
 */

import { 
  GitHubLogAnalysis, 
  GitHubBuildErrorAnalysis 
} from './githubErrorHandler';
import {
  ErrorCategory,
  ErrorSeverity,
  BuildStage,
  FrameworkType
} from '../types/api';

/**
 * Error log storage configuration
 */
export interface ErrorLogStorageConfig {
  retentionDays: number;          // How long to keep error logs
  maxLogSizeBytes: number;        // Maximum size for individual logs
  compressionEnabled: boolean;    // Whether to compress logs
  indexingEnabled: boolean;       // Whether to create searchable indexes
}

/**
 * Stored error log metadata
 */
export interface StoredErrorLog {
  project_id: string;
  workflow_run_id: number;
  repository: string;
  error_id: string;               // Unique identifier for this error
  timestamp: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  stage: BuildStage;
  framework: FrameworkType;
  user_message: string;
  technical_message: string;
  fixable: boolean;
  confidence: number;
  failed_step: string;
  step_number: number;
  workflow_run_url: string;
  raw_log_size: number;
  compressed: boolean;
  tags: string[];                 // Searchable tags
}

/**
 * Error log search criteria
 */
export interface ErrorLogSearchCriteria {
  project_id?: string;
  category?: ErrorCategory[];
  severity?: ErrorSeverity[];
  stage?: BuildStage[];
  framework?: FrameworkType[];
  time_range?: {
    start: string;
    end: string;
  };
  tags?: string[];
  limit?: number;
  offset?: number;
}

/**
 * Error log search results
 */
export interface ErrorLogSearchResult {
  logs: StoredErrorLog[];
  total_count: number;
  has_more: boolean;
  search_time_ms: number;
}

/**
 * Error log retention policy
 */
export interface ErrorLogRetentionPolicy {
  critical_errors_days: number;   // Keep critical errors longer
  regular_errors_days: number;    // Standard retention for other errors
  infrastructure_errors_days: number; // Infrastructure errors (usually temporary)
  max_logs_per_project: number;   // Maximum logs per project
}

/**
 * Main Error Log Storage class
 */
export class ErrorLogStorage {
  private config: ErrorLogStorageConfig;
  private retentionPolicy: ErrorLogRetentionPolicy;

  constructor(config?: Partial<ErrorLogStorageConfig>) {
    this.config = {
      retentionDays: 90,              // 3 months default retention
      maxLogSizeBytes: 10 * 1024 * 1024, // 10MB max log size
      compressionEnabled: true,
      indexingEnabled: true,
      ...config
    };

    this.retentionPolicy = {
      critical_errors_days: 180,      // Keep critical errors for 6 months
      regular_errors_days: 90,        // Keep regular errors for 3 months
      infrastructure_errors_days: 30, // Infrastructure errors only 1 month
      max_logs_per_project: 100       // Max 100 error logs per project
    };

    console.info('[ERROR-LOG-STORAGE] Initialized with configuration', {
      retention_days: this.config.retentionDays,
      max_log_size_mb: this.config.maxLogSizeBytes / (1024 * 1024),
      compression_enabled: this.config.compressionEnabled,
      indexing_enabled: this.config.indexingEnabled
    });
  }

  /**
   * Store GitHub Actions error analysis and logs in R2
   */
  async storeErrorLog(
    errorAnalysis: GitHubBuildErrorAnalysis,
    logAnalysis: GitHubLogAnalysis,
    env: Env
  ): Promise<{ success: boolean; error_id?: string; error?: string }> {
    try {
      const errorId = this.generateErrorId(errorAnalysis, logAnalysis);
      
      console.info('[ERROR-LOG-STORAGE] Storing error log', {
        project_id: errorAnalysis.github_context.repository,
        workflow_run_id: errorAnalysis.github_context.workflow_run_id,
        error_id: errorId,
        category: errorAnalysis.category,
        severity: errorAnalysis.severity
      });

      // 1. Store detailed error analysis
      await this.storeErrorAnalysis(errorId, errorAnalysis, env);

      // 2. Store raw GitHub Actions logs (if available)
      if (logAnalysis.rawLogSize > 0) {
        await this.storeRawLogs(errorId, logAnalysis, env);
      }

      // 3. Create searchable metadata index
      if (this.config.indexingEnabled) {
        await this.createErrorLogIndex(errorId, errorAnalysis, logAnalysis, env);
      }

      // 4. Update project error statistics
      await this.updateProjectErrorStats(errorAnalysis, env);

      // 5. Enforce retention policy
      await this.enforceRetentionPolicy(errorAnalysis.github_context.repository, env);

      console.info('[ERROR-LOG-STORAGE] Error log stored successfully', {
        error_id: errorId,
        analysis_stored: true,
        logs_stored: logAnalysis.rawLogSize > 0,
        indexed: this.config.indexingEnabled
      });

      return { success: true, error_id: errorId };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ERROR-LOG-STORAGE] Failed to store error log', {
        workflow_run_id: errorAnalysis.github_context.workflow_run_id,
        repository: errorAnalysis.github_context.repository,
        error: errorMessage
      });

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Store detailed error analysis in R2
   */
  private async storeErrorAnalysis(
    errorId: string,
    errorAnalysis: GitHubBuildErrorAnalysis,
    env: Env
  ): Promise<void> {
    const analysisKey = `error-logs/${errorId}/analysis.json`;
    
    // Create comprehensive error analysis document
    const analysisDocument = {
      error_id: errorId,
      stored_at: new Date().toISOString(),
      analysis: errorAnalysis,
      metadata: {
        storage_version: '1.0',
        compressed: false,
        searchable: this.config.indexingEnabled
      }
    };

    await env.PROJECTS_BUCKET.put(
      analysisKey,
      JSON.stringify(analysisDocument, null, 2),
      {
        httpMetadata: { 
          contentType: 'application/json',
          cacheControl: 'max-age=3600' // Cache for 1 hour
        },
        customMetadata: {
          error_id: errorId,
          project_id: errorAnalysis.github_context.repository,
          workflow_run_id: errorAnalysis.github_context.workflow_run_id.toString(),
          category: errorAnalysis.category,
          severity: errorAnalysis.severity,
          stage: errorAnalysis.stage,
          framework: errorAnalysis.framework,
          fixable: errorAnalysis.fixable.toString(),
          created_at: new Date().toISOString(),
          type: 'error_analysis'
        }
      }
    );

    console.info('[ERROR-LOG-STORAGE] Error analysis stored', {
      key: analysisKey,
      size: JSON.stringify(analysisDocument).length,
      compressed: false
    });
  }

  /**
   * Store raw GitHub Actions logs in R2
   */
  private async storeRawLogs(
    errorId: string,
    logAnalysis: GitHubLogAnalysis,
    env: Env
  ): Promise<void> {
    const logsKey = `error-logs/${errorId}/raw-logs.json`;

    // Create structured raw logs document
    const logsDocument = {
      error_id: errorId,
      workflow_run_id: logAnalysis.workflowRunId,
      repository: logAnalysis.repositoryFullName,
      stored_at: new Date().toISOString(),
      logs_analysis: logAnalysis,
      metadata: {
        total_steps: logAnalysis.totalSteps,
        failed_steps: logAnalysis.failedSteps.length,
        error_entries: logAnalysis.errorEntries.length,
        raw_log_size: logAnalysis.rawLogSize,
        compressed: this.config.compressionEnabled
      }
    };

    let logsContent = JSON.stringify(logsDocument, null, 2);
    let contentEncoding: string | undefined;

    // Compress if enabled and log is large
    if (this.config.compressionEnabled && logsContent.length > 10000) {
      // Note: In Cloudflare Workers, compression would be done differently
      // This is a placeholder for compression logic
      contentEncoding = 'gzip';
      console.info('[ERROR-LOG-STORAGE] Log compression would be applied here');
    }

    await env.PROJECTS_BUCKET.put(
      logsKey,
      logsContent,
      {
        httpMetadata: { 
          contentType: 'application/json',
          contentEncoding,
          cacheControl: 'max-age=86400' // Cache for 24 hours
        },
        customMetadata: {
          error_id: errorId,
          workflow_run_id: logAnalysis.workflowRunId.toString(),
          repository: logAnalysis.repositoryFullName,
          total_steps: logAnalysis.totalSteps.toString(),
          failed_steps: logAnalysis.failedSteps.length.toString(),
          raw_size: logAnalysis.rawLogSize.toString(),
          compressed: this.config.compressionEnabled.toString(),
          created_at: new Date().toISOString(),
          type: 'raw_logs'
        }
      }
    );

    console.info('[ERROR-LOG-STORAGE] Raw logs stored', {
      key: logsKey,
      size: logsContent.length,
      compressed: this.config.compressionEnabled,
      original_size: logAnalysis.rawLogSize
    });
  }

  /**
   * Create searchable metadata index for error log
   */
  private async createErrorLogIndex(
    errorId: string,
    errorAnalysis: GitHubBuildErrorAnalysis,
    logAnalysis: GitHubLogAnalysis,
    env: Env
  ): Promise<void> {
    const indexKey = `error-logs/index/${errorId}.json`;

    // Generate searchable tags
    const tags = this.generateSearchableTags(errorAnalysis, logAnalysis);

    const indexEntry: StoredErrorLog = {
      project_id: errorAnalysis.github_context.repository,
      workflow_run_id: errorAnalysis.github_context.workflow_run_id,
      repository: errorAnalysis.github_context.repository,
      error_id: errorId,
      timestamp: errorAnalysis.analysisTimestamp,
      category: errorAnalysis.category,
      severity: errorAnalysis.severity,
      stage: errorAnalysis.stage,
      framework: errorAnalysis.framework,
      user_message: errorAnalysis.userMessage,
      technical_message: errorAnalysis.technicalMessage.substring(0, 500), // Truncate for index
      fixable: errorAnalysis.fixable,
      confidence: errorAnalysis.confidence,
      failed_step: errorAnalysis.github_context.failed_step,
      step_number: errorAnalysis.github_context.step_number,
      workflow_run_url: errorAnalysis.github_context.workflow_run_url,
      raw_log_size: logAnalysis.rawLogSize,
      compressed: this.config.compressionEnabled,
      tags
    };

    await env.PROJECTS_BUCKET.put(
      indexKey,
      JSON.stringify(indexEntry, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          error_id: errorId,
          project_id: errorAnalysis.github_context.repository,
          category: errorAnalysis.category,
          severity: errorAnalysis.severity,
          stage: errorAnalysis.stage,
          framework: errorAnalysis.framework,
          tags: tags.join(','),
          created_at: new Date().toISOString(),
          type: 'error_index'
        }
      }
    );

    console.info('[ERROR-LOG-STORAGE] Error index created', {
      key: indexKey,
      tags: tags.length,
      searchable_fields: Object.keys(indexEntry).length
    });
  }

  /**
   * Search error logs based on criteria
   */
  async searchErrorLogs(
    criteria: ErrorLogSearchCriteria,
    env: Env
  ): Promise<ErrorLogSearchResult> {
    const startTime = Date.now();
    
    try {
      console.info('[ERROR-LOG-STORAGE] Searching error logs', criteria);

      // Build R2 list parameters for filtering
      const listOptions: any = {
        prefix: 'error-logs/index/',
        limit: Math.min(criteria.limit || 50, 1000) // Cap at 1000
      };

      // Get error log indexes
      const listResult = await env.PROJECTS_BUCKET.list(listOptions);
      
      if (listResult.objects.length === 0) {
        return {
          logs: [],
          total_count: 0,
          has_more: false,
          search_time_ms: Date.now() - startTime
        };
      }

      // Fetch and filter error log indexes
      const errorLogs: StoredErrorLog[] = [];
      const fetchPromises = listResult.objects
        .slice(criteria.offset || 0)
        .map(async (obj) => {
          try {
            const errorLogObject = await env.PROJECTS_BUCKET.get(obj.key);
            if (errorLogObject) {
              const errorLog = await errorLogObject.json() as StoredErrorLog;
              
              // Apply filters
              if (this.matchesCriteria(errorLog, criteria)) {
                errorLogs.push(errorLog);
              }
            }
          } catch (error) {
            console.warn('[ERROR-LOG-STORAGE] Failed to fetch error log', {
              key: obj.key,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        });

      await Promise.all(fetchPromises);

      // Sort by timestamp (most recent first)
      errorLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply limit
      const limit = criteria.limit || 50;
      const resultLogs = errorLogs.slice(0, limit);
      
      const searchResult: ErrorLogSearchResult = {
        logs: resultLogs,
        total_count: errorLogs.length,
        has_more: errorLogs.length > limit,
        search_time_ms: Date.now() - startTime
      };

      console.info('[ERROR-LOG-STORAGE] Error log search completed', {
        criteria_provided: Object.keys(criteria).length,
        total_found: searchResult.total_count,
        returned: resultLogs.length,
        search_time_ms: searchResult.search_time_ms
      });

      return searchResult;

    } catch (error) {
      console.error('[ERROR-LOG-STORAGE] Error log search failed', {
        criteria,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        logs: [],
        total_count: 0,
        has_more: false,
        search_time_ms: Date.now() - startTime
      };
    }
  }

  /**
   * Get specific error log by ID
   */
  async getErrorLog(
    errorId: string,
    env: Env,
    includeRawLogs: boolean = false
  ): Promise<{
    analysis?: GitHubBuildErrorAnalysis;
    rawLogs?: GitHubLogAnalysis;
    error?: string;
  }> {
    try {
      console.info('[ERROR-LOG-STORAGE] Fetching error log', {
        error_id: errorId,
        include_raw_logs: includeRawLogs
      });

      // Fetch error analysis
      const analysisKey = `error-logs/${errorId}/analysis.json`;
      const analysisObject = await env.PROJECTS_BUCKET.get(analysisKey);
      
      if (!analysisObject) {
        return { error: `Error log ${errorId} not found` };
      }

      const analysisDocument = await analysisObject.json();
      const analysis = analysisDocument.analysis as GitHubBuildErrorAnalysis;

      // Optionally fetch raw logs
      let rawLogs: GitHubLogAnalysis | undefined;
      if (includeRawLogs) {
        const logsKey = `error-logs/${errorId}/raw-logs.json`;
        const logsObject = await env.PROJECTS_BUCKET.get(logsKey);
        
        if (logsObject) {
          const logsDocument = await logsObject.json();
          rawLogs = logsDocument.logs_analysis;
        }
      }

      console.info('[ERROR-LOG-STORAGE] Error log fetched successfully', {
        error_id: errorId,
        analysis_found: !!analysis,
        raw_logs_found: !!rawLogs
      });

      return { analysis, rawLogs };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ERROR-LOG-STORAGE] Failed to fetch error log', {
        error_id: errorId,
        error: errorMessage
      });

      return { error: errorMessage };
    }
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(
    errorAnalysis: GitHubBuildErrorAnalysis,
    logAnalysis: GitHubLogAnalysis
  ): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '');
    const workflowId = logAnalysis.workflowRunId;
    const category = errorAnalysis.category;
    
    return `${category}-${workflowId}-${timestamp}`;
  }

  /**
   * Generate searchable tags for error log
   */
  private generateSearchableTags(
    errorAnalysis: GitHubBuildErrorAnalysis,
    logAnalysis: GitHubLogAnalysis
  ): string[] {
    const tags: string[] = [];

    // Category and severity tags
    tags.push(`category:${errorAnalysis.category}`);
    tags.push(`severity:${errorAnalysis.severity}`);
    tags.push(`stage:${errorAnalysis.stage}`);
    tags.push(`framework:${errorAnalysis.framework}`);

    // Fixability tag
    if (errorAnalysis.fixable) {
      tags.push('fixable');
    } else {
      tags.push('not-fixable');
    }

    // Confidence level tags
    if (errorAnalysis.confidence >= 80) {
      tags.push('high-confidence');
    } else if (errorAnalysis.confidence >= 50) {
      tags.push('medium-confidence');
    } else {
      tags.push('low-confidence');
    }

    // Failed step tags
    if (logAnalysis.failedSteps.length > 0) {
      const stepName = logAnalysis.failedSteps[0].name.toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .trim();
      tags.push(`step:${stepName}`);
    }

    // Error type tags from technical message
    const message = errorAnalysis.technicalMessage.toLowerCase();
    if (message.includes('npm')) tags.push('npm');
    if (message.includes('typescript')) tags.push('typescript');
    if (message.includes('vite')) tags.push('vite');
    if (message.includes('dependency')) tags.push('dependency');
    if (message.includes('syntax')) tags.push('syntax');

    return tags;
  }

  /**
   * Check if error log matches search criteria
   */
  private matchesCriteria(errorLog: StoredErrorLog, criteria: ErrorLogSearchCriteria): boolean {
    // Project filter
    if (criteria.project_id && errorLog.project_id !== criteria.project_id) {
      return false;
    }

    // Category filter
    if (criteria.category && criteria.category.length > 0 && !criteria.category.includes(errorLog.category)) {
      return false;
    }

    // Severity filter
    if (criteria.severity && criteria.severity.length > 0 && !criteria.severity.includes(errorLog.severity)) {
      return false;
    }

    // Stage filter
    if (criteria.stage && criteria.stage.length > 0 && !criteria.stage.includes(errorLog.stage)) {
      return false;
    }

    // Framework filter
    if (criteria.framework && criteria.framework.length > 0 && !criteria.framework.includes(errorLog.framework)) {
      return false;
    }

    // Time range filter
    if (criteria.time_range) {
      const logTime = new Date(errorLog.timestamp).getTime();
      const startTime = new Date(criteria.time_range.start).getTime();
      const endTime = new Date(criteria.time_range.end).getTime();
      
      if (logTime < startTime || logTime > endTime) {
        return false;
      }
    }

    // Tags filter
    if (criteria.tags && criteria.tags.length > 0) {
      const hasMatchingTag = criteria.tags.some(tag => errorLog.tags.includes(tag));
      if (!hasMatchingTag) {
        return false;
      }
    }

    return true;
  }

  /**
   * Update project error statistics
   */
  private async updateProjectErrorStats(
    errorAnalysis: GitHubBuildErrorAnalysis,
    env: Env
  ): Promise<void> {
    try {
      const statsKey = `error-logs/stats/${errorAnalysis.github_context.repository}.json`;
      
      // Get existing stats or initialize
      let stats: any = {
        project_id: errorAnalysis.github_context.repository,
        total_errors: 0,
        errors_by_category: {},
        errors_by_severity: {},
        errors_by_stage: {},
        last_error: null,
        last_updated: null
      };

      try {
        const existingStats = await env.PROJECTS_BUCKET.get(statsKey);
        if (existingStats) {
          stats = await existingStats.json();
        }
      } catch {
        // Stats don't exist yet, use defaults
      }

      // Update statistics
      stats.total_errors++;
      stats.errors_by_category[errorAnalysis.category] = (stats.errors_by_category[errorAnalysis.category] || 0) + 1;
      stats.errors_by_severity[errorAnalysis.severity] = (stats.errors_by_severity[errorAnalysis.severity] || 0) + 1;
      stats.errors_by_stage[errorAnalysis.stage] = (stats.errors_by_stage[errorAnalysis.stage] || 0) + 1;
      stats.last_error = errorAnalysis.analysisTimestamp;
      stats.last_updated = new Date().toISOString();

      await env.PROJECTS_BUCKET.put(
        statsKey,
        JSON.stringify(stats, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: errorAnalysis.github_context.repository,
            total_errors: stats.total_errors.toString(),
            updated_at: stats.last_updated,
            type: 'error_stats'
          }
        }
      );

    } catch (error) {
      console.error('[ERROR-LOG-STORAGE] Failed to update project error stats', {
        project_id: errorAnalysis.github_context.repository,
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - stats update failure shouldn't break error storage
    }
  }

  /**
   * Enforce error log retention policy
   */
  private async enforceRetentionPolicy(projectId: string, env: Env): Promise<void> {
    try {
      console.info('[ERROR-LOG-STORAGE] Enforcing retention policy', {
        project_id: projectId,
        retention_days: this.config.retentionDays
      });

      // List error logs for project
      const indexPrefix = `error-logs/index/`;
      const listResult = await env.PROJECTS_BUCKET.list({ prefix: indexPrefix });

      if (listResult.objects.length === 0) return;

      const now = Date.now();
      const retentionThreshold = now - (this.config.retentionDays * 24 * 60 * 60 * 1000);
      
      let deletedCount = 0;
      const deletePromises: Promise<void>[] = [];

      for (const obj of listResult.objects) {
        // Get error log metadata
        try {
          const errorLogObject = await env.PROJECTS_BUCKET.get(obj.key);
          if (!errorLogObject) continue;

          const errorLog = await errorLogObject.json() as StoredErrorLog;
          
          // Check if project matches and log is old enough
          if (errorLog.project_id === projectId) {
            const logTime = new Date(errorLog.timestamp).getTime();
            
            // Apply different retention based on severity
            let retentionTime = retentionThreshold;
            if (errorLog.severity === 'critical') {
              retentionTime = now - (this.retentionPolicy.critical_errors_days * 24 * 60 * 60 * 1000);
            } else if (errorLog.category === 'infrastructure') {
              retentionTime = now - (this.retentionPolicy.infrastructure_errors_days * 24 * 60 * 60 * 1000);
            }

            if (logTime < retentionTime) {
              // Delete error log and associated files
              const errorId = errorLog.error_id;
              deletePromises.push(this.deleteErrorLog(errorId, env));
              deletedCount++;
            }
          }
        } catch (error) {
          console.warn('[ERROR-LOG-STORAGE] Failed to check retention for log', {
            key: obj.key,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      await Promise.all(deletePromises);

      if (deletedCount > 0) {
        console.info('[ERROR-LOG-STORAGE] Retention policy enforced', {
          project_id: projectId,
          deleted_logs: deletedCount,
          retention_days: this.config.retentionDays
        });
      }

    } catch (error) {
      console.error('[ERROR-LOG-STORAGE] Failed to enforce retention policy', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - retention policy failure shouldn't break error storage
    }
  }

  /**
   * Delete error log and all associated files
   */
  private async deleteErrorLog(errorId: string, env: Env): Promise<void> {
    const filesToDelete = [
      `error-logs/${errorId}/analysis.json`,
      `error-logs/${errorId}/raw-logs.json`,
      `error-logs/index/${errorId}.json`
    ];

    const deletePromises = filesToDelete.map(key =>
      env.PROJECTS_BUCKET.delete(key).catch(error =>
        console.warn('[ERROR-LOG-STORAGE] Failed to delete file', { key, error })
      )
    );

    await Promise.all(deletePromises);
  }
}

/**
 * Factory function to create error log storage instance
 */
export function createErrorLogStorage(config?: Partial<ErrorLogStorageConfig>): ErrorLogStorage {
  return new ErrorLogStorage(config);
}