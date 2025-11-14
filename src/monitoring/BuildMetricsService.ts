/**
 * BuildMetricsService - Specialized monitoring for build status lag and performance
 * Part of Day 3 Critical Issues Implementation
 * Tracks build duration, status transitions, and detects anomalies
 */

import { ServiceMetrics } from './ServiceMetrics';

// Type definitions
export type BuildStatus = 'pending' | 'building' | 'completed' | 'failed' | 'timeout';

export interface BuildLagMetrics {
  buildId: string;
  projectId: string;
  statusTransitionLag: number; // milliseconds between status changes
  githubCallbackLag?: number; // milliseconds from GitHub completion to callback received
  totalBuildTime: number; // milliseconds from created to completed
  isStuck: boolean;
  stuckDuration?: number; // milliseconds stuck in current state
}

export interface BuildPerformanceMetrics {
  averageBuildTime: number;
  p95BuildTime: number;
  successRate: number;
  timeoutRate: number;
  stuckBuildsCount: number;
  totalBuilds: number;
}

export interface AlertThresholds {
  maxBuildDurationMinutes: number;
  maxStatusLagSeconds: number;
  minSuccessRate: number;
  maxStuckBuilds: number;
}

export class BuildMetricsService {
  private static buildMetrics = new Map<string, BuildLagMetrics>();
  private static performanceHistory: number[] = [];
  private static readonly MAX_HISTORY_SIZE = 1000;
  
  // Default alert thresholds
  private static alertThresholds: AlertThresholds = {
    maxBuildDurationMinutes: 30,
    maxStatusLagSeconds: 60,
    minSuccessRate: 0.9,
    maxStuckBuilds: 5
  };

  /**
   * Record build start event
   */
  static recordBuildStart(buildId: string, projectId: string): void {
    const now = Date.now();
    this.buildMetrics.set(buildId, {
      buildId,
      projectId,
      statusTransitionLag: 0,
      totalBuildTime: 0,
      isStuck: false
    });
    
    // Record in ServiceMetrics for aggregation
    ServiceMetrics.recordOperation('BuildService', 'startBuild', 0, true);
  }

  /**
   * Record build status transition
   */
  static recordStatusTransition(
    buildId: string, 
    fromStatus: BuildStatus, 
    toStatus: BuildStatus,
    transitionTime: number
  ): void {
    const metrics = this.buildMetrics.get(buildId);
    if (metrics) {
      metrics.statusTransitionLag = transitionTime;
      
      // Detect if build is stuck
      if (transitionTime > this.alertThresholds.maxStatusLagSeconds * 1000) {
        metrics.isStuck = true;
        metrics.stuckDuration = transitionTime;
      }
      
      this.buildMetrics.set(buildId, metrics);
      
      // Record transition in ServiceMetrics
      ServiceMetrics.recordOperation(
        'BuildService', 
        `transition_${fromStatus}_to_${toStatus}`, 
        transitionTime, 
        true
      );
    }
  }

  /**
   * Record GitHub callback received
   */
  static recordGitHubCallback(
    buildId: string, 
    githubCompletedAt: Date, 
    callbackReceivedAt: Date = new Date()
  ): void {
    const metrics = this.buildMetrics.get(buildId);
    if (metrics) {
      const lag = callbackReceivedAt.getTime() - githubCompletedAt.getTime();
      metrics.githubCallbackLag = lag;
      this.buildMetrics.set(buildId, metrics);
      
      // Record callback lag
      ServiceMetrics.recordOperation('GitHub', 'callbackLag', lag, true);
    }
  }

  /**
   * Record build completion
   */
  static recordBuildComplete(
    buildId: string, 
    success: boolean, 
    startTime: Date, 
    endTime: Date = new Date()
  ): void {
    const duration = endTime.getTime() - startTime.getTime();
    
    const metrics = this.buildMetrics.get(buildId);
    if (metrics) {
      metrics.totalBuildTime = duration;
      metrics.isStuck = false; // Build completed, not stuck
      this.buildMetrics.set(buildId, metrics);
    }
    
    // Add to performance history
    this.performanceHistory.push(duration);
    if (this.performanceHistory.length > this.MAX_HISTORY_SIZE) {
      this.performanceHistory.shift();
    }
    
    // Record in ServiceMetrics
    ServiceMetrics.recordOperation('BuildService', 'completeBuild', duration, success);
  }

  /**
   * Get build lag metrics for a specific build
   */
  static getBuildMetrics(buildId: string): BuildLagMetrics | null {
    return this.buildMetrics.get(buildId) || null;
  }

  /**
   * Get overall build performance metrics
   */
  static getPerformanceMetrics(): BuildPerformanceMetrics {
    const metrics = ServiceMetrics.getMetrics();
    
    // Calculate average build time
    const avgBuildTime = this.performanceHistory.length > 0
      ? this.performanceHistory.reduce((a, b) => a + b, 0) / this.performanceHistory.length
      : 0;
    
    // Calculate P95 build time
    const sortedTimes = [...this.performanceHistory].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedTimes.length * 0.95);
    const p95BuildTime = sortedTimes[p95Index] || 0;
    
