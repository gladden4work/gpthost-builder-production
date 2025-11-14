/**
 * ServiceFactory - Creates service instances based on feature flags
 * Handles feature flag parsing and service selection
 * Includes dependency validation to prevent invalid service configurations
 */

import type { Env } from '../types/env';
import { IStorageService, StorageService } from './StorageService';
import { ProjectService, IProjectService } from './ProjectService';
import { LegacyStorageAdapter } from './LegacyStorageAdapter';
import { MonitoredStorageService } from './MonitoredStorageService';
import { LegacyProjectAdapter } from './LegacyProjectAdapter';
import { getFeatureFlags } from '../config/featureFlags';
import { IGitHubService, IBuildService } from './interfaces';
import { GitHubService } from './GitHubService';
import { BuildService } from './BuildService';
import { DeployService } from './DeployService';

// Legacy GitHub adapter for backward compatibility
class LegacyGitHubAdapter implements IGitHubService {
  constructor(private env: Env) {}
  
  async triggerWorkflow(params: any): Promise<any> {
    // This would wrap existing githubApi.ts functions
    // For now, return an error result
    return { 
      ok: false, 
      error: { 
        code: 'GITHUB_NOT_IMPLEMENTED', 
        message: 'Legacy GitHub adapter not yet implemented' 
      } 
    };
  }
  
  async getWorkflowStatus(runId: number): Promise<any> {
    return { 
      ok: false, 
      error: { 
        code: 'GITHUB_NOT_IMPLEMENTED', 
        message: 'Legacy GitHub adapter not yet implemented' 
      } 
    };
  }
  
  async handleWebhookCallback(payload: any, signature: string): Promise<any> {
    return { 
      ok: false, 
      error: { 
        code: 'GITHUB_NOT_IMPLEMENTED', 
        message: 'Legacy GitHub adapter not yet implemented' 
      } 
    };
  }
  
  validateWebhookSignature(signature: string, body: string): any {
    return { 
      ok: false, 
      error: { 
        code: 'GITHUB_NOT_IMPLEMENTED', 
        message: 'Legacy GitHub adapter not yet implemented' 
      } 
    };
  }
}

/**
 * Factory for creating service instances based on environment configuration
 * Tracks enabled services for dependency validation
 */
export class ServiceFactory {
  private static enabledServices = new Set<string>();

  /**
   * Get the appropriate storage service based on feature flags
   * @param env - Environment with feature flags and bucket
   * @returns Storage service instance (new, legacy, or monitored)
   */
  static getStorageService(env: Env): IStorageService {
    // Parse feature flags with safe fallback
    const flags = getFeatureFlags(env);
    
    // Select base service based on feature flag
    let service: IStorageService;
    
    if (flags.useNewStorageService) {
      this.enabledServices.add('StorageService');
      // Use new StorageService
      service = new StorageService(env.PROJECTS_BUCKET);
    } else {
      // Fall back to legacy adapter
      service = new LegacyStorageAdapter(env.PROJECTS_BUCKET);
    }
    
    // Wrap with monitoring if enabled
    if (flags.useMonitoring) {
      service = new MonitoredStorageService(service);
    }
    
    return service;
  }
  
  /**
   * Get the appropriate project service based on feature flags.
   * Note: No legacy adapter is present in this codebase; fall back to new implementation.
   */
  static getProjectService(env: Env): IProjectService {
    const flags = getFeatureFlags(env);
    const storage = this.getStorageService(env);

    // Prefer new ProjectService when flag is true; otherwise default to new as well.
    if (flags.useNewProjectService) {
      this.enabledServices.add('ProjectService');
      return new ProjectService(storage);
    }
    return new ProjectService(storage);
  }

