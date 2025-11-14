import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projectListHandler } from '../../src/routes/projectsList';
import { ServiceFactory } from '../../src/services/ServiceFactory';
import type { AuthenticatedRequest, AuthSuccessContext } from '../../src/utils/authUtils';
import type { FrameworkType } from '../../src/types/api';
import type { Env } from '../../src/types/env';
import { createMockEnv } from '../helpers/testProjectSetup';

const FRAMEWORK = 'react' as FrameworkType;

async function createProject(
  env: Env,
  {
    name,
    ownerId,
  }: {
    name: string;
    ownerId?: string;
  }
) {
  const projectService = ServiceFactory.getProjectService(env);
  const result = await projectService.createProject({
    name,
    framework: FRAMEWORK,
    files: [
      {
        path: 'App.jsx',
        content: 'export default function App() { return <div>Hello</div>; }',
      },
    ],
    ownerId,
  });

  if (!result.ok) {
    throw new Error(`Failed to seed project: ${result.error.message}`);
  }

  return result.value.id;
}

describe('/api/projects/list account scoping', () => {
  let env: Env;
  let legacyProjectId: string;
  let supabaseProjectId: string;
  const supabaseOwnerId = 'aaca3d46-cb06-41f4-9c38-01009e668c2b';

  beforeEach(async () => {
    env = createMockEnv();
    const bucket = env.PROJECTS_BUCKET as any;
    const originalPut = bucket.put;
    bucket.put = vi.fn(async (key: string, content: any, options?: any) => {
      let normalized = content;
      if (content instanceof ArrayBuffer) {
        normalized = Buffer.from(content).toString();
      } else if (ArrayBuffer.isView(content)) {
        normalized = Buffer.from(content.buffer).toString();
      }
      return originalPut(key, normalized, options);
    });
    const originalGet = bucket.get;
    bucket.get = vi.fn(async (key: string) => {
      const result = await originalGet(key);
      if (!result) return result;
      const text = await result.text();
      const buffer = Buffer.from(text);
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      return {
        ...result,
        text: () => Promise.resolve(text),
        json: () => Promise.resolve(JSON.parse(text)),
        arrayBuffer: () => Promise.resolve(arrayBuffer),
      };
    });
    env.FEATURE_FLAGS = JSON.stringify({
      useNewStorageService: true,
      useNewProjectService: true,
      useMonitoring: false,
    });
    legacyProjectId = await createProject(env, { name: 'legacy-project' });
    supabaseProjectId = await createProject(env, {
      name: 'supabase-project',
      ownerId: supabaseOwnerId,
    });

  });

  it('excludes legacy-owned projects for Supabase-authenticated users', async () => {
    const request = new Request('https://example.com/api/projects/list');

    const authContext: AuthSuccessContext = {
      isValid: true,
      token: 'fake-supabase',
      authType: 'supabase-jwt',
      user: {
        id: supabaseOwnerId,
      },
    };

    (request as AuthenticatedRequest).authContext = authContext;

    const response = await projectListHandler(request, env);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const projectIds = body.data.projects.map((p: any) => p.id);
    expect(projectIds).toContain(supabaseProjectId);
    expect(projectIds).not.toContain(legacyProjectId);
  });

  it('continues to return legacy projects for legacy token auth', async () => {
    const request = new Request('https://example.com/api/projects/list');

    const authContext: AuthSuccessContext = {
      isValid: true,
      token: 'legacy',
      authType: 'legacy-token',
    };

    (request as AuthenticatedRequest).authContext = authContext;

    const response = await projectListHandler(request, env);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const projectIds = body.data.projects.map((p: any) => p.id);
    expect(projectIds).toContain(legacyProjectId);
  });
});
