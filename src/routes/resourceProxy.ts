import { isResourceProxyEnabled, generateResourceProxyToken, validateResourceProxyToken } from '../utils/resourceProxy';
import { 
  createResourceProxyCacheService, 
  type ResourceProxyCacheService
} from '../services/ResourceProxyCacheService';
import { createProxyUsageService, type ProxyUsageService } from '../services/ProxyUsageService';
import type { ExecutionContext } from '@cloudflare/workers-types';

export const RESOURCE_PROXY_PREFIX = '/__gpthost-proxy__/';
export const RESOURCE_PROXY_SW_PATH = '/__gpthost__/resource-proxy.js';

const SAFE_EXTENSIONS = /\.(glb|gltf|fbx|obj|png|jpe?g|gif|webp|svg|mp3|wav|ogg|m4a|mp4|webm|json|woff2?|ttf|otf)$/i;
const SAFE_CONTENT_TYPES = [
  /^image\//i,
  /^audio\//i,
  /^video\//i,
  /^font\//i,
  /^model\//i,
  /^application\/(font-woff|font-woff2|woff|woff2|vnd\.ms-fontobject|x-font-ttf|x-font-otf)$/i,
];
const PATH_HAS_EXTENSION = /\.[a-z0-9]+$/i;
const BLOCKED_HOSTS = [/^localhost\.?$/i];

// Maximum size for proxied content (100MB)
const MAX_PROXY_SIZE_BYTES = 100 * 1024 * 1024;

// Phase 3: Feature flag for quota enforcement
const ENABLE_QUOTA_ENFORCEMENT = true;

/**
 * Handle resource proxy requests with R2 caching support (Phase 2)
 * 
 * Flow:
 * 1. Validate token and target URL
 * 2. Check R2 cache for existing entry
 * 3. If cache hit and not stale, serve from cache
 * 4. If cache hit but stale, perform conditional fetch with validators
 * 5. If cache miss, fetch from origin
 * 6. Background cache the response (if eligible)
 */
