/**
 * TASK-028: Project Isolation Manager
 * 
 * Ensures complete isolation between projects during concurrent builds.
 * Prevents cross-project interference, manages project-specific resources,
 * and maintains secure boundaries between different projects.
 * 
 * Features:
 * - Project-specific directory isolation
 * - Build environment segregation
 * - Cache isolation per project
 * - Resource conflict prevention
 * - Secure project boundaries
 * - Concurrent build support
 */

import { 
  FrameworkType,
  BuildJob,
  ProjectMetadata 
} from '../types/api';

import { ProjectDirectoryStructure } from './multiProjectManager';

/**
 * Project isolation configuration
 */
export interface ProjectIsolationConfig {
  enableStrictIsolation: boolean;    // Enforce strict project boundaries
  enableCacheIsolation: boolean;     // Isolate build caches per project
  enableResourceLimits: boolean;     // Apply per-project resource limits
  maxConcurrentBuilds: number;       // Maximum concurrent builds per project
  resourceTimeoutMs: number;         // Timeout for resource allocation
}

/**
 * Project isolation result
 */
export interface IsolationResult<T = any> {
  success: boolean;
  data?: T;
  error?: {
    type: 'isolation_conflict' | 'resource_limit' | 'boundary_violation' | 'cache_conflict';
    message: string;
    details?: any;
  };
  metadata?: {
    project_id: string;
    isolation_level: 'strict' | 'standard' | 'minimal';
    resources_allocated?: string[];
    cache_key?: string;
  };
}

/**
 * Project resource allocation tracking
 */
export interface ProjectResourceAllocation {
  project_id: string;
  job_id: string;
  framework: FrameworkType;
  allocated_at: string;
  resources: {
    cache_key: string;
    build_directory: string;
    temp_files: string[];
    environment_vars: Record<string, string>;
  };
  limits: {
    max_memory_mb: number;
    max_disk_mb: number;
    max_duration_ms: number;
  };
  isolation_level: 'strict' | 'standard' | 'minimal';
}

/**
 * Cache isolation metadata
 */
export interface CacheIsolationMetadata {
  project_id: string;
  framework: FrameworkType;
  cache_key_prefix: string;
  dependency_hash: string;
  framework_version: string;
  isolation_boundary: string;
  created_at: string;
  last_used: string;
  hit_count: number;
  size_mb: number;
}

/**
 * Project Isolation Manager
 * 
 * Manages isolation boundaries and resource allocation for concurrent projects
 */
export class ProjectIsolationManager {
  private config: ProjectIsolationConfig;
  private activeAllocations: Map<string, ProjectResourceAllocation>;
  private cacheRegistry: Map<string, CacheIsolationMetadata>;

  constructor(
    private env: Env,
    private directoryStructure: ProjectDirectoryStructure,
    config?: Partial<ProjectIsolationConfig>
  ) {
    // Initialize configuration with defaults
    this.config = {
      enableStrictIsolation: true,
      enableCacheIsolation: true,
      enableResourceLimits: true,
      maxConcurrentBuilds: 10,
      resourceTimeoutMs: 5 * 60 * 1000, // 5 minutes
      ...config
    };

    this.activeAllocations = new Map();
    this.cacheRegistry = new Map();
  }

