/**
 * Admin Stats Service
 * Phase 2: Super Admin Dashboard - Dashboard & Stats
 *
 * Aggregates platform statistics from existing R2/KV storage
 * No new databases or tables - reads from ProjectService, SubdomainService, and metadata
 */

import { ProjectService } from './ProjectService';
import { SubdomainService } from './SubdomainService';
import { IStorageService } from './StorageService';
import type { Project, ProjectStatus } from '../domain/models';

/**
 * Platform overview statistics
 */
export interface PlatformStats {
  users: {
    total: number;
    unique_owners: string[];
  };
  projects: {
    total: number;
    deployed: number;
    building: number;
    failed: number;
    by_status: Record<ProjectStatus, number>;
  };
  subdomains: {
    active: number;
  };
  builds: {
    total_24h: number;
    failed_24h: number;
    failureRate: number; // Percentage
  };
  timestamp: string;
}

/**
 * Activity event for feed
 */
export interface ActivityEvent {
  id: string;
  type: 'build_success' | 'build_failure' | 'deploy_success' | 'project_created' | 'error';
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  timestamp: string;
  user: string;
  project?: string;
  project_id?: string;
  metadata?: Record<string, any>;
}

/**
 * Activity feed response
 */
export interface ActivityFeed {
  events: ActivityEvent[];
  total_count: number;
  timestamp: string;
}

/**
 * Admin Stats Service - Aggregates platform statistics
 */
export class AdminStatsService {
  private projectService: ProjectService;
  private subdomainService: SubdomainService;

  constructor(storage: IStorageService, env: Env) {
    this.projectService = new ProjectService(storage);
    this.subdomainService = new SubdomainService(env);
  }

  /**
   * Normalize possible storage shapes into consistent primitives
   */
  private getOwnerId(project: Project): string | undefined {
    return (project as any).ownerId || (project as any).owner_id;
  }

  private getDeploymentUrl(project: Project): string | undefined {
    return (project as any).deploymentUrl || (project as any).deployment_url;
  }

  private getErrorMessage(project: Project): string | undefined {
    return (project as any).errorMessage || (project as any).error_message;
  }

  private getBuildMetadata(project: Project): Record<string, any> | null {
    const metadata = (project as any).build_metadata || (project as any).buildMetadata;
    return metadata || null;
  }

  private parseDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    const parsed = new Date(value as any);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  private getProjectDate(project: Project, keys: string[]): Date | null {
    for (const key of keys) {
      const parsed = this.parseDate((project as any)[key]);
      if (parsed) return parsed;
    }
    return null;
  }

