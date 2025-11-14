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
