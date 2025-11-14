/**
 * TASK-027: Build Cache Optimization - Intelligent Cache Key Generation
 * 
 * This utility provides intelligent cache key generation strategies for GitHub Actions builds.
 * It creates optimized cache keys based on project dependencies, framework type, and build context.
 * 
 * Features:
 * - Multi-level cache key strategies (exact → partial → fallback)
 * - Framework-aware cache key generation
 * - Dependency fingerprinting for optimal cache granularity
 * - Cache key validation and collision detection
 * - Integration with GitHub Actions cache system
 */

import { FrameworkType } from '../types/api';
import crypto from 'crypto';

/**
 * Cache key configuration for different cache levels
 */
export interface CacheKeyConfig {
  os: string;
  nodeVersion: string;
  framework: FrameworkType;
  projectId: string;
}

/**
 * Cache key strategy definition
 */
export interface CacheKeyStrategy {
  level: 'exact' | 'partial' | 'fallback';
  key: string;
  description: string;
  priority: number;
}

/**
 * Package.json dependency analysis
 */
export interface DependencyFingerprint {
  dependencies_hash: string;
  devDependencies_hash: string;
  framework_deps: string[];
  build_tools: string[];
  ui_libraries: string[];
  dependency_count: number;
}

/**
 * Cache key validation result
 */
export interface CacheKeyValidation {
  is_valid: boolean;
  key_length: number;
  collision_risk: 'low' | 'medium' | 'high';
  recommendations: string[];
}

/**
 * Common framework dependencies for intelligent caching
 */
const FRAMEWORK_DEPENDENCIES = {
  react: [
    'react', 'react-dom', '@types/react', '@types/react-dom',
    '@vitejs/plugin-react', '@vitejs/plugin-react-swc',
    'eslint-plugin-react', 'eslint-plugin-react-hooks',
    'react-router-dom', '@tanstack/react-query'
  ],
  vue: [
    'vue', '@vitejs/plugin-vue', '@vue/eslint-config-typescript',
    'vue-router', 'pinia', '@vueuse/core'
  ],
  svelte: [
    'svelte', '@sveltejs/vite-plugin-svelte', '@sveltejs/kit',
    'svelte-check', '@sveltejs/adapter-auto'
  ],
  html: [
    'vite', 'typescript', '@types/node'
  ],
  unknown: []
};

/**
 * Build tool dependencies that are commonly cached
 */
const BUILD_TOOLS = [
  'vite', 'webpack', 'rollup', 'esbuild', 'typescript', 'tsc',
  'eslint', 'prettier', 'postcss', 'autoprefixer', 'tailwindcss'
];

/**
 * UI library dependencies for enhanced caching
 */
const UI_LIBRARIES = [
  '@radix-ui', '@headlessui', '@chakra-ui', '@material-ui',
  'antd', 'react-bootstrap', 'semantic-ui-react',
  'styled-components', 'emotion', '@emotion',
  'lucide-react', 'react-icons', 'heroicons'
];

/**
 * Intelligent cache key generator for GitHub Actions builds
 */
export class CacheKeyGenerator {
  
  constructor() {
    console.info('✅ [CACHE-KEY-GENERATOR] Initialized intelligent cache key generation system');
  }

  /**
   * Generate multi-level cache key strategies for a project
   */
  generateCacheKeyStrategies(
    config: CacheKeyConfig,
    packageJson?: any,
    packageLockJson?: any
  ): CacheKeyStrategy[] {
    const strategies: CacheKeyStrategy[] = [];

    // Level 1: Exact match strategy (package-lock.json hash)
    if (packageLockJson) {
      const exactKey = this.generateExactCacheKey(config, packageLockJson);
      const validation = this.validateCacheKey(exactKey);
      
      if (validation.is_valid) {
        strategies.push({
          level: 'exact',
          key: exactKey,
          description: 'Exact dependency match based on package-lock.json hash',
          priority: 1
        });
      } else {
        console.warn('❌ [CACHE-KEY-GENERATOR] Invalid exact cache key generated', {
          key: exactKey,
          validation
        });
      }
    }

    // Level 2: Partial match strategy (package.json + framework)
    if (packageJson) {
      const partialKey = this.generatePartialCacheKey(config, packageJson);
      const validation = this.validateCacheKey(partialKey);
      
      if (validation.is_valid) {
        strategies.push({
          level: 'partial',
          key: partialKey,
          description: 'Partial match based on package.json and framework',
          priority: 2
        });
      } else {
        console.warn('❌ [CACHE-KEY-GENERATOR] Invalid partial cache key generated', {
          key: partialKey,
          validation
        });
      }
    }

    // Level 3: Fallback strategy (framework + OS)
    const fallbackKey = this.generateFallbackCacheKey(config);
    const validation = this.validateCacheKey(fallbackKey);
    
    if (validation.is_valid) {
      strategies.push({
        level: 'fallback',
        key: fallbackKey,
        description: 'Framework and OS based fallback cache',
        priority: 3
      });
    } else {
      console.warn('❌ [CACHE-KEY-GENERATOR] Invalid fallback cache key generated', {
        key: fallbackKey,
        validation
      });
    }

    return strategies;
  }

