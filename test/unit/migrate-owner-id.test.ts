/**
 * Migration Tests: Owner ID Backfill
 * Tests the migration logic for adding ownerId to legacy projects
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { migrateOwnerIds } from '../../src/routes/migrate';

// Mock R2 bucket for testing
class MockR2Bucket {
  private storage: Map<string, string> = new Map();

  async get(key: string) {
    const content = this.storage.get(key);
    if (!content) return null;
    return {
      text: async () => content
    };
  }

  async put(key: string, value: string) {
    this.storage.set(key, value);
  }

  setMockData(key: string, data: any) {
    this.storage.set(key, JSON.stringify(data, null, 2));
  }

  getMockData(key: string) {
    const content = this.storage.get(key);
    return content ? JSON.parse(content) : null;
  }
}

describe('Owner ID Migration', () => {
  let mockBucket: MockR2Bucket;

  beforeEach(() => {
    mockBucket = new MockR2Bucket();
  });

  describe('Single Project Migration', () => {
    it('should migrate a project without ownerId in dry-run mode', async () => {
      // Setup: Project without ownerId
      const projectId = '064324e1-1c0c-4b14-a9b9-73d9be6150b1';
      mockBucket.setMockData(`projects/${projectId}/metadata.json`, {
        id: projectId,
        name: 'Test Project',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z'
      });

      // Execute: Dry-run migration
      const report = await migrateOwnerIds(mockBucket as any, [projectId], true);

      // Verify: Report shows migration would happen
      expect(report.dryRun).toBe(true);
      expect(report.totalProcessed).toBe(1);
      expect(report.migrated).toBe(1);
      expect(report.skipped).toBe(0);
      expect(report.errors).toBe(0);

      // Verify: Result details
      expect(report.results[0]).toEqual({
        projectId,
        status: 'migrated',
        before: 'undefined',
        after: 'legacy-single-tenant'
      });

      // Verify: Actual data NOT changed (dry-run)
      const metadata = mockBucket.getMockData(`projects/${projectId}/metadata.json`);
      expect(metadata.ownerId).toBeUndefined();
    });

    it('should migrate a project without ownerId in live mode', async () => {
      // Setup: Project without ownerId
      const projectId = '064324e1-1c0c-4b14-a9b9-73d9be6150b1';
      const originalMetadata = {
        id: projectId,
        name: 'Test Project',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z'
      };
      mockBucket.setMockData(`projects/${projectId}/metadata.json`, originalMetadata);

      // Execute: Live migration
      const report = await migrateOwnerIds(mockBucket as any, [projectId], false);

      // Verify: Report shows migration happened
      expect(report.dryRun).toBe(false);
      expect(report.migrated).toBe(1);

      // Verify: Actual data changed
      const metadata = mockBucket.getMockData(`projects/${projectId}/metadata.json`);
      expect(metadata.ownerId).toBe('legacy-single-tenant');
      expect(metadata.id).toBe(projectId);
      expect(metadata.name).toBe('Test Project');
      expect(metadata.updatedAt).toBeDefined();
      expect(metadata.updatedAt).not.toBe(originalMetadata.updatedAt);
    });

    it('should skip projects that already have ownerId', async () => {
      // Setup: Project with existing ownerId
      const projectId = 'test-project-123';
      mockBucket.setMockData(`projects/${projectId}/metadata.json`, {
        id: projectId,
        name: 'Existing Project',
        ownerId: 'legacy-single-tenant',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z'
      });

      // Execute: Migration attempt
      const report = await migrateOwnerIds(mockBucket as any, [projectId], false);

      // Verify: Project was skipped
      expect(report.migrated).toBe(0);
      expect(report.skipped).toBe(1);
      expect(report.results[0]).toEqual({
        projectId,
        status: 'skipped',
        before: 'legacy-single-tenant',
        after: 'legacy-single-tenant'
      });
    });

    it('should skip projects with Supabase user IDs', async () => {
      // Setup: Project with Supabase UUID
      const projectId = 'test-project-456';
      const supabaseId = '88f1690f-75c1-419a-9973-f0be57b7bcda';
      mockBucket.setMockData(`projects/${projectId}/metadata.json`, {
        id: projectId,
        name: 'User Project',
        ownerId: supabaseId,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z'
      });

      // Execute: Migration attempt
      const report = await migrateOwnerIds(mockBucket as any, [projectId], false);

      // Verify: Project was skipped
      expect(report.skipped).toBe(1);
      expect(report.results[0].before).toBe(supabaseId);
      expect(report.results[0].after).toBe(supabaseId);
    });
  });

  describe('Batch Migration', () => {
    it('should handle mixed migration scenarios', async () => {
      // Setup: Three projects with different states
      const project1 = 'needs-migration-1';
      const project2 = 'already-migrated-2';
      const project3 = 'needs-migration-3';

      mockBucket.setMockData(`projects/${project1}/metadata.json`, {
        id: project1,
        name: 'Project 1'
      });

      mockBucket.setMockData(`projects/${project2}/metadata.json`, {
        id: project2,
        name: 'Project 2',
        ownerId: 'legacy-single-tenant'
      });

      mockBucket.setMockData(`projects/${project3}/metadata.json`, {
        id: project3,
        name: 'Project 3'
      });

      // Execute: Batch migration
      const report = await migrateOwnerIds(
        mockBucket as any,
        [project1, project2, project3],
        false
      );

      // Verify: Correct counts
      expect(report.totalProcessed).toBe(3);
      expect(report.migrated).toBe(2);
      expect(report.skipped).toBe(1);
      expect(report.errors).toBe(0);

      // Verify: Individual results
      expect(report.results.find(r => r.projectId === project1)?.status).toBe('migrated');
      expect(report.results.find(r => r.projectId === project2)?.status).toBe('skipped');
      expect(report.results.find(r => r.projectId === project3)?.status).toBe('migrated');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing metadata files', async () => {
      const projectId = 'non-existent-project';

      // Execute: Migration attempt (no mock data set)
      const report = await migrateOwnerIds(mockBucket as any, [projectId], false);

      // Verify: Error reported
      expect(report.errors).toBe(1);
      expect(report.results[0]).toEqual({
        projectId,
        status: 'error',
        before: undefined,
        error: 'Metadata file not found'
      });
    });

    it('should handle malformed JSON', async () => {
      const projectId = 'malformed-project';

      // Setup: Invalid JSON
      (mockBucket as any).storage.set(
        `projects/${projectId}/metadata.json`,
        '{ invalid json content'
      );

      // Execute: Migration attempt
      const report = await migrateOwnerIds(mockBucket as any, [projectId], false);

      // Verify: Error reported
      expect(report.errors).toBe(1);
      expect(report.results[0].status).toBe('error');
      expect(report.results[0].error).toContain('JSON parse error');
    });

    it('should not fail entire batch if one project errors', async () => {
      const validProject = 'valid-project';
      const invalidProject = 'invalid-project';

      // Setup: One valid, one invalid
      mockBucket.setMockData(`projects/${validProject}/metadata.json`, {
        id: validProject,
        name: 'Valid'
      });

      (mockBucket as any).storage.set(
        `projects/${invalidProject}/metadata.json`,
        '{ invalid }'
      );

      // Execute: Batch migration
      const report = await migrateOwnerIds(
        mockBucket as any,
        [validProject, invalidProject],
        false
      );

      // Verify: Valid project migrated, invalid errored
      expect(report.totalProcessed).toBe(2);
      expect(report.migrated).toBe(1);
      expect(report.errors).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle ownerId: null', async () => {
      const projectId = 'null-owner-project';
      mockBucket.setMockData(`projects/${projectId}/metadata.json`, {
        id: projectId,
        ownerId: null
      });

      const report = await migrateOwnerIds(mockBucket as any, [projectId], false);

      expect(report.migrated).toBe(1);
      expect(report.results[0].before).toBe('null');
    });

    it('should handle ownerId: empty string', async () => {
      const projectId = 'empty-owner-project';
      mockBucket.setMockData(`projects/${projectId}/metadata.json`, {
        id: projectId,
        ownerId: ''
      });

      const report = await migrateOwnerIds(mockBucket as any, [projectId], false);

      expect(report.migrated).toBe(1);
      expect(report.results[0].before).toBe('empty');
    });

    it('should preserve all other metadata fields', async () => {
      const projectId = 'complex-project';
      const originalMetadata = {
        id: projectId,
        name: 'Complex Project',
        framework: 'react',
        customField: { nested: 'value' },
        tags: ['test', 'migration'],
        createdAt: '2025-01-01T00:00:00Z'
      };

      mockBucket.setMockData(`projects/${projectId}/metadata.json`, originalMetadata);

      const report = await migrateOwnerIds(mockBucket as any, [projectId], false);

      const updated = mockBucket.getMockData(`projects/${projectId}/metadata.json`);
      expect(updated.framework).toBe('react');
      expect(updated.customField).toEqual({ nested: 'value' });
      expect(updated.tags).toEqual(['test', 'migration']);
      expect(updated.ownerId).toBe('legacy-single-tenant');
    });
  });

  describe('Dry-Run Safety', () => {
    it('should not modify any data in dry-run mode', async () => {
      const projectIds = ['p1', 'p2', 'p3'];

      projectIds.forEach(id => {
        mockBucket.setMockData(`projects/${id}/metadata.json`, {
          id,
          name: `Project ${id}`
        });
      });

      // Execute: Dry-run
      await migrateOwnerIds(mockBucket as any, projectIds, true);

      // Verify: No changes
      projectIds.forEach(id => {
        const metadata = mockBucket.getMockData(`projects/${id}/metadata.json`);
        expect(metadata.ownerId).toBeUndefined();
      });
    });
  });
});
