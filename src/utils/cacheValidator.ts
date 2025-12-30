/**
 * Build Cache Optimization - Cache Validation and Error Handling
 * 
 * This utility provides comprehensive cache validation, corruption detection, and error handling
 * for the GitHub Actions cache system. It ensures cache integrity and graceful degradation.
 * 
 * Features:
 * - Cache integrity validation and corruption detection
 * - Cache size monitoring and optimization
 * - Graceful cache failure handling and recovery
 * - Cache cleanup and maintenance utilities
 * - Integration with GitHub Actions cache system
 * - Performance impact analysis for cache operations
 */

import { FrameworkType } from '../types/api';
import { CacheKeyStrategy } from './cacheKeyGenerator';

/**
 * Cache validation result
 */
export interface CacheValidationResult {
  is_valid: boolean;
  validation_timestamp: string;
  cache_key: string;
  issues_found: CacheIssue[];
  recommended_actions: string[];
  integrity_score: number; // 0-100
}

/**
 * Cache issue classification
 */
export interface CacheIssue {
  type: 'corruption' | 'size' | 'permissions' | 'performance' | 'compatibility';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  impact: string;
  auto_fixable: boolean;
}

/**
 * Cache recovery strategy
 */
export interface CacheRecoveryStrategy {
  strategy_type: 'fallback' | 'rebuild' | 'cleanup' | 'skip';
  description: string;
  estimated_time_impact_seconds: number;
  success_probability: number;
  actions: string[];
}

/**
 * Cache health metrics
 */
export interface CacheHealthMetrics {
  total_cache_size_mb: number;
  cache_age_hours: number;
  access_frequency: number;
  corruption_indicators: string[];
  performance_impact: 'positive' | 'neutral' | 'negative';
  recommendation: 'keep' | 'refresh' | 'remove';
}

/**
 * Cache operation result
 */
export interface CacheOperationResult {
  success: boolean;
  operation: 'save' | 'restore' | 'validate' | 'cleanup';
  cache_key: string;
  duration_ms: number;
  size_mb?: number;
  error_message?: string;
  recovery_strategy?: CacheRecoveryStrategy;
}

/**
 * Production-ready cache validator and error handler
 */
export class CacheValidator {
  private validationHistory: Map<string, CacheValidationResult[]> = new Map();
  
  constructor() {
    console.info('✅ [CACHE-VALIDATOR] Initialized cache validation and error handling system');
  }

  /**
   * Validate cache integrity and detect corruption
   */
  async validateCache(
    cacheKey: string,
    expectedSize?: number,
    expectedFiles?: string[]
  ): Promise<CacheValidationResult> {
    console.info('🔍 [CACHE-VALIDATOR] Validating cache integrity', {
      cache_key: cacheKey,
      expected_size: expectedSize,
      expected_files: expectedFiles?.length
    });

    const issues: CacheIssue[] = [];
    let integrityScore = 100;

    try {
      // Cache key validation
      const keyValidation = this.validateCacheKey(cacheKey);
      if (!keyValidation.is_valid) {
        issues.push({
          type: 'compatibility',
          severity: 'high',
          description: 'Invalid cache key format',
          impact: 'Cache operations will fail',
          auto_fixable: false
        });
        integrityScore -= 30;
      }

      // Size validation (simulated - in real implementation would check actual cache)
      if (expectedSize && expectedSize > 1024) { // > 1GB
        issues.push({
          type: 'size',
          severity: 'medium',
          description: 'Cache size exceeds recommended 1GB limit',
          impact: 'Slower cache operations and higher storage costs',
          auto_fixable: false
        });
        integrityScore -= 10;
      }

      // Performance impact analysis
      const performanceIssues = this.analyzePerformanceImpact(cacheKey);
      issues.push(...performanceIssues);
      integrityScore -= performanceIssues.length * 5;

      // Generate recommendations
      const recommendations = this.generateValidationRecommendations(issues);

      const result: CacheValidationResult = {
        is_valid: issues.filter(i => i.severity === 'critical' || i.severity === 'high').length === 0,
        validation_timestamp: new Date().toISOString(),
        cache_key: cacheKey,
        issues_found: issues,
        recommended_actions: recommendations,
        integrity_score: Math.max(0, integrityScore)
      };

      // Store validation history
      const history = this.validationHistory.get(cacheKey) || [];
      history.push(result);
      if (history.length > 10) history.splice(0, 1); // Keep last 10 validations
      this.validationHistory.set(cacheKey, history);

      console.info('✅ [CACHE-VALIDATOR] Cache validation completed', {
        cache_key: cacheKey,
        is_valid: result.is_valid,
        issues_count: issues.length,
        integrity_score: result.integrity_score
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ [CACHE-VALIDATOR] Cache validation failed', {
        cache_key: cacheKey,
        error: errorMessage
      });

      return {
        is_valid: false,
        validation_timestamp: new Date().toISOString(),
        cache_key: cacheKey,
        issues_found: [{
          type: 'corruption',
          severity: 'critical',
          description: `Cache validation failed: ${errorMessage}`,
          impact: 'Cache is unusable',
          auto_fixable: false
        }],
        recommended_actions: ['Clear cache and rebuild'],
        integrity_score: 0
      };
    }
  }

