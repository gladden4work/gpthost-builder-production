/**
 * URL Router - TASK-019
 * 
 * Core URL routing utilities for serving deployed websites from R2.
 * Handles parsing of request URLs, project ID extraction, and path resolution
 * for serving static sites with proper fallbacks and SPA support.
 */

/**
 * Parsed URL components for routing
 */
export interface ParsedURL {
  /** Project ID extracted from URL */
  projectId: string | null;
  /** File path within the project */
  filePath: string;
  /** Whether this is likely an API request */
  isApiRequest: boolean;
  /** Whether this is the root/index request for a project */
  isRootRequest: boolean;
  /** Custom domain if applicable */
  customDomain?: string;
}

/**
 * Site routing configuration
 */
export interface SiteRoutingConfig {
  /** Default deployment domain */
  deploymentDomain: string;
  /** Path prefix for deployments (e.g., 'sites') */
  pathPrefix: string;
  /** Enable SPA routing (fallback to index.html) */
  enableSpaRouting: boolean;
  /** Custom domain mappings (domain -> projectId) */
  customDomains?: Map<string, string>;
}

/**
 * MIME type mapping for static assets
 */
const MIME_TYPES: Record<string, string> = {
  // HTML
  '.html': 'text/html',
  '.htm': 'text/html',
  
  // CSS
  '.css': 'text/css',
  '.scss': 'text/css',
  '.sass': 'text/css',
  
  // JavaScript
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'text/javascript',
  '.tsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  
  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  
  // Other assets
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  
  // Vue/Svelte
  '.vue': 'text/javascript',
  '.svelte': 'text/javascript'
};

/**
 * Default MIME type for unknown extensions
 */
const DEFAULT_MIME_TYPE = 'application/octet-stream';

/**
 * Cache control headers for different file types
 */
const CACHE_CONTROL: Record<string, string> = {
  // HTML files - shorter cache for content updates
  'text/html': 'public, max-age=3600, s-maxage=3600', // 1 hour
  
  // Hashed assets - long cache (assumes versioned filenames)
  'text/javascript': 'public, max-age=31536000, s-maxage=31536000, immutable', // 1 year
  'text/css': 'public, max-age=31536000, s-maxage=31536000, immutable', // 1 year
  
  // Images - medium cache
  'image/png': 'public, max-age=86400, s-maxage=86400', // 1 day
  'image/jpeg': 'public, max-age=86400, s-maxage=86400', // 1 day
  'image/gif': 'public, max-age=86400, s-maxage=86400', // 1 day
  'image/svg+xml': 'public, max-age=86400, s-maxage=86400', // 1 day
  'image/webp': 'public, max-age=86400, s-maxage=86400', // 1 day
  
  // Fonts - long cache
  'font/woff': 'public, max-age=31536000, s-maxage=31536000, immutable', // 1 year
  'font/woff2': 'public, max-age=31536000, s-maxage=31536000, immutable', // 1 year
  'font/ttf': 'public, max-age=31536000, s-maxage=31536000, immutable', // 1 year
  
  // Default cache control
  'default': 'public, max-age=3600, s-maxage=3600' // 1 hour
};

/**
 * Security headers for all responses
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;"
};

/**
 * Parse incoming request URL to extract routing information
 */
export function parseURL(request: Request, config: SiteRoutingConfig): ParsedURL {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const hostname = url.hostname;
  
  // Check if this is an API request
  const isApiRequest = pathname.startsWith('/api/');
  
  // Check for custom domain mapping
  let projectId: string | null = null;
  let filePath = '';
  let customDomain: string | undefined;
  
  if (config.customDomains?.has(hostname)) {
    // Custom domain request
    customDomain = hostname;
    projectId = config.customDomains.get(hostname) || null;
    filePath = pathname === '/' ? 'index.html' : pathname.substring(1);
  } else if (!isApiRequest && pathname.startsWith(`/${config.pathPrefix}/`)) {
    // Standard deployment URL: /sites/{project-id}/{file-path}
    const pathSegments = pathname.split('/');
    if (pathSegments.length >= 3) {
      projectId = pathSegments[2];
      filePath = pathSegments.length > 3 
        ? pathSegments.slice(3).join('/')
        : 'index.html';
    }
  }
  
  // Clean up file path
  if (filePath === '' || filePath === '/') {
    filePath = 'index.html';
  }
  
  // Remove leading slash if present
  if (filePath.startsWith('/')) {
    filePath = filePath.substring(1);
  }
  
  return {
    projectId,
    filePath,
    isApiRequest,
    isRootRequest: filePath === 'index.html',
    customDomain
  };
}

/**
 * Determine MIME type from file extension
 */
export function getMimeType(filePath: string): string {
  const extension = getFileExtension(filePath);
  return MIME_TYPES[extension] || DEFAULT_MIME_TYPE;
}

/**
 * Get file extension (including the dot)
 */
