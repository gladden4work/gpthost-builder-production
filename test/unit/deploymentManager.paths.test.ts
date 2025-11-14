import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeploymentManager } from '../../src/utils/deploymentManager';
import { createUnitTestEnv } from '../helpers/testEnvironments';

describe('DeploymentManager path handling - Unit', () => {
  let env: any;

  beforeEach(() => {
    env = createUnitTestEnv();
  });

  it('listProjectBuilds returns timestamps from builds/{projectId}/', async () => {
    const projectId = 'test-proj';

    // Mock R2 list to return delimited prefixes under builds/{projectId}/
    (env.BUILDS_BUCKET.list as any) = vi.fn().mockResolvedValue({
      objects: [],
      delimitedPrefixes: [
        `builds/${projectId}/20240819-123000/`,
        `builds/${projectId}/20240818-120000/`,
      ],
    });

    const manager = createDeploymentManager(env);
    const builds = await manager.listProjectBuilds(projectId);

    // Should strip prefix and trailing slash, newest first
    expect(builds).toEqual(['20240819-123000', '20240818-120000']);
  });

  it('validateBuildExists checks for manifest at builds/{projectId}/{timestamp}/manifest.json', async () => {
    const projectId = 'test-proj';
    const latest = '20240819-123000';

    // list returns the latest first after manager sort
    ;(env.BUILDS_BUCKET.list as any) = vi.fn().mockResolvedValue({
      objects: [],
      delimitedPrefixes: [
        `builds/${projectId}/${latest}/`,
        `builds/${projectId}/20240818-120000/`,
      ],
    });

    // get returns a manifest for the latest path
    ;(env.BUILDS_BUCKET.get as any) = vi.fn().mockImplementation((key: string) => {
      if (key === `builds/${projectId}/${latest}/manifest.json`) {
        return Promise.resolve({ text: () => Promise.resolve('{"artifacts": []}') });
      }
      return Promise.resolve(null);
    });

    const manager = createDeploymentManager(env);
    const exists = await manager.validateBuildExists(projectId);
    expect(exists).toBe(true);
    expect(env.BUILDS_BUCKET.get).toHaveBeenCalledWith(`builds/${projectId}/${latest}/manifest.json`);
  });
});

