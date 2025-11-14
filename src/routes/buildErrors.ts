/**
 * Build Error API Endpoints - TASK-017
 * 
 * RESTful API endpoints for accessing build error analysis, analytics, and recovery suggestions.
 * Provides comprehensive error information for debugging and user guidance.
 */

import { Request } from '@cloudflare/workers-types';
import { 
  BuildErrorAnalysis,
  ErrorRecoverySuggestion,
  BuildErrorResponse,
  ErrorAnalyticsRequest,
  ErrorAnalyticsResponse,
  ErrorStatistics,
  ErrorCategory,
  FrameworkType,
  BuildStage
} from '../types/api';
import { successResponse, errorResponse } from '../utils/responses';
import { createBuildErrorAnalyzer } from '../utils/buildErrorAnalyzer';

// TASK-026: GitHub Actions Error Handling Integration
import { createErrorLogStorage } from '../utils/errorLogStorage';
import { createErrorSolutionMapper, determineProjectComplexity } from '../utils/errorSolutionMapper';
import { createGitHubErrorHandler } from '../utils/githubErrorHandler';

/**
 * GET /api/build/errors/{project_id}
 * Get detailed error analysis for a specific project build failure
 */
export async function getBuildErrorAnalysis(
  request: Request,
  env: Env,
  project_id: string
): Promise<Response> {
  try {
    console.info('[BUILD-ERROR-API] Retrieving error analysis for project', { project_id });

    // TASK-026: Use enhanced GitHub Actions error storage
    const errorLogStorage = createErrorLogStorage();
    
    // First, try to get GitHub Actions error analysis from enhanced storage
    const githubErrorResult = await errorLogStorage.searchErrorLogs(
      { project_id, limit: 1 },
      env
    );

    if (githubErrorResult.logs.length > 0) {
      console.info('[BUILD-ERROR-API] Found GitHub Actions error analysis', {
        project_id,
        error_id: githubErrorResult.logs[0].error_id,
        category: githubErrorResult.logs[0].category
      });

      const latestError = githubErrorResult.logs[0];
      const errorDetails = await errorLogStorage.getErrorLog(
        latestError.error_id,
        env,
        false
      );

      if (errorDetails.analysis) {
        // Generate enhanced solutions using GitHub-specific error handler
        const solutionMapper = createErrorSolutionMapper();
        const solutionContext = {
          errorAnalysis: errorDetails.analysis,
          logAnalysis: {
            workflowRunId: errorDetails.analysis.github_context.workflow_run_id,
            repositoryFullName: errorDetails.analysis.github_context.repository,
            totalSteps: 5,
            failedSteps: [],
            errorEntries: [],
            errorSummary: errorDetails.analysis.userMessage,
            failedStage: errorDetails.analysis.stage,
            logsFetchedAt: new Date().toISOString(),
            rawLogSize: 0
          },
          projectComplexity: determineProjectComplexity(errorDetails.analysis, {
            workflowRunId: errorDetails.analysis.github_context.workflow_run_id,
            repositoryFullName: errorDetails.analysis.github_context.repository,
            totalSteps: 5,
            failedSteps: [],
            errorEntries: [],
            errorSummary: errorDetails.analysis.userMessage,
            failedStage: errorDetails.analysis.stage,
            logsFetchedAt: new Date().toISOString(),
            rawLogSize: 0
          }),
          hasTypeScript: errorDetails.analysis.technicalMessage.toLowerCase().includes('typescript'),
          hasCustomDependencies: errorDetails.analysis.category === 'dependency'
        };

        const githubSolutions = solutionMapper.generateSolutions(solutionContext);

        // Create enhanced error response with GitHub context
        const enhancedErrorResponse: BuildErrorResponse = {
          projectId: project_id,
          jobId: errorDetails.analysis.github_context.workflow_run_id.toString(),
          analysis: errorDetails.analysis,
          suggestions: githubSolutions,
          canRetry: errorDetails.analysis.category !== 'infrastructure' && errorDetails.analysis.fixable,
          retryRecommended: errorDetails.analysis.category === 'timeout' || 
                          (errorDetails.analysis.category === 'infrastructure' && errorDetails.analysis.severity !== 'critical'),
          debugUrl: `/api/build/errors/${project_id}/debug`,
          supportedActions: getGitHubSupportedActions(errorDetails.analysis, githubSolutions),
          timestamp: new Date().toISOString()
        };

        console.info('[BUILD-ERROR-API] GitHub Actions error analysis returned', {
          project_id,
          error_category: errorDetails.analysis.category,
          solution_count: githubSolutions.length,
          workflow_run_url: errorDetails.analysis.github_context.workflow_run_url
        });

        return successResponse(enhancedErrorResponse, {
          project_id,
          error_category: errorDetails.analysis.category,
          error_severity: errorDetails.analysis.severity,
          fixable: errorDetails.analysis.fixable,
          suggestions_count: githubSolutions.length,
          github_integration: true,
          workflow_run_id: errorDetails.analysis.github_context.workflow_run_id
        });
      }
    }

    // Fallback to legacy error analysis system
    console.info('[BUILD-ERROR-API] No GitHub Actions errors found, checking legacy system', { project_id });

    const errorPattern = `projects/${project_id}/errors/`;
    const errorObjects = await env.PROJECTS_BUCKET.list({ 
      prefix: errorPattern,
      delimiter: '/'
    });
    
    if (errorObjects.objects.length === 0) {
      return errorResponse(
        'No error analysis found for this project',
        { project_id },
        404
      );
    }
    
    // Get the most recent error (sorted by timestamp in filename)
    const mostRecentError = errorObjects.objects
      .sort((a, b) => b.key.localeCompare(a.key))
      .find(obj => obj.key.endsWith('.json'));
    
    if (!mostRecentError) {
      return errorResponse(
        'No valid error analysis found',
        { project_id },
        404
      );
    }
    
    // Retrieve error analysis details
    const errorObject = await env.PROJECTS_BUCKET.get(mostRecentError.key);
    if (!errorObject) {
      return errorResponse(
        'Error analysis data not found',
        { project_id },
        404
      );
    }
    
    const errorAnalysis = await errorObject.json() as BuildErrorAnalysis;
    
    // Generate recovery suggestions using legacy system
    const errorAnalyzer = createBuildErrorAnalyzer();
    const recoverySuggestions = errorAnalyzer.generateRecoverySuggestions(errorAnalysis);
    
    // Create comprehensive error response
    const legacyErrorResponse: BuildErrorResponse = {
      projectId: project_id,
      jobId: errorAnalysis.debugInfo.originalError || 'unknown',
      analysis: errorAnalysis,
      suggestions: recoverySuggestions,
      canRetry: errorAnalysis.category !== 'infrastructure' && errorAnalysis.fixable,
      retryRecommended: errorAnalysis.category === 'timeout' || 
                      (errorAnalysis.category === 'infrastructure' && errorAnalysis.severity !== 'critical'),
      debugUrl: `/api/build/errors/${project_id}/debug`,
      supportedActions: getSupportedActions(errorAnalysis, recoverySuggestions),
      timestamp: new Date().toISOString()
    };

    console.info('[BUILD-ERROR-API] Legacy error analysis returned', {
      project_id,
      error_category: errorAnalysis.category,
      suggestion_count: recoverySuggestions.length,
      github_integration: false
    });
    
    return successResponse(legacyErrorResponse, {
      project_id,
      error_category: errorAnalysis.category,
      error_severity: errorAnalysis.severity,
      fixable: errorAnalysis.fixable,
      suggestions_count: recoverySuggestions.length,
      github_integration: false
    });
    
  } catch (error) {
    console.error('[BUILD-ERROR-API] Error retrieving build error analysis:', error);
    return errorResponse(
      'Failed to retrieve error analysis',
      { 
        project_id, 
        error: error instanceof Error ? error.message : String(error) 
      },
      500
    );
  }
}

