/**
 * Feature flag parsing utility
 * Supports canonical FEATURE_FLAGS JSON and legacy flat env flags.
 */

import type { Env } from '../types/env';

export interface FeatureFlags {
  useNewStorageService: boolean;
  useMonitoring: boolean;
  // Additional flags can be added over time without breaking callers
  useNewProjectService?: boolean;
  useNewGitHubService?: boolean;
  useNewBuildService?: boolean;
  useNewDeployService?: boolean;
}

export function getFeatureFlags(env: Env): FeatureFlags {
  // Preferred: parse canonical JSON from FEATURE_FLAGS
  if (env.FEATURE_FLAGS) {
    try {
      const parsed = JSON.parse(env.FEATURE_FLAGS as string);
      return {
        useNewStorageService: !!parsed.useNewStorageService,
        useMonitoring: !!parsed.useMonitoring,
        useNewProjectService: !!parsed.useNewProjectService,
        useNewGitHubService: !!parsed.useNewGitHubService,
        useNewBuildService: !!parsed.useNewBuildService,
        useNewDeployService: !!parsed.useNewDeployService,
      };
    } catch (error) {
      // Malformed JSON → fall through to env fallback with safe defaults
      if (env.ENVIRONMENT === 'development' || env.DEBUG === 'true') {
        console.warn('Failed to parse FEATURE_FLAGS, using legacy env fallbacks:', error);
      }
    }
  }

  // Fallback: flat env vars (legacy), defaulting to false
  return {
    useNewStorageService: env.FEATURE_NEW_STORAGE === 'true',
    useMonitoring: env.FEATURE_MONITORING === 'true',
    // The following are present for completeness but default to false unless explicitly enabled
    useNewProjectService: (env as any).FEATURE_NEW_PROJECT === 'true',
    useNewGitHubService: (env as any).FEATURE_NEW_GITHUB === 'true',
    useNewBuildService: (env as any).FEATURE_NEW_BUILD === 'true',
    useNewDeployService: (env as any).FEATURE_NEW_DEPLOY === 'true',
  };
}

