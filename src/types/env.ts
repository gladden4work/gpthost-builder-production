/**
 * Environment type definitions for Cloudflare Workers
 * TDD RED phase stub - to be implemented in GREEN phase
 */

import type { R2Bucket, KVNamespace } from '@cloudflare/workers-types';

/**
 * Environment variables and bindings for the Worker
 */
export interface Env {
  // R2 Buckets
  PROJECTS_BUCKET: R2Bucket;
  BUILDS_BUCKET?: R2Bucket;
  SITES_BUCKET?: R2Bucket;

  // Feature Flags
  /**
   * Canonical feature flags JSON string, e.g.
   * '{"useNewStorageService":true,"useMonitoring":false}'
   */
  FEATURE_FLAGS?: string;
  FEATURE_NEW_STORAGE?: string;
  FEATURE_MONITORING?: string;
  FEATURE_DETAILED_LOGGING?: string;
  FEATURE_AUTO_FALLBACK?: string;
  FEATURE_NEW_STORAGE_PERCENTAGE?: string;
  
  // KV Namespaces (for feature flag storage)
  FEATURE_FLAGS_KV?: KVNamespace;
  
  // User context
  USER_ID?: string;
  
  // Other environment variables
  GITHUB_TOKEN?: string;
  GITHUB_ORG?: string;
  GITHUB_REPO?: string;
  ENVIRONMENT?: string;
  DEBUG?: string;
}
