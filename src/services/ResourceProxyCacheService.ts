/**
 * ResourceProxyCacheService - Phase 2: Caching & Performance
 * 
 * Handles R2-based caching for proxied external resources with:
 * - Smart caching rules respecting Cache-Control headers
 * - TTL-based expiration (30 days default)
 * - Size limits (skip files > 100MB)
 * - ETag/Last-Modified validators for conditional requests
 * - Request counting (cache only when accessed 2+ times)
 * 
 * Storage pattern: proxy-cache/{url-hash} in PROJECTS_BUCKET
 * Metadata stored in R2 customMetadata for each cached object
 */

import { Result, Ok, Err } from '../lib/result';
import { StorageError, StorageErrorCode } from '../lib/errors';

// Constants for cache configuration
const CACHE_PREFIX = 'proxy-cache/';
const MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const MIN_REQUEST_COUNT_FOR_CACHE = 2; // Only cache after 2nd request
const REQUEST_COUNT_TTL_SECONDS = 60 * 60; // 1 hour for request counting

/**
 * Cache entry metadata stored in R2 customMetadata
 */
export interface CacheMetadata {
  originalUrl: string;
  cachedAt: string;
  contentType: string;
  contentEncoding?: string;
  size: number;
  etag?: string;
  lastModified?: string;
  expiresAt: string;
  cacheControl?: string;
}

/**
 * R2 object with body for cache reading
 */
