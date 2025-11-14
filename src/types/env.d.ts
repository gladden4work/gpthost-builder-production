/**
 * Environment type definitions for Cloudflare Workers
 */

export interface Env {
  // GitHub Configuration
  GITHUB_TOKEN: string;
  GITHUB_OWNER?: string;
  GITHUB_REPO?: string;
  GITHUB_WORKFLOW?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_CALLBACK_TOKEN?: string;
  
  // Worker Configuration
  WORKER_URL?: string;
  
  // R2 Bindings
  R2_BUCKET?: R2Bucket;
  
  // KV Bindings
  KV_NAMESPACE?: KVNamespace;
  RATE_LIMIT_STORE?: KVNamespace;

  // D1 Bindings
  DB?: D1Database;
  
  // Queue Bindings
  BUILD_QUEUE?: Queue;
  
  // Durable Objects
  PROJECT_STATE?: DurableObjectNamespace;
  
  // Environment
  ENVIRONMENT?: 'development' | 'staging' | 'production';
  
  // Feature Flags
  FEATURE_FLAGS?: string;
  USE_NEW_STORAGE_SERVICE?: string;
  USE_NEW_PROJECT_SERVICE?: string;
  USE_NEW_GITHUB_SERVICE?: string;
  USE_NEW_BUILD_SERVICE?: string;
  USE_NEW_DEPLOY_SERVICE?: string;
  USE_MONITORING?: string;

  // Security Flags (Week 1 Security Audit)
  ENABLE_EMERGENCY_ENDPOINTS?: string;
  ENABLE_DEBUG_ENDPOINTS?: string;

  // Logging Configuration (Week 2 Security Audit)
  LOG_LEVEL?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  PII_LOGGING_ENABLED?: string;

  // CORS Configuration
  ALLOWED_ORIGINS?: string;
}