import { describe, it, expect, vi, afterEach } from 'vitest';
import { getProjectDependenciesHandler } from '../../src/routes/analysis';

describe('getProjectDependenciesHandler', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('detects missing deps, security warnings and peer deps', async () => {
    const projectId = 'dep-project';
    const timestamp = new Date().toISOString();
    const importAnalysis: any = {
      statements: [],
      dependencies: {
        external: ['react-router-dom', 'left-pad', 'nonexistent-package-xyz'],
        local: [],
        nodeBuiltins: [],
        scoped: [],
        assets: [],
        dynamicImports: [],
        typeOnlyImports: [],
        allUnique: ['react-router-dom', 'left-pad', 'nonexistent-package-xyz']
      },
      hasCircularImports: false,
      unusedImports: [],
      importCount: { total: 3, es6: 3, commonjs: 0, dynamic: 0, typeOnly: 0, assets: 0 }
    };
    const metadata = {
      id: projectId,
      status: 'analyzing',
      framework: 'react',
      files: [
        {
          name: 'App.jsx',
          path: `projects/${projectId}/source/App.jsx`,
          size: 10,
          type: 'text/jsx',
          upload_time: timestamp,
          analysis: { framework: 'react', importAnalysis }
        }
      ],
      created_at: timestamp,
      updated_at: timestamp,
      analysis: {
        primaryFramework: 'react',
        componentType: 'single-component',
        hasMultipleFrameworks: false,
        totalComponents: 1,
        entryPoints: [],
        dependencies: [],
        stylingApproaches: [],
        analysisComplete: true,
        analysisTimestamp: timestamp
      }
    };
    const storage = new Map<string, string>();
    storage.set(`projects/${projectId}/metadata.json`, JSON.stringify(metadata));
    const PROJECTS_BUCKET = {
      get: vi.fn(async (key: string) => {
        const content = storage.get(key);
        if (!content) return null;
        return { text: async () => content } as any;
      })
    } as any;

    global.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('nonexistent-package-xyz')) {
        return { ok: false, status: 404 } as any;
      }
      if (u.includes('left-pad')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            name: 'left-pad',
            'dist-tags': { latest: '1.0.0' },
            versions: { '1.0.0': { deprecated: 'deprecated for security reasons' } }
          })
        } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ name: 'react-router-dom', 'dist-tags': { latest: '6.0.0' }, versions: { '6.0.0': {} } })
      } as any;
    });

    const env = { PROJECTS_BUCKET } as any;
    const req = new Request(`https://test/api/analysis/${projectId}/dependencies`);
    const res = await getProjectDependenciesHandler(req, env);
    const json = await res.json();
    expect(json.data.issues.missing_dependencies).toContain('nonexistent-package-xyz');
    expect(json.data.issues.security_warnings[0]).toContain('left-pad');
    expect(json.data.package_json_suggestions.peerDependencies.react).toBeDefined();
  });
});