/**
 * GET /api/build/errors/{project_id}/history
 * Get error history for a project with analytics
 */
export async function getBuildErrorHistory(
  request: Request,
  env: Env,
  project_id: string
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);
    const category = url.searchParams.get('category') as ErrorCategory | null;
    
    // List all error analyses for the project
    const errorPattern = `projects/${project_id}/errors/`;
    const errorObjects = await env.PROJECTS_BUCKET.list({ 
      prefix: errorPattern
    });
    
    if (errorObjects.objects.length === 0) {
      return successResponse({
        project_id,
        errors: [],
        total_count: 0,
        filtered_count: 0
      });
    }
    
    // Retrieve and parse error analyses
    const errorAnalyses: BuildErrorAnalysis[] = [];
    const sortedErrors = errorObjects.objects
      .filter(obj => obj.key.endsWith('.json'))
      .sort((a, b) => b.key.localeCompare(a.key))
      .slice(0, limit * 2); // Get extra in case of filtering
    
    for (const errorObj of sortedErrors) {
      try {
        const errorObject = await env.PROJECTS_BUCKET.get(errorObj.key);
        if (errorObject) {
          const analysis = await errorObject.json() as BuildErrorAnalysis;
          
          // Apply category filter if specified
          if (!category || analysis.category === category) {
            errorAnalyses.push(analysis);
          }
          
          // Stop once we have enough filtered results
          if (errorAnalyses.length >= limit) break;
        }
      } catch (parseError) {
        console.warn(`Failed to parse error analysis: ${errorObj.key}`, parseError);
      }
    }
    
    return successResponse({
      project_id,
      errors: errorAnalyses,
      total_count: errorObjects.objects.length,
      filtered_count: errorAnalyses.length,
      has_more: errorObjects.objects.length > limit
    });
    
  } catch (error) {
    console.error('[BUILD-ERROR-API] Error retrieving error history:', error);
    return errorResponse(
      'Failed to retrieve error history',
      { 
        project_id, 
        error: error instanceof Error ? error.message : String(error) 
      },
      500
    );
  }
}