export async function handleResourceProxyRequest(
  request: Request, 
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  if (!env || !isResourceProxyEnabled(env)) {
    return new Response('Proxy disabled', { status: 404 });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  const encodedTarget = url.pathname.replace(RESOURCE_PROXY_PREFIX, '');
  if (!encodedTarget) {
    return new Response('Missing target', { status: 400 });
  }

  const projectId = url.searchParams.get('project_id') || '';
  const token = url.searchParams.get('token') || '';
  if (!projectId || !token || !(await validateResourceProxyToken(token, projectId, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  let target: URL;
  try {
    target = new URL(decodeURIComponent(encodedTarget));
  } catch {
    return new Response('Invalid target', { status: 400 });
  }

  if (isBlockedHost(target)) {
    return new Response('Forbidden', { status: 403 });
  }

  const hasSafeExtension = SAFE_EXTENSIONS.test(target.pathname);
  const hasExtension = PATH_HAS_EXTENSION.test(target.pathname);
  if (hasExtension && !hasSafeExtension) {
    return new Response('Forbidden', { status: 403 });
  }

  const targetUrl = target.toString();
  const hasRange = request.headers.has('range');
  
  // Initialize services
  const cacheService = createResourceProxyCacheService(env, ctx);
  const usageService = createProxyUsageService(env);

  // Phase 3: Check quota before proceeding
  if (ENABLE_QUOTA_ENFORCEMENT && usageService) {
    const quotaCheck = await usageService.checkQuota(projectId);
    if (!quotaCheck.allowed) {
      console.warn('[PROXY] Quota exceeded for project:', projectId, quotaCheck.reason);
      // Calculate seconds until quota reset
      const resetTime = new Date(quotaCheck.usage.windowStart).getTime() + 24 * 60 * 60 * 1000;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
      return new Response(JSON.stringify({
        error: 'Quota exceeded',
        reason: quotaCheck.reason,
        usage: quotaCheck.usage,
        limit: quotaCheck.quotaLimit,
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-Quota-Limit-Requests': quotaCheck.quotaLimit.requestsPerDay.toString(),
          'X-Quota-Remaining-Requests': Math.max(0, quotaCheck.quotaLimit.requestsPerDay - quotaCheck.usage.requestCount).toString(),
          'X-Quota-Reset': new Date(resetTime).toISOString(),
          'Retry-After': retryAfterSeconds.toString(),
        },
      });
    }

    // Check if host is dynamically blocked
    if (await usageService.isHostBlocked(target.hostname)) {
      console.warn('[PROXY] Host blocked by policy:', target.hostname);
      return new Response('Forbidden - host blocked', { status: 403 });
    }
  }

  // Phase 2: Try serving from cache first (skip for Range requests)
  if (!hasRange) {
    const cacheResult = await cacheService.tryServeFromCache(
      targetUrl,
      request.headers.get('accept-encoding')
    );
    
    if (cacheResult.hit && !cacheResult.stale && cacheResult.object && cacheResult.metadata) {
      // Fresh cache hit - serve directly from R2
      console.info('[PROXY] Cache HIT:', targetUrl);
      
      // Phase 3: Record cache HIT telemetry
      if (usageService && ctx) {
        ctx.waitUntil((async () => {
          const urlHash = await generateUrlHash(targetUrl);
          await Promise.all([
            usageService.recordUsage(projectId, cacheResult.metadata.size, ctx),
            usageService.recordTelemetryEvent({
              projectId,
              host: target.hostname,
              urlHash,
              mimeType: cacheResult.metadata.contentType,
              sizeBytes: cacheResult.metadata.size,
              cacheStatus: 'HIT',
              responseStatus: 200,
            }, ctx),
          ]);
        })());
      }
      
      return cacheService.buildCachedResponse(cacheResult.object, cacheResult.metadata);
    }

    // Handle stale cache with conditional request
    if (cacheResult.hit && cacheResult.stale && cacheResult.validators) {
      console.info('[PROXY] Cache STALE, performing conditional fetch:', targetUrl);
      
      const conditionalResponse = await performConditionalFetch(
        targetUrl,
        cacheResult.validators,
        request.headers
      );

      if (conditionalResponse.status === 304 && cacheResult.object && cacheResult.metadata) {
        // Phase 3: Record stale-served telemetry
      if (usageService && ctx) {
        ctx.waitUntil((async () => {
          const urlHash = await generateUrlHash(targetUrl);
          await Promise.all([
            usageService.recordUsage(projectId, cacheResult.metadata.size, ctx),
            usageService.recordTelemetryEvent({
              projectId,
              host: target.hostname,
              urlHash,
              mimeType: cacheResult.metadata.contentType,
              sizeBytes: cacheResult.metadata.size,
              cacheStatus: 'STALE',
              responseStatus: 200,
            }, ctx),
            ]);
          })());
        }
        // Origin says content unchanged - update cache expiry and serve stale
        if (ctx) {
          ctx.waitUntil(cacheService.updateCacheExpiry(targetUrl));
        }
        return cacheService.buildCachedResponse(cacheResult.object, cacheResult.metadata);
      }

      // Content changed - proceed with new response
      return await handleOriginResponse(
        conditionalResponse,
        targetUrl,
        hasRange,
        cacheService,
        ctx,
        projectId,
        usageService,
        !hasSafeExtension
      );
    }
  }

  console.info('[PROXY] Cache MISS:', targetUrl);

  // Fetch from origin
  const outboundHeaders = new Headers();
  copyIfPresent(request.headers, outboundHeaders, ['accept', 'range', 'if-none-match', 'if-modified-since', 'accept-encoding']);
  outboundHeaders.set('User-Agent', 'GPTHost-Proxy/1.0');

  const upstream = await fetch(new Request(targetUrl, {
    method: request.method,
    headers: outboundHeaders,
    redirect: 'follow',
  }));

  return await handleOriginResponse(
    upstream,
    targetUrl,
    hasRange,
    cacheService,
    ctx,
    projectId,
    usageService,
    !hasSafeExtension
  );
}

/**
 * Perform a conditional fetch with ETag/Last-Modified validators
 */
async function performConditionalFetch(
  targetUrl: string,
  validators: { etag?: string; lastModified?: string },
  originalHeaders: Headers
): Promise<Response> {
  const headers = new Headers();
  headers.set('User-Agent', 'GPTHost-Proxy/1.0');
  
  // Add accept-encoding for compression
  if (originalHeaders.has('accept-encoding')) {
    headers.set('Accept-Encoding', originalHeaders.get('accept-encoding')!);
  }

  if (validators.etag) {
    headers.set('If-None-Match', validators.etag);
  }
  if (validators.lastModified) {
    headers.set('If-Modified-Since', validators.lastModified);
  }

  return await fetch(targetUrl, {
    method: 'GET',
    headers,
    redirect: 'follow',
  });
}

/**
 * Handle response from origin - add CORS headers, record usage, and background cache
 */
async function handleOriginResponse(
  upstream: Response,
  targetUrl: string,
  hasRange: boolean,
  cacheService: ResourceProxyCacheService,
  ctx?: ExecutionContext,
  projectId?: string,
  usageService?: ProxyUsageService | null,
  enforceAllowedContentType: boolean = false
): Promise<Response> {
  if (enforceAllowedContentType && !isAllowedContentType(upstream.headers.get('content-type'))) {
    const responseHeaders = new Headers();
    addCorsHeaders(responseHeaders);
    responseHeaders.set('Content-Type', 'text/plain');
    responseHeaders.set('X-Cache', 'BLOCKED-MIME');
    return new Response('Forbidden', {
      status: 403,
      headers: responseHeaders,
    });
  }

  // Check content length for size limit (when provided)
  const contentLengthHeader = upstream.headers.get('content-length');
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : null;
  const hasValidContentLength = contentLength !== null && !Number.isNaN(contentLength);
  const targetHost = new URL(targetUrl).hostname;
  
  if (hasValidContentLength && contentLength > MAX_PROXY_SIZE_BYTES) {
    // Enforce hard limit for known sizes
    const responseHeaders = new Headers();
    addCorsHeaders(responseHeaders);
    responseHeaders.set('Content-Type', 'text/plain');
    responseHeaders.set('X-Cache', 'BLOCKED-SIZE');

    // Phase 3: Record usage and telemetry for size rejection
    if (usageService && projectId && ctx) {
      ctx.waitUntil((async () => {
        const urlHash = await generateUrlHash(targetUrl);
        await Promise.all([
          usageService.recordUsage(projectId, 0, ctx),
          usageService.recordTelemetryEvent({
            projectId,
            host: targetHost,
            urlHash,
            mimeType: upstream.headers.get('content-type') || undefined,
            sizeBytes: 0,
            cacheStatus: 'BYPASS',
            responseStatus: 413,
          }, ctx),
        ]);
      })());
    }
    
    return new Response('Payload too large', {
      status: 413,
      statusText: 'Payload Too Large',
      headers: responseHeaders,
    });
  }

  const responseHeaders = new Headers(upstream.headers);
  addCorsHeaders(responseHeaders);
  responseHeaders.set('X-Cache', 'MISS');
  responseHeaders.delete('set-cookie');

  const upstreamForCache = upstream.clone();
  const clientStream = upstream.body;
  const byteCounter = clientStream ? createByteCountingStream(clientStream, MAX_PROXY_SIZE_BYTES) : null;

  const responseBody = byteCounter ? byteCounter.stream : clientStream;

  // Background cache if eligible
  if (upstreamForCache.body && upstream.ok && ctx) {
    ctx.waitUntil(
      cacheService.cacheResponse(targetUrl, upstreamForCache, hasRange)
        .then(result => {
          if (result.stored) {
            console.info('[PROXY] Cached in background:', targetUrl, result.cacheKey);
          } else {
            console.info('[PROXY] Not cached:', targetUrl, result.reason);
          }
        })
        .catch(err => console.error('[PROXY] Background cache error:', err))
    );
  }

  // Phase 3: Record usage and telemetry
  if (usageService && projectId && ctx) {
    const recordUsage = async (bytes: number, exceeded: boolean) => {
      if (exceeded) {
        console.warn('[PROXY] Size limit exceeded, stream aborted:', targetUrl);
      }

      const urlHash = await generateUrlHash(targetUrl);
      await Promise.all([
        usageService.recordUsage(projectId, bytes, ctx),
        usageService.recordTelemetryEvent({
          projectId,
          host: targetHost,
          urlHash,
          mimeType: upstream.headers.get('content-type') || undefined,
          sizeBytes: bytes,
          cacheStatus: exceeded ? 'BYPASS' : 'MISS',
          responseStatus: exceeded ? 413 : upstream.status,
        }, ctx),
      ]);
    };

    if (byteCounter) {
      ctx.waitUntil(
        byteCounter.bytesPromise.then(result => recordUsage(result.bytes, result.exceeded))
      );
    } else {
      ctx.waitUntil(recordUsage(0, false));
    }
  }

  return new Response(responseBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

/**
 * Generate a short hash for URL (for telemetry without storing full URLs)
 */
async function generateUrlHash(url: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(url);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 12);
}

/**
 * Add standard CORS headers to response
 */
function addCorsHeaders(headers: Headers): void {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Headers', '*');
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
}

function isAllowedContentType(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }
  const mime = contentType.split(';')[0]?.trim().toLowerCase();
  if (!mime) {
    return false;
  }
  return SAFE_CONTENT_TYPES.some((pattern) => pattern.test(mime));
}

export function getResourceProxyServiceWorker(projectId: string, token: string): Response {
  const body = RESOURCE_PROXY_SW_TEMPLATE.replace('__PROJECT_ID__', projectId).replace('__PROXY_TOKEN__', token);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=3600',
      'Service-Worker-Allowed': '/',
    },
  });
}

export async function createResourceProxyToken(projectId: string, env: Env): Promise<string> {
  return generateResourceProxyToken(projectId, env);
}

export function shouldHandleResourceProxy(request: Request): boolean {
  return request.url.includes(RESOURCE_PROXY_PREFIX);
}

export function shouldServeResourceProxySW(request: Request): boolean {
  return new URL(request.url).pathname.startsWith(RESOURCE_PROXY_SW_PATH);
}

const RESOURCE_PROXY_SW_TEMPLATE = `/* GPTHost Resource Proxy Service Worker */
const PROJECT_ID = '__PROJECT_ID__';
const PROXY_TOKEN = '__PROXY_TOKEN__';
const PROXY_PREFIX = '${RESOURCE_PROXY_PREFIX}';
const PROXY_SW_PATH = '${RESOURCE_PROXY_SW_PATH}';
const SAFE_EXT = ${SAFE_EXTENSIONS.toString()};

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Leave same-origin requests and API calls untouched
  if (url.origin === self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith(PROXY_PREFIX) || url.pathname.startsWith(PROXY_SW_PATH)) {
    return;
  }

  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return;
  if (req.credentials === 'include') return;
  if (!isEligible(url, req)) return;

  const target = encodeURIComponent(url.toString());
  const proxyUrl = new URL(PROXY_PREFIX + target, self.location.origin);
  proxyUrl.searchParams.set('project_id', PROJECT_ID);
  proxyUrl.searchParams.set('token', PROXY_TOKEN);

  const headers = new Headers();
  copyIfPresent(req.headers, headers, ['accept', 'range', 'if-none-match', 'if-modified-since']);

  event.respondWith(fetch(new Request(proxyUrl.toString(), { method, headers })));
});

function isEligible(url, req) {
  const destination = req.destination;
  const assetDestinations = ['image', 'audio', 'video', 'font'];
  if (assetDestinations.includes(destination)) return true;
  return SAFE_EXT.test(url.pathname);
}

function copyIfPresent(source, target, keys) {
  keys.forEach((key) => {
    if (source.has(key)) {
      target.set(key, source.get(key));
    }
  });
}
`;

function isBlockedHost(url: URL): boolean {
  if (url.protocol === 'file:') {
    return true;
  }

  const host = normalizeHost(url.hostname.toLowerCase());
  if (BLOCKED_HOSTS.some((pattern) => pattern.test(host))) {
    return true;
  }

  return isPrivateIp(host);
}

function isPrivateIp(host: string): boolean {
  if (isIPv4Address(host)) {
    return isPrivateIPv4(host);
  }

  if (isIPv6Address(host)) {
    return isPrivateIPv6(host);
  }

  return false;
}

function isIPv4Address(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      return false;
    }
    const value = Number.parseInt(part, 10);
    return value >= 0 && value <= 255;
  });
}

