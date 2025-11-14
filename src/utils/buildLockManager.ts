import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * Provides a simple distributed lock using R2 conditional writes. The lock is
 * stored at `locks/{id}` and expires automatically after the provided TTL.
 */
export class BuildLockManager {
  constructor(private bucket: R2Bucket) {}

  async acquire(id: string, ttlSeconds = 300): Promise<boolean> {
    const key = `locks/${id}`;
    try {
      await this.bucket.put(key, '', {
        expirationTtl: ttlSeconds,
        onlyIf: { exists: false }
      });
      return true;
    } catch {
      return false;
    }
  }

  async release(id: string): Promise<void> {
    const key = `locks/${id}`;
    try {
      await this.bucket.delete(key);
    } catch {
      // ignore
    }
  }
}