export function getFileExtension(filePath: string): string {
  const lastDotIndex = filePath.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === filePath.length - 1) {
    return '';
  }
  return filePath.substring(lastDotIndex).toLowerCase();
}

/**
 * Get appropriate cache control headers for a file
 */
export function getCacheControl(mimeType: string, filePath: string): string {
  // Check if this is a hashed asset (contains hash-like pattern)
  const hasHashPattern = /[a-f0-9]{6,}/i.test(filePath);
  
  if (hasHashPattern && (mimeType === 'text/javascript' || mimeType === 'text/css')) {
    // Hashed JS/CSS files get immutable cache
    return CACHE_CONTROL[mimeType] || CACHE_CONTROL.default;
  }
  
  return CACHE_CONTROL[mimeType] || CACHE_CONTROL.default;
}

/**
 * Check if a file path represents a potential SPA route
 * (no file extension and not a known static asset pattern)
 */
export function isPotentialSpaRoute(filePath: string): boolean {
  // If it has an extension, it's likely a static asset
  if (getFileExtension(filePath)) {
    return false;
  }
  
  // Common SPA route patterns
  const spaRoutePatterns = [
    /^[a-zA-Z0-9-_]+$/, // Single path segment
    /^[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+$/, // Two path segments
    /^[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+$/ // Three path segments
  ];
  
  return spaRoutePatterns.some(pattern => pattern.test(filePath));
}

/**
 * Validate project ID format (UUID)
 */
export function isValidProjectId(projectId: string): boolean {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(projectId);
}

/**
 * Normalize file path for R2 storage
 * Ensures proper path format for R2 object keys
 */
export function normalizeFilePath(filePath: string): string {
  // Remove leading/trailing slashes
  let normalized = filePath.replace(/^\/+|\/+$/g, '');
  
  // Replace consecutive slashes with single slash
  normalized = normalized.replace(/\/+/g, '/');
  
  // Handle empty path
  if (!normalized) {
    normalized = 'index.html';
  }
  
  return normalized;
}

/**
 * Generate deployment path for R2 storage
 */
export function generateDeploymentPath(projectId: string, filePath: string, pathPrefix: string = 'sites'): string {
  const normalizedPath = normalizeFilePath(filePath);
  return `${pathPrefix}/${projectId}/${normalizedPath}`;
}

/**
 * Create default site routing configuration
 */
export function createDefaultSiteRoutingConfig(env: Env): SiteRoutingConfig {
  return {
    deploymentDomain: env.DEPLOYMENT_DOMAIN || 'gpthost-deployments-staging.r2.dev',
    pathPrefix: 'sites',
    enableSpaRouting: true,
    customDomains: new Map()
  };
}

/**
 * Extract project ID from various URL formats
 * Supports both standard deployment URLs and custom domains
 */
export function extractProjectId(request: Request, config: SiteRoutingConfig): string | null {
  const parsed = parseURL(request, config);
  return parsed.projectId;
}

/**
 * Check if request is for a static asset
 */
export function isStaticAssetRequest(filePath: string): boolean {
  const extension = getFileExtension(filePath);
  return extension !== '' && extension !== '.html';
}

/**
 * Generate 404 error response for missing files
 */
export function create404Response(projectId: string, filePath: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 - Not Found</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; margin-bottom: 20px; }
        p { color: #666; line-height: 1.5; margin-bottom: 15px; }
        .code { background: #f8f9fa; padding: 4px 8px; border-radius: 4px; font-family: monospace; color: #e74c3c; }
    </style>
</head>
<body>
    <div class="container">
        <h1>404 - File Not Found</h1>
        <p>The requested file <span class="code">${filePath}</span> could not be found in project <span class="code">${projectId}</span>.</p>
        <p>This could mean:</p>
        <ul>
            <li>The file does not exist in the deployed project</li>
            <li>The project has not been deployed yet</li>
            <li>The URL path is incorrect</li>
        </ul>
        <p>If this is a single-page application, make sure your build includes proper routing configuration.</p>
    </div>
</body>
</html>`;

  return new Response(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html',
      ...SECURITY_HEADERS
    }
  });
}

/**
 * Generate project not found response
 */
export function createProjectNotFoundResponse(projectId: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Project Not Found</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px; background: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; margin-bottom: 20px; }
        p { color: #666; line-height: 1.5; margin-bottom: 15px; }
        .code { background: #f8f9fa; padding: 4px 8px; border-radius: 4px; font-family: monospace; color: #e74c3c; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Project Not Found</h1>
        <p>The project <span class="code">${projectId}</span> does not exist or has not been deployed.</p>
        <p>Please check:</p>
        <ul>
            <li>The project ID is correct</li>
            <li>The project has been successfully deployed</li>
            <li>You have the correct deployment URL</li>
        </ul>
    </div>
</body>
</html>`;

  return new Response(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html',
      ...SECURITY_HEADERS
    }
  });
}