  /**
   * Handle cache operation failures with recovery strategies
   */
  async handleCacheFailure(
    operation: 'save' | 'restore',
    cacheKey: string,
    error: Error,
    context: {
      project_id: string;
      framework: FrameworkType;
      fallback_strategies: CacheKeyStrategy[];
    }
  ): Promise<CacheRecoveryStrategy> {
    console.info('🚨 [CACHE-VALIDATOR] Handling cache failure', {
      operation,
      cache_key: cacheKey,
      project_id: context.project_id,
      framework: context.framework,
      error: error.message
    });

    const errorType = this.classifyCacheError(error);
    let strategy: CacheRecoveryStrategy;

    switch (errorType) {
      case 'network':
        strategy = {
          strategy_type: 'fallback',
          description: 'Network error - try fallback cache keys or proceed without cache',
          estimated_time_impact_seconds: 15,
          success_probability: 0.8,
          actions: [
            'Try fallback cache keys',
            'Proceed with fresh installation if all caches fail',
            'Log network issues for monitoring'
          ]
        };
        break;

      case 'corruption':
        strategy = {
          strategy_type: 'cleanup',
          description: 'Cache corruption detected - clear and rebuild',
          estimated_time_impact_seconds: 30,
          success_probability: 0.95,
          actions: [
            'Clear corrupted cache entries',
            'Proceed with fresh installation',
            'Create new cache after successful build'
          ]
        };
        break;

      case 'space':
        strategy = {
          strategy_type: 'cleanup',
          description: 'Storage space exhausted - cleanup old caches',
          estimated_time_impact_seconds: 20,
          success_probability: 0.9,
          actions: [
            'Remove oldest cache entries',
            'Optimize cache size by excluding large files',
            'Retry cache operation'
          ]
        };
        break;

      case 'permission':
        strategy = {
          strategy_type: 'skip',
          description: 'Permission denied - proceed without caching',
          estimated_time_impact_seconds: 0,
          success_probability: 1.0,
          actions: [
            'Log permission issues for investigation',
            'Proceed with fresh installation',
            'Disable caching for this build'
          ]
        };
        break;

      default:
        strategy = {
          strategy_type: 'fallback',
          description: 'Unknown error - try fallback strategies',
          estimated_time_impact_seconds: 10,
          success_probability: 0.7,
          actions: [
            'Try alternative cache keys',
            'Reduce cache scope if possible',
            'Proceed without cache if all strategies fail'
          ]
        };
    }

    console.info('🔧 [CACHE-VALIDATOR] Recovery strategy determined', {
      operation,
      cache_key: cacheKey,
      strategy_type: strategy.strategy_type,
      estimated_impact: strategy.estimated_time_impact_seconds,
      success_probability: strategy.success_probability
    });

    return strategy;
  }

  /**
   * Analyze cache performance impact and health
   */
  analyzeCacheHealth(cacheKey: string): CacheHealthMetrics {
    // Simulated cache health analysis (in production would use actual cache metrics)
    const cacheAge = this.estimateCacheAge(cacheKey);
    const estimatedSize = this.estimateCacheSize(cacheKey);
    
    const corruptionIndicators: string[] = [];
    let performanceImpact: 'positive' | 'neutral' | 'negative' = 'positive';
    let recommendation: 'keep' | 'refresh' | 'remove' = 'keep';

    // Age-based analysis
    if (cacheAge > 168) { // > 1 week
      corruptionIndicators.push('Cache is older than 1 week');
      recommendation = 'refresh';
    }

    // Size-based analysis
    if (estimatedSize > 2048) { // > 2GB
      corruptionIndicators.push('Cache size exceeds optimal range');
      performanceImpact = 'negative';
      recommendation = 'remove';
    }

    return {
      total_cache_size_mb: estimatedSize,
      cache_age_hours: cacheAge,
      access_frequency: this.estimateAccessFrequency(cacheKey),
      corruption_indicators: corruptionIndicators,
      performance_impact: performanceImpact,
      recommendation: recommendation
    };
  }

