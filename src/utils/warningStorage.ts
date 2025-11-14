/**
 * Warning Storage System - TASK-020
 * 
 * Storage and retrieval system for build warnings integrated with R2.
 * Provides efficient warning data management, analytics, and historical tracking.
 * 
 * Handles:
 * - Warning storage in R2 BUILDS_BUCKET
 * - Warning analytics and trending
 * - Historical warning data retrieval
 * - Warning metadata management
 */

import {
  BuildWarningAnalysis,
  BuildWarningsSummary,
  WarningResolutionSuggestion,
  BuildStage,
  WarningCategory,
  WarningSeverity
} from './buildWarningParser';

import { FrameworkType } from '../types/api';

/**
 * Warning storage metadata
 */
export interface WarningStorageMetadata {
  projectId: string;
  buildId: string;
  totalWarnings: number;
  criticalWarnings: number;
  fixableWarnings: number;
  stage: BuildStage;
  framework: FrameworkType;
  timestamp: string;
  version: string; // Storage format version
}

/**
 * Stored warning data structure
 */
export interface StoredWarningData {
  metadata: WarningStorageMetadata;
  warnings: BuildWarningAnalysis[];
  summary: BuildWarningsSummary;
  suggestions: WarningResolutionSuggestion[];
  analytics: {
    warningTrends: WarningTrend[];
    categoryDistribution: Record<WarningCategory, number>;
    severityDistribution: Record<WarningSeverity, number>;
    fixabilityRate: number;
  };
}

/**
 * Warning trend data for analytics
 */
export interface WarningTrend {
  date: string;
  totalWarnings: number;
  criticalWarnings: number;
  category: WarningCategory;
  resolved: number;
}

/**
 * Warning query filters
 */
export interface WarningQueryFilters {
  category?: WarningCategory[];
  severity?: WarningSeverity[];
  stage?: BuildStage[];
  fixable?: boolean;
  dateRange?: {
    start: string;
    end: string;
  };
  limit?: number;
  offset?: number;
}

/**
 * Warning analytics response
 */
export interface WarningAnalytics {
  projectId: string;
  timeRange: {
    start: string;
    end: string;
  };
  summary: {
    totalWarnings: number;
    totalBuilds: number;
    averageWarningsPerBuild: number;
    improvementTrend: 'improving' | 'stable' | 'declining';
  };
  categories: Array<{
    category: WarningCategory;
    count: number;
    trend: 'increasing' | 'stable' | 'decreasing';
    averageResolutionTime: number;
  }>;
  recommendations: string[];
  topIssues: Array<{
    pattern: string;
    occurrences: number;
    category: WarningCategory;
    impact: string;
  }>;
}

/**
 * Warning Storage Manager
 */
export class WarningStorageManager {
  private static readonly STORAGE_VERSION = '1.0';
  private static readonly WARNING_KEY_PREFIX = 'warnings';

  /**
   * Store warning data for a build
   */
  async storeWarnings(
    projectId: string,
    buildId: string,
    warnings: BuildWarningAnalysis[],
    summary: BuildWarningsSummary,
    suggestions: WarningResolutionSuggestion[],
    stage: BuildStage,
    framework: FrameworkType,
    env: Env
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      
      // Create storage metadata
      const metadata: WarningStorageMetadata = {
        projectId,
        buildId,
        totalWarnings: warnings.length,
        criticalWarnings: warnings.filter(w => w.severity === 'critical').length,
        fixableWarnings: warnings.filter(w => w.fixable).length,
        stage,
        framework,
        timestamp,
        version: WarningStorageManager.STORAGE_VERSION
      };

      // Generate analytics data
      const analytics = this.generateAnalytics(warnings, projectId);

      // Create complete warning data structure
      const warningData: StoredWarningData = {
        metadata,
        warnings,
        summary,
        suggestions,
        analytics
      };

      // Store main warning data
      const warningKey = this.generateWarningKey(projectId, buildId, timestamp);
      await env.BUILDS_BUCKET.put(
        warningKey,
        JSON.stringify(warningData, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            build_id: buildId,
            type: 'build_warnings',
            total_warnings: metadata.totalWarnings.toString(),
            critical_warnings: metadata.criticalWarnings.toString(),
            fixable_warnings: metadata.fixableWarnings.toString(),
            stage,
            framework,
            created_at: timestamp
          }
        }
      );