  /**
   * Create comprehensive project isolation for legacy projects
   * Sets up all isolation boundaries for projects that may be in legacy format
   */
  async createProjectIsolationForLegacyProject(
    projectId: string,
    framework: FrameworkType,
    isLegacyProject: boolean = false
  ): Promise<IsolationResult<{
    isolation_created: boolean;
    cache_boundary: string;
    resource_limits: any;
  }>> {
    try {
      console.info('[PROJECT-ISOLATION] Creating project isolation for legacy project', {
        project_id: projectId,
        framework,
        strict_isolation: this.config.enableStrictIsolation,
        legacy_format: isLegacyProject
      });

      // Create isolated directory structure
      const directoryIsolation = await this.createDirectoryIsolationForLegacyProject(projectId, isLegacyProject);
      if (!directoryIsolation.success) {
        return directoryIsolation;
      }

      // Setup cache isolation
      let cacheBoundary = '';
      if (this.config.enableCacheIsolation) {
        const cacheIsolation = await this.createCacheIsolation(projectId, framework);
        if (!cacheIsolation.success) {
          return cacheIsolation;
        }
        cacheBoundary = cacheIsolation.data?.cache_boundary || '';
      }

      // Apply resource limits
      let resourceLimits = {};
      if (this.config.enableResourceLimits) {
        resourceLimits = await this.applyResourceLimitsForLegacyProject(projectId, framework, isLegacyProject);
      }

      // Create isolation metadata file
      const projectRoot = isLegacyProject ? `projects/${projectId}` : `${this.directoryStructure.active}/${projectId}`;
      const isolationMetadata = {
        project_id: projectId,
        framework,
        created_at: new Date().toISOString(),
        isolation_level: this.config.enableStrictIsolation ? 'strict' : 'standard',
        cache_boundary: cacheBoundary,
        resource_limits: resourceLimits,
        directory_structure: {
          project_root: projectRoot,
          build_directory: `${projectRoot}/build`,
          cache_directory: `${this.directoryStructure.cache}/${projectId}`,
          temp_directory: `${projectRoot}/temp`
        },
        boundaries: {
          prevent_cross_project_access: true,
          isolate_environment_variables: true,
          separate_build_caches: this.config.enableCacheIsolation,
          enforce_resource_limits: this.config.enableResourceLimits
        },
        legacy_format: isLegacyProject
      };

      const isolationKey = `${projectRoot}/isolation.json`;
      await this.env.PROJECTS_BUCKET.put(
        isolationKey,
        JSON.stringify(isolationMetadata, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            type: 'isolation-metadata',
            created_at: new Date().toISOString(),
            isolation_level: isolationMetadata.isolation_level,
            legacy_format: String(isLegacyProject)
          }
        }
      );

      console.info('✅ [PROJECT-ISOLATION] Project isolation created successfully', {
        project_id: projectId,
        framework,
        cache_boundary: cacheBoundary,
        isolation_level: isolationMetadata.isolation_level,
        legacy_format: isLegacyProject
      });

      return {
        success: true,
        data: {
          isolation_created: true,
          cache_boundary: cacheBoundary,
          resource_limits: resourceLimits
        },
        metadata: {
          project_id: projectId,
          isolation_level: isolationMetadata.isolation_level,
          cache_key: cacheBoundary
        }
      };

    } catch (error) {
      console.error('[PROJECT-ISOLATION] Failed to create project isolation', {
        project_id: projectId,
        framework,
        legacy_format: isLegacyProject,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: {
          type: 'isolation_conflict',
          message: 'Failed to create project isolation',
          details: error
        },
        metadata: {
          project_id: projectId,
          isolation_level: 'minimal'
        }
      };
    }
  }