  /**
   * Generate exact cache key based on package-lock.json hash
   */
  private generateExactCacheKey(config: CacheKeyConfig, packageLockJson: any): string {
    // Create a stable hash of package-lock.json content
    const lockfileHash = this.hashObject(packageLockJson);
    
    // Create project-specific cache key with length validation
    const baseKey = `node-modules-v2-${config.os}-${config.nodeVersion}-${config.framework}-${config.projectId}-${lockfileHash}`;
    
    // Ensure key doesn't exceed GitHub Actions limit
    return this.truncateCacheKeyIfNeeded(baseKey);
  }

  /**
   * Generate partial cache key based on package.json dependencies
   */
  private generatePartialCacheKey(config: CacheKeyConfig, packageJson: any): string {
    const fingerprint = this.createDependencyFingerprint(packageJson, config.framework);
    
    // Combine framework-specific dependencies and build tools for partial match
    const partialHash = this.hashString([
      fingerprint.dependencies_hash,
      fingerprint.devDependencies_hash,
      fingerprint.framework_deps.join(','),
      fingerprint.build_tools.join(',')
    ].join('|'));

    const baseKey = `node-modules-v2-${config.os}-${config.nodeVersion}-${config.framework}-${config.projectId}-partial-${partialHash}`;
    
    return this.truncateCacheKeyIfNeeded(baseKey);
  }

  /**
   * Generate fallback cache key for common framework dependencies
   */
  private generateFallbackCacheKey(config: CacheKeyConfig): string {
    const baseKey = `node-modules-v2-${config.os}-${config.nodeVersion}-${config.framework}-${config.projectId}-base`;
    
    return this.truncateCacheKeyIfNeeded(baseKey);
  }

  /**
   * Generate npm cache key strategies
   */
  generateNpmCacheKeys(config: CacheKeyConfig, packageLockJson?: any): CacheKeyStrategy[] {
    const strategies: CacheKeyStrategy[] = [];

    if (packageLockJson) {
      const lockfileHash = this.hashObject(packageLockJson);
      const exactKey = `npm-cache-v1-${config.os}-${config.projectId}-${lockfileHash}`;
      const validation = this.validateCacheKey(exactKey);
      
      if (validation.is_valid) {
        strategies.push({
          level: 'exact',
          key: exactKey,
          description: 'Exact npm cache match',
          priority: 1
        });
      }
    }

    const fallbackKey = `npm-cache-v1-${config.os}-${config.projectId}-${config.nodeVersion}`;
    const validation = this.validateCacheKey(fallbackKey);
    
    if (validation.is_valid) {
      strategies.push({
        level: 'fallback',
        key: fallbackKey,
        description: 'Node version based npm cache',
        priority: 2
      });
    }

    return strategies;
  }

  /**
   * Generate framework-specific cache key strategies
   */
  generateFrameworkCacheKeys(
    config: CacheKeyConfig, 
    packageJson?: any
  ): CacheKeyStrategy[] {
    const strategies: CacheKeyStrategy[] = [];

    if (packageJson) {
      const fingerprint = this.createDependencyFingerprint(packageJson, config.framework);
      const frameworkHash = this.hashString(fingerprint.framework_deps.join('|'));
      const exactKey = `framework-cache-v1-${config.os}-${config.framework}-${config.projectId}-${frameworkHash}`;
      const validation = this.validateCacheKey(exactKey);
      
      if (validation.is_valid) {
        strategies.push({
          level: 'exact',
          key: exactKey,
          description: 'Framework-specific dependency cache',
          priority: 1
        });
      }
    }

    const fallbackKey = `framework-cache-v1-${config.os}-${config.framework}-${config.projectId}`;
    const validation = this.validateCacheKey(fallbackKey);
    
    if (validation.is_valid) {
      strategies.push({
        level: 'fallback',
        key: fallbackKey,
        description: 'Base framework cache',
        priority: 2
      });
    }

    return strategies;
  }