  /**
   * Get the GitHub service for workflow management
   * @param env - Environment with feature flags and configuration
   * @returns GitHub service instance
   */
  static getGitHubService(env: Env): IGitHubService {
    const flags = getFeatureFlags(env);
    
    if (flags.useNewGitHubService) {
      this.enabledServices.add('GitHubService');
      
      const service = new GitHubService({
        token: env.GITHUB_TOKEN,
        owner: env.GITHUB_OWNER || 'gladden4work',
        repo: env.GITHUB_REPO || 'gpthost-build-test',
        workflowFile: env.GITHUB_WORKFLOW_FILENAME || env.GITHUB_WORKFLOW || 'gpthost-build.yml',
        webhookSecret: env.GITHUB_WEBHOOK_SECRET
      });
      
      // Add monitoring if enabled
      if (flags.useMonitoring) {
        // return new MonitoredGitHubService(service);
        return service; // Monitoring wrapper to be implemented later
      }
      
      return service;
    }
    
    // Fallback to legacy adapter
    return new LegacyGitHubAdapter(env);
  }

  /**
   * Get the build service for managing concurrent builds
   * Validates dependencies before creating service
   * @param env - Environment with feature flags and configuration
   * @returns Build service instance
   */
  static getBuildService(env: Env): IBuildService {
    const flags = getFeatureFlags(env);
    
    // Dependency validation: BuildService requires GitHubService
    if (flags.useNewBuildService && !flags.useNewGitHubService) {
      throw new Error(
        'BuildService requires GitHubService to be enabled. ' +
        'Please enable useNewGitHubService feature flag.'
      );
    }
    
    if (flags.useNewBuildService) {
      this.enabledServices.add('BuildService');
      const projectService = this.getProjectService(env);
      const githubService = this.getGitHubService(env);
      const storageService = this.getStorageService(env);
      return new BuildService(projectService, githubService, storageService, env);
    }

    // Fallback: use legacy project adapter as a no-op build service
    return new LegacyProjectAdapter(env) as unknown as IBuildService;
  }

  /**
   * Get the deploy service for managing deployments
   * @param env - Environment with feature flags and configuration
   * @returns Deploy service instance
   */
  static getDeployService(env: Env): DeployService {
    const flags = getFeatureFlags(env);
    
    // Dependency validation: DeployService requires other services
    if (flags.useNewDeployService && !flags.useNewBuildService) {
      throw new Error(
        'DeployService requires BuildService to be enabled. ' +
        'Please enable useNewBuildService feature flag.'
      );
    }
    
    if (flags.useNewDeployService) {
      this.enabledServices.add('DeployService');
      
      // Create storage services for builds and sites
      // Use dedicated BUILDS_BUCKET if available, otherwise fall back to PROJECTS_BUCKET
      let buildsStorage: IStorageService;
      if ((env as any).BUILDS_BUCKET) {
        buildsStorage = new StorageService((env as any).BUILDS_BUCKET);
      } else {
        buildsStorage = this.getStorageService(env); // fallback to PROJECTS_BUCKET
      }
      
      // Create sites storage using DEPLOYMENTS_BUCKET if available, otherwise use PROJECTS_BUCKET
      let sitesStorage: IStorageService;
      if (env.DEPLOYMENTS_BUCKET) {
        sitesStorage = new StorageService(env.DEPLOYMENTS_BUCKET);
        if (flags.useMonitoring) {
          sitesStorage = new MonitoredStorageService(sitesStorage);
        }
      } else {
        // Fallback to using the same bucket as builds
        sitesStorage = this.getStorageService(env);
      }
      
      const projectService = this.getProjectService(env);
      const buildService = this.getBuildService(env);
      
      return new DeployService(buildsStorage, sitesStorage, projectService, buildService, env);
    }
    
    // If flag is off, throw error (no legacy deploy service)
    throw new Error('DeployService is not enabled. Please enable useNewDeployService feature flag.');
  }

  /**
   * Get a list of all enabled services for debugging
   * @returns Array of enabled service names
   */
  static getEnabledServices(): string[] {
    return Array.from(this.enabledServices);
  }
}