  /**
   * Get platform overview statistics
   * Aggregates data from ProjectService, SubdomainService, and R2 metadata
   */
  async getPlatformStats(): Promise<PlatformStats> {
    const startTime = Date.now();

    try {
      console.info('[ADMIN-STATS] Aggregating platform statistics');

      // Load all projects (no owner filter for admin view)
      const projectsResult = await this.projectService.listProjects({
        limit: 10000, // High limit to get all projects
      });

      if (!projectsResult.ok) {
        throw new Error(`Failed to list projects: ${projectsResult.error.message}`);
      }

      const allProjects = projectsResult.value.projects;

      // Calculate project statistics
      const projectStats = this.calculateProjectStats(allProjects);

      // Get unique users from project owners
      const uniqueOwners = new Set(
        allProjects
          .map(p => this.getOwnerId(p))
          .filter((ownerId): ownerId is string => Boolean(ownerId))
      );

      // Count active subdomains
      const subdomainMapResult = await this.subdomainService.listProjectSubdomainMap();
      const activeSubdomains = subdomainMapResult.ok ? subdomainMapResult.value.size : 0;

      // Calculate build statistics (last 24 hours)
      const buildStats = this.calculateBuildStats(allProjects);

      const stats: PlatformStats = {
        users: {
          total: uniqueOwners.size,
          unique_owners: Array.from(uniqueOwners),
        },
        projects: projectStats,
        subdomains: {
          active: activeSubdomains,
        },
        builds: buildStats,
        timestamp: new Date().toISOString(),
      };

      const duration = Date.now() - startTime;
      console.info('[ADMIN-STATS] Platform statistics aggregated successfully', {
        total_projects: stats.projects.total,
        total_users: stats.users.total,
        active_subdomains: stats.subdomains.active,
        failure_rate: stats.builds.failureRate.toFixed(2),
        duration_ms: duration,
      });

      return stats;
    } catch (error) {
      console.error('[ADMIN-STATS] Failed to aggregate platform statistics', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get activity feed from project timeline and error logs
   */
  async getActivityFeed(limit: number = 20): Promise<ActivityFeed> {
    const startTime = Date.now();

    try {
      console.info('[ADMIN-STATS] Building activity feed', { limit });

      // Load recent projects to build activity timeline
      const projectsResult = await this.projectService.listProjects({
        limit: 100, // Get last 100 projects for activity
      });

      if (!projectsResult.ok) {
        throw new Error(`Failed to list projects: ${projectsResult.error.message}`);
      }

      const recentProjects = projectsResult.value.projects;
      const events: ActivityEvent[] = [];

      // Convert projects to activity events
      for (const project of recentProjects) {
        const ownerId = this.getOwnerId(project) || 'unknown';
        const projectName = (project as any).name || 'Unknown Project';
        const createdAt =
          this.getProjectDate(project, ['createdAt', 'created_at']) || new Date();
        const updatedAt =
          this.getProjectDate(project, ['updatedAt', 'updated_at']) || createdAt;
        const deploymentUrl = this.getDeploymentUrl(project);
        const buildMetadata = this.getBuildMetadata(project);
        const buildStatus =
          buildMetadata?.build_status ||
          buildMetadata?.status ||
          buildMetadata?.buildStatus;
        const buildCompletedAt = this.parseDate(
          buildMetadata?.build_completed_at ||
          buildMetadata?.completedAt ||
          buildMetadata?.completed_at ||
          buildMetadata?.buildCompletedAt ||
          buildMetadata?.build_timestamp
        );

        // Add project creation event
        events.push({
          id: `project-created-${project.id}`,
          type: 'project_created',
          severity: 'info',
          message: `Project "${projectName}" created`,
          timestamp: createdAt.toISOString(),
          user: ownerId,
          project: projectName,
          project_id: project.id,
          metadata: {
            framework: project.framework,
            status: project.status,
          },
        });

        // Add deployment event if deployed
        if (project.status === 'deployed' && deploymentUrl) {
          events.push({
            id: `deploy-success-${project.id}`,
            type: 'deploy_success',
            severity: 'info',
            message: `Project "${projectName}" deployed successfully`,
            timestamp: updatedAt.toISOString(),
            user: ownerId,
            project: projectName,
            project_id: project.id,
            metadata: {
              deployment_url: deploymentUrl,
              framework: project.framework,
            },
          });
        }

        // Add build success event if building completed
        if (project.status === 'deployed' || project.status === 'building') {
          if (buildStatus === 'completed' && buildCompletedAt) {
            events.push({
              id: `build-success-${project.id}`,
              type: 'build_success',
              severity: 'info',
              message: `Build completed for project "${projectName}"`,
              timestamp: buildCompletedAt.toISOString(),
              user: ownerId,
              project: projectName,
              project_id: project.id,
              metadata: {
                build_duration_ms: buildMetadata?.build_duration_ms,
                framework: project.framework,
              },
            });
          }
        }

        // Add failure event if failed
        const errorMessage = this.getErrorMessage(project);
        if (project.status === 'failed' && errorMessage) {
          events.push({
            id: `build-failure-${project.id}`,
            type: 'build_failure',
            severity: 'error',
            message: `Build failed for project "${projectName}": ${errorMessage.substring(0, 100)}`,
            timestamp: updatedAt.toISOString(),
            user: ownerId,
            project: projectName,
            project_id: project.id,
            metadata: {
              error_message: errorMessage,
              framework: project.framework,
            },
          });
        }
      }

      // Sort events by timestamp (newest first)
      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply limit
      const limitedEvents = events.slice(0, limit);

      const feed: ActivityFeed = {
        events: limitedEvents,
        total_count: events.length,
        timestamp: new Date().toISOString(),
      };

      const duration = Date.now() - startTime;
      console.info('[ADMIN-STATS] Activity feed built successfully', {
        total_events: feed.total_count,
        returned_events: limitedEvents.length,
        duration_ms: duration,
      });

      return feed;
    } catch (error) {
      console.error('[ADMIN-STATS] Failed to build activity feed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Calculate project statistics by status
   */
  private calculateProjectStats(projects: Project[]): PlatformStats['projects'] {
    const byStatus: Record<ProjectStatus, number> = {
      pending: 0,
      queueing: 0,
      analyzing: 0,
      scaffolding: 0,
      scaffolded: 0,
      building: 0,
      deploying: 0,
      deployed: 0,
      failed: 0,
    };

    for (const project of projects) {
      byStatus[project.status] = (byStatus[project.status] || 0) + 1;
    }

    return {
      total: projects.length,
      deployed: byStatus.deployed || 0,
      building: (byStatus.building || 0) + (byStatus.deploying || 0),
      failed: byStatus.failed || 0,
      by_status: byStatus,
    };
  }

  /**
   * Calculate build statistics for last 24 hours
   */
  private calculateBuildStats(projects: Project[]): PlatformStats['builds'] {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    let total24h = 0;
    let failed24h = 0;

    for (const project of projects) {
      const buildMetadata = this.getBuildMetadata(project);
      const completedAt = this.parseDate(
        buildMetadata?.build_completed_at ||
        buildMetadata?.completedAt ||
        buildMetadata?.completed_at ||
        buildMetadata?.buildCompletedAt ||
        buildMetadata?.build_timestamp
      );
      const buildStatus =
        buildMetadata?.build_status ||
        buildMetadata?.status ||
        buildMetadata?.buildStatus;

      if (completedAt && completedAt.getTime() >= twentyFourHoursAgo) {
        total24h++;
        if (
          buildStatus === 'failed' ||
          buildStatus === 'timeout' ||
          buildStatus === 'cancelled'
        ) {
          failed24h++;
        }
        continue;
      }

      // If build metadata is missing but the project recently failed, count it as a failed build
      const updatedAt =
        this.getProjectDate(project, ['updatedAt', 'updated_at']) || null;
      if (
        project.status === 'failed' &&
        updatedAt &&
        updatedAt.getTime() >= twentyFourHoursAgo
      ) {
        total24h++;
        failed24h++;
      }
    }

    const failureRate = total24h > 0 ? (failed24h / total24h) * 100 : 0;

    return {
      total_24h: total24h,
      failed_24h: failed24h,
      failureRate: parseFloat(failureRate.toFixed(2)),
    };
  }
}

/**
 * Factory function to create AdminStatsService
 */
export function createAdminStatsService(storage: IStorageService, env: Env): AdminStatsService {
  return new AdminStatsService(storage, env);
}
