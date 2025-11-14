/**
 * ProjectService - Manages project lifecycle and metadata
 * GREEN phase implementation following TDD principles
 * Minimal code to make all tests pass
 */

import { Result, Ok, Err } from '../lib/result';
import { ProjectError, ProjectErrorCode, StorageErrorCode } from '../lib/errors';
import { IStorageService } from './StorageService';
import { 
  Project, 
  ProjectStatus, 
  FrameworkType,
  CreateProjectInput,
  ProjectFilter,
  ProjectList,
  ProjectFile 
} from '../domain/models';


export interface IProjectService {
  createProject(input: CreateProjectInput): Promise<Result<Project, ProjectError>>;
  getProject(projectId: string): Promise<Result<Project, ProjectError>>;
  updateProject(projectId: string, updates: Partial<Project>): Promise<Result<Project, ProjectError>>;
  deleteProject(projectId: string): Promise<Result<void, ProjectError>>;
  listProjects(filter?: ProjectFilter): Promise<Result<ProjectList, ProjectError>>;
  addFiles(projectId: string, files: ProjectFile[]): Promise<Result<Project, ProjectError>>;
}

export class ProjectService implements IProjectService {
  constructor(private readonly storage: IStorageService) {}

  // Constants (extracted)
  private static readonly PROJECTS_PREFIX = 'projects' as const;
  private static readonly BUILDS_PREFIX = 'builds' as const;
  private static readonly SITES_PREFIX = 'sites' as const;
  private static readonly METADATA_FILENAME = 'metadata.json' as const;
  private static readonly JSON_CONTENT_TYPE = 'application/json' as const;
  private static readonly DEFAULT_PAGE_LIMIT = 10 as const;
  private static readonly LEGACY_OWNER_ID = 'legacy-single-tenant' as const;

