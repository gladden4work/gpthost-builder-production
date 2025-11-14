import { describe, it, expect } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import { BuildLockManager } from '../../src/utils/buildLockManager';

describe('BuildLockManager', () => {
  function createBucket(): R2Bucket {
    const store = new Map<string, unknown>();
    return {
      async put(key: string, _value: string, options: any) {
        if (options?.onlyIf?.exists === false && store.has(key)) {
          throw new Error('exists');
        }
        store.set(key, true);
      },
      async delete(key: string) {
        store.delete(key);
      }
    } as unknown as R2Bucket;
  }

  it('acquires and releases locks', async () => {
    const bucket = createBucket();
    const manager = new BuildLockManager(bucket);
    expect(await manager.acquire('a')).toBe(true);
    expect(await manager.acquire('a')).toBe(false);
    await manager.release('a');
    expect(await manager.acquire('a')).toBe(true);
  });
});
