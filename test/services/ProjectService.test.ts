// ProjectService RED-phase tests (DAY3 2.1)
// Aligns with refactor goals: Result pattern, DI via IStorageService, no direct R2 usage,
// clear error codes, and deterministic storage paths.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// SUT (System Under Test)
import { ProjectService } from '../../src/services/ProjectService';

// Shared refactor primitives
import { Ok, Err } from '../../src/lib/result';
import { ProjectErrorCode, StorageErrorCode } from '../../src/lib/errors';

// DI contract: ensure ProjectService depends on IStorageService only
import type { IStorageService } from '../../src/services/StorageService';

// Use existing app enums/types to stay consistent with broader code
import type { FrameworkType, ProjectStatus } from '../../src/types/api';

// Lightweight helpers
const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A minimal factory to create the SUT
function createService(mockStorage: IStorageService): ProjectService {
  return new ProjectService(mockStorage);
}

describe('ProjectService (RED phase)', () => {
  let service: ProjectService;
  let storage: jested<IStorageService>;

  beforeEach(() => {
    // Create a typed mock for IStorageService
    storage = {
      uploadFile: vi.fn(),
      downloadFile: vi.fn(),
      listFiles: vi.fn(),
      deleteFile: vi.fn(),
      exists: vi.fn(),
      getMetadata: vi.fn?.(),
      copyDirectory: vi.fn?.(),
    } as unknown as jested<IStorageService>;

    service = createService(storage as IStorageService);
  });

  describe('createProject', () => {
    it('creates project with valid input and stores metadata/files', async () => {
      const input = {
        name: 'test-project',
        framework: 'react' as FrameworkType,
        files: [
          { path: 'App.tsx', content: 'export default function App() {}' },
          { path: 'index.html', content: '<!doctype html><html></html>' },
        ],
      };

      storage.uploadFile.mockResolvedValue(Ok(undefined));

      const result = await service.createProject(input as any);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('test-project');
        expect(result.value.framework).toBe('react');
        expect(result.value.status).toBe<'pending'>('pending' as ProjectStatus);
        expect(result.value.id).toMatch(uuidV4Regex);
      }

      // metadata.json written with JSON content-type
      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.stringMatching(/^projects\/.+\/metadata\.json$/),
        expect.any(ArrayBuffer),
        expect.objectContaining({ contentType: 'application/json' })
      );

      // source files saved under project prefix
      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.stringMatching(/^projects\/.+\/App\.tsx$/),
        expect.any(ArrayBuffer),
        expect.objectContaining({ contentType: expect.stringMatching(/typescript|tsx|javascript|text\/.+/) })
      );
    });

    it('rejects invalid project names', async () => {
      const input = {
        name: 'invalid project name!',
        framework: 'react' as FrameworkType,
        files: [{ path: 'index.html', content: '<html/>' }],
      };

      const result = await service.createProject(input as any);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ProjectErrorCode.INVALID_INPUT);
      }
    });

    it('rejects creation without files', async () => {
      const input = {
        name: 'empty-project',
        framework: 'react' as FrameworkType,
        files: [],
      };

      const result = await service.createProject(input as any);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ProjectErrorCode.INVALID_INPUT);
      }
    });

    it('auto-detects framework from files when not specified', async () => {
      const input = {
        name: 'auto-detect',
        files: [{ path: 'App.vue', content: '<template>Vue</template>' }],
      };

      storage.uploadFile.mockResolvedValue(Ok(undefined));

      const result = await service.createProject(input as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.framework).toBe<'vue'>('vue' as FrameworkType);
      }
    });

		it('persists ownerId for Supabase-authenticated users', async () => {
			const input = {
				name: 'owner-project',
				files: [{ path: 'index.html', content: '<div />' }],
				ownerId: 'a2d93a3e-1b1d-4e0f-bf64-3ea80ba546a5'
			};

			storage.uploadFile.mockResolvedValue(Ok(undefined));

			const result = await service.createProject(input as any);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.ownerId).toBe('a2d93a3e-1b1d-4e0f-bf64-3ea80ba546a5');
			}

			const metadataCall = storage.uploadFile.mock.calls.find((call) =>
				String(call[0]).endsWith('metadata.json')
			);
			expect(metadataCall).toBeDefined();
			if (metadataCall) {
				const metadataBuffer = metadataCall[1] as ArrayBuffer;
				const json = JSON.parse(new TextDecoder().decode(metadataBuffer)) as Record<string, unknown>;
				expect(json.ownerId).toBe('a2d93a3e-1b1d-4e0f-bf64-3ea80ba546a5');
			}
		});

		it('defaults ownerId to legacy placeholder when missing', async () => {
			const input = {
				name: 'legacy-project',
				files: [{ path: 'index.html', content: '<div />' }]
			};

			storage.uploadFile.mockResolvedValue(Ok(undefined));

			const result = await service.createProject(input as any);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.value.ownerId).toBe('legacy-single-tenant');
			}
		});
  });

  describe('getProject', () => {
    it('returns existing project metadata', async () => {
      const projectId = 'test-project-id';
      const payload = {
        id: projectId,
        name: 'test-project',
        framework: 'react',
        status: 'deployed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      storage.downloadFile.mockResolvedValue(
        Ok(new TextEncoder().encode(JSON.stringify(payload)).buffer)
      );

      const result = await service.getProject(projectId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(projectId);
        expect(result.value.name).toBe('test-project');
        expect(result.value.status).toBe<'deployed'>('deployed' as ProjectStatus);
      }
    });

    it('maps storage NOT_FOUND to project NOT_FOUND', async () => {
      storage.downloadFile.mockResolvedValue(
        Err({ code: StorageErrorCode.NOT_FOUND, message: 'File not found' } as any)
      );

      const result = await service.getProject('missing');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ProjectErrorCode.NOT_FOUND);
      }
    });
  });

  describe('updateProject', () => {
    it('updates status with valid transition and persists metadata', async () => {
      const projectId = 'p-123';
      const existing = {
        id: projectId,
        name: 'x',
        framework: 'react',
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      storage.downloadFile.mockResolvedValue(
        Ok(new TextEncoder().encode(JSON.stringify(existing)).buffer)
      );
      storage.uploadFile.mockResolvedValue(Ok(undefined));

      const result = await service.updateProject(projectId, { status: 'building' as ProjectStatus } as any);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe<'building'>('building' as ProjectStatus);
      }

      expect(storage.uploadFile).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^projects/${projectId}/metadata\\.json$`)),
        expect.any(ArrayBuffer),
        expect.objectContaining({ contentType: 'application/json' })
      );
    });

    it('rejects invalid status transitions', async () => {
      const projectId = 'p-456';
      const existing = {
        id: projectId,
        name: 'x',
        framework: 'react',
        status: 'deployed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      storage.downloadFile.mockResolvedValue(
        Ok(new TextEncoder().encode(JSON.stringify(existing)).buffer)
      );

      const result = await service.updateProject(projectId, { status: 'pending' as ProjectStatus } as any);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(ProjectErrorCode.INVALID_STATE);
      }
    });
  });

  describe('deleteProject', () => {
    it('deletes project directories across areas', async () => {
      storage.deleteFile.mockResolvedValue(Ok(undefined));

      const result = await service.deleteProject('to-delete');
      expect(result.ok).toBe(true);

      expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^projects\/to-delete\/$/));
      expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^projects\/active\/to-delete\/$/));
      expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^projects\/archived\/to-delete\/$/));
      expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^builds\/to-delete\/$/));
      expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^sites\/to-delete\/$/));
      expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^projects\/to-delete\/metadata\.json$/));
      expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^projects\/active\/to-delete\/metadata\.json$/));
      expect(storage.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^projects\/archived\/to-delete\/metadata\.json$/));
    });
  });

  describe('listProjects', () => {
    it('lists projects via metadata.json files and applies filters', async () => {
      storage.listFiles.mockResolvedValue(
        Ok([
          { key: 'projects/a/metadata.json' },
          { key: 'projects/b/metadata.json' },
          { key: 'projects/b/src/App.tsx' }, // should be ignored
        ])
      );

      const a = { id: 'a', name: 'a', framework: 'react', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const b = { id: 'b', name: 'b', framework: 'vue', status: 'deployed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

      storage.downloadFile.mockImplementation(async (key: string) => {
        if (key === 'projects/a/metadata.json') return Ok(new TextEncoder().encode(JSON.stringify(a)).buffer);
        if (key === 'projects/b/metadata.json') return Ok(new TextEncoder().encode(JSON.stringify(b)).buffer);
        return Err({ code: StorageErrorCode.NOT_FOUND, message: 'not found' } as any);
      });

      const result = await (service as any).listProjects({ framework: 'vue' as FrameworkType });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Align with steering: listProjects returns ProjectList with `projects` array
        expect(Array.isArray((result.value as any).projects)).toBe(true);
        const items = (result.value as any).projects as any[];
        expect(items.length).toBe(1);
        expect(items[0].id).toBe('b');
      }
    });

    it('filters projects by ownerId when provided', async () => {
      storage.listFiles.mockResolvedValue(
        Ok([
          { key: 'projects/a/metadata.json' },
          { key: 'projects/b/metadata.json' },
        ])
      );

      const encoder = new TextEncoder();
      const projectA = {
        id: 'a',
        name: 'A',
        framework: 'react',
        status: 'pending',
        ownerId: 'user-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const projectB = {
        id: 'b',
        name: 'B',
        framework: 'react',
        status: 'pending',
        ownerId: 'user-2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      storage.downloadFile.mockImplementation(async (key: string) => {
        if (key === 'projects/a/metadata.json') {
          return Ok(encoder.encode(JSON.stringify(projectA)).buffer);
        }
        if (key === 'projects/b/metadata.json') {
          return Ok(encoder.encode(JSON.stringify(projectB)).buffer);
        }
        return Err({ code: StorageErrorCode.NOT_FOUND, message: 'not found' } as any);
      });

      const result = await service.listProjects({ ownerId: 'user-2' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.projects).toHaveLength(1);
        expect(result.value.projects[0].id).toBe('b');
      }
    });
  });
});

// Utility type: make a jest/vi mocked shape of a type
type jested<T> = { [K in keyof T]: T[K] extends (...args: any[]) => any ? ReturnType<typeof vi.fn> : T[K] } & T;