  /**
   * Create dependency fingerprint for intelligent caching decisions
   */
  createDependencyFingerprint(packageJson: any, framework: FrameworkType): DependencyFingerprint {
    const dependencies = packageJson.dependencies || {};
    const devDependencies = packageJson.devDependencies || {};
    const allDeps = { ...dependencies, ...devDependencies };

    // Identify framework-specific dependencies
    const frameworkDeps = FRAMEWORK_DEPENDENCIES[framework] || [];
    const presentFrameworkDeps = frameworkDeps.filter(dep => dep in allDeps);

    // Identify build tools
    const buildTools = BUILD_TOOLS.filter(tool => dep => {
      return dep === tool || dep.includes(tool) || dep.startsWith(tool);
    }).filter(tool => Object.keys(allDeps).some(dep => 
      dep === tool || dep.includes(tool) || dep.startsWith(tool)
    ));

    // Identify UI libraries (by pattern matching)
    const uiLibraries = UI_LIBRARIES.filter(lib => 
      Object.keys(allDeps).some(dep => dep.includes(lib))
    );

    return {
      dependencies_hash: this.hashObject(dependencies),
      devDependencies_hash: this.hashObject(devDependencies),
      framework_deps: presentFrameworkDeps,
      build_tools: buildTools,
      ui_libraries: uiLibraries,
      dependency_count: Object.keys(allDeps).length
    };
  }

  /**
   * Validate cache key quality and detect potential issues
   */
  validateCacheKey(cacheKey: string): CacheKeyValidation {
    const validation: CacheKeyValidation = {
      is_valid: true,
      key_length: cacheKey.length,
      collision_risk: 'low',
      recommendations: []
    };

    // Check key length (GitHub Actions cache key limit is 512 characters)
    if (cacheKey.length > 512) {
      validation.is_valid = false;
      validation.collision_risk = 'high';
      validation.recommendations.push(`Cache key exceeds 512 character limit (${cacheKey.length}/512)`);
      console.error('❌ [CACHE-KEY-GENERATOR] Cache key too long', {
        key: cacheKey,
        length: cacheKey.length,
        limit: 512
      });
    } else if (cacheKey.length > 450) {
      validation.collision_risk = 'medium';
      validation.recommendations.push(`Cache key approaching limit (${cacheKey.length}/512) - consider shortening`);
      console.warn('⚠️ [CACHE-KEY-GENERATOR] Cache key length warning', {
        key: cacheKey,
        length: cacheKey.length
      });
    }

    // Check for invalid characters
    const invalidChars = /[^a-zA-Z0-9\-_\.]/;
    if (invalidChars.test(cacheKey)) {
      validation.is_valid = false;
      validation.recommendations.push('Cache key contains invalid characters (only alphanumeric, dash, underscore, period allowed)');
      console.error('❌ [CACHE-KEY-GENERATOR] Invalid characters in cache key', {
        key: cacheKey,
        invalidChars: cacheKey.match(invalidChars)
      });
    }

    // Check for empty or very short keys
    if (cacheKey.length < 10) {
      validation.is_valid = false;
      validation.recommendations.push('Cache key too short - must be at least 10 characters');
    }

    // Check for sufficient uniqueness
    const uniquenessScore = this.calculateUniquenessScore(cacheKey);
    if (uniquenessScore < 0.5) {
      validation.collision_risk = 'high';
      validation.recommendations.push('Cache key may have high collision risk - consider adding more specificity');
    } else if (uniquenessScore < 0.7) {
      validation.collision_risk = 'medium';
      validation.recommendations.push('Cache key uniqueness could be improved');
    }

    // Log validation results for debugging
    if (!validation.is_valid || validation.collision_risk !== 'low') {
      console.warn('⚠️ [CACHE-KEY-GENERATOR] Cache key validation issues', {
        key: cacheKey,
        validation
      });
    }

    return validation;
  }

  /**
   * Generate optimized cache restore keys for GitHub Actions
   */
  generateRestoreKeys(strategies: CacheKeyStrategy[]): string[] {
    return strategies
      .sort((a, b) => a.priority - b.priority)
      .map(strategy => strategy.key);
  }

  /**
   * Calculate cache key efficiency score based on dependency analysis
   */
  calculateCacheEfficiencyScore(
    fingerprint: DependencyFingerprint,
    framework: FrameworkType
  ): number {
    let score = 0;

    // Framework alignment score (40%)
    const frameworkDeps = FRAMEWORK_DEPENDENCIES[framework] || [];
    const frameworkAlignment = fingerprint.framework_deps.length / Math.max(frameworkDeps.length, 1);
    score += frameworkAlignment * 0.4;

    // Build tool presence score (30%)
    const buildToolScore = Math.min(fingerprint.build_tools.length / 3, 1);
    score += buildToolScore * 0.3;

    // Dependency count score (20%) - favors moderate dependency counts
    const optimalDepCount = 30;
    const depCountScore = 1 - Math.abs(fingerprint.dependency_count - optimalDepCount) / optimalDepCount;
    score += Math.max(depCountScore, 0) * 0.2;

    // UI library presence score (10%)
    const uiLibScore = Math.min(fingerprint.ui_libraries.length / 2, 1);
    score += uiLibScore * 0.1;

    return Math.min(score, 1);
  }