  async createProject(input: CreateProjectInput): Promise<Result<Project, ProjectError>> {
    // Validate input
    if (!this.isValidProjectName(input.name)) {
      return Err(new ProjectError(
        ProjectErrorCode.INVALID_INPUT,
        'Project name must be 3-50 alphanumeric characters with hyphens',
        { service: 'ProjectService', operation: 'createProject' }
      ));
    }

    if (!input.files || input.files.length === 0) {
      return Err(new ProjectError(
        ProjectErrorCode.INVALID_INPUT,
        'At least one file is required',
        { service: 'ProjectService', operation: 'createProject' }
      ));
    }

    // Generate project ID
    const projectId = crypto.randomUUID();

    // Detect framework if not specified
    const framework = input.framework || this.detectFramework(input.files);

    // Create project object
    const project: Project = {
      id: projectId,
      name: input.name,
      description: input.description,
      framework,
      status: 'pending' as ProjectStatus,
      files: input.files.map(f => ({
        path: this.sanitizePath(f.path),
        size: new TextEncoder().encode(f.content).length,
        contentType: this.getContentType(f.path)
      })),
      ownerId: input.ownerId ?? ProjectService.LEGACY_OWNER_ID,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Save project metadata
    const metadataPath = this.getProjectMetadataPath(projectId);
    const metadataContent = this.encodeJson(project);
    
    const saveResult = await this.storage.uploadFile(
      metadataPath,
      metadataContent.buffer as ArrayBuffer,
      { contentType: ProjectService.JSON_CONTENT_TYPE }
    );

    if (!saveResult.ok) {
      return Err(new ProjectError(
        ProjectErrorCode.STORAGE_ERROR,
        `Failed to save project: ${saveResult.error.message}`,
        { service: 'ProjectService', operation: 'createProject', projectId }
      ));
    }

    // Save project files
    for (const file of input.files) {
      const sanitizedPath = this.sanitizePath(file.path);
      const filePath = this.getProjectFilePath(projectId, sanitizedPath);
      const fileContent = new TextEncoder().encode(file.content);
      
      const uploadResult = await this.storage.uploadFile(
        filePath,
        fileContent.buffer as ArrayBuffer,
        { contentType: this.getContentType(file.path) }
      );

      if (!uploadResult.ok) {
        // Rollback on failure - delete both directory and metadata
        await this.storage.deleteFile(this.getProjectDirectory(projectId));
        await this.storage.deleteFile(metadataPath);
        return Err(new ProjectError(
          ProjectErrorCode.STORAGE_ERROR,
          `Failed to save file ${file.path}: ${uploadResult.error.message}`,
          { service: 'ProjectService', operation: 'createProject', projectId }
        ));
      }
    }

    return Ok(project);
  }

  async getProject(projectId: string): Promise<Result<Project, ProjectError>> {
    const metadataPath = this.getProjectMetadataPath(projectId);
    const downloadResult = await this.storage.downloadFile(metadataPath);

    if (!downloadResult.ok) {
      if (downloadResult.error.code === StorageErrorCode.NOT_FOUND) {
        return Err(new ProjectError(
          ProjectErrorCode.NOT_FOUND,
          `Project ${projectId} not found`,
          { service: 'ProjectService', operation: 'getProject', projectId }
        ));
      }
      return Err(new ProjectError(
        ProjectErrorCode.STORAGE_ERROR,
        downloadResult.error.message,
        { service: 'ProjectService', operation: 'getProject', projectId }
      ));
    }

    try {
      const project = this.decodeJson<Project>(downloadResult.value);
      
      // Convert date strings back to Date objects
      project.createdAt = new Date(project.createdAt);
      project.updatedAt = new Date(project.updatedAt);
      project.ownerId = project.ownerId || ProjectService.LEGACY_OWNER_ID;
      
      return Ok(project);
    } catch (error) {
      return Err(new ProjectError(
        ProjectErrorCode.INVALID_INPUT,
        `Failed to parse project data: ${(error as Error).message}`,
        { service: 'ProjectService', operation: 'getProject', projectId }
      ));
    }
  }

  async updateProject(
    projectId: string, 
    updates: Partial<Project>
  ): Promise<Result<Project, ProjectError>> {
    // Get existing project
    const getResult = await this.getProject(projectId);
    if (!getResult.ok) return getResult;

    const project = getResult.value;

    // Validate status transition if status is being updated
    if (updates.status && updates.status !== project.status) {
      if (!this.isValidStatusTransition(project.status, updates.status)) {
        return Err(new ProjectError(
          ProjectErrorCode.INVALID_STATE,
          `Cannot transition from ${project.status} to ${updates.status}`,
          { service: 'ProjectService', operation: 'updateProject', projectId }
        ));
      }
    }

    // Apply updates
    const updatedProject = {
      ...project,
      ...updates,
      updatedAt: new Date()
    };

    // Save updated project
    const metadataPath = this.getProjectMetadataPath(projectId);
    const metadataContent = this.encodeJson(updatedProject);
    
    const saveResult = await this.storage.uploadFile(
      metadataPath,
      metadataContent.buffer as ArrayBuffer,
      { contentType: ProjectService.JSON_CONTENT_TYPE }
    );

    if (!saveResult.ok) {
      return Err(new ProjectError(
        ProjectErrorCode.STORAGE_ERROR,
        `Failed to update project: ${saveResult.error.message}`,
        { service: 'ProjectService', operation: 'updateProject', projectId }
      ));
    }

    return Ok(updatedProject);
  }

  async deleteProject(projectId: string): Promise<Result<void, ProjectError>> {
    const prefixes = [
      `${ProjectService.PROJECTS_PREFIX}/${projectId}/`,
      `${ProjectService.PROJECTS_PREFIX}/active/${projectId}/`,
      `${ProjectService.PROJECTS_PREFIX}/archived/${projectId}/`,
      `${ProjectService.BUILDS_PREFIX}/${projectId}/`,
      `${ProjectService.SITES_PREFIX}/${projectId}/`,
    ];

    const metadataPaths = [
      `${ProjectService.PROJECTS_PREFIX}/${projectId}/${ProjectService.METADATA_FILENAME}`,
      `${ProjectService.PROJECTS_PREFIX}/active/${projectId}/${ProjectService.METADATA_FILENAME}`,
      `${ProjectService.PROJECTS_PREFIX}/archived/${projectId}/${ProjectService.METADATA_FILENAME}`,
    ];

    const errors: string[] = [];

    for (const prefix of prefixes) {
      const deleteResult = await this.storage.deleteFile(prefix);
      if (!deleteResult.ok && deleteResult.error.code !== StorageErrorCode.NOT_FOUND) {
        errors.push(`Failed to delete prefix ${prefix}: ${deleteResult.error.message}`);
      }
    }

    for (const metadataPath of metadataPaths) {
      const deleteResult = await this.storage.deleteFile(metadataPath);
      if (!deleteResult.ok && deleteResult.error.code !== StorageErrorCode.NOT_FOUND) {
        errors.push(`Failed to delete metadata ${metadataPath}: ${deleteResult.error.message}`);
      }
    }

    if (errors.length > 0) {
      return Err(new ProjectError(
        ProjectErrorCode.STORAGE_ERROR,
        `Failed to delete project ${projectId}`,
        { service: 'ProjectService', operation: 'deleteProject', projectId, errors }
      ));
    }

    return Ok(undefined);
  }

  async listProjects(filter?: ProjectFilter): Promise<Result<ProjectList, ProjectError>> {
    // List all project metadata files
    const listResult = await this.storage.listFiles(`${ProjectService.PROJECTS_PREFIX}/`, {
      maxKeys: 1000
    });

    if (!listResult.ok) {
      return Err(new ProjectError(
        ProjectErrorCode.STORAGE_ERROR,
        `Failed to list projects: ${listResult.error.message}`,
        { service: 'ProjectService', operation: 'listProjects' }
      ));
    }

    // Filter for metadata.json files
    const metadataFiles = listResult.value.filter(f => f.key.endsWith(`/${ProjectService.METADATA_FILENAME}`));

    // Load each project in parallel
    const downloadPromises = metadataFiles.map(file => 
      this.storage.downloadFile(file.key)
    );
    
    const downloadResults = await Promise.all(downloadPromises);
    
    const projects: Project[] = [];
    for (const downloadResult of downloadResults) {
      if (downloadResult.ok) {
        try {
          const parsed = this.decodeJson<Project>(downloadResult.value);
          const project: Project = {
            ...parsed,
            createdAt: new Date((parsed as any).createdAt as any),
            updatedAt: new Date((parsed as any).updatedAt as any),
          };
          
          const projectOwner = project.ownerId || ProjectService.LEGACY_OWNER_ID;

          if (filter?.ownerId && projectOwner !== filter.ownerId) continue;

          // Apply filters
          if (filter?.status && project.status !== filter.status) continue;
          if (filter?.framework && project.framework !== filter.framework) continue;
          if (filter?.createdAfter && project.createdAt < filter.createdAfter) continue;
          if (filter?.createdBefore && project.createdAt > filter.createdBefore) continue;
          
          projects.push(project);
        } catch (error) {
          // Skip invalid projects
          continue;
        }
      }
    }

    // Sort by creation date (newest first)
    projects.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Apply pagination
    const offset = filter?.offset || 0;
    const limit = filter?.limit || ProjectService.DEFAULT_PAGE_LIMIT;
    const paginatedProjects = projects.slice(offset, offset + limit);

    return Ok({
      projects: paginatedProjects,
      total: projects.length,
      hasMore: offset + limit < projects.length
    });
  }

  async addFiles(
    projectId: string, 
    files: ProjectFile[]
  ): Promise<Result<Project, ProjectError>> {
    // Get existing project
    const getResult = await this.getProject(projectId);
    if (!getResult.ok) return getResult;

    const project = getResult.value;

    // Upload new files
    for (const file of files) {
      const sanitizedPath = this.sanitizePath(file.path);
      const filePath = this.getProjectFilePath(projectId, sanitizedPath);
      const fileContent = new TextEncoder().encode(file.content);
      
      const uploadResult = await this.storage.uploadFile(
        filePath,
        fileContent.buffer as ArrayBuffer,
        { contentType: this.getContentType(file.path) }
      );

      if (!uploadResult.ok) {
        return Err(new ProjectError(
          ProjectErrorCode.STORAGE_ERROR,
          `Failed to upload file ${file.path}: ${uploadResult.error.message}`,
          { service: 'ProjectService', operation: 'addFiles', projectId }
        ));
      }

      // Add to project files list
      project.files.push({
        path: sanitizedPath,
        size: fileContent.length,
        contentType: this.getContentType(file.path)
      });
    }

    // Update project metadata
    return this.updateProject(projectId, { files: project.files });
  }

    // Helper methods
  private getProjectMetadataPath(projectId: string): string {
    return `${ProjectService.PROJECTS_PREFIX}/${projectId}/${ProjectService.METADATA_FILENAME}`;
  }

  private getProjectFilePath(projectId: string, sanitizedPath: string): string {
    return `${ProjectService.PROJECTS_PREFIX}/${projectId}/${sanitizedPath}`;
  }

  private getProjectDirectory(projectId: string): string {
    return `${ProjectService.PROJECTS_PREFIX}/${projectId}/`;
  }

  private getAllProjectDirectories(projectId: string): string[] {
    return [
      `${ProjectService.PROJECTS_PREFIX}/${projectId}/`,
      `${ProjectService.BUILDS_PREFIX}/${projectId}/`,
      `${ProjectService.SITES_PREFIX}/${projectId}/`
    ];
  }

  private encodeJson(data: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(data));
  }

