/**
 * Utility for generating Worker URLs consistently across the application
 * 
 * CRITICAL: Always use Workers URL for serving content, never direct R2 URLs
 * R2 public buckets cannot handle path-based routing like /sites/{projectId}/
 * All traffic must go through Workers which handles the routing logic
 */

/**
 * Get the base Worker URL for the current environment
 */
export function getWorkerUrl(env: Env): string {
  // First priority: Use explicitly configured WORKER_URL
  if (env.WORKER_URL) {
    return env.WORKER_URL;
  }

  // Second priority: Extract from GitHub callback URL if available
  const callbackUrl = env.GITHUB_BUILD_CALLBACK_URL;
  if (callbackUrl && callbackUrl.includes('workers.dev')) {
    try {
      const url = new URL(callbackUrl);
      return `${url.protocol}//${url.host}`;
    } catch (e) {
      // Fall through to environment-based logic
    }
  }

  // Third priority: Determine from environment
  const environment = env.ENVIRONMENT || 'development';
  
  switch (environment) {
    case 'production':
      return 'https://gpthost-builder.gladden4work.workers.dev';
    case 'staging':
      return 'https://gpthost-builder-staging.gladden4work.workers.dev';
    case 'development':
    default:
      return 'http://localhost:8787';
  }
}

/**
 * Generate a deployment URL for a project
 */
export function getDeploymentUrl(projectId: string, env: Env): string {
  const workerUrl = getWorkerUrl(env);
  return `${workerUrl}/sites/${projectId}/`;
}

/**
 * Generate a build artifact URL for a project
 */
export function getBuildUrl(projectId: string, env: Env): string {
  const workerUrl = getWorkerUrl(env);
  return `${workerUrl}/builds/${projectId}/`;
}