interface R2ObjectWithBody {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
  customMetadata?: Record<string, string>;
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Cache lookup result
 */
export interface CacheLookupResult {
  hit: boolean;
  object?: R2ObjectWithBody;
  metadata?: CacheMetadata;
  stale?: boolean;
  validators?: {
    etag?: string;
    lastModified?: string;
  };
}

/**
 * Cache storage result
 */
export interface CacheStorageResult {
  stored: boolean;
  reason?: string;
  cacheKey?: string;
}

/**
 * Parse Cache-Control header to determine caching behavior
 */
export function parseCacheControl(header: string | null): {
  noStore: boolean;
  noCache: boolean;
  private: boolean;
  maxAge?: number;
} {
  if (!header) {
    return { noStore: false, noCache: false, private: false };
  }

  const directives = header.toLowerCase().split(',').map(d => d.trim());
  
  return {
    noStore: directives.some(d => d === 'no-store'),
    noCache: directives.some(d => d === 'no-cache'),
    private: directives.some(d => d === 'private'),
    maxAge: directives
      .find(d => d.startsWith('max-age='))
      ?.split('=')[1]
      ? parseInt(directives.find(d => d.startsWith('max-age='))!.split('=')[1], 10)
      : undefined,
  };
}

/**
 * Determine cache TTL in seconds based on Cache-Control directives
 */
export function getCacheTtlSeconds(cacheControlHeader: string | null): number {
  const cc = parseCacheControl(cacheControlHeader);

  if (cc.noCache) {
    return 0;
  }

  if (cc.maxAge !== undefined) {
    return cc.maxAge;
  }

  return DEFAULT_TTL_SECONDS;
}

/**
 * Check if a cached content-encoding is acceptable for the current request
 */
export function isEncodingAccepted(
  acceptEncodingHeader: string | null,
  contentEncoding?: string
): boolean {
  if (!contentEncoding || contentEncoding === 'identity') {
    return true;
  }

  if (!acceptEncodingHeader) {
    return false;
  }

  const tokens = acceptEncodingHeader
    .toLowerCase()
    .split(',')
    .map(token => token.trim())
    .filter(Boolean);

  let wildcardQ: number | undefined;

  for (const token of tokens) {
    const [encodingPart, ...params] = token.split(';').map(part => part.trim());
    const encoding = encodingPart.toLowerCase();
    let q = 1;

    for (const param of params) {
      if (param.startsWith('q=')) {
        const parsed = Number.parseFloat(param.slice(2));
        if (!Number.isNaN(parsed)) {
          q = parsed;
        }
      }
    }

    if (encoding === '*') {
      wildcardQ = q;
      continue;
    }

    if (encoding === contentEncoding.toLowerCase()) {
      return q > 0;
    }
  }

  if (wildcardQ !== undefined) {
    return wildcardQ > 0;
  }

  return false;
}

/**
 * Generate a deterministic cache key from a URL using SHA-256
 */
export async function generateCacheKey(url: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(url);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  // Use first 16 characters (64 bits) of the hex hash for key
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

/**
 * Generate the full R2 path for a cache entry
 */
export function getCachePath(cacheKey: string): string {
  return `${CACHE_PREFIX}${cacheKey}`;
}

/**
 * Check if a response should be cached based on headers and request context
 */
export function shouldCacheResponse(
  response: Response,
  requestHasRange: boolean,
  contentLength: number
): { shouldCache: boolean; reason?: string } {
  // Skip if Range request
  if (requestHasRange) {
    return { shouldCache: false, reason: 'Range request' };
  }

  // Skip if too large
  if (contentLength > MAX_CACHE_SIZE_BYTES) {
    return { shouldCache: false, reason: `Size ${contentLength} exceeds ${MAX_CACHE_SIZE_BYTES}` };
  }

  // Check Cache-Control
  const cc = parseCacheControl(response.headers.get('cache-control'));
  
  if (cc.noStore) {
    return { shouldCache: false, reason: 'Cache-Control: no-store' };
  }

  if (cc.private) {
    return { shouldCache: false, reason: 'Cache-Control: private' };
  }

  return { shouldCache: true };
}

export async function readResponseBodyWithLimit(
  response: Response,
  maxBytes: number
): Promise<{ body: ArrayBuffer; size: number; exceeded: boolean }> {
  if (!response.body) {
    return { body: new ArrayBuffer(0), size: 0, exceeded: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return { body: new ArrayBuffer(0), size: totalBytes, exceeded: true };
    }

    chunks.push(value);
  }

  const buffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { body: buffer.buffer, size: totalBytes, exceeded: false };
}

/**
 * ResourceProxyCacheService - Manages caching of proxied external resources
 */
export class ResourceProxyCacheService {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly kv?: KVNamespace,
    private readonly ctx?: ExecutionContext
  ) {}

  /**
   * Try to serve a resource from cache
   */
  async tryServeFromCache(url: string, acceptEncoding?: string | null): Promise<CacheLookupResult> {
    try {
      const cacheKey = await generateCacheKey(url);
      const cachePath = getCachePath(cacheKey);

      const object = await this.bucket.get(cachePath);

      if (!object) {
        return { hit: false };
      }

      // Extract metadata
      const metadata: CacheMetadata = {
        originalUrl: object.customMetadata?.originalUrl || url,
        cachedAt: object.customMetadata?.cachedAt || '',
        contentType: object.customMetadata?.contentType || 'application/octet-stream',
        contentEncoding: object.customMetadata?.contentEncoding,
        size: parseInt(object.customMetadata?.size || '0', 10),
        etag: object.customMetadata?.etag,
        lastModified: object.customMetadata?.lastModified,
        expiresAt: object.customMetadata?.expiresAt || '',
        cacheControl: object.customMetadata?.cacheControl,
      };

      if (!isEncodingAccepted(acceptEncoding ?? null, metadata.contentEncoding)) {
        return { hit: false };
      }

      // Check if cache entry is stale
      const now = Date.now();
      const expiresAt = new Date(metadata.expiresAt).getTime();
      const cacheControl = parseCacheControl(metadata.cacheControl || null);
      const mustRevalidate = cacheControl.noCache || cacheControl.maxAge === 0;
      const isStale = mustRevalidate || expiresAt < now;

      if (isStale) {
        // Return stale entry with validators for conditional request
        return {
          hit: true,
          object,
          metadata,
          stale: true,
          validators: {
            etag: metadata.etag,
            lastModified: metadata.lastModified,
          },
        };
      }

      // Fresh cache hit
      return {
        hit: true,
        object,
        metadata,
        stale: false,
      };
    } catch (error) {
      console.error('[PROXY-CACHE] Error reading from cache:', error);
      return { hit: false };
    }
  }

  /**
   * Build a Response from a cached object
   */
  buildCachedResponse(object: R2ObjectWithBody, metadata: CacheMetadata): Response {
    const headers = new Headers();
    headers.set('Content-Type', metadata.contentType);
    headers.set('Content-Length', metadata.size.toString());
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Headers', '*');
    headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.set('X-Cache', 'HIT');
    headers.set('X-Cached-At', metadata.cachedAt);

    if (metadata.contentEncoding) {
      headers.set('Content-Encoding', metadata.contentEncoding);
    }
    if (metadata.etag) {
      headers.set('ETag', metadata.etag);
    }
    if (metadata.lastModified) {
      headers.set('Last-Modified', metadata.lastModified);
    }
    if (metadata.cacheControl) {
      headers.set('Cache-Control', metadata.cacheControl);
    }

    return new Response(object.body, {
      status: 200,
      headers,
    });
  }

  /**
   * Check and increment request count for a URL
   * Returns true if the URL has been requested enough times to cache
   */
  async shouldCacheBasedOnRequestCount(url: string): Promise<boolean> {
    if (!this.kv) {
      // If KV not available, always allow caching
      return true;
    }

    try {
      const countKey = `proxy:req-count:${await generateCacheKey(url)}`;
      const currentCount = await this.kv.get(countKey);
      const count = currentCount ? parseInt(currentCount, 10) : 0;
      
      // Increment in background
      if (this.ctx) {
        this.ctx.waitUntil(
          this.kv.put(countKey, (count + 1).toString(), {
            expirationTtl: REQUEST_COUNT_TTL_SECONDS,
          })
        );
      } else {
        await this.kv.put(countKey, (count + 1).toString(), {
          expirationTtl: REQUEST_COUNT_TTL_SECONDS,
        });
      }

      return count + 1 >= MIN_REQUEST_COUNT_FOR_CACHE;
    } catch (error) {
      console.error('[PROXY-CACHE] Error checking request count:', error);
      // On error, default to allowing cache
      return true;
    }
  }

  /**
   * Cache a proxied response in R2
   */
  async cacheResponse(
    url: string,
    response: Response,
    requestHadRange: boolean
  ): Promise<CacheStorageResult> {
    try {
      const contentLengthHeader = response.headers.get('content-length');
      const parsedLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : Number.NaN;
      const hasValidLength = Number.isFinite(parsedLength);
      const preliminaryLength = hasValidLength ? parsedLength : 0;

      const cacheDecision = shouldCacheResponse(response, requestHadRange, preliminaryLength);
      if (!cacheDecision.shouldCache) {
        return { stored: false, reason: cacheDecision.reason };
      }

      // Check request count threshold
      const shouldCacheByCount = await this.shouldCacheBasedOnRequestCount(url);
      if (!shouldCacheByCount) {
        return { stored: false, reason: 'Request count below threshold' };
      }

      const bodyResult = await readResponseBodyWithLimit(response.clone(), MAX_CACHE_SIZE_BYTES);
      if (bodyResult.exceeded) {
        return { stored: false, reason: `Size ${bodyResult.size} exceeds ${MAX_CACHE_SIZE_BYTES}` };
      }

      const body = bodyResult.body;
      const bodySize = bodyResult.size;

      // Calculate expiration
      const ttlSeconds = getCacheTtlSeconds(response.headers.get('cache-control'));
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

      // Build metadata
      const metadata: Record<string, string> = {
        originalUrl: url,
        cachedAt: now.toISOString(),
        contentType: response.headers.get('content-type') || 'application/octet-stream',
        size: bodySize.toString(),
        expiresAt: expiresAt.toISOString(),
      };

      const contentEncoding = response.headers.get('content-encoding');
      if (contentEncoding && contentEncoding !== 'identity') {
        metadata.contentEncoding = contentEncoding;
      }

      const etag = response.headers.get('etag');
      if (etag) {
        metadata.etag = etag;
      }

      const lastModified = response.headers.get('last-modified');
      if (lastModified) {
        metadata.lastModified = lastModified;
      }

      const cacheControl = response.headers.get('cache-control');
      if (cacheControl) {
        metadata.cacheControl = cacheControl;
      }

      // Store in R2
      const cacheKey = await generateCacheKey(url);
      const cachePath = getCachePath(cacheKey);

      await this.bucket.put(cachePath, body, {
        customMetadata: metadata,
      });

      console.info('[PROXY-CACHE] Cached resource:', {
        url,
        cacheKey,
        size: bodySize,
        expiresAt: expiresAt.toISOString(),
      });

      return { stored: true, cacheKey };
    } catch (error) {
      console.error('[PROXY-CACHE] Error caching response:', error);
      return { stored: false, reason: `Cache error: ${(error as Error).message}` };
    }
  }

  /**
   * Update a cached entry after conditional validation confirms no change
   */
  async updateCacheExpiry(url: string): Promise<void> {
    try {
      const cacheKey = await generateCacheKey(url);
      const cachePath = getCachePath(cacheKey);

      const object = await this.bucket.get(cachePath);
      if (!object) return;

      // Read existing metadata
      const metadata = { ...object.customMetadata };
      
      // Update expiry
      const now = new Date();
      const ttlSeconds = getCacheTtlSeconds(metadata.cacheControl || null);
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
      metadata.expiresAt = expiresAt.toISOString();

      // Re-upload with updated metadata
      const body = await object.arrayBuffer();
      await this.bucket.put(cachePath, body, {
        customMetadata: metadata,
      });

      console.info('[PROXY-CACHE] Updated cache expiry:', { url, cacheKey, expiresAt: metadata.expiresAt });
    } catch (error) {
      console.error('[PROXY-CACHE] Error updating cache expiry:', error);
    }
  }

  /**
   * Delete a cached entry
   */
  async deleteCache(url: string): Promise<Result<void, StorageError>> {
    try {
      const cacheKey = await generateCacheKey(url);
      const cachePath = getCachePath(cacheKey);
      await this.bucket.delete(cachePath);
      return Ok(undefined);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to delete cache for ${url}: ${(error as Error).message}`
      ));
    }
  }

  /**
   * Clear all cached resources for a specific project
   * (When project-specific cache prefixes are used)
   */
  async clearProjectCache(projectId: string): Promise<Result<number, StorageError>> {
    try {
      // Note: This is a placeholder. In Phase 3, we'll track project-cache mappings.
      // For now, we use a global cache without project-specific prefixes.
      console.info('[PROXY-CACHE] clearProjectCache not yet implemented for global cache');
      return Ok(0);
    } catch (error) {
      return Err(new StorageError(
        StorageErrorCode.OPERATION_FAILED,
        `Failed to clear cache for project ${projectId}: ${(error as Error).message}`
      ));
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalObjects: number;
    totalSizeBytes: number;
    oldestEntry?: string;
    newestEntry?: string;
  }> {
    try {
      let totalObjects = 0;
      let totalSizeBytes = 0;
      let oldestEntry: string | undefined;
      let newestEntry: string | undefined;
      let cursor: string | undefined;

      do {
        const list = await this.bucket.list({
          prefix: CACHE_PREFIX,
          cursor,
          limit: 1000,
          include: ['customMetadata'],
        });

        for (const obj of list.objects) {
          totalObjects++;
          totalSizeBytes += obj.size;

          const cachedAt = obj.customMetadata?.cachedAt;
          if (cachedAt) {
            if (!oldestEntry || cachedAt < oldestEntry) {
              oldestEntry = cachedAt;
            }
            if (!newestEntry || cachedAt > newestEntry) {
              newestEntry = cachedAt;
            }
          }
        }

        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);

      return { totalObjects, totalSizeBytes, oldestEntry, newestEntry };
    } catch (error) {
      console.error('[PROXY-CACHE] Error getting cache stats:', error);
      return { totalObjects: 0, totalSizeBytes: 0 };
    }
  }

  /**
   * Cleanup expired cache entries
   * Should be called periodically (e.g., via a cron trigger)
   */
  async cleanupExpiredEntries(maxToDelete: number = 100): Promise<number> {
    try {
      const now = Date.now();
      let deleted = 0;
      let cursor: string | undefined;

      do {
        const list = await this.bucket.list({
          prefix: CACHE_PREFIX,
          cursor,
          limit: 100,
          include: ['customMetadata'],
        });

        const toDelete: string[] = [];

        for (const obj of list.objects) {
          const expiresAt = obj.customMetadata?.expiresAt;
          if (expiresAt && new Date(expiresAt).getTime() < now) {
            toDelete.push(obj.key);
          }

          if (deleted + toDelete.length >= maxToDelete) {
            break;
          }
        }

        // Delete expired entries
        for (const key of toDelete) {
          await this.bucket.delete(key);
          deleted++;
        }

        cursor = list.truncated && deleted < maxToDelete ? list.cursor : undefined;
      } while (cursor);

      if (deleted > 0) {
        console.info('[PROXY-CACHE] Cleaned up expired entries:', deleted);
      }

      return deleted;
    } catch (error) {
      console.error('[PROXY-CACHE] Error cleaning up expired entries:', error);
      return 0;
    }
  }
}

/**
 * Factory function to create a ResourceProxyCacheService instance
 */
export function createResourceProxyCacheService(
  env: Env,
  ctx?: ExecutionContext
): ResourceProxyCacheService {
  // Use PROJECTS_BUCKET for cache storage as specified in the plan
  const bucket = env.PROJECTS_BUCKET;
  // KV namespace is optional - use RATE_LIMIT_STORE if available for request counting
  const kv = (env as any).RATE_LIMIT_STORE as KVNamespace | undefined;
  
  return new ResourceProxyCacheService(bucket, kv, ctx);
}
