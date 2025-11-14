/**
 * Test Environment Strategy for GPTHost MVP
 * 
 * This file defines the test environment configurations for different test types,
 * enabling proper Test-Driven Development with functional validation.
 */

import { vi } from 'vitest';

// Type definitions for our test environments
export interface TestEnvironment {
  type: 'unit' | 'integration' | 'e2e';
  description: string;
  storageType: 'mock' | 'miniflare' | 'persistent';
  realNetworking: boolean;
  realBuildQueue: boolean;
}

// Test Environment Configurations
export const TEST_ENVIRONMENTS: Record<string, TestEnvironment> = {
  unit: {
    type: 'unit',
    description: 'Isolated unit tests with simple mocks',
    storageType: 'mock',
    realNetworking: false,
    realBuildQueue: false,
  },
  integration: {
    type: 'integration',
    description: 'Integration tests with functional R2 simulation',
    storageType: 'miniflare',
    realNetworking: false,
    realBuildQueue: true,
  },
  e2e: {
    type: 'e2e',
    description: 'End-to-end tests with persistent R2 and real deployment flow',
    storageType: 'persistent',
    realNetworking: true,
    realBuildQueue: true,
  },
};

/**
 * Create Mock Environment for Unit Tests
 * Uses simple vi.fn() mocks that don't actually store data
 */
export function createUnitTestEnv(): any {
  const createR2BucketMock = () => ({
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue({ objects: [] }),
    delete: vi.fn().mockResolvedValue(undefined),
    head: vi.fn().mockResolvedValue(null),
  });

  const createQueueMock = () => ({
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue(undefined),
  });

  return {
    ENVIRONMENT: 'test',
    MAX_FILE_SIZE: '104857600',
    SUPPORTED_EXTENSIONS: '.html,.jsx,.tsx,.vue,.svelte',
    PROJECTS_BUCKET: createR2BucketMock(),
    BUILDS_BUCKET: createR2BucketMock(),
    DEPLOYMENTS_BUCKET: createR2BucketMock(),
    BUILD_QUEUE: createQueueMock(),
    MVP_ACCESS_TOKEN: 'test-valid-token-12345',
  };
}

/**
 * Create Integration Test Environment
 * Uses miniflare R2 simulation that behaves like real R2 but without persistence
 */
export function createIntegrationTestEnv(): any {
  // Note: In vitest.config.mts, miniflare is configured to provide
  // functional R2 buckets that actually store/retrieve data during tests
  return {
    ENVIRONMENT: 'test-integration',
    MAX_FILE_SIZE: '104857600',
    SUPPORTED_EXTENSIONS: '.html,.jsx,.tsx,.vue,.svelte',
    // R2 buckets will be provided by miniflare
    MVP_ACCESS_TOKEN: 'test-valid-token-12345',
    DEPLOYMENT_DOMAIN: 'test-deployments.r2.dev',
  };
}

/**
 * Create E2E Test Environment
 * Uses persistent miniflare R2 and enables real deployment testing
 */
export function createE2ETestEnv(): any {
  // Note: In vitest.config.mts, miniflare is configured with r2Persist
  // to maintain data across test runs for proper E2E validation
  return {
    ENVIRONMENT: 'test-e2e',
    MAX_FILE_SIZE: '104857600',
    SUPPORTED_EXTENSIONS: '.html,.jsx,.tsx,.vue,.svelte',
    // R2 buckets will be provided by miniflare with persistence
    MVP_ACCESS_TOKEN: 'test-valid-token-12345',
    DEPLOYMENT_DOMAIN: 'test-deployments.r2.dev',
    // Enable real build processing for E2E tests
    GITHUB_REPOSITORY: 'test-user/gpthost-builds',
    GITHUB_TOKEN: 'test-github-token',
  };
}

/**
 * Helper to get appropriate environment based on test type
 */
export function getTestEnvironment(testType: 'unit' | 'integration' | 'e2e'): any {
  switch (testType) {
    case 'unit':
      return createUnitTestEnv();
    case 'integration':
      return createIntegrationTestEnv();
    case 'e2e':
      return createE2ETestEnv();
    default:
      throw new Error(`Unknown test type: ${testType}`);
  }
}

/**
 * Test Data Cleanup Helpers
 */
export class TestDataManager {
  private static readonly TEST_R2_PREFIX = 'test-';
  
  /**
   * Clean up test data from R2 buckets
   * Only affects data with test prefix for safety
   */
  static async cleanupTestData(env: any): Promise<void> {
    if (!env.PROJECTS_BUCKET) return;
    
    try {
      // List all objects with test prefix
      const objects = await env.PROJECTS_BUCKET.list({
        prefix: this.TEST_R2_PREFIX,
      });
      
      // Delete test objects
      const deletePromises = objects.objects.map((obj: any) =>
        env.PROJECTS_BUCKET.delete(obj.key)
      );
      
      await Promise.all(deletePromises);
    } catch (error) {
      console.warn('Test cleanup failed:', error);
      // Don't fail tests on cleanup errors
    }
  }
  