    // Calculate success rate
    const successCount = metrics['BuildService.completeBuild.success.count'] || 0;
    const failureCount = metrics['BuildService.completeBuild.failure.count'] || 0;
    const totalBuilds = successCount + failureCount;
    const successRate = totalBuilds > 0 ? successCount / totalBuilds : 0;
    
    // Count stuck builds
    let stuckBuildsCount = 0;
    for (const [, buildMetrics] of this.buildMetrics) {
      if (buildMetrics.isStuck) {
        stuckBuildsCount++;
      }
    }
    
    // Calculate timeout rate
    const timeoutCount = Array.from(this.buildMetrics.values())
      .filter(m => m.totalBuildTime > this.alertThresholds.maxBuildDurationMinutes * 60 * 1000)
      .length;
    const timeoutRate = totalBuilds > 0 ? timeoutCount / totalBuilds : 0;
    
    return {
      averageBuildTime: avgBuildTime,
      p95BuildTime,
      successRate,
      timeoutRate,
      stuckBuildsCount,
      totalBuilds
    };
  }

  /**
   * Check if alerts should be triggered
   */
  static checkAlerts(): Alert[] {
    const alerts: Alert[] = [];
    const performance = this.getPerformanceMetrics();
    
    // Check success rate
    if (performance.successRate < this.alertThresholds.minSuccessRate) {
      alerts.push({
        type: 'LOW_SUCCESS_RATE',
        severity: 'HIGH',
        message: `Build success rate (${(performance.successRate * 100).toFixed(1)}%) is below threshold (${this.alertThresholds.minSuccessRate * 100}%)`,
        value: performance.successRate,
        threshold: this.alertThresholds.minSuccessRate
      });
    }
    
    // Check stuck builds
    if (performance.stuckBuildsCount > this.alertThresholds.maxStuckBuilds) {
      alerts.push({
        type: 'STUCK_BUILDS',
        severity: 'CRITICAL',
        message: `${performance.stuckBuildsCount} builds are stuck (threshold: ${this.alertThresholds.maxStuckBuilds})`,
        value: performance.stuckBuildsCount,
        threshold: this.alertThresholds.maxStuckBuilds
      });
    }
    
    // Check average build time
    const maxBuildTimeMs = this.alertThresholds.maxBuildDurationMinutes * 60 * 1000;
    if (performance.averageBuildTime > maxBuildTimeMs) {
      alerts.push({
        type: 'HIGH_BUILD_TIME',
        severity: 'MEDIUM',
        message: `Average build time (${Math.round(performance.averageBuildTime / 60000)} min) exceeds threshold (${this.alertThresholds.maxBuildDurationMinutes} min)`,
        value: performance.averageBuildTime,
        threshold: maxBuildTimeMs
      });
    }
    
    // Check for builds with high callback lag
    for (const [buildId, metrics] of this.buildMetrics) {
      if (metrics.githubCallbackLag && 
          metrics.githubCallbackLag > this.alertThresholds.maxStatusLagSeconds * 1000) {
        alerts.push({
          type: 'CALLBACK_LAG',
          severity: 'HIGH',
          message: `Build ${buildId} has high GitHub callback lag (${Math.round(metrics.githubCallbackLag / 1000)}s)`,
          value: metrics.githubCallbackLag,
          threshold: this.alertThresholds.maxStatusLagSeconds * 1000,
          buildId
        });
      }
    }
    
    return alerts;
  }

  /**
   * Update alert thresholds
   */
  static setAlertThresholds(thresholds: Partial<AlertThresholds>): void {
    this.alertThresholds = {
      ...this.alertThresholds,
      ...thresholds
    };
  }

  /**
   * Get current alert thresholds
   */
  static getAlertThresholds(): AlertThresholds {
    return { ...this.alertThresholds };
  }

  /**
   * Clear metrics for a specific build
   */
  static clearBuildMetrics(buildId: string): void {
    this.buildMetrics.delete(buildId);
  }

  /**
   * Clear all metrics
   */
  static clearAll(): void {
    this.buildMetrics.clear();
    this.performanceHistory = [];
    ServiceMetrics.clear();
  }

  /**
   * Export metrics for external monitoring systems
   */
  static exportMetrics(): {
    buildMetrics: Record<string, BuildLagMetrics>;
    performanceMetrics: BuildPerformanceMetrics;
    alerts: Alert[];
    serviceMetrics: Record<string, number>;
  } {
    const buildMetricsObj: Record<string, BuildLagMetrics> = {};
    for (const [id, metrics] of this.buildMetrics) {
      buildMetricsObj[id] = metrics;
    }
    
    return {
      buildMetrics: buildMetricsObj,
      performanceMetrics: this.getPerformanceMetrics(),
      alerts: this.checkAlerts(),
      serviceMetrics: ServiceMetrics.getMetrics()
    };
  }
}

export interface Alert {
  type: 'LOW_SUCCESS_RATE' | 'STUCK_BUILDS' | 'HIGH_BUILD_TIME' | 'CALLBACK_LAG';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  value: number;
  threshold: number;
  buildId?: string;
}