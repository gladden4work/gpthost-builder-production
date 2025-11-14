import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveDependencies } from '../../src/utils/dependencyResolver';

// Types are internal; use any to pass shapes
const mockImportAnalysis: any = {
  dependencies: {
    external: [],
    scoped: [],
    nodeBuiltins: [],
    local: [],
    assets: [],
    dynamicImports: [],
    typeOnlyImports: [],
    allUnique: []
  },
  imports: []
};

describe('Dependency resolver - mappings and peer deps', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch as any;
  });

  it('includes mapped packages like xlsx and mammoth without registry calls', async () => {
    const analysis = {
      ...mockImportAnalysis,
      dependencies: {
        ...mockImportAnalysis.dependencies,
        external: ['xlsx', 'mammoth']
      }
    };

    const res = await resolveDependencies(analysis, { patterns: { hasJSX: true } } as any, 'react', {
      strategy: 'compatible',
      includeDevDependencies: true
    } as any);

    const deps = Object.keys(res.packageJson.dependencies || {});
    expect(deps).toContain('xlsx');
    expect(deps).toContain('mammoth');
  });

  it('auto-adds peerDependencies for a lib via registry', async () => {
    // Arrange: pretend we import a non-mapped package that has peers
    const analysis = {
      ...mockImportAnalysis,
      dependencies: {
        ...mockImportAnalysis.dependencies,
        external: ['fake-lib-with-peers']
      }
    };

    // Mock registry response for the package
    global.fetch = vi.fn(async (url: any) => {
      if (String(url).includes(encodeURIComponent('fake-lib-with-peers'))) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            name: 'fake-lib-with-peers',
            version: '1.2.3',
            'dist-tags': { latest: '1.2.3' },
            versions: { '1.2.3': {} },
            dependencies: {},
            peerDependencies: {
              'peer-a': '^1.0.0',
              'peer-b': '~2.0.0'
            },
            time: { modified: new Date().toISOString() },
            license: 'MIT',
          }),
        } as any;
      }
      // Default: not found
      return { ok: false, status: 404, json: async () => ({}) } as any;
    });

    const res = await resolveDependencies(analysis, { patterns: { hasJSX: true } } as any, 'react', {
      strategy: 'compatible',
      includeDevDependencies: true,
      includePeerDependencies: true,
    } as any);

    const deps = res.packageJson.dependencies || {};
    expect(Object.keys(deps)).toContain('fake-lib-with-peers');
    expect(Object.keys(deps)).toContain('peer-a');
    expect(Object.keys(deps)).toContain('peer-b');
  });
});

