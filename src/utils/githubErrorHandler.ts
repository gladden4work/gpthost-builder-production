/**
 * GitHub Actions Error Handler
 * 
 * Comprehensive GitHub Actions log parsing and error extraction system.
 * Fetches workflow run logs, extracts meaningful error messages, and classifies
 * them for user-friendly display and actionable recovery suggestions.
 * 
 * Features:
 * - GitHub Actions log fetching and ZIP extraction  
 * - Step-by-step error analysis and classification
 * - Integration with existing build error analysis system
 * - User-friendly error message transformation
 * - Error storage in R2 for debugging and analytics
 */

import {
  BuildErrorAnalysis,
  ErrorCategory,
  ErrorSeverity,
  BuildStage,
  FrameworkType,
  GitHubWorkflowRun
} from '../types/api';
import { createBuildErrorAnalyzer } from './buildErrorAnalyzer';
import { GitHubApiClient } from './githubApi';

/**
 * GitHub Actions step information
 */
export interface GitHubActionStep {
  name: string;
  status: 'completed' | 'in_progress' | 'queued' | 'skipped';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  number: number;
  started_at?: string;
  completed_at?: string;
}

/**
 * Parsed GitHub Actions log entry
 */
export interface GitHubLogEntry {
  timestamp: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  stepName: string;
  stepNumber: number;
  message: string;
  rawLine: string;
  isError: boolean;
  errorType?: string;
}

/**
 * GitHub Actions log analysis result
 */
export interface GitHubLogAnalysis {
  workflowRunId: number;
  repositoryFullName: string;
  totalSteps: number;
  failedSteps: GitHubActionStep[];
  errorEntries: GitHubLogEntry[];
  primaryError?: GitHubLogEntry;
  errorSummary: string;
  failedStage: BuildStage;
  logsFetchedAt: string;
  rawLogSize: number;
}

/**
 * Enhanced build error analysis with GitHub context
 */
export interface GitHubBuildErrorAnalysis extends BuildErrorAnalysis {
  github_context: {
    workflow_run_id: number;
    repository: string;
    failed_step: string;
    step_number: number;
    workflow_run_url: string;
    raw_log_path?: string; // R2 path to full logs
  };
}

/**
 * GitHub Actions error patterns specific to common build issues
 */
const GITHUB_ACTIONS_ERROR_PATTERNS = [
  // NPM/Dependency errors
  {
    pattern: /npm ERR!.*ERESOLVE/i,
    category: 'dependency' as ErrorCategory,
    severity: 'critical' as ErrorSeverity,
    stage: 'npm-install' as BuildStage,
    friendlyMessage: 'NPM dependency resolution failed due to version conflicts'
  },
  {
    pattern: /npm ERR!.*404.*Not Found/i,
    category: 'dependency' as ErrorCategory,
    severity: 'error' as ErrorSeverity,
    stage: 'npm-install' as BuildStage,
    friendlyMessage: 'Package not found in NPM registry'
  },
  {
    pattern: /Error: Process completed with exit code 1.*npm (install|ci)/i,
    category: 'dependency' as ErrorCategory,
    severity: 'error' as ErrorSeverity,
    stage: 'npm-install' as BuildStage,
    friendlyMessage: 'NPM installation failed'
  },

  // Build/compilation errors
  {
    pattern: /Error: Process completed with exit code 1.*npm run build/i,
    category: 'build' as ErrorCategory,
    severity: 'error' as ErrorSeverity,
    stage: 'build' as BuildStage,
    friendlyMessage: 'Build compilation failed'
  },
  {
    pattern: /TypeScript error in/i,
    category: 'syntax' as ErrorCategory,
    severity: 'error' as ErrorSeverity,
    stage: 'build' as BuildStage,
    friendlyMessage: 'TypeScript compilation error'
  },
  {
    pattern: /error TS\d+:/i,
    category: 'syntax' as ErrorCategory,
    severity: 'error' as ErrorSeverity,
    stage: 'build' as BuildStage,
    friendlyMessage: 'TypeScript type checking error'
  },

  // Vite/bundler errors
  {
    pattern: /\[vite\] build error:/i,
    category: 'build' as ErrorCategory,
    severity: 'error' as ErrorSeverity,
    stage: 'build' as BuildStage,
    friendlyMessage: 'Vite build process error'
  },
  {
    pattern: /Transform failed with \d+ errors?/i,
    category: 'build' as ErrorCategory,
    severity: 'error' as ErrorSeverity,
    stage: 'build' as BuildStage,
    friendlyMessage: 'Code transformation failed during build'
  },

  // Timeout errors
  {
    pattern: /Error: The operation was canceled\./i,
    category: 'timeout' as ErrorCategory,
    severity: 'critical' as ErrorSeverity,
    stage: 'build' as BuildStage,
    friendlyMessage: 'Build process timed out'
  },
  {
    pattern: /timeout/i,
    category: 'timeout' as ErrorCategory,
    severity: 'error' as ErrorSeverity,
    stage: 'build' as BuildStage,
    friendlyMessage: 'Operation timed out'
  },

  // R2/infrastructure errors
  {
    pattern: /Error.*R2.*upload/i,
    category: 'infrastructure' as ErrorCategory,
    severity: 'critical' as ErrorSeverity,
    stage: 'deployment' as BuildStage,
    friendlyMessage: 'Failed to upload build artifacts to storage'
  },
  {
    pattern: /aws.*s3.*endpoint.*error/i,
    category: 'infrastructure' as ErrorCategory,
    severity: 'critical' as ErrorSeverity,
    stage: 'deployment' as BuildStage,
    friendlyMessage: 'Storage service connection error'
  }
];

