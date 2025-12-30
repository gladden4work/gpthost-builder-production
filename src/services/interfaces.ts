/**
 * Service Interfaces for Cloudflare Workers
 * Central location for all service interfaces to avoid circular dependencies
 */

import { Result } from '../lib/result';
import { GitHubError, BuildError, ProjectError, StorageError } from '../lib/errors';
import type { UpdateProjectInput } from '../domain/models';

/**
 * Project Status (from domain models)
 */
export enum ProjectStatus {
  PENDING = 'pending',
  ANALYZING = 'analyzing',
  SCAFFOLDING = 'scaffolding',
  SCAFFOLDED = 'scaffolded',
  BUILDING = 'building',
  DEPLOYING = 'deploying',
  DEPLOYED = 'deployed',
  FAILED = 'failed',
}

/**
 * Framework Type
 */
export type FrameworkType = 'react' | 'vue' | 'svelte' | 'unknown';

/**
 * Project File
 */
export interface ProjectFile {
  path: string;
  content: string;
  size?: number;
  contentType?: string;
}

/**
 * Project Entity
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  framework: FrameworkType;
  status: ProjectStatus;
  files: ProjectFile[];
  ownerId?: string;
  createdAt: Date;
  updatedAt: Date;
  deploymentUrl?: string;
  buildId?: string;
  githubRepo?: string;
  githubWorkflowRunId?: string;
  errorMessage?: string;
  buildMetadata?: BuildMetadata;
}

/**
 * GitHub Workflow Dispatch Parameters
 */
export interface WorkflowDispatchParams {
  projectId: string;
  workflowFile?: string; // Optional - uses configured default if not provided
  inputs: {
    project_id: string;
    source_files: string; // JSON stringified files
    callback_url?: string;
    callback_token?: string;
    framework?: string;
    build_command?: string;
    correlation_id?: string; // For tracking specific workflow runs
  };
  retryCount?: number; // For exponential backoff
}

/**
 * GitHub Workflow Run
 */
export interface WorkflowRun {
  id: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'neutral' | 'skipped' | 'timed_out';
  htmlUrl: string;
  createdAt: Date;
  updatedAt: Date;
  runNumber?: number;
  headSha?: string;
}

/**
 * GitHub Workflow Job
 */
export interface WorkflowJob {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'neutral' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  steps: WorkflowStep[];
}

/**
 * GitHub Workflow Step
 */
export interface WorkflowStep {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'neutral' | 'skipped';
  number: number;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * GitHub Workflow Status
 */
export interface WorkflowStatus {
  runId: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'neutral' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  jobs: WorkflowJob[];
}

/**
 * GitHub Webhook Payload
 */
export interface WebhookPayload {
  action: string;
  workflow_run?: {
    id: number;
    status: string;
    conclusion?: string;
    head_sha: string;
  };
  repository?: {
    name: string;
    full_name: string;
  };
}

/**
 * GitHub Service Interface
 */
export interface IGitHubService {
  triggerWorkflow(params: WorkflowDispatchParams): Promise<Result<WorkflowRun, GitHubError>>;
  getWorkflowStatus(runId: number): Promise<Result<WorkflowStatus, GitHubError>>;
  handleWebhookCallback(payload: WebhookPayload, signature: string): Promise<Result<void, GitHubError>>;
  validateWebhookSignature(signature: string, body: string): Result<boolean, GitHubError>;
  validateWebhookSignatureAsync?(signature: string, body: string): Promise<Result<boolean, GitHubError>>;
  cancelWorkflow?(runId: number): Promise<Result<void, GitHubError>>;
}

/**
 * Build Job
 */
export interface BuildJob {
  buildId: string;
  projectId: string;
  status: 'queued' | 'building' | 'success' | 'failed' | 'cancelled';
  createdAt: Date;
  completedAt?: Date;
  retryCount: number;
  githubRunId?: number;
  githubRunUrl?: string;
  artifactPath?: string;
  error?: string;
  originalBuildId?: string;
}

/**
 * Build Status
 */
export interface BuildStatus {
  buildId: string;
  projectId: string;
  status: 'queued' | 'building' | 'success' | 'failed' | 'cancelled';
  currentStep?: string;
  progress?: number;
  startedAt: Date;
  completedAt?: Date;
  githubRunUrl?: string;
  error?: string;
}

/**
 * Build Result
 */
export interface BuildResult {
  success: boolean;
  artifactPath?: string;
  logs?: string[];
  error?: string;
}

/**
 * Build Metadata for Project updates
 */
export interface BuildMetadata {
  buildId: string;
  githubRunId?: number;
  startedAt?: Date;
  completedAt?: Date;
  artifactPath?: string;
}

/**
 * Build Service Interface
 */
export interface IBuildService {
  queueBuild(project: Project): Promise<Result<BuildJob, BuildError>>;
  getBuildStatus(buildId: string): Promise<Result<BuildStatus, BuildError>>;
  completeBuild(buildId: string, result: BuildResult): Promise<Result<void, BuildError>>;
  retryBuild(buildId: string): Promise<Result<BuildJob, BuildError>>;
  cancelBuild(buildId: string): Promise<Result<void, BuildError>>;
}

/**
 * Storage Service Interface
 */
export interface IStorageService {
  uploadFile(key: string, data: ArrayBuffer, metadata?: Record<string, string>): Promise<Result<void, StorageError>>;
  downloadFile(key: string): Promise<Result<ArrayBuffer, StorageError>>;
  deleteFile(key: string): Promise<Result<void, StorageError>>;
  listFiles(prefix: string): Promise<Result<string[], StorageError>>;
  listPrefixes?(prefix: string): Promise<Result<string[], StorageError>>;
  fileExists(key: string): Promise<Result<boolean, StorageError>>;
  copyDirectory(source: string, destination: string): Promise<Result<void, StorageError>>;
  exists(path: string): Promise<Result<boolean, StorageError>>;
  getMetadata(path: string): Promise<Result<{ contentType?: string }, StorageError>>;
}

/**
 * Project Service Interface  
 */
export interface IProjectService {
  createProject(input: any): Promise<Result<Project, ProjectError>>;
  getProject(projectId: string): Promise<Result<Project, ProjectError>>;
  updateProject(projectId: string, updates: UpdateProjectInput): Promise<Result<Project, ProjectError>>;
  deleteProject(projectId: string): Promise<Result<void, ProjectError>>;
  listProjects(filter?: any): Promise<Result<any, ProjectError>>;
}

/**
 * Deploy Service Interface
 * Formalizes the contract for deployment operations and static site serving
 */
export interface IDeployService {
  /**
   * Deploy a completed build to production sites storage.
   * Returns deployment details including URL and timestamp.
   */
  deployBuild(
    buildId: string
  ): Promise<
    Result<
      {
        deploymentUrl: string;
        status: 'deployed';
        projectId: string;
        deployedAt: Date;
      },
      import('../lib/errors').DeploymentError
    >
  >;

  /**
   * Serve static site content with optional SPA fallback behavior.
   */
  serveSite(
    projectId: string,
    path: string,
    options?: { spa?: boolean }
  ): Promise<
    Result<
      {
        body: ArrayBuffer;
        headers: Record<string, string>;
        contentType: string;
      },
      import('../lib/errors').DeploymentError
    >
  >;

  /**
   * Generate the deployment URL for a project, supporting custom domains.
   */
  generateDeploymentUrl(
    projectId: string,
    options?: { customDomain?: string }
  ): string;
}