function isPrivateIPv4(host: string): boolean {
  const [a, b] = host.split('.').map((part) => Number.parseInt(part, 10));

  if (a === 10 || a === 127 || a === 0) {
    return true;
  }

  if (a === 169 && b === 254) {
    return true;
  }

  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }

  if (a === 192 && b === 168) {
    return true;
  }

  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }

  return false;
}

function isIPv6Address(host: string): boolean {
  return host.includes(':');
}

function isPrivateIPv6(host: string): boolean {
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return true;
  }

  if (host === '::' || host === '0:0:0:0:0:0:0:0') {
    return true;
  }

  if (host.startsWith('fc') || host.startsWith('fd')) {
    return true;
  }

  if (/^fe[89ab]/.test(host)) {
    return true;
  }

  const mappedIpv4 = extractMappedIpv4(host);
  if (mappedIpv4 && isPrivateIPv4(mappedIpv4)) {
    return true;
  }

  return false;
}

function extractMappedIpv4(host: string): string | null {
  const markerIndex = host.lastIndexOf('ffff:');
  if (markerIndex === -1) {
    return null;
  }

  const candidate = host.slice(markerIndex + 'ffff:'.length);
  return isIPv4Address(candidate) ? candidate : null;
}

function normalizeHost(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host.slice(1, -1);
  }

  return host;
}

function copyIfPresent(source: Headers, target: Headers, keys: string[]): void {
  keys.forEach((key) => {
    if (source.has(key)) {
      target.set(key, source.get(key)!);
    }
  });
}

function createByteCountingStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number
): { stream: ReadableStream<Uint8Array>; bytesPromise: Promise<{ bytes: number; exceeded: boolean }> } {
  let bytes = 0;
  let settled = false;
  let resolveResult: (result: { bytes: number; exceeded: boolean }) => void;

  const bytesPromise = new Promise<{ bytes: number; exceeded: boolean }>((resolve) => {
    resolveResult = resolve;
  });

  const settleOnce = (result: { bytes: number; exceeded: boolean }) => {
    if (settled) return;
    settled = true;
    resolveResult(result);
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        settleOnce({ bytes, exceeded: true });
        controller.error(new Error('MAX_PROXY_SIZE_EXCEEDED'));
        return;
      }
      controller.enqueue(chunk);
    },
    flush() {
      settleOnce({ bytes, exceeded: false });
    },
    cancel() {
      settleOnce({ bytes, exceeded: false });
    },
  });

  return { stream: stream.pipeThrough(transform), bytesPromise };
}

export { generateResourceProxyToken } from '../utils/resourceProxy';