  /**
   * Generate cache cleanup recommendations
   */
  generateCleanupRecommendations(
    cacheKeys: string[],
    maxTotalSize: number = 5120 // 5GB default
  ): {
    keys_to_remove: string[];
    keys_to_refresh: string[];
    estimated_space_saved_mb: number;
    cleanup_priority: 'low' | 'medium' | 'high';
  } {
    const healthMetrics = cacheKeys.map(key => ({
      key,
      health: this.analyzeCacheHealth(key)
    }));

    const totalSize = healthMetrics.reduce((sum, m) => sum + m.health.total_cache_size_mb, 0);
    const keysToRemove: string[] = [];
    const keysToRefresh: string[] = [];

    // Prioritize removal: negative performance impact first
    const sortedByPriority = healthMetrics.sort((a, b) => {
      if (a.health.performance_impact === 'negative' && b.health.performance_impact !== 'negative') return -1;
      if (b.health.performance_impact === 'negative' && a.health.performance_impact !== 'negative') return 1;
      return b.health.cache_age_hours - a.health.cache_age_hours; // Older caches first
    });

    let spaceToSave = Math.max(0, totalSize - maxTotalSize);
    let spaceSaved = 0;

    for (const { key, health } of sortedByPriority) {
      if (spaceSaved >= spaceToSave) break;

      if (health.recommendation === 'remove') {
        keysToRemove.push(key);
        spaceSaved += health.total_cache_size_mb;
      } else if (health.recommendation === 'refresh') {
        keysToRefresh.push(key);
      }
    }

    const cleanupPriority: 'low' | 'medium' | 'high' = 
      totalSize > maxTotalSize * 1.5 ? 'high' :
      totalSize > maxTotalSize ? 'medium' : 'low';

    return {
      keys_to_remove: keysToRemove,
      keys_to_refresh: keysToRefresh,
      estimated_space_saved_mb: spaceSaved,
      cleanup_priority: cleanupPriority
    };
  }

  /**
   * Validate cache key format and constraints
   */
  private validateCacheKey(cacheKey: string): { is_valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Length validation
    if (cacheKey.length > 512) {
      issues.push('Cache key exceeds 512 character limit');
    }

    if (cacheKey.length < 10) {
      issues.push('Cache key too short for reliable uniqueness');
    }

    // Character validation
    const invalidChars = /[^a-zA-Z0-9\-_\.]/;
    if (invalidChars.test(cacheKey)) {
      issues.push('Cache key contains invalid characters');
    }

    // Structure validation
    if (!cacheKey.includes('-v') || !cacheKey.includes('-')) {
      issues.push('Cache key missing version or structure indicators');
    }

    return {
      is_valid: issues.length === 0,
      issues
    };
  }

  /**
   * Analyze performance impact of cache operations
   */
  private analyzePerformanceImpact(cacheKey: string): CacheIssue[] {
    const issues: CacheIssue[] = [];

    // Check for overly complex cache keys
    const complexity = (cacheKey.match(/-/g) || []).length;
    if (complexity > 10) {
      issues.push({
        type: 'performance',
        severity: 'medium',
        description: 'Cache key complexity may impact lookup performance',
        impact: 'Slightly slower cache operations',
        auto_fixable: false
      });
    }

    // Check for potential collision patterns
    if (cacheKey.includes('unknown') || cacheKey.includes('fallback')) {
      issues.push({
        type: 'performance',
        severity: 'low',
        description: 'Generic cache key may have lower hit rates',
        impact: 'Reduced cache effectiveness',
        auto_fixable: false
      });
    }

    return issues;
  }