/**
 * Main GitHub Actions Error Handler class
 */
export class GitHubErrorHandler {
  private githubClient: GitHubApiClient;
  private errorAnalyzer: ReturnType<typeof createBuildErrorAnalyzer>;

  constructor(githubToken: string) {
    this.githubClient = new GitHubApiClient(githubToken);
    this.errorAnalyzer = createBuildErrorAnalyzer();
  }

  /**
   * Fetch and analyze GitHub Actions workflow logs for errors
   */
  async analyzeWorkflowFailure(
    repositoryFullName: string,
    workflowRunId: number,
    projectId: string,
    framework: FrameworkType
  ): Promise<GitHubBuildErrorAnalysis | null> {
    try {
      console.info('[GITHUB-ERROR-HANDLER] Starting workflow failure analysis', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId,
        project_id: projectId,
        framework
      });

      // 1. Fetch workflow run details
      const workflowRun = await this.githubClient.getWorkflowRunStatus(
        repositoryFullName,
        workflowRunId
      );

      if (!workflowRun) {
        console.error('[GITHUB-ERROR-HANDLER] Workflow run not found');
        return null;
      }

      if (workflowRun.conclusion !== 'failure') {
        console.warn('[GITHUB-ERROR-HANDLER] Workflow did not fail', {
          status: workflowRun.status,
          conclusion: workflowRun.conclusion
        });
        return null;
      }

      // 2. Fetch and parse workflow logs
      const logAnalysis = await this.fetchAndParseWorkflowLogs(
        repositoryFullName,
        workflowRunId
      );

      if (!logAnalysis) {
        console.error('[GITHUB-ERROR-HANDLER] Failed to fetch workflow logs');
        return this.createFallbackErrorAnalysis(workflowRun, projectId, framework);
      }

      // 3. Extract primary error from logs
      const primaryError = this.extractPrimaryError(logAnalysis);
      
      // 4. Classify error using existing error analyzer
      const errorAnalysis = this.classifyGitHubError(
        primaryError,
        logAnalysis.failedStage,
        framework,
        logAnalysis
      );

      // 5. Create enhanced error analysis with GitHub context
      const enhancedAnalysis: GitHubBuildErrorAnalysis = {
        ...errorAnalysis,
        github_context: {
          workflow_run_id: workflowRunId,
          repository: repositoryFullName,
          failed_step: logAnalysis.failedSteps[0]?.name || 'unknown',
          step_number: logAnalysis.failedSteps[0]?.number || 0,
          workflow_run_url: workflowRun.html_url
        }
      };

      console.info('[GITHUB-ERROR-HANDLER] Workflow failure analysis completed', {
        project_id: projectId,
        error_category: enhancedAnalysis.category,
        error_severity: enhancedAnalysis.severity,
        failed_stage: enhancedAnalysis.stage,
        fixable: enhancedAnalysis.fixable
      });

      return enhancedAnalysis;

    } catch (error) {
      console.error('[GITHUB-ERROR-HANDLER] Error analyzing workflow failure', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId,
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      return null;
    }
  }