/**
 * GET /api/build/errors/{project_id}/analytics
 * Get error analytics and statistics for a project
 */
export async function getBuildErrorAnalytics(
  request: Request,
  env: Env,
  project_id: string
): Promise<Response> {
  try {
    // Get error statistics
    const statsKey = `projects/${project_id}/error-stats.json`;
    const statsObject = await env.PROJECTS_BUCKET.get(statsKey);
    
    if (!statsObject) {
      // No errors yet - return empty statistics
      const emptyStats: ErrorStatistics = {
        projectId: project_id,
        totalErrors: 0,
        errorsByCategory: {} as Record<ErrorCategory, number>,
        errorsByStage: {} as Record<BuildStage, number>,
        errorsByFramework: {} as Record<FrameworkType, number>,
        commonPatterns: [],
        resolutionRate: 0,
        averageFixTime: 0
      };
      
      return successResponse({
        statistics: emptyStats,
        trends: [],
        topIssues: [],
        recommendations: [
          'No build errors detected yet',
          'Continue monitoring build performance',
          'Consider implementing automated testing'
        ]
      } as ErrorAnalyticsResponse);
    }
    
    const statistics = await statsObject.json() as ErrorStatistics;
    
    // Calculate trends (simplified for MVP - could be enhanced with time-series data)
    const trends = Object.entries(statistics.errorsByCategory).map(([category, count]) => ({
      date: new Date().toISOString().split('T')[0], // Today's date
      errorCount: count,
      category: category as ErrorCategory
    }));
    
    // Generate top issues from common patterns
    const topIssues = statistics.commonPatterns
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(pattern => ({
        pattern: pattern.pattern,
        count: pattern.count,
        category: pattern.category,
        severity: 'error' as const, // Default severity
        avgResolutionTime: statistics.averageFixTime
      }));
    
    // Generate recommendations based on error patterns
    const recommendations = generateAnalyticsRecommendations(statistics);
    
    const analytics: ErrorAnalyticsResponse = {
      statistics,
      trends,
      topIssues,
      recommendations
    };
    
    return successResponse(analytics, {
      project_id,
      total_errors: statistics.totalErrors,
      resolution_rate: statistics.resolutionRate,
      most_common_category: getMostCommonCategory(statistics)
    });
    
  } catch (error) {
    console.error('[BUILD-ERROR-API] Error retrieving error analytics:', error);
    return errorResponse(
      'Failed to retrieve error analytics',
      { 
        project_id, 
        error: error instanceof Error ? error.message : String(error) 
      },
      500
    );
  }
}