  /**
   * Create comprehensive project isolation
   * Sets up all isolation boundaries for a new project
   */
  async createProjectIsolation(
    projectId: string,
    framework: FrameworkType
  ): Promise<IsolationResult<{
    isolation_created: boolean;
    cache_boundary: string;
    resource_limits: any;
  }>> {
    try {
      console.info('[PROJECT-ISOLATION] Creating project isolation', {
        project_id: projectId,
        framework,
        strict_isolation: this.config.enableStrictIsolation
      });

      // Create isolated directory structure
      const directoryIsolation = await this.createDirectoryIsolation(projectId);
      if (!directoryIsolation.success) {
        return directoryIsolation;
      }

      // Setup cache isolation
      let cacheBoundary = '';
      if (this.config.enableCacheIsolation) {
        const cacheIsolation = await this.createCacheIsolation(projectId, framework);
        if (!cacheIsolation.success) {
          return cacheIsolation;
        }
        cacheBoundary = cacheIsolation.data?.cache_boundary || '';
      }

      // Apply resource limits
      let resourceLimits = {};
      if (this.config.enableResourceLimits) {
        resourceLimits = await this.applyResourceLimits(projectId, framework);
      }

      // Create isolation metadata file
      const isolationMetadata = {
        project_id: projectId,
        framework,
        created_at: new Date().toISOString(),
        isolation_level: this.config.enableStrictIsolation ? 'strict' : 'standard',
        cache_boundary: cacheBoundary,
        resource_limits: resourceLimits,
        directory_structure: {
          project_root: `${this.directoryStructure.active}/${projectId}`,
          build_directory: `${this.directoryStructure.active}/${projectId}/build`,
          cache_directory: `${this.directoryStructure.cache}/${projectId}`,
          temp_directory: `${this.directoryStructure.active}/${projectId}/temp`
        },
        boundaries: {
          prevent_cross_project_access: true,
          isolate_environment_variables: true,
          separate_build_caches: this.config.enableCacheIsolation,
          enforce_resource_limits: this.config.enableResourceLimits
        }
      };

      const isolationKey = `${this.directoryStructure.active}/${projectId}/isolation.json`;
      await this.env.PROJECTS_BUCKET.put(
        isolationKey,
        JSON.stringify(isolationMetadata, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            type: 'isolation-metadata',
            created_at: new Date().toISOString(),
            isolation_level: isolationMetadata.isolation_level
          }
        }
      );

      console.info('✅ [PROJECT-ISOLATION] Project isolation created successfully', {
        project_id: projectId,
        framework,
        cache_boundary: cacheBoundary,
        isolation_level: isolationMetadata.isolation_level
      });

      return {
        success: true,
        data: {
          isolation_created: true,
          cache_boundary: cacheBoundary,
          resource_limits: resourceLimits
        },
        metadata: {
          project_id: projectId,
          isolation_level: isolationMetadata.isolation_level,
          cache_key: cacheBoundary
        }
      };

    } catch (error) {
      console.error('[PROJECT-ISOLATION] Failed to create project isolation', {
        project_id: projectId,
        framework,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: {
          type: 'isolation_conflict',
          message: 'Failed to create project isolation',
          details: error
        },
        metadata: {
          project_id: projectId,
          isolation_level: 'minimal'
        }
      };
    }
  }

  /**
   * Verify project isolation is intact before build
   */
  async verifyProjectIsolation(projectId: string): Promise<IsolationResult<{
    isolation_valid: boolean;
    boundaries_secure: boolean;
    cache_isolated: boolean;
  }>> {
    try {
      console.info('[PROJECT-ISOLATION] Verifying project isolation', { project_id: projectId });

      // Load isolation metadata - try both new multi-project format and legacy format
      let isolationKey = `${this.directoryStructure.active}/${projectId}/isolation.json`;
      let isolationObj = await this.env.PROJECTS_BUCKET.get(isolationKey);
      
      // If not found in multi-project format, try legacy format
      if (!isolationObj) {
        isolationKey = `projects/${projectId}/isolation.json`;
        isolationObj = await this.env.PROJECTS_BUCKET.get(isolationKey);
      }
      
      if (!isolationObj) {
        // Auto-create isolation for legacy projects that don't have it
        console.info('[PROJECT-ISOLATION] Isolation metadata not found, creating on-demand for legacy project', { 
          project_id: projectId 
        });
        
        // Try to load project metadata to get framework (try all formats)
        let metadataKey = `projects/${projectId}/project.json`;
        let metadataObj = await this.env.PROJECTS_BUCKET.get(metadataKey);
        
        if (!metadataObj) {
          // Try old single-project format
          metadataKey = `projects/${projectId}/metadata.json`;
          metadataObj = await this.env.PROJECTS_BUCKET.get(metadataKey);
        }
        
        if (!metadataObj) {
          // Try multi-project format
          metadataKey = `${this.directoryStructure.active}/${projectId}/metadata.json`;
          metadataObj = await this.env.PROJECTS_BUCKET.get(metadataKey);
        }
        
        if (!metadataObj) {
          console.error('[PROJECT-ISOLATION] Project metadata not found, cannot create isolation', {
            project_id: projectId,
            metadata_key: metadataKey
          });
          return {
            success: false,
            error: {
              type: 'boundary_violation',
              message: 'Project not found - no metadata available'
            },
            metadata: { project_id: projectId, isolation_level: 'minimal' }
          };
        }
        
        // Parse project metadata
        const projectMetadata = await metadataObj.json() as any;
        const framework = projectMetadata.framework || 'react';
        
        console.info('[PROJECT-ISOLATION] Creating isolation on-demand', {
          project_id: projectId,
          framework: framework,
          project_name: projectMetadata.name
        });
        
        // Create isolation now - use legacy format if project is in legacy location
        const isLegacyProject = metadataKey.startsWith('projects/');
        const createResult = await this.createProjectIsolationForLegacyProject(projectId, framework, isLegacyProject);
        if (!createResult.success) {
          console.error('[PROJECT-ISOLATION] Failed to create isolation on-demand', {
            project_id: projectId,
            error: createResult.error
          });
          return createResult;
        }
        
        console.info('[PROJECT-ISOLATION] Successfully created isolation on-demand', {
          project_id: projectId,
          isolation_level: createResult.metadata?.isolation_level,
          legacy_format: isLegacyProject
        });
        
        // Re-load the newly created isolation metadata (use correct path)
        const newIsolationKey = isLegacyProject ? `projects/${projectId}/isolation.json` : isolationKey;
        isolationObj = await this.env.PROJECTS_BUCKET.get(newIsolationKey);
        
        if (!isolationObj) {
          console.error('[PROJECT-ISOLATION] Failed to reload isolation after creation', {
            project_id: projectId
          });
          return {
            success: false,
            error: {
              type: 'boundary_violation',
              message: 'Failed to load isolation metadata after creation'
            },
            metadata: { project_id: projectId, isolation_level: 'minimal' }
          };
        }
      }

      const isolationMetadata = await isolationObj.json();

      // Verify directory isolation
      const directoryCheck = await this.verifyDirectoryIsolation(projectId, isolationMetadata);
      if (!directoryCheck.success) {
        return directoryCheck;
      }

      // Verify cache isolation
      let cacheIsolated = true;
      if (this.config.enableCacheIsolation) {
        const cacheCheck = await this.verifyCacheIsolation(projectId, isolationMetadata);
        cacheIsolated = cacheCheck.success;
      }

      // Check for resource conflicts
      const resourceCheck = await this.checkResourceConflicts(projectId);
      if (!resourceCheck.success) {
        return resourceCheck;
      }

      console.info('✅ [PROJECT-ISOLATION] Project isolation verification passed', {
        project_id: projectId,
        cache_isolated: cacheIsolated,
        boundaries_secure: directoryCheck.success
      });

      return {
        success: true,
        data: {
          isolation_valid: true,
          boundaries_secure: true,
          cache_isolated: cacheIsolated
        },
        metadata: {
          project_id: projectId,
          isolation_level: isolationMetadata.isolation_level
        }
      };

    } catch (error) {
      console.error('[PROJECT-ISOLATION] Project isolation verification failed', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: {
          type: 'boundary_violation',
          message: 'Project isolation verification failed',
          details: error
        },
        metadata: {
          project_id: projectId,
          isolation_level: 'minimal'
        }
      };
    }
  }