  /**
   * Generate test project ID with proper prefix
   */
  static generateTestProjectId(): string {
    return `${this.TEST_R2_PREFIX}project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Test Timeouts by Environment
 */
export const TEST_TIMEOUTS = {
  unit: 5000,      // 5 seconds for unit tests
  integration: 15000,  // 15 seconds for integration tests  
  e2e: 120000,     // 2 minutes for full E2E deployment tests
};

/**
 * Expected Test Outcomes
 * These define what each test type should validate
 */
export const TEST_VALIDATIONS = {
  unit: {
    description: 'Validate isolated function logic',
    requirements: [
      'Functions return expected outputs for given inputs',
      'Error handling works correctly',
      'Type safety is maintained',
    ],
  },
  integration: {
    description: 'Validate component interactions work correctly',
    requirements: [
      'API endpoints process requests correctly',
      'Data flows properly between handlers',
      'R2 storage operations succeed',
      'Build queue processing works',
    ],
  },
  e2e: {
    description: 'Validate complete user workflows',
    requirements: [
      'Upload → Scaffold → Build → Deploy flow works',
      'Deployed sites are accessible and functional',
      'Performance meets <90 second requirement',
      'Error recovery and retry mechanisms work',
      '85%+ success rate with AI components',
    ],
  },
};

export default {
  TEST_ENVIRONMENTS,
  createUnitTestEnv,
  createIntegrationTestEnv,
  createE2ETestEnv,
  getTestEnvironment,
  TestDataManager,
  TEST_TIMEOUTS,
  TEST_VALIDATIONS,
};

/**
 * Day 5 TDD Helpers (Option A - Centralized Bootstrap)
 * Provides a single, canonical way to configure env + seed data
 * to match the multi-bucket architecture used by DeployService.
 */

export interface Day5BootstrapOptions {
  projectId: string;
  buildId: string;
  projectName?: string;
  framework?: 'react' | 'vue' | 'svelte' | 'unknown';
  artifactIndexHtml?: string;
}

/** Build canonical FEATURE_FLAGS JSON string enabling Day 5 services */
export function buildDay5FeatureFlags(): string {
  return JSON.stringify({
    useNewStorageService: true,
    useMonitoring: false,
    useNewProjectService: true,
    useNewGitHubService: true,
    useNewBuildService: true,
    useNewDeployService: true,
  });
}

/** Apply Day 5 feature flags and test environment baseline */
export function applyDay5Flags(env: any): void {
  env.ENVIRONMENT = env.ENVIRONMENT || 'test';
  env.FEATURE_FLAGS = buildDay5FeatureFlags();
  env.MVP_ACCESS_TOKEN = env.MVP_ACCESS_TOKEN || 'test-token';
}

/** Seed a project metadata document into PROJECTS_BUCKET */
export async function seedProjectMetadata(
  env: any,
  projectId: string,
  overrides: Partial<any> = {}
): Promise<void> {
  const now = new Date().toISOString();
  const metadata = {
    id: projectId,
    name: overrides.name || `project-${projectId}`,
    framework: overrides.framework || 'react',
    status: overrides.status || 'built',
    buildStatus: overrides.buildStatus || 'completed',
    currentBuildId: overrides.currentBuildId,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    ...overrides,
  };
  await env.PROJECTS_BUCKET.put(`projects/${projectId}/metadata.json`, JSON.stringify(metadata));
}

/** Seed a successful build metadata document under PROJECTS_BUCKET */
export async function seedBuildSuccess(
  env: any,
  buildId: string,
  projectId: string,
  artifactPath?: string
): Promise<void> {
  const now = new Date().toISOString();
  const meta = {
    id: buildId,
    projectId,
    status: 'success',
    startTime: now,
    endTime: now,
    artifactPath: artifactPath || `builds/${buildId}/dist/`,
  };
  await env.PROJECTS_BUCKET.put(`builds/${buildId}/metadata.json`, JSON.stringify(meta));
}

/** Seed a build artifact file into PROJECTS_BUCKET under builds/{id}/dist/ */
export async function seedArtifact(
  env: any,
  buildId: string,
  relPath: string,
  body: string | ArrayBuffer,
  contentType?: string
): Promise<void> {
  const key = `builds/${buildId}/dist/${relPath.replace(/^\/+/, '')}`;
  if (typeof body === 'string') {
    await env.PROJECTS_BUCKET.put(key, body, contentType ? { httpMetadata: { contentType } } : undefined);
  } else {
    await env.PROJECTS_BUCKET.put(key, body, contentType ? { httpMetadata: { contentType } } : undefined);
  }
}

/**
 * Bootstrap a unit test environment for Day 5 (Deploy + API v2)
 * - Creates env with all three buckets
 * - Applies Day 5 feature flags
 * - Seeds project metadata, successful build, and index.html artifact
 */
export async function bootstrapDay5UnitEnv(opts: Day5BootstrapOptions): Promise<any> {
  const env = createUnitTestEnv();
  applyDay5Flags(env);

  const projectId = opts.projectId;
  const buildId = opts.buildId;
  const framework = opts.framework || 'react';
  const indexHtml = opts.artifactIndexHtml || '<html><head><title>Test</title></head><body>OK</body></html>';

  await seedProjectMetadata(env, projectId, {
    name: opts.projectName || `project-${projectId}`,
    framework,
    status: 'built',
    buildStatus: 'completed',
    currentBuildId: buildId,
  });

  await seedBuildSuccess(env, buildId, projectId);
  await seedArtifact(env, buildId, 'index.html', indexHtml, 'text/html');

  return env;
}