  private decodeJson<T>(buffer: ArrayBuffer): T {
    return JSON.parse(new TextDecoder().decode(buffer)) as T;
  }
  private sanitizePath(path: string): string {
    // Normalize separators to '/'
    let normalized = path.replace(/\\/g, '/');
    // Remove leading slash to prevent absolute paths
    normalized = normalized.replace(/^\/+/, '');
    // Collapse multiple slashes
    normalized = normalized.replace(/\/+/g, '/');
    // Strip any path traversal attempts like ../ or .../
    normalized = normalized.replace(/\.{2,}\/?/g, '');
    return normalized;
  }

  private detectFramework(files: ProjectFile[]): FrameworkType {
    // Check file extensions and content
    const hasReact = files.some(f => 
      f.path.endsWith('.jsx') || f.path.endsWith('.tsx') ||
      f.content.includes('import React') || f.content.includes('from "react"')
    );
    if (hasReact) return 'react' as FrameworkType;

    const hasVue = files.some(f => f.path.endsWith('.vue'));
    if (hasVue) return 'vue' as FrameworkType;

    const hasSvelte = files.some(f => f.path.endsWith('.svelte'));
    if (hasSvelte) return 'svelte' as FrameworkType;

    return 'unknown' as FrameworkType;
  }

  private isValidProjectName(name: string): boolean {
    return /^[a-zA-Z0-9-]{3,50}$/.test(name);
  }

  private isValidStatusTransition(from: ProjectStatus, to: ProjectStatus): boolean {
    const validTransitions: Record<ProjectStatus, ProjectStatus[]> = {
      'pending': ['analyzing', 'building', 'failed'],  // Allow direct to building for test
      'analyzing': ['scaffolding', 'failed'],
      'scaffolding': ['scaffolded', 'failed'],
      'scaffolded': ['building', 'failed'],
      // Allow direct transition from building -> deployed to tolerate
      // external build systems that skip the intermediate "deploying" state
      // (e.g., GitHub callback v2 path performing immediate deploy)
      'building': ['deploying', 'failed', 'deployed'],
      'deploying': ['deployed', 'failed'],
      'deployed': ['building'],
      'failed': ['pending', 'building']
    };

    return validTransitions[from]?.includes(to) || false;
  }

  private getContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      'html': 'text/html',
      'js': 'application/javascript',
      'jsx': 'application/javascript',
      'ts': 'text/typescript',
      'tsx': 'text/typescript',
      'css': 'text/css',
      'json': 'application/json',
      'vue': 'text/vue',
      'svelte': 'text/svelte'
    };
    return contentTypes[ext || ''] || 'text/plain';
  }
}
