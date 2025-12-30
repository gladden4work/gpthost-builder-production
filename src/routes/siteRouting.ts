/**
 * Site Routing
 * 
 * Middleware for serving deployed websites from R2 storage.
 * Handles static file serving, SPA routing, custom domains, and proper fallbacks.
 * 
 * This module serves all non-API requests by:
 * 1. Parsing the URL to extract project ID and file path
 * 2. Serving files from DEPLOYMENTS_BUCKET with proper headers
 * 3. Implementing SPA fallback to index.html for unknown routes
 * 4. Handling 404s gracefully with helpful error pages
 */

import { createDeploymentManager } from '../utils/deploymentManager';
import {
  parseURL,
  getMimeType,
  getCacheControl,
  isPotentialSpaRoute,
  isValidProjectId,
  generateDeploymentPath,
  createDefaultSiteRoutingConfig,
  create404Response,
  createProjectNotFoundResponse,
  createSubdomainNotFoundResponse,
  SECURITY_HEADERS,
  type SiteRoutingConfig,
  type ParsedURL
} from '../utils/urlRouter';
import { maybeInjectResourceProxy, isResourceProxyEnabled } from '../utils/resourceProxy';

/**
 * Site routing options for handling different scenarios
 */
export interface SiteRoutingOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Custom routing configuration */
  config?: Partial<SiteRoutingConfig>;
  /** Enable SPA fallback behavior */
  enableSpaFallback?: boolean;
}

/**
 * Main site routing handler for non-API requests
 * Serves deployed websites from R2 with proper caching and fallbacks
 */
export async function handleSiteRouting(
  request: Request, 
  env: Env, 
  options: SiteRoutingOptions = {}
): Promise<Response | null> {
  const config = { ...createDefaultSiteRoutingConfig(env), ...options.config };
  const debug = options.debug || false;
  const enableSpaFallback = options.enableSpaFallback ?? true;

  try {
    // Parse the incoming URL (async with subdomain routing support)
    const parsed = await parseURL(request, config, env);

    if (debug) {
      console.info('[SITE-ROUTING] Parsed URL:', parsed);
    }

    // Skip API requests - let main router handle them
    if (parsed.isApiRequest) {
      return null; // Let main router handle API requests
    }

    // Handle subdomain routing mode with no project found
    if (parsed.routingMode === 'subdomain' && !parsed.projectId && parsed.subdomain) {
      if (debug) {
        console.info('[SITE-ROUTING] Subdomain not mapped:', parsed.subdomain);
      }
      const baseDomain = env.BASE_DOMAIN || 'gpthost.online';
      return createSubdomainNotFoundResponse(parsed.subdomain, baseDomain);
    }

    // Must have a valid project ID to serve content
    if (!parsed.projectId) {
      if (debug) {
        console.info('[SITE-ROUTING] No project ID found in URL');
      }
      return null; // Let main router handle non-site requests
    }

    // Validate project ID format
    if (!isValidProjectId(parsed.projectId)) {
      if (debug) {
        console.info('[SITE-ROUTING] Invalid project ID format:', parsed.projectId);
      }
      return createProjectNotFoundResponse(parsed.projectId);
    }

    // Check if project exists and is deployed
    const deploymentManager = createDeploymentManager(env);
    const deploymentStatus = await deploymentManager.getDeploymentStatus(parsed.projectId);
    
    if (deploymentStatus.status !== 'deployed') {
      if (debug) {
        console.info('[SITE-ROUTING] Project not deployed:', deploymentStatus);
      }
      return createProjectNotFoundResponse(parsed.projectId);
    }

    // Try to serve the requested file
    const response = await serveFile(env, parsed, config, debug);
    
    // If file not found and SPA fallback is enabled, try index.html
    if (response.status === 404 && enableSpaFallback && isPotentialSpaRoute(parsed.filePath)) {
      if (debug) {
        console.info('[SITE-ROUTING] Attempting SPA fallback for:', parsed.filePath);
      }
      
      // Try serving index.html instead
      const indexParsed: ParsedURL = {
        ...parsed,
        filePath: 'index.html',
        isRootRequest: true
      };
      
      const indexResponse = await serveFile(env, indexParsed, config, debug);
      
      // If index.html exists, serve it for the SPA route
      if (indexResponse.status === 200) {
        return indexResponse;
      }
    }

    return response;

  } catch (error) {
    console.error('[SITE-ROUTING] Error in site routing:', error);
    
    return new Response('Internal Server Error', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        ...SECURITY_HEADERS
      }
    });
  }
}