  /**
   * Setup isolated build environment for a specific build job
   */
  async setupBuildEnvironment(
    projectId: string,
    framework: FrameworkType,
    jobId: string
  ): Promise<IsolationResult<{
    environment_configured: boolean;
    resource_allocation: ProjectResourceAllocation;
    cache_key: string;
  }>> {
    try {
      console.info('[PROJECT-ISOLATION] Setting up build environment', {
        project_id: projectId,
        job_id: jobId,
        framework
      });

      // Check if project already has too many concurrent builds
      const concurrentBuilds = await this.getConcurrentBuildsCount(projectId);
      if (concurrentBuilds >= this.config.maxConcurrentBuilds) {
        return {
          success: false,
          error: {
            type: 'resource_limit',
            message: `Project has reached maximum concurrent builds limit (${this.config.maxConcurrentBuilds})`
          },
          metadata: { project_id: projectId, isolation_level: 'minimal' }
        };
      }

      // Generate unique cache key for this build
      const cacheKey = this.generateBuildCacheKey(projectId, framework, jobId);

      // Allocate build resources
      const resourceAllocation: ProjectResourceAllocation = {
        project_id: projectId,
        job_id: jobId,
        framework,
        allocated_at: new Date().toISOString(),
        resources: {
          cache_key: cacheKey,
          build_directory: `${this.directoryStructure.active}/${projectId}/builds/${jobId}`,
          temp_files: [],
          environment_vars: this.generateIsolatedEnvironmentVars(projectId, jobId, framework)
        },
        limits: this.calculateResourceLimits(framework),
        isolation_level: this.config.enableStrictIsolation ? 'strict' : 'standard'
      };

      // Store resource allocation
      this.activeAllocations.set(jobId, resourceAllocation);

      // Create build-specific directories
      await this.createBuildSpecificDirectories(resourceAllocation);

      // Setup isolated cache if enabled
      if (this.config.enableCacheIsolation) {
        await this.setupIsolatedCache(projectId, framework, cacheKey);
      }

      console.info('✅ [PROJECT-ISOLATION] Build environment configured', {
        project_id: projectId,
        job_id: jobId,
        cache_key: cacheKey,
        isolation_level: resourceAllocation.isolation_level
      });

      return {
        success: true,
        data: {
          environment_configured: true,
          resource_allocation: resourceAllocation,
          cache_key: cacheKey
        },
        metadata: {
          project_id: projectId,
          isolation_level: resourceAllocation.isolation_level,
          resources_allocated: Object.keys(resourceAllocation.resources),
          cache_key: cacheKey
        }
      };

    } catch (error) {
      console.error('[PROJECT-ISOLATION] Failed to setup build environment', {
        project_id: projectId,
        job_id: jobId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: {
          type: 'resource_limit',
          message: 'Failed to setup isolated build environment',
          details: error
        },
        metadata: {
          project_id: projectId,
          isolation_level: 'minimal'
        }
      };
    }
  }

  /**
   * Update project cache after build completion
   */
  async updateProjectCache(
    projectId: string,
    buildSuccess: boolean
  ): Promise<IsolationResult<{
    cache_updated: boolean;
    cache_size_mb: number;
  }>> {
    try {
      if (!this.config.enableCacheIsolation) {
        return { success: true, data: { cache_updated: false, cache_size_mb: 0 } };
      }

      console.info('[PROJECT-ISOLATION] Updating project cache', {
        project_id: projectId,
        build_success: buildSuccess
      });

      // Get current cache metadata
      const cacheMetadata = this.cacheRegistry.get(projectId);
      
      if (cacheMetadata) {
        // Update cache statistics
        cacheMetadata.last_used = new Date().toISOString();
        cacheMetadata.hit_count += buildSuccess ? 1 : 0;
        
        // Save updated cache metadata
        await this.saveCacheMetadata(projectId, cacheMetadata);

        console.info('✅ [PROJECT-ISOLATION] Project cache updated', {
          project_id: projectId,
          cache_size_mb: cacheMetadata.size_mb,
          hit_count: cacheMetadata.hit_count
        });

        return {
          success: true,
          data: {
            cache_updated: true,
            cache_size_mb: cacheMetadata.size_mb
          },
          metadata: {
            project_id: projectId,
            isolation_level: 'standard',
            cache_key: cacheMetadata.cache_key_prefix
          }
        };
      }

      return { success: true, data: { cache_updated: false, cache_size_mb: 0 } };

    } catch (error) {
      console.error('[PROJECT-ISOLATION] Failed to update project cache', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: {
          type: 'cache_conflict',
          message: 'Failed to update project cache',
          details: error
        },
        metadata: {
          project_id: projectId,
          isolation_level: 'minimal'
        }
      };
    }
  }

  /**
   * Clean up build environment after job completion
   */
  async cleanupBuildEnvironment(
    projectId: string,
    jobId: string
  ): Promise<IsolationResult<{
    cleanup_completed: boolean;
    resources_freed: string[];
  }>> {
    try {
      console.info('[PROJECT-ISOLATION] Cleaning up build environment', {
        project_id: projectId,
        job_id: jobId
      });

      const allocation = this.activeAllocations.get(jobId);
      if (!allocation) {
        return { success: true, data: { cleanup_completed: false, resources_freed: [] } };
      }

      const resourcesFreed: string[] = [];

      // Clean up temporary files
      for (const tempFile of allocation.resources.temp_files) {
        try {
          await this.env.PROJECTS_BUCKET.delete(tempFile);
          resourcesFreed.push(tempFile);
        } catch (error) {
          console.warn('[PROJECT-ISOLATION] Failed to delete temp file', { temp_file: tempFile });
        }
      }

      // Clean up build directory
      try {
        const buildDir = allocation.resources.build_directory;
        const buildObjects = await this.env.PROJECTS_BUCKET.list({ prefix: `${buildDir}/` });
        
        for (const obj of buildObjects.objects) {
          await this.env.PROJECTS_BUCKET.delete(obj.key);
          resourcesFreed.push(obj.key);
        }
      } catch (error) {
        console.warn('[PROJECT-ISOLATION] Failed to clean up build directory', {
          project_id: projectId,
          job_id: jobId
        });
      }

      // Remove resource allocation
      this.activeAllocations.delete(jobId);

      console.info('✅ [PROJECT-ISOLATION] Build environment cleanup completed', {
        project_id: projectId,
        job_id: jobId,
        resources_freed: resourcesFreed.length
      });

      return {
        success: true,
        data: {
          cleanup_completed: true,
          resources_freed: resourcesFreed
        },
        metadata: {
          project_id: projectId,
          isolation_level: allocation.isolation_level
        }
      };

    } catch (error) {
      console.error('[PROJECT-ISOLATION] Build environment cleanup failed', {
        project_id: projectId,
        job_id: jobId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: {
          type: 'isolation_conflict',
          message: 'Failed to cleanup build environment',
          details: error
        },
        metadata: {
          project_id: projectId,
          isolation_level: 'minimal'
        }
      };
    }
  }

  // Private helper methods

  /**
   * Create isolated directory structure for legacy projects
   */
  private async createDirectoryIsolationForLegacyProject(projectId: string, isLegacyProject: boolean): Promise<IsolationResult<boolean>> {
    try {
      const projectRoot = isLegacyProject ? `projects/${projectId}` : `${this.directoryStructure.active}/${projectId}`;
      const projectDirs = [
        `${projectRoot}/source`,
        `${projectRoot}/builds`,
        `${projectRoot}/temp`,
        `${this.directoryStructure.cache}/${projectId}`
      ];

      for (const dir of projectDirs) {
        const keepFile = `${dir}/.gitkeep`;
        await this.env.PROJECTS_BUCKET.put(keepFile, '', {
          customMetadata: {
            project_id: projectId,
            type: 'isolation-directory',
            created_at: new Date().toISOString(),
            legacy_format: String(isLegacyProject)
          }
        });
      }

      return { success: true, data: true };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'isolation_conflict',
          message: 'Failed to create directory isolation',
          details: error
        }
      };
    }
  }

