import { describe, it, expect, vi } from 'vitest';
import { reanalyzeProjectHandler } from '../../src/routes/analysis';

describe('reanalyzeProjectHandler', () => {
  it('re-runs analysis and updates metadata', async () => {
    const projectId = 'test-project';
    const fileContent = "export default function App(){return '<div/>'}";
    const timestamp = new Date().toISOString();
    const metadata = {
      id: projectId,
      status: 'analyzing',
      files: [
        {
          name: 'App.jsx',
          path: `projects/${projectId}/source/App.jsx`,
          size: fileContent.length,
          type: 'text/jsx',
          upload_time: timestamp
        }
      ],
      created_at: timestamp,
      updated_at: timestamp
    };
    const storage = new Map<string, string>();
    storage.set(`projects/${projectId}/metadata.json`, JSON.stringify(metadata));
    storage.set(`projects/${projectId}/source/App.jsx`, fileContent);
    const PROJECTS_BUCKET = {
      get: vi.fn(async (key: string) => {
        const content = storage.get(key);
        if (!content) return null;
        return { text: async () => content } as any;
      }),
      put: vi.fn(async (key: string, value: any) => {
        storage.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      })
    } as any;
    const env = { PROJECTS_BUCKET } as any;
    const req = new Request(`https://test/api/analysis/${projectId}/reanalyze`, { method: 'POST' });
    const res = await reanalyzeProjectHandler(req, env);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.project_analysis.analysisComplete).toBe(true);
    const stored = JSON.parse(storage.get(`projects/${projectId}/metadata.json`)!);
    expect(stored.files[0].analysis).toBeDefined();
  });
});