/**
 * POST /api/build/errors/{project_id}/retry
 * Trigger build retry with error-specific optimizations
 */
export async function retryBuildWithErrorAnalysis(
  request: Request,
  env: Env,
  project_id: string
): Promise<Response> {
  try {
    // Get the most recent error analysis
    const errorPattern = `projects/${project_id}/errors/`;
    const errorObjects = await env.PROJECTS_BUCKET.list({ 
      prefix: errorPattern,
      delimiter: '/'
    });
    
    let retryOptions = {};
    let retryRecommended = true;
    let reason = 'Manual retry requested';
    
    if (errorObjects.objects.length > 0) {
      // Get the most recent error
      const mostRecentError = errorObjects.objects
        .sort((a, b) => b.key.localeCompare(a.key))
        .find(obj => obj.key.endsWith('.json'));
      
      if (mostRecentError) {
        const errorObject = await env.PROJECTS_BUCKET.get(mostRecentError.key);
        if (errorObject) {
          const errorAnalysis = await errorObject.json() as BuildErrorAnalysis;
          
          // Determine if retry is recommended
          retryRecommended = errorAnalysis.fixable && 
                            (errorAnalysis.category === 'timeout' || 
                             errorAnalysis.category === 'infrastructure');
          
          // Configure retry options based on error analysis
          if (errorAnalysis.category === 'timeout') {
            retryOptions = {
              timeout_seconds: 300, // Increase timeout
              priority: 'high'
            };
            reason = 'Retry with increased timeout for timeout error';
          } else if (errorAnalysis.category === 'infrastructure') {
            retryOptions = {
              priority: 'high'
            };
            reason = 'Retry after infrastructure error resolution';
          } else if (errorAnalysis.category === 'dependency') {
            retryOptions = {
              timeout_seconds: 240 // Slightly longer for dependency resolution
            };
            reason = 'Retry with extended time for dependency resolution';
          } else {
            reason = 'Error may require code changes before retry';
            retryRecommended = false;
          }
        }
      }
    }
    
    if (!retryRecommended) {
      return errorResponse(
        'Build retry not recommended for this error type',
        { 
          project_id,
          reason,
          suggestion: 'Review error analysis and fix issues before retrying'
        },
        400
      );
    }
    
    // NOTE: Build queue integration deferred to TASK-018: Deployment Pipeline
    // Retry functionality requires complete build queue implementation
    
    return successResponse({
      project_id,
      retry_scheduled: true,
      retry_options: retryOptions,
      reason,
      estimated_start_time: new Date(Date.now() + 30000).toISOString() // 30 seconds from now
    }, {
      project_id,
      retry_type: 'error_analysis_optimized'
    });
    
  } catch (error) {
    console.error('[BUILD-ERROR-API] Error scheduling retry:', error);
    return errorResponse(
      'Failed to schedule build retry',
      { 
        project_id, 
        error: error instanceof Error ? error.message : String(error) 
      },
      500
    );
  }
}

/**
 * Helper function to get supported actions based on error analysis
 */
function getSupportedActions(
  analysis: BuildErrorAnalysis, 
  suggestions: ErrorRecoverySuggestion[]
): string[] {
  const actions: string[] = [];
  
  // Basic actions always available
  actions.push('view_detailed_logs');
  actions.push('contact_support');
  
  // Category-specific actions
  if (analysis.fixable) {
    actions.push('view_suggestions');
    
    if (analysis.category === 'timeout' || analysis.category === 'infrastructure') {
      actions.push('retry_build');
    }
    
    if (analysis.category === 'dependency') {
      actions.push('view_package_info');
    }
    
    if (analysis.category === 'syntax' || analysis.category === 'build') {
      actions.push('view_code_examples');
    }
  }
  
  // Add actions based on recovery suggestions
  const automatedSuggestions = suggestions.filter(s => s.automated);
  if (automatedSuggestions.length > 0) {
    actions.push('apply_automated_fixes');
  }
  
  return actions;
}