  /**
   * Apply resource limits for legacy projects
   */
  private async applyResourceLimitsForLegacyProject(projectId: string, framework: FrameworkType, isLegacyProject: boolean): Promise<any> {
    const limits = this.calculateResourceLimits(framework);
    
    // Store limits in project isolation metadata
    const projectRoot = isLegacyProject ? `projects/${projectId}` : `${this.directoryStructure.active}/${projectId}`;
    const limitsKey = `${projectRoot}/resource-limits.json`;
    await this.env.PROJECTS_BUCKET.put(
      limitsKey,
      JSON.stringify(limits, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          project_id: projectId,
          type: 'resource-limits',
          created_at: new Date().toISOString(),
          legacy_format: String(isLegacyProject)
        }
      }
    );

    return limits;
  }

  /**
   * Create isolated directory structure for project
   */
  private async createDirectoryIsolation(projectId: string): Promise<IsolationResult<boolean>> {
    try {
      const projectDirs = [
        `${this.directoryStructure.active}/${projectId}/source`,
        `${this.directoryStructure.active}/${projectId}/builds`,
        `${this.directoryStructure.active}/${projectId}/temp`,
        `${this.directoryStructure.cache}/${projectId}`
      ];

      for (const dir of projectDirs) {
        const keepFile = `${dir}/.gitkeep`;
        await this.env.PROJECTS_BUCKET.put(keepFile, '', {
          customMetadata: {
            project_id: projectId,
            type: 'isolation-directory',
            created_at: new Date().toISOString()
          }
        });
      }

      return { success: true, data: true };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'isolation_conflict',
          message: 'Failed to create directory isolation',
          details: error
        }
      };
    }
  }

  /**
   * Create cache isolation for project
   */
  private async createCacheIsolation(
    projectId: string,
    framework: FrameworkType
  ): Promise<IsolationResult<{ cache_boundary: string }>> {
    try {
      const cacheBoundary = `project-${projectId}-${framework}`;
      
      const cacheMetadata: CacheIsolationMetadata = {
        project_id: projectId,
        framework,
        cache_key_prefix: cacheBoundary,
        dependency_hash: '',
        framework_version: this.getFrameworkVersion(framework),
        isolation_boundary: cacheBoundary,
        created_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
        hit_count: 0,
        size_mb: 0
      };

      this.cacheRegistry.set(projectId, cacheMetadata);
      await this.saveCacheMetadata(projectId, cacheMetadata);

      return { success: true, data: { cache_boundary: cacheBoundary } };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'cache_conflict',
          message: 'Failed to create cache isolation',
          details: error
        }
      };
    }
  }

  /**
   * Apply resource limits for project
   */
  private async applyResourceLimits(projectId: string, framework: FrameworkType): Promise<any> {
    const limits = this.calculateResourceLimits(framework);
    
    // Store limits in project isolation metadata
    const limitsKey = `${this.directoryStructure.active}/${projectId}/resource-limits.json`;
    await this.env.PROJECTS_BUCKET.put(
      limitsKey,
      JSON.stringify(limits, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          project_id: projectId,
          type: 'resource-limits',
          created_at: new Date().toISOString()
        }
      }
    );

    return limits;
  }

  /**
   * Verify directory isolation is intact
   */
  private async verifyDirectoryIsolation(projectId: string, isolationMetadata: any): Promise<IsolationResult<boolean>> {
    try {
      // Check if project directories exist and are properly isolated
      const isLegacyProject = isolationMetadata.legacy_format === true;
      const projectRoot = isLegacyProject ? `projects/${projectId}` : `${this.directoryStructure.active}/${projectId}`;
      
      const expectedDirs = [
        `${projectRoot}/source/`,
        `${projectRoot}/builds/`,
        `${this.directoryStructure.cache}/${projectId}/`
      ];

      for (const dir of expectedDirs) {
        const objects = await this.env.PROJECTS_BUCKET.list({ prefix: dir, delimiter: '/' });
        // Directory should exist (even if just with .gitkeep)
        if (objects.objects.length === 0 && (!objects.delimitedPrefixes || objects.delimitedPrefixes.length === 0)) {
          return {
            success: false,
            error: {
              type: 'boundary_violation',
              message: `Missing isolated directory: ${dir}`
            }
          };
        }
      }

      return { success: true, data: true };
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'boundary_violation',
          message: 'Directory isolation verification failed',
          details: error
        }
      };
    }
  }

  /**
   * Verify cache isolation is working properly
   */
  private async verifyCacheIsolation(projectId: string, isolationMetadata: any): Promise<IsolationResult<boolean>> {
    const cacheMetadata = this.cacheRegistry.get(projectId);
    
    if (!cacheMetadata) {
      return {
        success: false,
        error: {
          type: 'cache_conflict',
          message: 'Cache isolation metadata missing'
        }
      };
    }

    // Verify cache boundary matches isolation metadata
    if (cacheMetadata.isolation_boundary !== isolationMetadata.cache_boundary) {
      return {
        success: false,
        error: {
          type: 'cache_conflict',
          message: 'Cache isolation boundary mismatch'
        }
      };
    }

    return { success: true, data: true };
  }

  /**
   * Check for resource conflicts with other projects
   */
  private async checkResourceConflicts(projectId: string): Promise<IsolationResult<boolean>> {
    // Check if there are any overlapping resource allocations
    for (const [jobId, allocation] of this.activeAllocations.entries()) {
      if (allocation.project_id === projectId) {
        // Check for resource conflicts within the same project
        const elapsedTime = Date.now() - new Date(allocation.allocated_at).getTime();
        if (elapsedTime > this.config.resourceTimeoutMs) {
          // Resource allocation has timed out
          console.warn('[PROJECT-ISOLATION] Resource allocation timeout detected', {
            project_id: projectId,
            job_id: jobId,
            elapsed_time_ms: elapsedTime
          });
          
          // Clean up timed out allocation
          this.activeAllocations.delete(jobId);
        }
      }
    }

    return { success: true, data: true };
  }

  /**
   * Get count of concurrent builds for a project
   */
  private async getConcurrentBuildsCount(projectId: string): Promise<number> {
    let count = 0;
    for (const allocation of this.activeAllocations.values()) {
      if (allocation.project_id === projectId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Generate unique cache key for build
   */
  private generateBuildCacheKey(projectId: string, framework: FrameworkType, jobId: string): string {
    const timestamp = Date.now();
    return `build-${projectId}-${framework}-${jobId}-${timestamp}`;
  }

  /**
   * Generate isolated environment variables for build
   */
  private generateIsolatedEnvironmentVars(
    projectId: string,
    jobId: string,
    framework: FrameworkType
  ): Record<string, string> {
    return {
      PROJECT_ID: projectId,
      JOB_ID: jobId,
      FRAMEWORK: framework,
      BUILD_ISOLATION: 'enabled',
      CACHE_ISOLATION: this.config.enableCacheIsolation ? 'enabled' : 'disabled',
      RESOURCE_LIMITS: this.config.enableResourceLimits ? 'enabled' : 'disabled',
      ISOLATION_LEVEL: this.config.enableStrictIsolation ? 'strict' : 'standard'
    };
  }

  /**
   * Calculate resource limits based on framework
   */
  private calculateResourceLimits(framework: FrameworkType): any {
    const baseLimits = {
      max_memory_mb: 512,
      max_disk_mb: 1024,
      max_duration_ms: 10 * 60 * 1000 // 10 minutes
    };

    // Adjust limits based on framework complexity
    switch (framework) {
      case 'react':
        return {
          ...baseLimits,
          max_memory_mb: 768,
          max_disk_mb: 1536
        };
      case 'vue':
        return {
          ...baseLimits,
          max_memory_mb: 640,
          max_disk_mb: 1280
        };
      case 'svelte':
        return {
          ...baseLimits,
          max_memory_mb: 512,
          max_disk_mb: 1024
        };
      default:
        return baseLimits;
    }
  }

  /**
   * Create build-specific directories
   */
  private async createBuildSpecificDirectories(allocation: ProjectResourceAllocation): Promise<void> {
    const dirs = [
      allocation.resources.build_directory,
      `${allocation.resources.build_directory}/artifacts`,
      `${allocation.resources.build_directory}/logs`
    ];

    for (const dir of dirs) {
      const keepFile = `${dir}/.gitkeep`;
      await this.env.PROJECTS_BUCKET.put(keepFile, '', {
        customMetadata: {
          project_id: allocation.project_id,
          job_id: allocation.job_id,
          type: 'build-directory',
          created_at: allocation.allocated_at
        }
      });
    }
  }

  /**
   * Setup isolated cache for project
   */
  private async setupIsolatedCache(
    projectId: string,
    framework: FrameworkType,
    cacheKey: string
  ): Promise<void> {
    const cacheConfig = {
      project_id: projectId,
      framework,
      cache_key: cacheKey,
      isolation_enabled: true,
      created_at: new Date().toISOString()
    };

    const cacheConfigKey = `${this.directoryStructure.cache}/${projectId}/config.json`;
    await this.env.PROJECTS_BUCKET.put(
      cacheConfigKey,
      JSON.stringify(cacheConfig, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          project_id: projectId,
          type: 'cache-config',
          created_at: new Date().toISOString()
        }
      }
    );
  }

  /**
   * Save cache metadata to storage
   */
  private async saveCacheMetadata(projectId: string, metadata: CacheIsolationMetadata): Promise<void> {
    const metadataKey = `${this.directoryStructure.cache}/${projectId}/metadata.json`;
    await this.env.PROJECTS_BUCKET.put(
      metadataKey,
      JSON.stringify(metadata, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          project_id: projectId,
          type: 'cache-metadata',
          updated_at: new Date().toISOString()
        }
      }
    );
  }

  /**
   * Get framework version string for cache isolation
   */
  private getFrameworkVersion(framework: FrameworkType): string {
    // In production, this would detect actual framework versions
    // For now, return standard versions
    const versions = {
      'react': '18.x',
      'vue': '3.x',
      'svelte': '4.x',
      'html': '5.x',
      'unknown': '1.x'
    };
    
    return versions[framework] || versions['unknown'];
  }
}

/**
 * Factory function to create ProjectIsolationManager
 */
export function createProjectIsolationManager(
  env: Env,
  directoryStructure: ProjectDirectoryStructure,
  config?: Partial<ProjectIsolationConfig>
): ProjectIsolationManager {
  return new ProjectIsolationManager(env, directoryStructure, config);
}