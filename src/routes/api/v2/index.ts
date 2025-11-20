/**
 * API v2 Main Router
 * Aggregates all v2 API endpoints
 * Based on DAY5-TDD-STRATEGY.md specifications
 */

import { handleV2Deploy } from './deploy';
import { handleGitHubCallback } from './github';
import { handleBuildUpload } from './github/upload';
import { handleV2CreateProject, handleV2GetProject } from './projects';
import { handleV2QueueBuild, handleV2GetBuildStatus } from './build';
import { handleV2SubdomainCheck, handleV2SubdomainReserve, handleV2SubdomainGet, handleV2SubdomainDelete } from './subdomains';
import { v2Error } from '../../../middleware/envelope';

/**
 * Route v2 API requests to appropriate handlers
 */
export async function routeV2Api(
  request: Request, 
  env: Env,
  path: string
): Promise<Response> {
  const method = request.method;
  
  // Strip /api/v2 prefix for cleaner routing
  const route = path.replace('/api/v2', '');
  
  // Match routes
  if (route === '/deploy' && method === 'POST') {
    return handleV2Deploy(request, env);
  }
  
  if (route === '/github/build-callback' && method === 'POST') {
    return handleGitHubCallback(request, env);
  }
  
  if (route === '/github/build-callback/upload' && method === 'POST') {
    return handleBuildUpload(request, env);
  }
  
  // Alias for backward compatibility - maps to same handler
  if (route === '/github/upload' && method === 'POST') {
    return handleBuildUpload(request, env);
  }
  
  if (route === '/projects' && method === 'POST') {
    return handleV2CreateProject(request, env);
  }
  
  // Match project ID pattern
  const projectMatch = route.match(/^\/projects\/([^\/]+)$/);
  if (projectMatch && method === 'GET') {
    return handleV2GetProject(request, env, projectMatch[1]);
  }
  
  if (route === '/build' && method === 'POST') {
    return handleV2QueueBuild(request, env);
  }
  
  // Match build ID pattern
  const buildMatch = route.match(/^\/build\/([^\/]+)$/);
  if (buildMatch && method === 'GET') {
    return handleV2GetBuildStatus(request, env, buildMatch[1]);
  }

  // Subdomain routes
  if (route === '/subdomains/check' && method === 'GET') {
    return handleV2SubdomainCheck(request, env);
  }

  if (route === '/subdomains/reserve' && method === 'POST') {
    return handleV2SubdomainReserve(request, env);
  }

  // Match subdomain project pattern
  const subdomainProjectMatch = route.match(/^\/subdomains\/project\/([^\/]+)$/);
  if (subdomainProjectMatch && method === 'GET') {
    return handleV2SubdomainGet(request, env, subdomainProjectMatch[1]);
  }

  // Match subdomain delete pattern
  const subdomainDeleteMatch = route.match(/^\/subdomains\/([^\/]+)$/);
  if (subdomainDeleteMatch && method === 'DELETE') {
    return handleV2SubdomainDelete(request, env, subdomainDeleteMatch[1]);
  }

  // Route not found
  return v2Error('NOT_FOUND', `Route ${method} ${path} not found`, 404);
}