/**
 * Serve a specific file from the deployment bucket
 */
async function serveFile(
  env: Env,
  parsed: ParsedURL,
  config: SiteRoutingConfig,
  debug: boolean = false
): Promise<Response> {
  try {
    const deploymentPath = generateDeploymentPath(parsed.projectId!, parsed.filePath, config.pathPrefix);
    
    if (debug) {
      console.info('[SITE-ROUTING] Serving file:', deploymentPath);
    }

    // Get the file from R2
    const object = await env.DEPLOYMENTS_BUCKET.get(deploymentPath);
    
    if (!object) {
      if (debug) {
        console.info('[SITE-ROUTING] File not found:', deploymentPath);
      }
      return create404Response(parsed.projectId!, parsed.filePath);
    }

    // Determine content type and cache headers
    const mimeType = getMimeType(parsed.filePath);
    const cacheControl = getCacheControl(mimeType, parsed.filePath);

    if (mimeType === 'text/html' && isResourceProxyEnabled(env)) {
      const html = await object.text();
      const injected = await maybeInjectResourceProxy(html, parsed.projectId!, env);
      if (injected) {
        return new Response(injected, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Cache-Control': cacheControl,
            'ETag': object.etag || '',
            'Last-Modified': object.uploaded?.toUTCString() || '',
            'X-GPThost-Resource-Proxy': 'injected-at-request-time',
            ...SECURITY_HEADERS
          }
        });
      }
    }
    
    // Stream the file content
    const body = object.body;
    
    if (debug) {
      console.info('[SITE-ROUTING] File served successfully:', {
        path: deploymentPath,
        mimeType,
        size: object.size
      });
    }

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': cacheControl,
        'Content-Length': object.size?.toString() || '',
        'ETag': object.etag || '',
        'Last-Modified': object.uploaded?.toUTCString() || '',
        ...SECURITY_HEADERS
      }
    });

  } catch (error) {
    console.error('[SITE-ROUTING] Error serving file:', error);
    
    return new Response('Internal Server Error', {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        ...SECURITY_HEADERS
      }
    });
  }
}

/**
 * Check if a request should be handled by site routing
 * (i.e., it's not an API request and might be a site request)
 */
export function shouldHandleSiteRouting(request: Request): boolean {
  const url = new URL(request.url);
  const pathname = url.pathname;
  
  // Skip API requests
  if (pathname.startsWith('/api/')) {
    return false;
  }
  
  // Skip common non-site paths
  const skipPaths = [
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml'
  ];
  
  if (skipPaths.includes(pathname)) {
    return false;
  }
  
  // Handle if it looks like a site request
  return pathname.startsWith('/sites/') || pathname.length > 1;
}

/**
 * Middleware wrapper for easy integration with existing router
 */
export function createSiteRoutingMiddleware(options: SiteRoutingOptions = {}) {
  return async (request: Request, env: Env): Promise<Response | null> => {
    if (!shouldHandleSiteRouting(request)) {
      return null; // Let other handlers process this request
    }
    
    return await handleSiteRouting(request, env, options);
  };
}

/**
 * Handle special files that might be requested directly
 */
export async function handleSpecialFiles(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  
  // Handle favicon.ico requests
  if (pathname === '/favicon.ico') {
    return new Response(null, { 
      status: 404,
      headers: {
        'Content-Type': 'image/x-icon',
        'Cache-Control': 'public, max-age=86400', // 1 day
        ...SECURITY_HEADERS
      }
    });
  }
  
  // Handle robots.txt
  if (pathname === '/robots.txt') {
    const robotsTxt = `User-agent: *
Disallow: /api/
Allow: /sites/

Sitemap: https://${url.hostname}/sitemap.xml`;
    
    return new Response(robotsTxt, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'public, max-age=86400', // 1 day
        ...SECURITY_HEADERS
      }
    });
  }
  
  // Handle sitemap.xml (basic implementation)
  if (pathname === '/sitemap.xml') {
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${url.hostname}/</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
    
    return new Response(sitemap, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=86400', // 1 day
        ...SECURITY_HEADERS
      }
    });
  }
  
  return null; // Not a special file
}
