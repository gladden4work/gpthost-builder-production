/**
 * GitHub API Integration for GPTHost
 * 
 * CRITICAL: This replaces the simulated build system with real GitHub Actions.
 * Cloudflare Workers cannot execute npm install or vite build directly,
 * so we must use GitHub Actions for actual builds.
 * 
 * Features:
 * - Repository creation and management
 * - GitHub Actions workflow triggering
 * - Token authentication and validation
 * - Multi-project repository structure
 * - Build status monitoring
 */

import { BuildJob, BuildStatus, FrameworkType } from '../types/api';
import JSZip from 'jszip';

/**
 * GitHub API response types
 */
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  created_at: string;
  updated_at: string;
}

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
 * GitHub Actions log line with metadata
 */
export interface GitHubActionLogLine {
  timestamp: string;
  step_name: string;
  step_number?: number;
  content: string;
  level: 'info' | 'warning' | 'error' | 'debug';
  job_name?: string;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: null | 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out';
  html_url: string;
  created_at: string;
  updated_at: string;
  run_number: number;
  run_started_at: string;
}

export interface GitHubWorkflowDispatchEvent {
  ref: string;
  inputs: {
    project_id: string;
    framework: FrameworkType;
    source_files: string;
    build_config: string;
    callback_url?: string;
  };
}

export interface GitHubApiError {
  message: string;
  documentation_url?: string;
  status: number;
  errors?: Array<{
    resource: string;
    field: string;
    code: string;
  }>;
}

export interface GitHubRateLimitInfo {
  limit: number;
  remaining: number;
  reset_time: number; // Unix timestamp (renamed to match expected format)
  retryAfter?: number; // Seconds to wait
}

export interface GitHubApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: GitHubApiError;
  rateLimitInfo?: GitHubRateLimitInfo;
}

/**
 * GitHub API client for GPTHost build operations
 */
export class GitHubApiClient {
  private token: string;
  private baseUrl = 'https://api.github.com';
  private userAgent = 'GPTHost-Builder/1.0';
  private lastRateLimitInfo: GitHubRateLimitInfo | null = null;

  constructor(token: string) {
    if (!token) {
      throw new Error('GitHub token is required');
    }
    this.token = token;
  }

  /**
   * Validate GitHub token and get user information
   */
  async validateToken(): Promise<{ valid: boolean; user?: string; scopes?: string[] }> {
    try {
      const result = await this.makeApiRequest<{ login: string }>(`${this.baseUrl}/user`);
      
      if (!result.success) {
        if (result.error?.status === 401) {
          return { valid: false };
        }
        
        console.error('GitHub token validation failed:', result.error?.message);
        return { valid: false };
      }

      // Note: OAuth scopes are not available in the new response format
      // This would require a separate API call if needed
      return {
        valid: true,
        user: result.data?.login,
        scopes: [] // OAuth scopes not available through makeApiRequest
      };
    } catch (error) {
      console.error('GitHub token validation failed:', error);
      return { valid: false };
    }
  }