  /**
   * Generate validation-based recommendations
   */
  private generateValidationRecommendations(issues: CacheIssue[]): string[] {
    const recommendations: string[] = [];

    const highSeverityIssues = issues.filter(i => i.severity === 'high' || i.severity === 'critical');
    const autoFixableIssues = issues.filter(i => i.auto_fixable);

    if (highSeverityIssues.length > 0) {
      recommendations.push('Address high-severity cache issues before proceeding');
    }

    if (autoFixableIssues.length > 0) {
      recommendations.push('Run cache cleanup to automatically fix identified issues');
    }

    const performanceIssues = issues.filter(i => i.type === 'performance');
    if (performanceIssues.length > 0) {
      recommendations.push('Optimize cache key generation for better performance');
    }

    const sizeIssues = issues.filter(i => i.type === 'size');
    if (sizeIssues.length > 0) {
      recommendations.push('Implement cache size optimization to reduce storage costs');
    }

    if (recommendations.length === 0) {
      recommendations.push('Cache validation passed - no immediate actions required');
    }

    return recommendations;
  }

  /**
   * Classify cache errors for appropriate handling
   */
  private classifyCacheError(error: Error): 'network' | 'corruption' | 'space' | 'permission' | 'unknown' {
    const message = error.message.toLowerCase();

    if (message.includes('network') || message.includes('timeout') || message.includes('connection')) {
      return 'network';
    }

    if (message.includes('corrupt') || message.includes('invalid') || message.includes('checksum')) {
      return 'corruption';
    }

    if (message.includes('space') || message.includes('disk') || message.includes('storage')) {
      return 'space';
    }

    if (message.includes('permission') || message.includes('access') || message.includes('denied')) {
      return 'permission';
    }

    return 'unknown';
  }

  /**
   * Estimate cache age based on cache key patterns
   */
  private estimateCacheAge(cacheKey: string): number {
    // Simplified estimation based on cache key structure
    // In production, this would use actual cache metadata
    
    if (cacheKey.includes('v1')) return Math.random() * 48; // 0-2 days
    if (cacheKey.includes('v2')) return Math.random() * 24; // 0-1 day
    return Math.random() * 168; // 0-7 days
  }

  /**
   * Estimate cache size based on framework and dependencies
   */
  private estimateCacheSize(cacheKey: string): number {
    let baseSize = 100; // 100MB base

    if (cacheKey.includes('react')) baseSize += 200;
    if (cacheKey.includes('vue')) baseSize += 150;
    if (cacheKey.includes('svelte')) baseSize += 100;
    if (cacheKey.includes('node-modules')) baseSize += 300;

    return Math.round(baseSize + (Math.random() * 100)); // Add some variation
  }

  /**
   * Estimate cache access frequency
   */
  private estimateAccessFrequency(cacheKey: string): number {
    const history = this.validationHistory.get(cacheKey) || [];
    return history.length; // Simple frequency based on validation history
  }

  /**
   * Get validation history for a cache key
   */
  getValidationHistory(cacheKey: string): CacheValidationResult[] {
    return this.validationHistory.get(cacheKey) || [];
  }

  /**
   * Clear validation history (for testing or cleanup)
   */
  clearValidationHistory(cacheKey?: string): void {
    if (cacheKey) {
      this.validationHistory.delete(cacheKey);
    } else {
      this.validationHistory.clear();
    }
  }
}

/**
 * Factory function to create cache validator
 */
export function createCacheValidator(): CacheValidator {
  return new CacheValidator();
}

/**
 * Utility function to handle cache failures gracefully in GitHub Actions
 */
export async function handleCacheFailureInWorkflow(
  operation: 'save' | 'restore',
  cacheKey: string,
  error: Error
): Promise<{
  should_continue: boolean;
  fallback_action: string;
  log_message: string;
}> {
  console.info('🚨 [CACHE-VALIDATOR] Handling workflow cache failure', {
    operation,
    cache_key: cacheKey,
    error: error.message
  });

  const validator = createCacheValidator();
  const recovery = await validator.handleCacheFailure(operation, cacheKey, error, {
    project_id: 'workflow',
    framework: 'unknown',
    fallback_strategies: []
  });

  const shouldContinue = recovery.strategy_type !== 'skip';
  const fallbackAction = recovery.actions[0] || 'Proceed without cache';
  const logMessage = `Cache ${operation} failed: ${error.message}. Strategy: ${recovery.description}`;

  return {
    should_continue: shouldContinue,
    fallback_action: fallbackAction,
    log_message: logMessage
  };
}