  /**
   * Fetch workflow run logs and parse them into structured data
   */
  private async fetchAndParseWorkflowLogs(
    repositoryFullName: string,
    workflowRunId: number
  ): Promise<GitHubLogAnalysis | null> {
    try {
      // Get workflow run details and steps
      const [workflowRun, steps] = await Promise.all([
        this.githubClient.getWorkflowRunStatus(repositoryFullName, workflowRunId),
        this.fetchWorkflowSteps(repositoryFullName, workflowRunId)
      ]);

      if (!workflowRun) {
        return null;
      }

      // Get failed steps
      const failedSteps = steps.filter(step => 
        step.conclusion === 'failure' || 
        (step.status === 'completed' && step.conclusion !== 'success')
      );

      // Fetch logs using GitHub API (this will need enhancement in githubApi.ts)
      const rawLogs = await this.fetchWorkflowRunLogs(repositoryFullName, workflowRunId);
      
      if (!rawLogs || rawLogs.length === 0) {
        console.warn('[GITHUB-ERROR-HANDLER] No logs available for analysis');
        return this.createMinimalLogAnalysis(workflowRunId, repositoryFullName, failedSteps);
      }

      // Parse log entries
      const logEntries = this.parseLogEntries(rawLogs);
      const errorEntries = logEntries.filter(entry => entry.isError);
      
      // Determine failed stage based on step names
      const failedStage = this.determineFailedStage(failedSteps);
      
      // Find primary error (most relevant error message)
      const primaryError = this.findPrimaryError(errorEntries, failedSteps);

      const logAnalysis: GitHubLogAnalysis = {
        workflowRunId,
        repositoryFullName,
        totalSteps: steps.length,
        failedSteps,
        errorEntries,
        primaryError,
        errorSummary: this.createErrorSummary(errorEntries, failedSteps),
        failedStage,
        logsFetchedAt: new Date().toISOString(),
        rawLogSize: rawLogs.join('\n').length
      };

      return logAnalysis;

    } catch (error) {
      console.error('[GITHUB-ERROR-HANDLER] Failed to fetch workflow logs', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Fetch workflow steps from GitHub API
   * Real GitHub API integration implementation
   */
  private async fetchWorkflowSteps(
    repositoryFullName: string,
    workflowRunId: number
  ): Promise<GitHubActionStep[]> {
    try {
      console.info('[GITHUB-ERROR-HANDLER] Fetching real workflow steps from GitHub API', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId
      });

      // Use the real GitHub API client method that we already implemented
      const steps = await this.githubClient.getWorkflowRunSteps(repositoryFullName, workflowRunId);
      
      if (!steps) {
        console.warn('[GITHUB-ERROR-HANDLER] No workflow steps found, workflow may not be started yet');
        return [];
      }

      console.info('[GITHUB-ERROR-HANDLER] Retrieved real workflow steps', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId,
        step_count: steps.length,
        failed_steps: steps.filter(step => step.conclusion === 'failure').length,
        completed_steps: steps.filter(step => step.status === 'completed').length
      });

      return steps;

    } catch (error) {
      console.error('[GITHUB-ERROR-HANDLER] Failed to fetch workflow steps from GitHub API', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Return empty array on failure instead of mock data
      return [];
    }
  }

  /**
   * Fetch raw workflow logs (enhanced version of githubApi method)
   * Now uses real GitHub Actions logs from ZIP extraction
   */
  private async fetchWorkflowRunLogs(
    repositoryFullName: string,
    workflowRunId: number
  ): Promise<string[] | null> {
    try {
      console.info('[GITHUB-ERROR-HANDLER] Fetching real workflow logs', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId
      });

      // Use the real GitHub API client method that now extracts actual ZIP data
      const logLines = await this.githubClient.getWorkflowRunLogs(repositoryFullName, workflowRunId);
      
      if (!logLines || logLines.length === 0) {
        console.warn('[GITHUB-ERROR-HANDLER] No workflow logs found, workflow may still be running');
        return null;
      }

      // Convert structured log lines back to raw text for parsing
      const rawLogs = logLines.map(line => 
        `${line.timestamp} ${line.content}`
      );

      console.info('[GITHUB-ERROR-HANDLER] Retrieved and processed real workflow logs', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId,
        total_log_lines: rawLogs.length,
        error_lines: logLines.filter(line => line.level === 'error').length,
        warning_lines: logLines.filter(line => line.level === 'warning').length
      });

      return rawLogs;

    } catch (error) {
      console.error('[GITHUB-ERROR-HANDLER] Failed to fetch workflow logs', {
        repository: repositoryFullName,
        workflow_run_id: workflowRunId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Parse raw log lines into structured log entries
   */
  private parseLogEntries(rawLogs: string[]): GitHubLogEntry[] {
    const entries: GitHubLogEntry[] = [];
    let currentStep = 'unknown';
    let currentStepNumber = 0;

    for (const line of rawLogs) {
      // Skip empty lines
      if (!line.trim()) continue;

      // Detect step boundaries (GitHub Actions format)
      const stepMatch = line.match(/##\[group\](.+)/);
      if (stepMatch) {
        currentStep = stepMatch[1].trim();
        currentStepNumber++;
        continue;
      }

      // Parse log entry
      const entry = this.parseLogLine(line, currentStep, currentStepNumber);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Parse individual log line into structured entry
   */
  private parseLogLine(line: string, stepName: string, stepNumber: number): GitHubLogEntry | null {
    // GitHub Actions log format typically: timestamp message
    const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)/);
    const timestamp = timestampMatch ? timestampMatch[1] : new Date().toISOString();
    
    // Remove timestamp from message
    const message = timestampMatch ? line.substring(timestampMatch[0].length).trim() : line.trim();
    
    // Determine log level and error status
    let level: GitHubLogEntry['level'] = 'info';
    let isError = false;
    let errorType: string | undefined;

    if (message.includes('ERROR') || message.includes('Error:') || message.includes('npm ERR!')) {
      level = 'error';
      isError = true;
      errorType = this.extractErrorType(message);
    } else if (message.includes('WARN') || message.includes('Warning:')) {
      level = 'warning';
    } else if (message.includes('DEBUG')) {
      level = 'debug';
    }

    return {
      timestamp,
      level,
      stepName,
      stepNumber,
      message,
      rawLine: line,
      isError,
      errorType
    };
  }

  /**
   * Extract error type from log message
   */
  private extractErrorType(message: string): string {
    // NPM errors
    if (message.includes('npm ERR!')) {
      if (message.includes('ERESOLVE')) return 'npm-dependency-conflict';
      if (message.includes('404')) return 'npm-package-not-found';
      return 'npm-error';
    }

    // TypeScript errors
    if (message.includes('error TS')) return 'typescript-error';
    
    // Build errors
    if (message.includes('build error') || message.includes('Build failed')) return 'build-error';
    
    // Vite errors
    if (message.includes('[vite]')) return 'vite-error';

    return 'unknown-error';
  }

  /**
   * Determine build stage that failed based on step names
   */
  private determineFailedStage(failedSteps: GitHubActionStep[]): BuildStage {
    if (failedSteps.length === 0) return 'build';

    const firstFailedStep = failedSteps[0];
    const stepName = firstFailedStep.name.toLowerCase();

    if (stepName.includes('install') || stepName.includes('dependencies')) {
      return 'npm-install';
    } else if (stepName.includes('build') || stepName.includes('compile')) {
      return 'build';
    } else if (stepName.includes('upload') || stepName.includes('r2') || stepName.includes('deploy')) {
      return 'deployment';
    } else if (stepName.includes('cleanup')) {
      return 'cleanup';
    }

    return 'build'; // Default fallback
  }

  /**
   * Find the most relevant error from log entries
   */
  private findPrimaryError(errorEntries: GitHubLogEntry[], failedSteps: GitHubActionStep[]): GitHubLogEntry | undefined {
    if (errorEntries.length === 0) return undefined;

    // Prioritize errors from failed steps
    if (failedSteps.length > 0) {
      const failedStepNumbers = failedSteps.map(s => s.number);
      const errorsFromFailedSteps = errorEntries.filter(entry => 
        failedStepNumbers.includes(entry.stepNumber)
      );
      
      if (errorsFromFailedSteps.length > 0) {
        return errorsFromFailedSteps[0];
      }
    }

    // Return first error entry
    return errorEntries[0];
  }

  /**
   * Create error summary from log analysis
   */
  private createErrorSummary(errorEntries: GitHubLogEntry[], failedSteps: GitHubActionStep[]): string {
    if (errorEntries.length === 0) {
      return `Build failed in ${failedSteps.length} step(s)`;
    }

    const primaryError = errorEntries[0];
    const errorCount = errorEntries.length;

    let summary = `Build failed with ${errorCount} error${errorCount > 1 ? 's' : ''}`;
    
    if (failedSteps.length > 0) {
      summary += ` in step "${failedSteps[0].name}"`;
    }

    if (primaryError.errorType) {
      summary += ` (${primaryError.errorType})`;
    }

    return summary;
  }

  /**
   * Extract primary error message from log analysis
   */
  private extractPrimaryError(logAnalysis: GitHubLogAnalysis): string {
    if (logAnalysis.primaryError) {
      return logAnalysis.primaryError.message;
    }
    
    if (logAnalysis.errorEntries.length > 0) {
      return logAnalysis.errorEntries[0].message;
    }

    return logAnalysis.errorSummary;
  }

  /**
   * Classify GitHub error using existing error analyzer with GitHub context
   */
  private classifyGitHubError(
    errorMessage: string,
    stage: BuildStage,
    framework: FrameworkType,
    logAnalysis: GitHubLogAnalysis
  ): BuildErrorAnalysis {
    // First, try GitHub-specific patterns
    for (const pattern of GITHUB_ACTIONS_ERROR_PATTERNS) {
      if (pattern.pattern.test(errorMessage)) {
        return {
          category: pattern.category,
          severity: pattern.severity,
          stage: pattern.stage,
          framework,
          userMessage: pattern.friendlyMessage,
          technicalMessage: errorMessage,
          suggestions: this.getGitHubSpecificSuggestions(pattern.category, pattern.stage),
          fixable: pattern.category !== 'infrastructure',
          debugInfo: {
            originalError: errorMessage,
            matchedPattern: pattern.friendlyMessage,
            context: this.createLogContext(logAnalysis)
          },
          confidence: 90,
          analysisTimestamp: new Date().toISOString()
        };
      }
    }

    // Fallback to existing error analyzer
    const analysis = this.errorAnalyzer.analyzeError(errorMessage, stage, framework);
    
    // Enhance with GitHub context
    analysis.debugInfo = {
      ...analysis.debugInfo,
      context: this.createLogContext(logAnalysis)
    };

    return analysis;
  }

  /**
   * Create log context for debugging
   */
  private createLogContext(logAnalysis: GitHubLogAnalysis): string {
    const context = [
      `Workflow Run: ${logAnalysis.workflowRunId}`,
      `Failed Steps: ${logAnalysis.failedSteps.map(s => s.name).join(', ')}`,
      `Error Count: ${logAnalysis.errorEntries.length}`,
      `Stage: ${logAnalysis.failedStage}`
    ];

    if (logAnalysis.primaryError) {
      context.push(`Primary Error: ${logAnalysis.primaryError.message.substring(0, 100)}...`);
    }

    return context.join('\n');
  }

  /**
   * Get GitHub-specific suggestions for error categories
   */
  private getGitHubSpecificSuggestions(category: ErrorCategory, stage: BuildStage): string[] {
    const suggestions: string[] = [];

    switch (category) {
      case 'dependency':
        suggestions.push(
          'Check package.json for correct dependency names and versions',
          'Try using --legacy-peer-deps flag for dependency conflicts',
          'Verify all dependencies exist in NPM registry',
          'Review GitHub Actions logs for specific NPM error details'
        );
        break;
        
      case 'syntax':
        suggestions.push(
          'Review TypeScript/JavaScript syntax in your component files',
          'Check import statements and file paths',
          'Verify JSX syntax follows React standards',
          'Use a linter to catch syntax issues before deployment'
        );
        break;
        
      case 'build':
        suggestions.push(
          'Check Vite configuration for your framework',
          'Verify all imports can be resolved',
          'Review build output in GitHub Actions logs',
          'Try building locally to reproduce the issue'
        );
        break;
        
      case 'timeout':
        suggestions.push(
          'Retry the build - timeouts are often temporary',
          'Reduce bundle size by removing unused dependencies',
          'Check for infinite loops in your components',
          'Consider optimizing large dependencies'
        );
        break;
        
      case 'infrastructure':
        suggestions.push(
          'Retry the build - infrastructure issues are usually temporary',
          'Check GitHub Actions status for service disruptions',
          'Verify Cloudflare R2 credentials and permissions',
          'Contact support if the issue persists across multiple builds'
        );
        break;
        
      default:
        suggestions.push(
          'Review GitHub Actions workflow logs for specific error details',
          'Try building the project locally to isolate the issue',
          'Check project files for common issues',
          'Contact support with GitHub Actions run URL if needed'
        );
    }

    return suggestions;
  }

  /**
   * Create fallback error analysis when logs can't be fetched
   */
  private createFallbackErrorAnalysis(
    workflowRun: GitHubWorkflowRun,
    projectId: string,
    framework: FrameworkType
  ): GitHubBuildErrorAnalysis {
    return {
      category: 'unknown',
      severity: 'error',
      stage: 'build',
      framework,
      userMessage: 'GitHub Actions build failed, but detailed logs could not be retrieved.',
      technicalMessage: `Workflow run ${workflowRun.id} failed with conclusion: ${workflowRun.conclusion}`,
      suggestions: [
        'Visit the GitHub Actions run URL to view detailed logs',
        'Check for common build issues in your project',
        'Try running the build again in case of temporary issues',
        'Contact support with the GitHub Actions run URL'
      ],
      fixable: true,
      debugInfo: {
        originalError: `GitHub Actions workflow failed: ${workflowRun.conclusion}`,
        context: `Workflow: ${workflowRun.name}, Run: ${workflowRun.run_number}`
      },
      confidence: 25, // Low confidence without detailed logs
      analysisTimestamp: new Date().toISOString(),
      github_context: {
        workflow_run_id: workflowRun.id,
        repository: 'unknown',
        failed_step: 'unknown',
        step_number: 0,
        workflow_run_url: workflowRun.html_url
      }
    };
  }

  /**
   * Create minimal log analysis when logs can't be fetched
   */
  private createMinimalLogAnalysis(
    workflowRunId: number,
    repositoryFullName: string,
    failedSteps: GitHubActionStep[]
  ): GitHubLogAnalysis {
    return {
      workflowRunId,
      repositoryFullName,
      totalSteps: failedSteps.length,
      failedSteps,
      errorEntries: [],
      errorSummary: 'GitHub Actions build failed - logs not available',
      failedStage: 'build',
      logsFetchedAt: new Date().toISOString(),
      rawLogSize: 0
    };
  }

}

/**
 * Factory function to create GitHub error handler
 */
export function createGitHubErrorHandler(githubToken: string): GitHubErrorHandler {
  return new GitHubErrorHandler(githubToken);
}

/**
 * Utility function to extract error category from GitHub Actions error
 */
export function classifyGitHubActionsError(errorMessage: string): ErrorCategory {
  // Handle null/undefined inputs
  if (!errorMessage || typeof errorMessage !== 'string') {
    return 'unknown';
  }

  const message = errorMessage.toLowerCase();
  
  if (message.includes('npm err') || message.includes('dependency') || message.includes('package')) {
    return 'dependency';
  } else if (message.includes('typescript') || message.includes('error ts') || message.includes('syntax') || message.includes('parse')) {
    return 'syntax';
  } else if (message.includes('build') || message.includes('compile') || message.includes('vite')) {
    return 'build';
  } else if (message.includes('timeout') || message.includes('canceled')) {
    return 'timeout';
  } else if (message.includes('r2') || message.includes('upload') || message.includes('storage')) {
    return 'infrastructure';
  }
  
  return 'unknown';
}