  /**
   * Recommend cache optimizations based on project analysis
   */
  recommendCacheOptimizations(
    fingerprint: DependencyFingerprint,
    framework: FrameworkType
  ): string[] {
    const recommendations: string[] = [];

    // Framework-specific recommendations
    const frameworkDeps = FRAMEWORK_DEPENDENCIES[framework] || [];
    const missingFrameworkDeps = frameworkDeps.filter(
      dep => !fingerprint.framework_deps.includes(dep)
    );

    if (missingFrameworkDeps.length > 0 && framework !== 'unknown') {
      recommendations.push(
        `Consider adding common ${framework} dependencies to improve cache hit rates: ${missingFrameworkDeps.slice(0, 3).join(', ')}`
      );
    }

    // Build tool recommendations
    if (fingerprint.build_tools.length === 0) {
      recommendations.push('No build tools detected - consider adding TypeScript, ESLint, or Vite for better development experience');
    }

    // Dependency count recommendations
    if (fingerprint.dependency_count > 100) {
      recommendations.push('High dependency count may impact cache performance - consider dependency optimization');
    }

    if (fingerprint.dependency_count < 5) {
      recommendations.push('Very few dependencies - cache benefits may be limited');
    }

    return recommendations;
  }

  /**
   * Create stable hash of an object
   */
  private hashObject(obj: any): string {
    // Create a stable string representation of the object
    const stableString = JSON.stringify(obj, Object.keys(obj).sort());
    return this.hashString(stableString);
  }

  /**
   * Create hash of a string
   */
  private hashString(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex').substring(0, 12);
  }

  /**
   * Truncate cache key if it exceeds GitHub Actions limit
   */
  private truncateCacheKeyIfNeeded(cacheKey: string): string {
    const MAX_LENGTH = 512;
    
    if (cacheKey.length <= MAX_LENGTH) {
      return cacheKey;
    }

    // Truncate from the middle to preserve prefix and suffix information
    const prefixLength = Math.floor((MAX_LENGTH - 3) / 2);
    const suffixLength = MAX_LENGTH - prefixLength - 3;
    
    const truncatedKey = cacheKey.substring(0, prefixLength) + '...' + cacheKey.substring(cacheKey.length - suffixLength);
    
    console.warn('⚠️ [CACHE-KEY-GENERATOR] Cache key truncated due to length limit', {
      original: cacheKey,
      originalLength: cacheKey.length,
      truncated: truncatedKey,
      truncatedLength: truncatedKey.length
    });
    
    return truncatedKey;
  }

  /**
   * Calculate uniqueness score for collision detection
   */
  private calculateUniquenessScore(cacheKey: string): number {
    // Enhanced uniqueness score based on character diversity, length, and pattern complexity
    const uniqueChars = new Set(cacheKey).size;
    const lengthScore = Math.min(cacheKey.length / 50, 1);
    const diversityScore = uniqueChars / 36; // max alphanumeric diversity
    
    // Pattern complexity score (rewards hashes and structured data)
    const hasHash = /[a-f0-9]{8,}/.test(cacheKey);
    const hasVersion = /v\d+/.test(cacheKey);
    const hasStructure = cacheKey.split('-').length > 3;
    
    const patternScore = (hasHash ? 0.3 : 0) + (hasVersion ? 0.2 : 0) + (hasStructure ? 0.2 : 0);
    
    return Math.min((lengthScore + diversityScore + patternScore) / 2.5, 1);
  }
}

/**
 * Factory function to create cache key generator
 */
export function createCacheKeyGenerator(): CacheKeyGenerator {
  return new CacheKeyGenerator();
}

/**
 * Utility function to extract cache key config from GitHub Actions context
 */
export function extractCacheKeyConfig(
  os: string,
  nodeVersion: string,
  projectId: string,
  packageJson?: any
): CacheKeyConfig {
  // Detect framework from package.json
  let framework: FrameworkType = 'unknown';
  
  if (packageJson?.dependencies || packageJson?.devDependencies) {
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };

    if (allDeps.react) framework = 'react';
    else if (allDeps.vue) framework = 'vue';
    else if (allDeps.svelte) framework = 'svelte';
    else if (allDeps.vite && !allDeps.react && !allDeps.vue && !allDeps.svelte) {
      framework = 'html';
    }
  }

  return {
    os,
    nodeVersion,
    framework,
    projectId
  };
}

/**
 * Utility function to format cache keys for GitHub Actions workflow
 */
export function formatCacheKeysForWorkflow(strategies: CacheKeyStrategy[]): {
  key: string;
  restoreKeys: string[];
} {
  const primaryStrategy = strategies.find(s => s.level === 'exact') || strategies[0];
  const restoreKeys = strategies
    .filter(s => s !== primaryStrategy)
    .sort((a, b) => a.priority - b.priority)
    .map(s => s.key);

  return {
    key: primaryStrategy.key,
    restoreKeys
  };
}