/**
 * Generate analytics recommendations based on error statistics
 */
function generateAnalyticsRecommendations(stats: ErrorStatistics): string[] {
  const recommendations: string[] = [];
  
  if (stats.totalErrors === 0) {
    return [
      'No build errors detected - great job!',
      'Continue monitoring build performance',
      'Consider implementing automated testing'
    ];
  }
  
  const mostCommonCategory = getMostCommonCategory(stats);
  
  switch (mostCommonCategory) {
    case 'dependency':
      recommendations.push(
        'Most errors are dependency-related - consider using package-lock.json',
        'Review package.json for version conflicts',
        'Consider using npm audit to check for vulnerabilities'
      );
      break;
      
    case 'syntax':
      recommendations.push(
        'Syntax errors are common - consider using a linter',
        'Enable TypeScript strict mode for better error detection',
        'Use code formatting tools to maintain consistency'
      );
      break;
      
    case 'timeout':
      recommendations.push(
        'Build timeouts suggest performance issues',
        'Consider optimizing large dependencies',
        'Review code for performance bottlenecks'
      );
      break;
      
    case 'infrastructure':
      recommendations.push(
        'Infrastructure errors are typically temporary',
        'No action needed - system issues resolve automatically',
        'Contact support if infrastructure errors persist'
      );
      break;
      
    default:
      recommendations.push(
        'Review error patterns for improvement opportunities',
        'Consider automated testing to catch issues earlier',
        'Monitor build performance trends'
      );
  }
  
  if (stats.resolutionRate < 50) {
    recommendations.push('Consider improving error resolution processes');
  }
  
  if (stats.averageFixTime > 300000) { // 5 minutes
    recommendations.push('Look for ways to reduce error resolution time');
  }
  
  return recommendations;
}

/**
 * Get most common error category from statistics
 */
function getMostCommonCategory(stats: ErrorStatistics): ErrorCategory {
  const entries = Object.entries(stats.errorsByCategory);
  if (entries.length === 0) return 'unknown';
  
  const [category] = entries.reduce((max, current) => 
    current[1] > max[1] ? current : max
  );
  
  return category as ErrorCategory;
}

/**
 * TASK-026: Get supported actions for GitHub Actions errors
 */
function getGitHubSupportedActions(
  analysis: any,
  suggestions: any[]
): string[] {
  const actions: string[] = [];
  
  // GitHub-specific actions
  actions.push('view_github_logs');
  actions.push('view_workflow_run');
  
  // Basic actions always available
  actions.push('view_detailed_logs');
  actions.push('contact_support');
  
  // Category-specific actions
  if (analysis.fixable) {
    actions.push('view_suggestions');
    
    if (analysis.category === 'timeout' || analysis.category === 'infrastructure') {
      actions.push('retry_build');
      actions.push('retry_with_optimizations');
    }
    
    if (analysis.category === 'dependency') {
      actions.push('view_package_info');
      actions.push('fix_package_conflicts');
    }
    
    if (analysis.category === 'syntax' || analysis.category === 'build') {
      actions.push('view_code_examples');
      actions.push('analyze_component_structure');
    }
  }
  
  // Add GitHub-specific automated actions
  const automatedSuggestions = suggestions.filter(s => s.automated && s.github_specific);
  if (automatedSuggestions.length > 0) {
    actions.push('apply_github_fixes');
    actions.push('modify_workflow');
  }
  
  // Add solution-specific actions
  const workflowModifications = suggestions.filter(s => s.workflow_modification);
  if (workflowModifications.length > 0) {
    actions.push('update_workflow_config');
  }
  
  const secretsRequired = suggestions.filter(s => s.requires_github_secrets);
  if (secretsRequired.length > 0) {
    actions.push('check_github_secrets');
  }
  
  return actions;
}