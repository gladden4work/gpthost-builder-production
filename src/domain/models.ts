/**
 * Domain models for GPTHost
 * Based on canonical steering documents
 */

import type { ProjectStatus, FrameworkType } from '../types/api';

/**
 * Project file input
 */
export interface ProjectFile {
  path: string;
  content: string;
}

/**
 * File metadata in project
 */
export interface FileMetadata {
  path: string;
  size: number;
  contentType: string;
}

/**
 * Build metadata stored alongside a project
 */
export interface BuildMetadata {
  buildId: string;
  githubRunId?: number;
  startedAt?: Date;
  completedAt?: Date;
  artifactPath?: string;
}

/**
 * Project entity
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  framework: FrameworkType;
  status: ProjectStatus;
  files: FileMetadata[];
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
 * Create project input
 */
export interface CreateProjectInput {
  name: string;
  description?: string;
  framework?: FrameworkType;
  files: ProjectFile[];
  ownerId?: string;
  /** Optional prefix for file paths (e.g., 'source/' for paste operations) */
  sourcePrefix?: string;
}

/**
 * Update project input
 */
export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  deploymentUrl?: string;
  buildId?: string;
  githubRepo?: string;
  githubWorkflowRunId?: string;
  errorMessage?: string;
  files?: FileMetadata[];
  buildMetadata?: BuildMetadata;
  ownerId?: string;
}

/**
 * Project filter criteria
 */
export interface ProjectFilter {
  status?: ProjectStatus;
  framework?: FrameworkType;
  createdAfter?: Date;
  createdBefore?: Date;
  offset?: number;
  limit?: number;
  ownerId?: string;
  ownerAliases?: string[];
}

/**
 * Project list result
 */
export interface ProjectList {
  projects: Project[];
  total: number;
  hasMore: boolean;
}

// Re-export types from api.ts for convenience
export { ProjectStatus, FrameworkType } from '../types/api';