  /**
   * Create dedicated repository for GPTHost builds
   */
  async createBuildRepository(
    orgOrUser: string, 
    repositoryName: string = 'gpthost-builds',
    isPrivate: boolean = true
  ): Promise<GitHubRepository> {
    try {
      // Check if repository already exists
      const existingRepo = await this.getRepository(orgOrUser, repositoryName);
      if (existingRepo) {
        console.info(`Repository ${orgOrUser}/${repositoryName} already exists`);
        return existingRepo;
      }
    } catch (error) {
      // Repository doesn't exist, continue with creation
    }

    const response = await fetch(`${this.baseUrl}/user/repos`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        name: repositoryName,
        description: 'Automated builds for GPTHost - AI-generated React components',
        private: isPrivate,
        auto_init: true,
        license_template: 'mit',
        gitignore_template: 'Node'
      }),
    });

    if (!response.ok) {
      const error: GitHubApiError = await response.json();
      throw new Error(`Failed to create repository: ${error.message}`);
    }

    const repository: GitHubRepository = await response.json();
    
    // Set up initial repository structure
    await this.setupInitialRepositoryStructure(repository.full_name);
    
    console.info(`Created GitHub repository: ${repository.html_url}`);
    return repository;
  }

  /**
   * Get repository information
   */
  async getRepository(owner: string, repo: string): Promise<GitHubRepository | null> {
    try {
      const result = await this.makeApiRequest<GitHubRepository>(`${this.baseUrl}/repos/${owner}/${repo}`);
      
      if (!result.success) {
        if (result.error?.status === 404) {
          return null;
        }
        
        // Log non-404 errors but still return null for consistency
        console.error(`Failed to get repository ${owner}/${repo}:`, result.error?.message);
        return null;
      }

      return result.data || null;
    } catch (error) {
      console.error(`Failed to get repository ${owner}/${repo}:`, error);
      return null;
    }
  }

  /**
   * Create GitHub Actions workflow files in the repository
   */
  async setupInitialRepositoryStructure(repositoryFullName: string): Promise<void> {
    const [owner, repo] = repositoryFullName.split('/');
    
    try {
      // Create .github/workflows directory structure
      await this.createFile(
        repositoryFullName,
        '.github/workflows/gpthost-build.yml',
        this.generateBuildWorkflowYaml(),
        'Add GPTHost build workflow'
      );

      await this.createFile(
        repositoryFullName,
        'README.md',
        this.generateRepositoryReadme(),
        'Initial repository setup for GPTHost builds'
      );

      await this.createFile(
        repositoryFullName,
        '.gitignore',
        this.generateGitIgnore(),
        'Add comprehensive .gitignore for Node.js builds'
      );

      console.info(`Set up initial structure for repository: ${repositoryFullName}`);
    } catch (error) {
      console.error(`Failed to set up repository structure: ${error}`);
      throw error;
    }
  }

  /**
   * Create or update a file in the repository
   */
  async createFile(
    repositoryFullName: string,
    filePath: string,
    content: string,
    commitMessage: string,
    branch: string = 'main'
  ): Promise<void> {
    const [owner, repo] = repositoryFullName.split('/');
    
    try {
      // Check if file exists to get SHA for updates
      let sha: string | undefined;
      try {
        const existingFile = await fetch(
          `${this.baseUrl}/repos/${repositoryFullName}/contents/${filePath}?ref=${branch}`,
          { headers: this.getHeaders() }
        );
        
        if (existingFile.ok) {
          const fileData = await existingFile.json();
          sha = fileData.sha;
        }
      } catch (error) {
        // File doesn't exist, that's fine
      }

      const response = await fetch(
        `${this.baseUrl}/repos/${repositoryFullName}/contents/${filePath}`,
        {
          method: 'PUT',
          headers: this.getHeaders(),
          body: JSON.stringify({
            message: commitMessage,
            content: btoa(unescape(encodeURIComponent(content))), // Cloudflare Workers compatible encoding
            branch,
            ...(sha && { sha }) // Include SHA for updates
          }),
        }
      );

      if (!response || !response.ok) {
        if (!response) {
          throw new Error(`Failed to create file ${filePath}: No response from GitHub API`);
        }
        const error: GitHubApiError = await response.json();
        throw new Error(`Failed to create file ${filePath}: ${error.message}`);
      }

      console.info(`Created/updated file: ${filePath} in ${repositoryFullName}`);
    } catch (error) {
      console.error(`Failed to create file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Trigger GitHub Actions workflow for build
   */
  async triggerBuild(
    repositoryFullName: string,
    buildJob: BuildJob,
    callbackUrl?: string,
    callbackToken?: string
  ): Promise<{ success: boolean; runId?: number; error?: string }> {
    try {
      // FIX: Pass source files directly as workflow input instead of uploading to repository
      // The GitHub workflow expects files as JSON in the source_files input parameter
      console.info('🚀 [GITHUB-API] Triggering GitHub Actions workflow with source files as input');
      
      // CRITICAL FIX: Preprocess JSX/TSX files to fix AI-generated patterns
      // This MUST happen right before sending to GitHub Actions to ensure the files are clean
      const { preprocessFiles } = await import('./jsxPreprocessor');
      console.info('🧹 [GITHUB-API] Preprocessing JSX/TSX files to fix AI-generated patterns');
      let preprocessedSourceFiles = preprocessFiles(buildJob.source_files);

      // Belt-and-suspenders: ensure dangerouslySetInnerHTML uses double braces
      // This guards against any regression or out-of-sync preprocessor builds.
      const fixDangerouslySetInnerHTML = (code: string): string => {
        try {
          // Transform: dangerouslySetInnerHTML={ __html: expr } -> dangerouslySetInnerHTML={{ __html: expr }}
          // Keep conservative pattern to avoid over-matching.
          return code.replace(/dangerouslySetInnerHTML\s*=\s*\{\s*__html\s*:\s*([^}]+)\s*\}/g, 'dangerouslySetInnerHTML={{ __html: $1 }}');
        } catch {
          return code;
        }
      };

      preprocessedSourceFiles = Object.fromEntries(
        Object.entries(preprocessedSourceFiles).map(([k, v]) => [
          k,
          typeof v === 'string' ? fixDangerouslySetInnerHTML(v) : v,
        ])
      );
      
      // Log preprocessing results for debugging
      const originalKeys = Object.keys(buildJob.source_files);
      const preprocessedKeys = Object.keys(preprocessedSourceFiles);
      console.info(`📝 [GITHUB-API] Preprocessed ${preprocessedKeys.length} files (original: ${originalKeys.length})`);
      
      // Check for JSX/TSX files and log if any were preprocessed
      const jsxFiles = preprocessedKeys.filter(key => 
        key.endsWith('.jsx') || key.endsWith('.tsx') || 
        key.endsWith('.js') || key.endsWith('.ts')
      );
      if (jsxFiles.length > 0) {
        console.info(`🔧 [GITHUB-API] Preprocessed ${jsxFiles.length} JSX/TSX files: ${jsxFiles.join(', ')}`);
      }
      
      // Generate base package.json content for the build
      const packageJson = this.generatePackageJson(buildJob.framework, buildJob.build_config);
      
      // Prepare source files including generated package.json (using PREPROCESSED files)
      const sourceFilesWithPackage: Record<string, string> = {
        ...preprocessedSourceFiles,  // Use preprocessed files instead of original
        'package.json': JSON.stringify(packageJson, null, 2)
      };
      
      // Add vite.config.js if needed
      if (['react', 'vue', 'svelte'].includes(buildJob.framework)) {
        sourceFilesWithPackage['vite.config.js'] = this.generateViteConfig(buildJob.framework);
      }

      // Detect external libraries required by the component to augment package.json
      // Files have already been preprocessed before saving to R2, so we just scan for dependencies
      let needsXlsx = false;
      for (const [filename, content] of Object.entries(sourceFilesWithPackage)) {
        if ((filename.endsWith('.jsx') || filename.endsWith('.tsx') || filename.endsWith('.js') || filename.endsWith('.ts')) && typeof content === 'string') {
          // Example: import * as XLSX from 'xlsx' or import { read } from 'xlsx'
          if (/from\s+['"]xlsx['"]/.test(content) || /require\(\s*['"]xlsx['"]\s*\)/.test(content)) {
            needsXlsx = true;
          }
        }
      }

      // Add detected dependencies to package.json
      if (needsXlsx) {
        packageJson.dependencies = packageJson.dependencies || {};
        if (!packageJson.dependencies['xlsx']) {
          packageJson.dependencies['xlsx'] = '^0.18.5';
          console.info('📦 [GITHUB-API] Adding dependency: xlsx');
        }
      }

      // Provide a smart default callback URL if not specified
      // This ensures the workflow always receives a valid callback URL
      // Prefer explicit callback, then env var, then static fallback
      const effectiveCallbackUrl =
        callbackUrl ||
        (typeof process !== 'undefined' && process.env && process.env.GITHUB_BUILD_CALLBACK_URL) ||
        'https://gpthost-builder-staging.gladden4work.workers.dev/api/v2/github/build-callback';
      
      if (!callbackUrl) {
        console.info('📌 [GITHUB-API] Using default callback URL:', effectiveCallbackUrl);
      }
      
      // Trigger the workflow dispatch event with files as JSON input
      const response = await fetch(
        `${this.baseUrl}/repos/${repositoryFullName}/actions/workflows/gpthost-build.yml/dispatches`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            ref: 'main',
            inputs: {
              project_id: buildJob.project_id,
              // FIX: Pass source files as JSON string in workflow input
              source_files: JSON.stringify(sourceFilesWithPackage),
              // FIX: Pass the generated package.json as build_config
              build_config: JSON.stringify(packageJson),
              callback_url: effectiveCallbackUrl,
              // FIX: Use the callback token passed to the function, or fallback to GitHub API token
              // The BuildService should pass the correct GITHUB_CALLBACK_TOKEN
              callback_token: callbackToken || this.token
            }
          }),
        }
      );

      if (!response.ok) {
        const error: GitHubApiError = await response.json();
        console.error('❌ [GITHUB-API] Workflow dispatch failed:', error);
        return { success: false, error: `Failed to trigger workflow: ${error.message}` };
      }

      console.info('✅ [GITHUB-API] Workflow dispatch request sent successfully');

      // Wait a moment for the workflow to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Get the latest workflow run
      const latestRun = await this.getLatestWorkflowRun(repositoryFullName, 'gpthost-build.yml');
      
      if (latestRun) {
        console.info(`✅ [GITHUB-API] GitHub Actions build triggered for project: ${buildJob.project_id}, Run ID: ${latestRun.id}`);
      } else {
        console.info(`⚠️ [GITHUB-API] Workflow dispatched but run ID not immediately available for project: ${buildJob.project_id}`);
      }
      
      return { success: true, runId: latestRun?.id };

    } catch (error) {
      console.error(`❌ [GITHUB-API] Failed to trigger build for project ${buildJob.project_id}:`, error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // NOTE: uploadProjectFiles method removed - files are now passed as workflow inputs
  // The GitHub Actions workflow handles file creation from the JSON input

  /**
   * Get the latest workflow run for a specific workflow
   */
  async getLatestWorkflowRun(
    repositoryFullName: string, 
    workflowFileName: string
  ): Promise<GitHubWorkflowRun | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/repos/${repositoryFullName}/actions/workflows/${workflowFileName}/runs?per_page=1`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        const error: GitHubApiError = await response.json();
        throw new Error(`Failed to get workflow runs: ${error.message}`);
      }

      const data = await response.json();
      return data.workflow_runs?.[0] || null;
    } catch (error) {
      console.error(`Failed to get latest workflow run:`, error);
      return null;
    }
  }

  /**
   * Get workflow run status and details
   */
  async getWorkflowRunStatus(repositoryFullName: string, runId: number): Promise<GitHubWorkflowRun | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/repos/${repositoryFullName}/actions/runs/${runId}`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        const error: GitHubApiError = await response.json();
        throw new Error(`Failed to get workflow run: ${error.message}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Failed to get workflow run status for run ${runId}:`, error);
      return null;
    }
  }

  /**
   * Get workflow run logs - Enhanced for TASK-026
   * Fetches, extracts, and parses GitHub Actions workflow logs
   */
  async getWorkflowRunLogs(repositoryFullName: string, runId: number): Promise<GitHubActionLogLine[] | null> {
    try {
      console.info('[GITHUB-API] Fetching workflow logs', {
        repository: repositoryFullName,
        run_id: runId
      });

      const response = await fetch(
        `${this.baseUrl}/repos/${repositoryFullName}/actions/runs/${runId}/logs`,
        { 
          headers: this.getHeaders(),
          redirect: 'follow' // Follow redirects to get actual ZIP file
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          console.warn('[GITHUB-API] Workflow logs not found (run may still be in progress)');
          return null;
        }
        const error: GitHubApiError = await response.json();
        throw new Error(`Failed to get workflow logs: ${error.message}`);
      }

      // GitHub returns logs as a ZIP file - we need to extract it
      const zipBuffer = await response.arrayBuffer();
      
      console.info('[GITHUB-API] Downloaded workflow logs ZIP', {
        size_bytes: zipBuffer.byteLength,
        content_type: response.headers.get('content-type')
      });

      // Extract and parse ZIP file
      const logLines = await this.extractAndParseLogsZip(zipBuffer);
      
      console.info('[GITHUB-API] Workflow logs extracted and parsed', {
        total_lines: logLines.length,
        has_errors: logLines.some(line => line.level === 'error' || line.content.toLowerCase().includes('error'))
      });

      return logLines.length > 0 ? logLines : null;

    } catch (error) {
      console.error('[GITHUB-API] Failed to get workflow logs', {
        repository: repositoryFullName,
        run_id: runId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Get workflow run steps with enhanced error information
   */
  async getWorkflowRunSteps(repositoryFullName: string, runId: number): Promise<GitHubActionStep[] | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/repos/${repositoryFullName}/actions/runs/${runId}/jobs`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        const error: GitHubApiError = await response.json();
        throw new Error(`Failed to get workflow jobs: ${error.message}`);
      }

      const data = await response.json();
      const jobs = data.jobs || [];

      // Extract steps from all jobs
      const allSteps: GitHubActionStep[] = [];
      let stepNumber = 1;

      for (const job of jobs) {
        if (job.steps && Array.isArray(job.steps)) {
          for (const step of job.steps) {
            allSteps.push({
              name: step.name,
              status: step.status,
              conclusion: step.conclusion,
              number: stepNumber++,
              started_at: step.started_at,
              completed_at: step.completed_at
            });
          }
        }
      }

      console.info('[GITHUB-API] Workflow steps fetched', {
        repository: repositoryFullName,
        run_id: runId,
        total_jobs: jobs.length,
        total_steps: allSteps.length,
        failed_steps: allSteps.filter(s => s.conclusion === 'failure').length
      });

      return allSteps;

    } catch (error) {
      console.error('[GITHUB-API] Failed to get workflow steps', {
        repository: repositoryFullName,
        run_id: runId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Extract and parse GitHub Actions logs ZIP file
   * TASK-026: Real ZIP extraction implementation using JSZip
   */
  private async extractAndParseLogsZip(zipBuffer: ArrayBuffer): Promise<GitHubActionLogLine[]> {
    try {
      console.info('[GITHUB-API] Extracting real logs from ZIP file', {
        size: zipBuffer.byteLength
      });

      // Check if this is actually a ZIP file
      const uint8Array = new Uint8Array(zipBuffer);
      const isZip = uint8Array[0] === 0x50 && uint8Array[1] === 0x4B; // PK header

      if (!isZip) {
        console.warn('[GITHUB-API] Data is not a ZIP file, attempting plain text parsing');
        // If not a ZIP, try to parse as plain text
        const textDecoder = new TextDecoder();
        const logText = textDecoder.decode(zipBuffer);
        return this.parseLogContent(logText, 'plain-text.log');
      }

      // Extract ZIP using JSZip
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(zipBuffer);
      
      console.info('[GITHUB-API] ZIP file loaded successfully', {
        file_count: Object.keys(zipContent.files).length
      });

      const logLines: GitHubActionLogLine[] = [];
      let processedFiles = 0;

      // Process each file in the ZIP
      for (const [filename, file] of Object.entries(zipContent.files)) {
        if (file.dir) {
          continue; // Skip directories
        }

        // GitHub Actions logs are typically .txt files
        if (filename.endsWith('.txt')) {
          try {
            const content = await file.async('text');
            console.info(`[GITHUB-API] Processing log file: ${filename} (${content.length} chars)`);
            
            const parsedLines = this.parseLogContent(content, filename);
            logLines.push(...parsedLines);
            processedFiles++;
            
            console.info(`[GITHUB-API] Extracted ${parsedLines.length} log lines from ${filename}`);
          } catch (fileError) {
            console.error(`[GITHUB-API] Failed to extract file ${filename}:`, fileError);
            continue;
          }
        }
      }

      console.info('[GITHUB-API] ZIP extraction completed', {
        processed_files: processedFiles,
        total_log_lines: logLines.length,
        error_lines: logLines.filter(line => line.level === 'error').length,
        warning_lines: logLines.filter(line => line.level === 'warning').length
      });

      return logLines;

    } catch (error) {
      console.error('[GITHUB-API] Failed to extract logs ZIP', error);
      // Return empty array on failure - caller should handle this gracefully
      return [];
    }
  }

  /**
   * Parse log content from a single file into structured log lines
   */
  private parseLogContent(content: string, filename: string): GitHubActionLogLine[] {
    const lines = content.split('\n').filter(line => line.trim());
    const logLines: GitHubActionLogLine[] = [];
    let currentStep = 'Unknown Step';
    let currentJobName = this.extractJobNameFromFilename(filename);

    for (const line of lines) {
      // Parse GitHub Actions log format
      const logLine = this.parseGitHubActionLogLine(line, currentStep, currentJobName);
      if (logLine) {
        logLines.push(logLine);
        
        // Update current step if we found a step marker
        if (logLine.step_name && logLine.step_name !== 'Unknown Step') {
          currentStep = logLine.step_name;
        }
      }
    }

    return logLines;
  }

  /**
   * Parse a single GitHub Actions log line
   */
  private parseGitHubActionLogLine(
    line: string, 
    defaultStep: string, 
    jobName?: string
  ): GitHubActionLogLine | null {
    if (!line.trim()) {
      return null;
    }

    // GitHub Actions log format: timestamp ##[...] or timestamp message
    // Examples:
    // 2025-01-11T12:00:00.000Z ##[group]Run actions/checkout@v4
    // 2025-01-11T12:00:01.000Z npm ERR! code ERESOLVE
    
    let timestamp = new Date().toISOString();
    let content = line;
    let stepName = defaultStep;
    let level: 'info' | 'warning' | 'error' | 'debug' = 'info';

    // Extract timestamp if present (ISO format at start of line)
    const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.?\d*Z?)\s+(.+)$/);
    if (timestampMatch) {
      timestamp = timestampMatch[1];
      content = timestampMatch[2];
    }

    // Extract step information from GitHub Actions format
    const groupMatch = content.match(/##\[group\](.+)/);
    if (groupMatch) {
      stepName = groupMatch[1];
      level = 'info';
    }

    const endGroupMatch = content.match(/##\[endgroup\]/);
    if (endGroupMatch) {
      content = 'Step completed';
      level = 'info';
    }

    // Detect error levels
    if (content.toLowerCase().includes('error') || content.includes('npm ERR!') || content.includes('❌')) {
      level = 'error';
    } else if (content.toLowerCase().includes('warn') || content.includes('⚠️')) {
      level = 'warning';
    } else if (content.includes('##[debug]')) {
      level = 'debug';
    }

    return {
      timestamp,
      step_name: stepName,
      content: content.trim(),
      level,
      job_name: jobName
    };
  }

  /**
   * Extract job name from log filename
   */
  private extractJobNameFromFilename(filename: string): string {
    // GitHub Actions log files are typically named like:
    // "1_build.txt", "2_Deploy.txt", etc.
    // or "1_Build (Node.js 18).txt"
    
    const match = filename.match(/^\d+_(.+)\.txt$/);
    if (match) {
      return match[1];
    }
    
    return 'Unknown Job';
  }

  /**
   * Get current rate limit information
   */
  getRateLimitInfo(): GitHubRateLimitInfo | null {
    return this.lastRateLimitInfo;
  }


  /**
   * Convert GitHub workflow run to GPTHost build status
   */
  convertWorkflowToBuildStatus(
    workflowRun: GitHubWorkflowRun, 
    projectId: string
  ): BuildStatus {
    let status: BuildStatus['status'];
    let progress: number;
    let currentStage: BuildStatus['current_stage'];

    switch (workflowRun.status) {
      case 'queued':
        status = 'queued';
        progress = 0;
        currentStage = 'queued';
        break;
      case 'in_progress':
        status = 'processing';
        progress = 50; // Estimate 50% progress for in-progress builds
        currentStage = 'build'; // Default to build stage
        break;
      case 'completed':
        if (workflowRun.conclusion === 'success') {
          status = 'completed';
          progress = 100;
          currentStage = 'deployment';
        } else {
          status = 'failed';
          progress = 0;
          currentStage = 'build';
        }
        break;
      default:
        status = 'failed';
        progress = 0;
        currentStage = 'npm-install';
    }

    return {
      status,
      progress,
      current_stage: currentStage,
      logs: [`GitHub Actions run: ${workflowRun.html_url}`],
      metadata: {
        job_id: `gh-${workflowRun.id}`,
        queued_at: workflowRun.created_at,
        started_at: workflowRun.run_started_at
      }
    };
  }

  /**
   * Production-ready API request handler with comprehensive error handling and rate limiting
   */
  private async makeApiRequest<T = any>(
    url: string, 
    options: RequestInit = {}, 
    retryCount: number = 0
  ): Promise<GitHubApiResponse<T>> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...options.headers
        }
      });

      // Extract rate limit information from headers
      const rateLimitInfo = this.extractRateLimitInfo(response);

      // Handle rate limiting (status 403 with rate limit exceeded)
      if (response.status === 403 && rateLimitInfo && rateLimitInfo.remaining === 0) {
        const resetTime = rateLimitInfo.reset_time * 1000; // Convert to milliseconds
        const waitTime = Math.max(0, resetTime - Date.now()) / 1000; // Convert to seconds
        
        console.warn('GitHub API rate limit exceeded', {
          resetTime: new Date(resetTime).toISOString(),
          waitTime: Math.round(waitTime),
          url: url.replace(this.baseUrl, ''),
          remaining: rateLimitInfo.remaining,
          limit: rateLimitInfo.limit
        });

        return {
          success: false,
          error: {
            message: `Rate limit exceeded. Reset at ${new Date(resetTime).toISOString()}`,
            status: 403
          },
          rateLimitInfo: {
            ...rateLimitInfo,
            retryAfter: Math.ceil(waitTime)
          }
        };
      }

      // Handle secondary rate limits (status 403 with retry-after header)
      if (response.status === 403 && response.headers.get('retry-after')) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '60');
        console.warn('GitHub API secondary rate limit hit', {
          retryAfter,
          url: url.replace(this.baseUrl, '')
        });
        
        return {
          success: false,
          error: {
            message: `Secondary rate limit exceeded. Retry after ${retryAfter} seconds`,
            status: 403
          },
          rateLimitInfo: {
            ...rateLimitInfo,
            retryAfter
          }
        };
      }

      // Handle other client errors (4xx) - don't retry
      if (response.status >= 400 && response.status < 500 && response.status !== 403) {
        let errorData: GitHubApiError;
        try {
          errorData = await response.json();
        } catch {
          errorData = {
            message: `HTTP ${response.status}: ${response.statusText}`,
            status: response.status
          };
        }
        
        return {
          success: false,
          error: errorData,
          rateLimitInfo
        };
      }

      // Handle server errors (5xx) - retry with exponential backoff
      if (response.status >= 500 && retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
        console.warn('GitHub API server error, retrying', {
          status: response.status,
          retryCount: retryCount + 1,
          delay,
          url: url.replace(this.baseUrl, '')
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeApiRequest<T>(url, options, retryCount + 1);
      }

      // Handle successful responses
      if (response.ok) {
        let data: T;
        const contentType = response.headers.get('content-type');
        
        if (contentType && contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text() as any;
        }
        
        return {
          success: true,
          data,
          rateLimitInfo
        };
      }

      // Handle other non-success responses
      let errorData: GitHubApiError;
      try {
        errorData = await response.json();
      } catch {
        errorData = {
          message: `HTTP ${response.status}: ${response.statusText}`,
          status: response.status
        };
      }
      
      return {
        success: false,
        error: errorData,
        rateLimitInfo
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Network errors - retry with exponential backoff
      if (retryCount < maxRetries && (
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('connection')
      )) {
        const delay = baseDelay * Math.pow(2, retryCount);
        console.warn('GitHub API network error, retrying', {
          error: errorMessage,
          retryCount: retryCount + 1,
          delay,
          url: url.replace(this.baseUrl, '')
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.makeApiRequest<T>(url, options, retryCount + 1);
      }
      
      return {
        success: false,
        error: {
          message: errorMessage,
          status: 0 // Network error
        }
      };
    }
  }

  /**
   * Extract rate limit information from GitHub API response headers
   */
  private extractRateLimitInfo(response: Response): GitHubRateLimitInfo | undefined {
    const limit = response.headers.get('x-ratelimit-limit');
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    
    if (limit && remaining && reset) {
      const rateLimitInfo: GitHubRateLimitInfo = {
        limit: parseInt(limit),
        remaining: parseInt(remaining),
        reset_time: parseInt(reset)
      };
      
      // Store for later retrieval
      this.lastRateLimitInfo = rateLimitInfo;
      
      return rateLimitInfo;
    }
    
    return undefined;
  }

  /**
   * Get common headers for GitHub API requests
   */
  private getHeaders(): HeadersInit {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': this.userAgent,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Generate GitHub Actions workflow YAML for builds
   * 
   * TASK-022: Enhanced workflow with R2 upload, build matrix, and framework support
   */
  private generateBuildWorkflowYaml(): string {
    return `name: GPTHost Build Pipeline

on:
  workflow_dispatch:
    inputs:
      project_id:
        description: 'Project ID'
        required: true
        type: string
      source_files:
        description: 'Source files as JSON object'
        required: true
        type: string
      build_config:
        description: 'Build configuration'
        required: true
        type: string
      callback_url:
        description: 'Callback URL for build status'
        required: true
        type: string
      callback_token:
        description: 'Authentication token for callback'
        required: true
        type: string

env:
  NODE_VERSION: '20'
  PROJECT_ID: \${{ inputs.project_id }}
  CALLBACK_URL: \${{ inputs.callback_url }}
  CALLBACK_TOKEN: \${{ inputs.callback_token }}
  CACHE_VERSION: \${{ vars.CACHE_VERSION || '1' }}

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    
    steps:
    - name: Checkout repository
      uses: actions/checkout@v4
      with:
        token: \${{ secrets.GITHUB_TOKEN }}
        fetch-depth: 1

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: \${{ env.NODE_VERSION }}
        registry-url: 'https://registry.npmjs.org'

    # FIX: Create cache directories before cache steps (CRITICAL FIX)
    - name: Create cache directories
      run: mkdir -p projects/\${{ inputs.project_id }}

    # TASK-027: Multi-level cache strategy for build optimization (FIXED)
    - name: Cache node_modules (Level 1 - Exact Dependencies)
      id: cache-node-modules-exact
      uses: actions/cache@v4
      with:
        path: |
          projects/\${{ inputs.project_id }}/node_modules
          ~/.npm
        key: node-modules-v\${{ env.CACHE_VERSION }}-\${{ runner.os }}-\${{ inputs.project_id }}-\${{ hashFiles('projects/\${{ inputs.project_id }}/package-lock.json') }}
        restore-keys: |
          node-modules-v\${{ env.CACHE_VERSION }}-\${{ runner.os }}-\${{ inputs.project_id }}-\${{ hashFiles('projects/\${{ inputs.project_id }}/package.json') }}
          node-modules-v\${{ env.CACHE_VERSION }}-\${{ runner.os }}-\${{ inputs.project_id }}-

    - name: Cache npm global packages (Level 2 - Global Cache)
      uses: actions/cache@v4
      with:
        path: ~/.npm
        key: npm-cache-v\${{ env.CACHE_VERSION }}-\${{ runner.os }}-\${{ inputs.project_id }}-\${{ hashFiles('projects/\${{ inputs.project_id }}/package-lock.json') }}
        restore-keys: |
          npm-cache-v\${{ env.CACHE_VERSION }}-\${{ runner.os }}-\${{ inputs.project_id }}-\${{ hashFiles('projects/\${{ inputs.project_id }}/package.json') }}
          npm-cache-v\${{ env.CACHE_VERSION }}-\${{ runner.os }}-\${{ inputs.project_id }}-

    - name: Cache framework dependencies (Level 3 - Framework Cache)
      uses: actions/cache@v4
      with:
        path: |
          projects/\${{ inputs.project_id }}/node_modules/.cache
          projects/\${{ inputs.project_id }}/node_modules/.vite
        key: framework-cache-v\${{ env.CACHE_VERSION }}-\${{ runner.os }}-\${{ inputs.project_id }}-\${{ hashFiles('projects/\${{ inputs.project_id }}/package.json') }}
        restore-keys: |
          framework-cache-v\${{ env.CACHE_VERSION }}-\${{ runner.os }}-\${{ inputs.project_id }}-
          framework-cache-v\${{ env.CACHE_VERSION }}-\${{ runner.os }}-

    - name: Create project directory
      run: |
        echo "Creating project directory structure..."
        mkdir -p projects/\${{ inputs.project_id }}/src
        mkdir -p projects/\${{ inputs.project_id }}/public
        mkdir -p artifacts/\${{ inputs.project_id }}
        
        echo "Project directory created successfully"
        ls -la projects/

    # CRITICAL FIX: Create source files from workflow input (preserving newlines)
    - name: Create source files from workflow input
      working-directory: projects/\${{ inputs.project_id }}
      env:
        SOURCE_FILES: \${{ inputs.source_files }}
        BUILD_CONFIG: \${{ inputs.build_config }}
      run: |
        echo "Creating source files from workflow input..."
        # Use environment variable to avoid YAML parsing issues
        echo "\$SOURCE_FILES" > source_files.json
        
        # Parse JSON and create files using printf to preserve newlines
        jq -r 'to_entries[] | [.key, .value] | @tsv' source_files.json | while IFS=\$'\\t' read -r filename content; do
          # Normalize filename
          filename=\${filename#./}
          filename=\${filename#/}

          # Basic safety: avoid path traversal
          if [[ "\$filename" == *".."* ]]; then
            echo "Skipping unsafe path: \$filename"
            continue
          fi

          # Decide target path
          if [[ "\$filename" == public/* ]]; then
            target="\$filename"
          elif [[ "\$filename" == src/* ]]; then
            target="\$filename"
          elif [[ "\$filename" == "index.html" ]]; then
            target="index.html"  # Keep in root for Vite
          elif [[ "\$filename" == *.json ]] || [[ "\$filename" == *.config.* ]] || [[ "\$filename" == *.html ]]; then
            target="\$filename"  # Config files in root
          else
            target="src/\$filename"  # Source files in src/
          fi

          # Create directory if needed
          mkdir -p "\$(dirname "\$target")"
          
          # CRITICAL: Use printf to preserve newlines and special characters
          printf '%s' "\$content" > "\$target"
          echo "Created: \$target"
        done
        
        # Create package.json from build_config if not already created
        if [ ! -f "package.json" ]; then
          echo "Creating package.json from build_config..."
          echo "\$BUILD_CONFIG" > package.json
        fi
        
        rm source_files.json
        echo "Source files created successfully"
        ls -la
        if [ -d "src" ]; then
          echo "Source directory contents:"
          ls -la src/
        fi
        
        # Display first few lines of a source file to verify newlines
        if [ -f "src/main.jsx" ]; then
          echo "First 5 lines of src/main.jsx (verifying newlines):"
          head -n 5 src/main.jsx
        elif [ -f "src/App.jsx" ]; then
          echo "First 5 lines of src/App.jsx (verifying newlines):"
          head -n 5 src/App.jsx
        fi
        
        echo "✅ Files created and verified successfully"

    - name: Validate project structure
      working-directory: projects/\${{ inputs.project_id }}
      run: |
        echo "Validating project structure..."
        
        # Check if package.json exists and is valid
        if [ ! -f "package.json" ]; then
          echo "ERROR: package.json not found"
          exit 1
        fi
        
        # Validate JSON syntax
        if ! jq . package.json > /dev/null 2>&1; then
          echo "ERROR: Invalid JSON in package.json"
          cat package.json
          exit 1
        fi
        
        # Check for source files - they might be in root or src directory
        if [ -d "src" ] && [ -n "\$(ls -A src 2>/dev/null)" ]; then
          echo "Found source files in src directory"
          find src -type f
        elif [ -f "App.jsx" ] || [ -f "App.js" ] || [ -f "App.tsx" ] || [ -f "index.html" ]; then
          echo "Found source files in root directory"
          ls -la *.jsx *.js *.tsx *.html 2>/dev/null || true
        else
          echo "WARNING: No typical source files found, but continuing anyway"
        fi
        
        echo "Project structure validation passed"
        echo "Package.json contents:"
        cat package.json
    # TASK-027: Install dependencies with cache optimization and metrics tracking
    - name: Install dependencies with cache optimization
      working-directory: projects/\${{ inputs.project_id }}
      run: |
        echo "🚀 Installing dependencies with cache optimization..."
        
        # Record start time for metrics
        INSTALL_START_TIME=\$(date +%s)
        
        # Check cache hit status
        echo "📊 Cache Hit Analysis:"
        if [ "\${{ steps.cache-node-modules-exact.outputs.cache-hit }}" = "true" ]; then
          echo "✅ NODE_MODULES_CACHE_HIT=true"
          echo "✅ Exact node_modules cache hit - dependencies restored from cache"
          CACHE_HIT_TYPE="exact"
        else
          echo "❌ NODE_MODULES_CACHE_HIT=false"
          echo "⚡ Installing dependencies from npm registry..."
          CACHE_HIT_TYPE="miss"
        fi
        
        # Set environment variables for metrics
        echo "CACHE_HIT_TYPE=\$CACHE_HIT_TYPE" >> \$GITHUB_ENV
        echo "INSTALL_START_TIME=\$INSTALL_START_TIME" >> \$GITHUB_ENV
        
        # Optimize npm install based on cache status
        if [ "\${{ steps.cache-node-modules-exact.outputs.cache-hit }}" = "true" ]; then
          echo "🎯 Using cached node_modules - running npm install with --prefer-offline"
          npm install --production=false --prefer-offline --no-audit --no-fund
        else
          echo "📦 Full dependency installation - using npm install"
          npm install --production=false --no-audit --no-fund --timing
        fi
        
        # Record completion time and calculate metrics
        INSTALL_END_TIME=\$(date +%s)
        INSTALL_DURATION=\$((INSTALL_END_TIME - INSTALL_START_TIME))
        
        echo "INSTALL_DURATION=\$INSTALL_DURATION" >> \$GITHUB_ENV
        echo "INSTALL_END_TIME=\$INSTALL_END_TIME" >> \$GITHUB_ENV
        
        echo "📈 Installation Metrics:"
        echo "   Cache Hit Type: \$CACHE_HIT_TYPE"
        echo "   Installation Duration: \${INSTALL_DURATION}s"
        echo "   Dependencies Count: \$(find node_modules -maxdepth 1 -type d | wc -l)"
        echo "   node_modules Size: \$(du -sh node_modules 2>/dev/null | cut -f1 || echo 'N/A')"
        
        echo "✅ Dependencies installed successfully"

    - name: Create build configuration
      working-directory: projects/\${{ inputs.project_id }}
      run: |
        echo "Setting up build environment..."
        
        # Create index.html if it doesn't exist (check both root and public)
        if [ ! -f "index.html" ] && [ ! -f "public/index.html" ]; then
          echo "Creating default index.html..."
          cat > index.html << 'EOF'
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>GPTHost Component</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" src="/src/index.jsx"></script>
        </body>
        </html>
        EOF
        fi
        
        # Vite config should already be uploaded, but create a fallback if missing
        if [ ! -f "vite.config.js" ] && [ ! -f "vite.config.ts" ]; then
          echo "Creating default vite.config.js..."
          cat > vite.config.js << 'EOF'
        import { defineConfig } from 'vite'
        import react from '@vitejs/plugin-react'

        export default defineConfig({
          plugins: [react()],
          build: {
            outDir: 'dist',
            emptyOutDir: true
          }
        })
        EOF
        fi
        
        echo "Build configuration ready"
        echo "Files in project directory:"
        ls -la

    # TASK-027: Build project with performance metrics and cache-aware optimization
    - name: Build project with performance tracking
      working-directory: projects/\${{ inputs.project_id }}
      run: |
        echo "🏗️ Starting build process with performance tracking..."
        
        # Record build start time
        BUILD_START_TIME=\$(date +%s)
        
        # Set environment variables for build optimization
        export NODE_ENV=production
        export CI=true
        export VITE_USE_CACHED_DEPS=true
        
        echo "📊 Build Environment:"
        echo "   Node Version: \$(node --version)"
        echo "   NPM Version: \$(npm --version)"
        echo "   Cache Hit Type: \$CACHE_HIT_TYPE"
        echo "   Install Duration: \${INSTALL_DURATION}s"
        
        # Run build command with cache-aware optimizations
        echo "⚡ Running optimized build process..."
        if npm run build; then
          echo "✅ Build completed successfully"
        else
          echo "❌ Build failed"
          exit 1
        fi
        
        # Record build completion time and calculate metrics
        BUILD_END_TIME=\$(date +%s)
        BUILD_DURATION=\$((BUILD_END_TIME - BUILD_START_TIME))
        TOTAL_DURATION=\$((BUILD_END_TIME - INSTALL_START_TIME))
        
        # Set metrics environment variables for callback
        echo "BUILD_START_TIME=\$BUILD_START_TIME" >> \$GITHUB_ENV
        echo "BUILD_END_TIME=\$BUILD_END_TIME" >> \$GITHUB_ENV
        echo "BUILD_DURATION=\$BUILD_DURATION" >> \$GITHUB_ENV
        echo "TOTAL_DURATION=\$TOTAL_DURATION" >> \$GITHUB_ENV
        
        # Verify build output
        if [ ! -d "dist" ] || [ -z "\$(ls -A dist)" ]; then
          echo "❌ ERROR: No build output found in dist directory"
          exit 1
        fi
        
        # Calculate build artifacts metrics
        ARTIFACTS_COUNT=\$(find dist -type f | wc -l)
        ARTIFACTS_SIZE=\$(du -sh dist 2>/dev/null | cut -f1 || echo 'N/A')
        
        echo "ARTIFACTS_COUNT=\$ARTIFACTS_COUNT" >> \$GITHUB_ENV
        echo "ARTIFACTS_SIZE=\$ARTIFACTS_SIZE" >> \$GITHUB_ENV
        
        echo "📈 Build Performance Metrics:"
        echo "   Cache Hit Type: \$CACHE_HIT_TYPE"
        echo "   Install Duration: \${INSTALL_DURATION}s"
        echo "   Build Duration: \${BUILD_DURATION}s"
        echo "   Total Duration: \${TOTAL_DURATION}s"
        echo "   Artifacts Count: \$ARTIFACTS_COUNT"
        echo "   Artifacts Size: \$ARTIFACTS_SIZE"
        
        # Performance target check
        if [ "\$TOTAL_DURATION" -lt 30 ]; then
          echo "🎯 ✅ Performance target achieved: \${TOTAL_DURATION}s < 30s"
          echo "PERFORMANCE_TARGET_MET=true" >> \$GITHUB_ENV
        else
          echo "⚠️ Performance target missed: \${TOTAL_DURATION}s >= 30s"
          echo "PERFORMANCE_TARGET_MET=false" >> \$GITHUB_ENV
        fi
        
        echo "✅ Build verification passed"
        ls -la dist/

    - name: Prepare artifacts
      run: |
        echo "Preparing artifacts for upload..."
        
        # Copy build output to artifacts directory
        cp -r projects/\${{ inputs.project_id }}/dist/* artifacts/\${{ inputs.project_id }}/
        
        # Create build manifest
        cat > artifacts/\${{ inputs.project_id }}/build-manifest.json << EOF
        {
          "project_id": "\${{ inputs.project_id }}",
          "build_timestamp": "\$(date -u +%Y-%m-%dT%H:%M:%SZ)",
          "git_commit": "\${{ github.sha }}",
          "workflow_run": "\${{ github.run_id }}"
        }
        EOF
        
        echo "Artifacts prepared successfully"
        ls -la artifacts/\${{ inputs.project_id }}/

    - name: Setup Cloudflare CLI
      run: |
        echo "Installing Cloudflare CLI..."
        npm install -g wrangler
        wrangler --version

    # FIX 4: Correct R2 upload directory path (CRITICAL FIX)
    - name: Upload to Cloudflare R2
      working-directory: artifacts/\${{ inputs.project_id }}
      env:
        CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
        CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        R2_BUCKET_NAME: \${{ secrets.R2_BUCKET_NAME }}
      run: |
        echo "Uploading artifacts to Cloudflare R2..."
        
        # Set build path for callback
        BUILD_PATH="builds/\${{ inputs.project_id }}/\$(date -u +%Y%m%d-%H%M%S)"
        echo "BUILD_PATH=\$BUILD_PATH" >> \$GITHUB_ENV
        
        # Upload all files to R2
        for file in *; do
          if [ -f "\$file" ]; then
            echo "Uploading: \$file"
            wrangler r2 object put "\$R2_BUCKET_NAME/\$BUILD_PATH/\$file" --file "\$file"
          fi
        done
        
        echo "Upload to R2 completed successfully"
        echo "Artifacts available at: \$BUILD_PATH"

    # TASK-027: Send success callback with comprehensive cache and performance metrics
    - name: Send success callback with cache metrics
      if: success()
      run: |
        echo "📡 Sending success callback with cache and performance metrics..."
        
        # Calculate cache hit rate for this build
        if [ "\$CACHE_HIT_TYPE" = "exact" ]; then
          CACHE_HIT_RATE=100
        else
          CACHE_HIT_RATE=0
        fi
        
        curl -X POST "\${{ inputs.callback_url }}" \\
          -H "Content-Type: application/json" \\
          -H "Authorization: Bearer \${{ inputs.callback_token }}" \\
          -d "{
            \"status\": \"success\",
            \"project_id\": \"\${{ inputs.project_id }}\",
            \"r2_build_path\": \"\$BUILD_PATH\",
            \"build_timestamp\": \"\$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
            \"artifacts_count\": \$ARTIFACTS_COUNT,
            \"workflow_run_id\": \"\${{ github.run_id }}\",
            \"git_commit\": \"\${{ github.sha }}\",
            \"performance_metrics\": {
              \"total_duration_seconds\": \$TOTAL_DURATION,
              \"install_duration_seconds\": \$INSTALL_DURATION,
              \"build_duration_seconds\": \$BUILD_DURATION,
              \"performance_target_met\": \$PERFORMANCE_TARGET_MET,
              \"artifacts_size\": \"\$ARTIFACTS_SIZE\"
            },
            \"cache_metrics\": {
              \"cache_hit_type\": \"\$CACHE_HIT_TYPE\",
              \"cache_hit_rate_percent\": \$CACHE_HIT_RATE,
              \"node_modules_cache_hit\": \${{ steps.cache-node-modules-exact.outputs.cache-hit == 'true' }},
              \"npm_cache_enabled\": true,
              \"framework_cache_enabled\": true
            },
            \"build_optimization\": {
              \"caching_strategy\": \"multi-level\",
              \"npm_optimization_flags\": [\"--no-audit\", \"--no-fund\", \"--prefer-offline\"],
              \"vite_cache_enabled\": true,
              \"performance_target_seconds\": 30
            }
          }"
        
        echo "✅ Success callback with metrics sent"
        echo "📈 Build Summary:"
        echo "   Total Duration: \${TOTAL_DURATION}s"
        echo "   Cache Hit Rate: \${CACHE_HIT_RATE}%"
        echo "   Performance Target Met: \$PERFORMANCE_TARGET_MET"

    - name: Send failure callback
      if: failure()
      run: |
        echo "Sending failure callback with error details..."
        
        # Capture the last error from build output if available
        ERROR_MESSAGE="Build pipeline failed."
        
        # Try to extract error from npm/vite build logs
        if [ -f "projects/\${{ inputs.project_id }}/npm-debug.log" ]; then
          ERROR_MESSAGE=\$(tail -n 20 "projects/\${{ inputs.project_id }}/npm-debug.log" | grep -E "(ERROR|error|Error)" | tail -n 1 || echo "Build failed - check logs")
        fi
        
        # Check for vite build errors in the most recent output
        if [ -z "\$ERROR_MESSAGE" ] || [ "\$ERROR_MESSAGE" = "Build pipeline failed." ]; then
          # Try to get the last few lines of stderr from the previous step
          ERROR_MESSAGE="Build failed during \${{ steps.*.outcome }} step. Common issues: JSX syntax errors, missing dependencies, or invalid configuration."
        fi
        
        # Send detailed failure callback
        curl -X POST "\${{ inputs.callback_url }}" \\
          -H "Content-Type: application/json" \\
          -H "Authorization: Bearer \${{ inputs.callback_token }}" \\
          -d "{
            \"status\": \"failed\",
            \"project_id\": \"\${{ inputs.project_id }}\",
            \"error_message\": \"\$ERROR_MESSAGE\",
            \"build_timestamp\": \"\$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
            \"workflow_run_id\": \"\${{ github.run_id }}\",
            \"workflow_run_url\": \"https://github.com/\${{ github.repository }}/actions/runs/\${{ github.run_id }}\",
            \"git_commit\": \"\${{ github.sha }}\",
            \"failed_step\": \"\${{ job.status }}\"
          }"
        
        echo "Failure callback sent with error details"

  cleanup:
    runs-on: ubuntu-latest
    if: always()
    needs: build
    steps:
    - name: Cleanup temporary files
      run: |
        echo "Cleaning up temporary build files..."
        # This step runs regardless of build success/failure
        # to ensure we don't leave temporary artifacts
        echo "Cleanup completed"
`;
  }

  /**
   * Generate repository README.md
   */
  private generateRepositoryReadme(): string {
    return `# GPTHost Builds Repository

This repository is automatically managed by GPTHost for building AI-generated React components.

## Structure

- \`projects/{project_id}/\` - Individual project builds
- \`.github/workflows/\` - GitHub Actions workflows for automated builds

## Automated Build Process

1. Source files are uploaded to \`projects/{project_id}/src/\`
2. Package.json and build configuration are generated
3. GitHub Actions runs npm install and build
4. Build artifacts are uploaded and deployed

## Security

- This repository is private and managed automatically
- No manual intervention required
- Build logs available in GitHub Actions

---

*Generated by GPTHost - AI-powered component deployment platform*
`;
  }

  /**
   * Generate .gitignore for Node.js builds
   */
  private generateGitIgnore(): string {
    return `# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs
dist/
build/
.next/
.svelte-kit/

# Environment files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Cache
.npm
.yarn/
.cache/
.parcel-cache/

# Logs
*.log
logs/

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage
coverage/
*.lcov

# Temporary files
.tmp/
temp/
`;
  }

  /**
   * Generate package.json based on framework and configuration
   */
  private generatePackageJson(framework: FrameworkType, buildConfig: any): any {
    const basePackage = {
      name: `gpthost-project`,
      version: '1.0.0',
      type: 'module',
      scripts: {},
      dependencies: {},
      devDependencies: {}
    };

    switch (framework) {
      case 'react':
        basePackage.scripts = {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview'
        };
        basePackage.dependencies = {
          'react': '^18.2.0',
          'react-dom': '^18.2.0'
        };
        basePackage.devDependencies = {
          '@types/react': '^18.2.43',
          '@types/react-dom': '^18.2.17',
          '@vitejs/plugin-react': '^4.2.1',
          'typescript': '^5.2.2',
          'vite': '^5.0.8'
        };
        break;

      case 'vue':
        basePackage.scripts = {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview'
        };
        basePackage.dependencies = {
          'vue': '^3.3.8'
        };
        basePackage.devDependencies = {
          '@vitejs/plugin-vue': '^4.5.2',
          'typescript': '^5.2.2',
          'vite': '^5.0.8',
          'vue-tsc': '^1.8.25'
        };
        break;

      case 'svelte':
        basePackage.scripts = {
          dev: 'vite dev',
          build: 'vite build',
          preview: 'vite preview'
        };
        basePackage.dependencies = {};
        basePackage.devDependencies = {
          '@sveltejs/adapter-auto': '^2.1.1',
          '@sveltejs/kit': '^1.27.4',
          '@sveltejs/vite-plugin-svelte': '^2.5.3',
          'svelte': '^4.2.7',
          'typescript': '^5.2.2',
          'vite': '^5.0.8'
        };
        break;

      case 'html':
        basePackage.scripts = {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview'
        };
        basePackage.dependencies = {};
        basePackage.devDependencies = {
          'vite': '^5.0.8'
        };
        break;
    }

    // Add additional dependencies from build config if specified
    if (buildConfig?.dependencies) {
      Object.assign(basePackage.dependencies, buildConfig.dependencies);
    }

    if (buildConfig?.devDependencies) {
      Object.assign(basePackage.devDependencies, buildConfig.devDependencies);
    }

    return basePackage;
  }

  /**
   * Generate Vite configuration
   */
  private generateViteConfig(framework: FrameworkType): string {
    const configs = {
      react: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  esbuild: {
    jsx: 'automatic',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    target: 'es2015', // More compatible target
    keepNames: true,
    legalComments: 'none'
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
})`,
      vue: `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})`,
      svelte: `import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})`,
      html: `import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})`
    };

    return configs[framework] || configs.html;
  }
}

/**
 * Factory function to create GitHub API client
 */
export function createGitHubApiClient(token: string): GitHubApiClient {
  return new GitHubApiClient(token);
}

/**
 * Validate GitHub token format
 */
export function isValidGitHubTokenFormat(token: string): boolean {
  // GitHub tokens have specific patterns:
  // - Personal Access Tokens (classic): ghp_[a-zA-Z0-9]{36}
  // - Personal Access Tokens (fine-grained): github_pat_[a-zA-Z0-9_]{82}
  // - App tokens: ghs_[a-zA-Z0-9]{36}
  const tokenPatterns = [
    /^ghp_[a-zA-Z0-9]{36}$/,           // Personal Access Token (classic)
    /^github_pat_[a-zA-Z0-9_]{82}$/,   // Personal Access Token (fine-grained)
    /^ghs_[a-zA-Z0-9]{36}$/,           // App token
  ];

  return tokenPatterns.some(pattern => pattern.test(token));
}
