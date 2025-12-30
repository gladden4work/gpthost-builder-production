/**
 * Environment type definitions for Cloudflare Workers
 * TDD RED phase stub - to be implemented in GREEN phase
 */

import type { R2Bucket, KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { ManifestDO } from '../durableObjects/ManifestDO';
import type { ProxyProjectUsageDO } from '../durableObjects/ProxyProjectUsageDO';

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
  FEATURE_RESOURCE_PROXY?: string;
  ENABLE_RESOURCE_PROXY?: string;
  RESOURCE_PROXY_SIGNING_SECRET?: string;
  PROXY_STATS_BACKEND?: string;
  
  // KV Namespaces (for feature flag storage)
  FEATURE_FLAGS_KV?: KVNamespace;

  /**
   * KV Namespace for subdomain-to-project mappings
   * Used when ENABLE_SUBDOMAIN_ROUTING is enabled
   * Maps: {project-name}-staging → project_id
   */
  SUBDOMAIN_MAPPINGS?: KVNamespace;

  /**
   * KV Namespace for per-owner project manifests
   * Used for fast dashboard loading without R2 enumeration
   * Key format: project_list:<ownerId>
   */
  PROJECT_LIST_MANIFEST?: KVNamespace;

  /**
   * Feature flag for manifest-based project list
   * Default: "false" (uses legacy R2 enumeration)
   * When "true", uses KV manifest for fast dashboard loading
   */
  ENABLE_PROJECT_MANIFEST?: string;

  /**
   * Feature flag for manifest drift detection cron
   * Default: "false" (disabled)
   * When "true", nightly cron checks for manifest/R2 drift
   */
  ENABLE_MANIFEST_DRIFT_CHECK?: string;

  // User context
  USER_ID?: string;

  // Subdomain Routing (Phase 0) - Feature Flags
  /**
   * Enable subdomain-based routing for projects
   * Default: "false" (disabled)
   * When enabled, projects are accessible via {subdomain}.gpthost.online
   * When disabled, projects use path-based routing: /sites/{project-id}/
   */
  ENABLE_SUBDOMAIN_ROUTING?: string;  // "true" | "false"

  /**
   * Base domain for subdomain routing
   * Examples: "gpthost.online", "staging.gpthost.online"
   */
  BASE_DOMAIN?: string;

  /**
   * Subdomain suffix for environment-specific routing
   * Examples: "-staging", "-dev", "" (empty for production)
   * Used to generate patterns like: {project-name}-staging.gpthost.online
   */
  SUBDOMAIN_SUFFIX?: string;

  // Other environment variables
  GITHUB_TOKEN?: string;
  GITHUB_ORG?: string;
  GITHUB_REPO?: string;
  ENVIRONMENT?: string;
  DEBUG?: string;

  // Durable Objects
  /**
   * Durable Object namespace for atomic manifest operations
   * Phase 4: ManifestDO provides true atomic updates with SQLite storage
   * Eliminates race conditions from KV-based CAS approach
   */
  MANIFEST_DO?: DurableObjectNamespace<ManifestDO>;
  PROXY_USAGE_DO?: DurableObjectNamespace<ProxyProjectUsageDO>;
}
