/**
 * Health check endpoint for monitoring GPTHost API status
 */

import { successResponse, errorResponse } from '../utils/responses';
import type { HealthResponse } from '../types/api';

/**
 * GET /api/health - Health check endpoint
 * Returns system status and service availability
 */
export async function healthHandler(request: Request, env: Env): Promise<Response> {
  try {
    // Test R2 bucket connectivity
    const r2Status = await testR2Connectivity(env);

    const healthData: HealthResponse = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      environment: env.ENVIRONMENT || 'staging',
      services: {
        r2_buckets: r2Status,
      },
    };

    return successResponse(healthData);
  } catch (error) {
    return errorResponse(
      'HEALTH_CHECK_FAILED',
      'Health check failed',
      503,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Test R2 bucket connectivity without writing data
 */
async function testR2Connectivity(env: Env): Promise<{ projects: boolean; builds: boolean }> {
  try {
    // Use list operation to test connectivity without writing
    // This is a lightweight operation to verify bucket access
    const projectsTest = env.PROJECTS_BUCKET.list({ limit: 1 });
    const buildsTest = env.BUILDS_BUCKET.list({ limit: 1 });

    const [projectsResult, buildsResult] = await Promise.allSettled([
      projectsTest,
      buildsTest,
    ]);

    return {
      projects: projectsResult.status === 'fulfilled',
      builds: buildsResult.status === 'fulfilled',
    };
  } catch (error) {
    // If any error occurs, mark both as unhealthy
    return {
      projects: false,
      builds: false,
    };
  }
}