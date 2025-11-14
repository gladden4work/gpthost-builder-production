// StorageService Feature Flag Integration (Day 3 TDD 1.4 - RED)
// Minimal RED tests focused on:
// - selection (new vs legacy)
// - fallback default (legacy when missing/invalid flags)
// - wrapper composition (monitoring wraps new service)
// These tests intentionally import non-existent modules to guarantee RED failures
// until GREEN implements them.

import { describe, it, expect } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { Env } from '../../src/types/env';

// To be implemented in GREEN phase
import { ServiceFactory } from '../../src/services/ServiceFactory';
import { StorageService } from '../../src/services/StorageService';
import { LegacyStorageAdapter } from '../../src/services/LegacyStorageAdapter';
import { MonitoredStorageService } from '../../src/services/MonitoredStorageService';

describe('StorageService Feature Flags (RED)', () => {
  const mockBucket = {
    put: () => Promise.resolve(undefined),
    get: () => Promise.resolve(null),
    delete: () => Promise.resolve(undefined),
    list: () => Promise.resolve({ objects: [], truncated: false }),
    head: () => Promise.resolve(null),
  } as unknown as R2Bucket;

  const baseEnv: Env = {
    PROJECTS_BUCKET: mockBucket,
  } as Env;

  it('selects new StorageService when useNewStorageService is true', () => {
    const env: Env = {
      ...baseEnv,
      FEATURE_FLAGS: JSON.stringify({ useNewStorageService: true }),
    };
    const svc = ServiceFactory.getStorageService(env);
    expect(svc).toBeInstanceOf(StorageService);
    expect(svc).not.toBeInstanceOf(LegacyStorageAdapter);
  });

  it('falls back to LegacyStorageAdapter when flag is false or missing', () => {
    const envMissing: Env = { ...baseEnv };
    const envFalse: Env = {
      ...baseEnv,
      FEATURE_FLAGS: JSON.stringify({ useNewStorageService: false }),
    };
    const svcMissing = ServiceFactory.getStorageService(envMissing);
    const svcFalse = ServiceFactory.getStorageService(envFalse);
    expect(svcMissing).toBeInstanceOf(LegacyStorageAdapter);
    expect(svcFalse).toBeInstanceOf(LegacyStorageAdapter);
  });

  it('wraps StorageService with MonitoredStorageService when useMonitoring is true', () => {
    const env: Env = {
      ...baseEnv,
      FEATURE_FLAGS: JSON.stringify({ useNewStorageService: true, useMonitoring: true }),
    };
    const svc = ServiceFactory.getStorageService(env);
    expect(svc).toBeInstanceOf(MonitoredStorageService);
  });

  it('defaults to legacy on malformed FEATURE_FLAGS JSON', () => {
    const env: Env = {
      ...baseEnv,
      FEATURE_FLAGS: '{not-json}',
    } as unknown as Env;
    const svc = ServiceFactory.getStorageService(env);
    expect(svc).toBeInstanceOf(LegacyStorageAdapter);
  });
});