      // Update project warning statistics
      await this.updateProjectWarningStats(projectId, warnings, env);

      console.info(`[WARNING-STORAGE] Stored ${warnings.length} warnings for project ${projectId}, build ${buildId}`);

    } catch (error) {
      console.error('[WARNING-STORAGE] Failed to store warnings:', {
        project_id: projectId,
        build_id: buildId,
        warning_count: warnings.length,
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - warning storage failures shouldn't break build process
    }
  }

  /**
   * Retrieve warnings for a specific build
   */
  async getWarningsForBuild(
    projectId: string,
    buildId: string,
    env: Env
  ): Promise<StoredWarningData | null> {
    try {
      // List warning files for this build
      const keyPattern = `${WarningStorageManager.WARNING_KEY_PREFIX}/${projectId}/${buildId}/`;
      const objects = await env.BUILDS_BUCKET.list({ prefix: keyPattern });

      if (objects.objects.length === 0) {
        return null;
      }

      // Get the most recent warning file (sorted by timestamp)
      const warningObject = objects.objects
        .filter(obj => obj.key.endsWith('.json'))
        .sort((a, b) => b.key.localeCompare(a.key))[0];

      if (!warningObject) {
        return null;
      }

      const stored = await env.BUILDS_BUCKET.get(warningObject.key);
      if (!stored) {
        return null;
      }

      return await stored.json() as StoredWarningData;

    } catch (error) {
      console.error('[WARNING-STORAGE] Failed to retrieve build warnings:', {
        project_id: projectId,
        build_id: buildId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Retrieve warnings for a project with filtering
   */
  async getWarningsForProject(
    projectId: string,
    filters: WarningQueryFilters,
    env: Env
  ): Promise<{
    warnings: BuildWarningAnalysis[];
    metadata: WarningStorageMetadata[];
    totalCount: number;
    filteredCount: number;
  }> {
    try {
      const keyPattern = `${WarningStorageManager.WARNING_KEY_PREFIX}/${projectId}/`;
      const objects = await env.BUILDS_BUCKET.list({ prefix: keyPattern });

      const allWarnings: BuildWarningAnalysis[] = [];
      const allMetadata: WarningStorageMetadata[] = [];

      // Process warning files
      const warningObjects = objects.objects
        .filter(obj => obj.key.endsWith('.json'))
        .sort((a, b) => b.key.localeCompare(a.key));

      // Apply limit if specified
      const processObjects = filters.limit 
        ? warningObjects.slice(0, Math.min(filters.limit, warningObjects.length))
        : warningObjects;

      for (const obj of processObjects) {
        try {
          const stored = await env.BUILDS_BUCKET.get(obj.key);
          if (stored) {
            const warningData = await stored.json() as StoredWarningData;
            
            // Apply date range filter
            if (filters.dateRange) {
              const warningDate = new Date(warningData.metadata.timestamp);
              const startDate = new Date(filters.dateRange.start);
              const endDate = new Date(filters.dateRange.end);
              
              if (warningDate < startDate || warningDate > endDate) {
                continue;
              }
            }

            allMetadata.push(warningData.metadata);
            allWarnings.push(...warningData.warnings);
          }
        } catch (parseError) {
          console.warn(`Failed to parse warning data: ${obj.key}`, parseError);
        }
      }

      // Apply filters
      const filteredWarnings = this.applyWarningFilters(allWarnings, filters);

      return {
        warnings: filteredWarnings,
        metadata: allMetadata,
        totalCount: allWarnings.length,
        filteredCount: filteredWarnings.length
      };

    } catch (error) {
      console.error('[WARNING-STORAGE] Failed to retrieve project warnings:', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        warnings: [],
        metadata: [],
        totalCount: 0,
        filteredCount: 0
      };
    }
  }

  /**
   * Get warning analytics for a project
   */
  async getWarningAnalytics(
    projectId: string,
    timeRange: { start: string; end: string },
    env: Env
  ): Promise<WarningAnalytics> {
    try {
      const filters: WarningQueryFilters = {
        dateRange: timeRange,
        limit: 100 // Reasonable limit for analytics
      };

      const { warnings, metadata } = await this.getWarningsForProject(
        projectId,
        filters,
        env
      );

      const analytics = this.calculateWarningAnalytics(
        projectId,
        warnings,
        metadata,
        timeRange
      );

      return analytics;

    } catch (error) {
      console.error('[WARNING-STORAGE] Failed to generate warning analytics:', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });

      // Return empty analytics on error
      return {
        projectId,
        timeRange,
        summary: {
          totalWarnings: 0,
          totalBuilds: 0,
          averageWarningsPerBuild: 0,
          improvementTrend: 'stable'
        },
        categories: [],
        recommendations: ['No warning data available for analysis'],
        topIssues: []
      };
    }
  }

  /**
   * Clear acknowledged warnings for a project
   */
  async clearAcknowledgedWarnings(
    projectId: string,
    warningIds: string[],
    env: Env
  ): Promise<{ success: boolean; clearedCount: number }> {
    try {
      // For MVP, we'll mark warnings as acknowledged by storing metadata
      // In production, this could involve more sophisticated tracking
      
      const acknowledgmentKey = `${WarningStorageManager.WARNING_KEY_PREFIX}/${projectId}/acknowledgments.json`;
      
      let existingAcks: string[] = [];
      try {
        const existing = await env.BUILDS_BUCKET.get(acknowledgmentKey);
        if (existing) {
          existingAcks = await existing.json() as string[];
        }
      } catch {
        // No existing acknowledgments
      }

      const newAcks = [...new Set([...existingAcks, ...warningIds])];

      await env.BUILDS_BUCKET.put(
        acknowledgmentKey,
        JSON.stringify(newAcks, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            type: 'warning_acknowledgments',
            count: newAcks.length.toString(),
            updated_at: new Date().toISOString()
          }
        }
      );

      return {
        success: true,
        clearedCount: warningIds.length
      };

    } catch (error) {
      console.error('[WARNING-STORAGE] Failed to clear acknowledged warnings:', {
        project_id: projectId,
        warning_ids: warningIds,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        clearedCount: 0
      };
    }
  }

  /**
   * Generate warning key for R2 storage
   */
  private generateWarningKey(projectId: string, buildId: string, timestamp: string): string {
    return `${WarningStorageManager.WARNING_KEY_PREFIX}/${projectId}/${buildId}/${timestamp}.json`;
  }

  /**
   * Apply warning filters
   */
  private applyWarningFilters(
    warnings: BuildWarningAnalysis[],
    filters: WarningQueryFilters
  ): BuildWarningAnalysis[] {
    let filtered = warnings;

    if (filters.category && filters.category.length > 0) {
      filtered = filtered.filter(w => filters.category!.includes(w.category));
    }

    if (filters.severity && filters.severity.length > 0) {
      filtered = filtered.filter(w => filters.severity!.includes(w.severity));
    }

    if (filters.stage && filters.stage.length > 0) {
      filtered = filtered.filter(w => filters.stage!.includes(w.stage));
    }

    if (filters.fixable !== undefined) {
      filtered = filtered.filter(w => w.fixable === filters.fixable);
    }

    // Apply offset and limit
    if (filters.offset) {
      filtered = filtered.slice(filters.offset);
    }

    if (filters.limit) {
      filtered = filtered.slice(0, filters.limit);
    }

    return filtered;
  }

  /**
   * Generate analytics data for storage
   */
  private generateAnalytics(
    warnings: BuildWarningAnalysis[],
    projectId: string
  ): StoredWarningData['analytics'] {
    const categoryDistribution = warnings.reduce((acc, w) => {
      acc[w.category] = (acc[w.category] || 0) + 1;
      return acc;
    }, {} as Record<WarningCategory, number>);

    const severityDistribution = warnings.reduce((acc, w) => {
      acc[w.severity] = (acc[w.severity] || 0) + 1;
      return acc;
    }, {} as Record<WarningSeverity, number>);

    const fixableCount = warnings.filter(w => w.fixable).length;
    const fixabilityRate = warnings.length > 0 ? (fixableCount / warnings.length) * 100 : 0;

    // Generate trend data (simplified for single build)
    const today = new Date().toISOString().split('T')[0];
    const warningTrends: WarningTrend[] = Object.entries(categoryDistribution).map(([category, count]) => ({
      date: today,
      totalWarnings: count,
      criticalWarnings: warnings.filter(w => w.category === category && w.severity === 'critical').length,
      category: category as WarningCategory,
      resolved: 0 // Will be updated when warnings are resolved
    }));

    return {
      warningTrends,
      categoryDistribution,
      severityDistribution,
      fixabilityRate
    };
  }

  /**
   * Calculate comprehensive warning analytics
   */
  private calculateWarningAnalytics(
    projectId: string,
    warnings: BuildWarningAnalysis[],
    metadata: WarningStorageMetadata[],
    timeRange: { start: string; end: string }
  ): WarningAnalytics {
    const totalWarnings = warnings.length;
    const totalBuilds = metadata.length;
    const averageWarningsPerBuild = totalBuilds > 0 ? totalWarnings / totalBuilds : 0;

    // Calculate category stats
    const categoryStats = warnings.reduce((acc, warning) => {
      if (!acc[warning.category]) {
        acc[warning.category] = {
          count: 0,
          totalImpact: 0
        };
      }
      acc[warning.category].count++;
      return acc;
    }, {} as Record<WarningCategory, { count: number; totalImpact: number }>);

    const categories = Object.entries(categoryStats).map(([category, stats]) => ({
      category: category as WarningCategory,
      count: stats.count,
      trend: 'stable' as const, // Simplified for MVP
      averageResolutionTime: 0 // Simplified for MVP
    }));

    // Generate recommendations based on warning patterns
    const recommendations = this.generateAnalyticsRecommendations(warnings, metadata);

    // Find top issues
    const issuePatterns = warnings.reduce((acc, warning) => {
      const pattern = warning.debugInfo.matchedPattern || warning.technicalMessage.substring(0, 100);
      if (!acc[pattern]) {
        acc[pattern] = {
          count: 0,
          category: warning.category,
          impact: warning.estimatedImpact
        };
      }
      acc[pattern].count++;
      return acc;
    }, {} as Record<string, { count: number; category: WarningCategory; impact: string }>);

    const topIssues = Object.entries(issuePatterns)
      .map(([pattern, data]) => ({
        pattern,
        occurrences: data.count,
        category: data.category,
        impact: data.impact
      }))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 5);

    return {
      projectId,
      timeRange,
      summary: {
        totalWarnings,
        totalBuilds,
        averageWarningsPerBuild,
        improvementTrend: 'stable' // Simplified for MVP
      },
      categories,
      recommendations,
      topIssues
    };
  }

  /**
   * Generate analytics-based recommendations
   */
  private generateAnalyticsRecommendations(
    warnings: BuildWarningAnalysis[],
    metadata: WarningStorageMetadata[]
  ): string[] {
    const recommendations: string[] = [];

    if (warnings.length === 0) {
      return ['No warnings detected - excellent code quality!'];
    }

    // Category-based recommendations
    const categoryCounts = warnings.reduce((acc, w) => {
      acc[w.category] = (acc[w.category] || 0) + 1;
      return acc;
    }, {} as Record<WarningCategory, number>);

    const mostCommonCategory = Object.entries(categoryCounts)
      .sort(([,a], [,b]) => b - a)[0];

    if (mostCommonCategory) {
      const [category, count] = mostCommonCategory;
      switch (category) {
        case 'eslint':
          recommendations.push(`${count} ESLint warnings detected - consider running 'eslint --fix' to auto-correct issues`);
          break;
        case 'typescript':
          recommendations.push(`${count} TypeScript warnings found - review type definitions and usage`);
          break;
        case 'dependency':
          recommendations.push(`${count} dependency warnings - consider updating packages with 'npm update'`);
          break;
        case 'performance':
          recommendations.push(`${count} performance warnings - review bundle size and optimization settings`);
          break;
        case 'security':
          recommendations.push(`${count} security warnings - run 'npm audit fix' to address vulnerabilities`);
          break;
      }
    }

    // Severity-based recommendations
    const criticalWarnings = warnings.filter(w => w.severity === 'critical').length;
    if (criticalWarnings > 0) {
      recommendations.push(`${criticalWarnings} critical warnings require immediate attention`);
    }

    // Fixability recommendations
    const fixableWarnings = warnings.filter(w => w.fixable).length;
    const autoFixableWarnings = warnings.filter(w => w.autoFixable).length;
    
    if (autoFixableWarnings > 0) {
      recommendations.push(`${autoFixableWarnings} warnings can be auto-fixed - consider using automated tools`);
    }
    
    if (fixableWarnings > autoFixableWarnings) {
      recommendations.push(`${fixableWarnings - autoFixableWarnings} warnings require manual fixes`);
    }

    return recommendations.slice(0, 5); // Limit to top 5 recommendations
  }

  /**
   * Update project warning statistics
   */
  private async updateProjectWarningStats(
    projectId: string,
    warnings: BuildWarningAnalysis[],
    env: Env
  ): Promise<void> {
    try {
      const statsKey = `projects/${projectId}/warning-stats.json`;
      
      // Get existing stats
      let stats = {
        projectId,
        totalBuildsAnalyzed: 0,
        totalWarnings: 0,
        warningsByCategory: {} as Record<WarningCategory, number>,
        warningsBySeverity: {} as Record<WarningSeverity, number>,
        lastAnalyzed: new Date().toISOString()
      };

      try {
        const existing = await env.BUILDS_BUCKET.get(statsKey);
        if (existing) {
          stats = { ...stats, ...await existing.json() };
        }
      } catch {
        // Use default stats
      }

      // Update statistics
      stats.totalBuildsAnalyzed++;
      stats.totalWarnings += warnings.length;
      stats.lastAnalyzed = new Date().toISOString();

      // Update category and severity counts
      warnings.forEach(warning => {
        stats.warningsByCategory[warning.category] = (stats.warningsByCategory[warning.category] || 0) + 1;
        stats.warningsBySeverity[warning.severity] = (stats.warningsBySeverity[warning.severity] || 0) + 1;
      });

      // Store updated statistics
      await env.BUILDS_BUCKET.put(
        statsKey,
        JSON.stringify(stats, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            type: 'warning_statistics',
            total_warnings: stats.totalWarnings.toString(),
            builds_analyzed: stats.totalBuildsAnalyzed.toString(),
            updated_at: stats.lastAnalyzed
          }
        }
      );

    } catch (error) {
      console.error('[WARNING-STORAGE] Failed to update project warning stats:', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

/**
 * Create warning storage manager instance
 */
export function createWarningStorageManager(): WarningStorageManager {
  return new WarningStorageManager();
}