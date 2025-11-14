/**
 * Test endpoints for development and debugging
 * These endpoints should be removed in production
 */

import { successResponse, errorResponse } from '../utils/responses';

/**
 * GET /test-r2 - Test R2 bucket access by putting and getting a test file
 * This endpoint verifies that both R2 buckets are accessible and working
 */
export async function testR2Handler(request: Request, env: Env): Promise<Response> {
  try {
    const testData = 'R2 bucket access test - ' + new Date().toISOString();
    const testKey = 'test-files/access-test.txt';
    
    // Test Projects Bucket
    console.info('Testing PROJECTS_BUCKET access...');
    await env.PROJECTS_BUCKET.put(testKey, testData);
    const projectsResult = await env.PROJECTS_BUCKET.get(testKey);
    
    // Test Builds Bucket  
    console.info('Testing BUILDS_BUCKET access...');
    await env.BUILDS_BUCKET.put(testKey, testData);
    const buildsResult = await env.BUILDS_BUCKET.get(testKey);
    
    const results = {
      timestamp: new Date().toISOString(),
      projects_bucket: {
        put_success: true,
        get_success: projectsResult !== null,
        data: projectsResult ? await projectsResult.text() : null
      },
      builds_bucket: {
        put_success: true,
        get_success: buildsResult !== null,
        data: buildsResult ? await buildsResult.text() : null
      }
    };
    
    return successResponse(results);
    
  } catch (error) {
    return errorResponse(
      'R2_TEST_FAILED',
      'R2 access test failed',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * GET /message - Simple message endpoint for basic connectivity testing
 */
export async function messageHandler(request: Request, env: Env): Promise<Response> {
  return successResponse({
    message: 'Hello, World!',
    service: 'GPTHost API',
    environment: env.ENVIRONMENT || 'staging',
  });
}

/**
 * GET /random - Generate a random UUID for testing
 */
export async function randomHandler(request: Request, env: Env): Promise<Response> {
  return successResponse({
    uuid: crypto.randomUUID(),
    generated_at: new Date().toISOString(),
  });
}