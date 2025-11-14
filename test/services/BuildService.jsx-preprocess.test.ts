/**
 * BuildService JSX preprocessing test
 * Verifies we fix AI-style double braces without breaking style objects
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BuildService } from '../../src/services/BuildService';
import type { IProjectService, IGitHubService, IStorageService, Project, WorkflowRun } from '../../src/services/interfaces';
import { ProjectStatus } from '../../src/services/interfaces';
import { Ok } from '../../src/lib/result';

describe('BuildService - JSX preprocessing', () => {
  let service: BuildService;
  let mockProjectService: IProjectService;
  let mockGitHubService: IGitHubService;
  let mockStorageService: IStorageService;

  beforeEach(() => {
    mockProjectService = {
      createProject: vi.fn(),
      getProject: vi.fn().mockResolvedValue(Ok({ id: 'p1', status: ProjectStatus.PENDING } as any)),
      updateProject: vi.fn().mockResolvedValue(Ok({} as any)),
      deleteProject: vi.fn(),
      listProjects: vi.fn(),
    };

    mockGitHubService = {
      triggerWorkflow: vi.fn(),
      getWorkflowStatus: vi.fn(),
      handleWebhookCallback: vi.fn(),
      validateWebhookSignature: vi.fn(),
    };

    mockStorageService = {
      uploadFile: vi.fn().mockResolvedValue(Ok(undefined)),
      downloadFile: vi.fn(),
      deleteFile: vi.fn(),
      listFiles: vi.fn(),
      fileExists: vi.fn(),
    };

    service = new BuildService(
      // constructor(projectService, githubService, storageService, env?) in this package
      mockProjectService as any,
      mockGitHubService as any,
      mockStorageService as any,
      undefined
    );
  });

  it('replaces double-brace expressions in JSX text while preserving style objects', async () => {
    const badJsx = `import React, { useState } from 'react';

function C() {
  const [count, setCount] = useState(0);
  const isActive = count > 0;
  return (
    <div>
      <div style={{ padding: '20px', backgroundColor: '#f0f0f0' }}>
        <h1 style={{ color: '#333', fontSize: '24px' }}>OK</h1>
      </div>
      <p>{{isActive && \`Count is \${count}\`}}</p>
      <div>{count === 0 && "Click to start"}</div>
      <footer>{{isActive && \`Total clicks: \${count}\`}}</footer>
    </div>
  );
}
export default C;`;

    const project: Project = {
      id: 'proj-1',
      name: 'test',
      framework: 'react' as any,
      status: ProjectStatus.PENDING,
      files: [{ path: 'src/components/component.jsx', content: badJsx }],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    const workflowRun: WorkflowRun = {
      id: 123,
      status: 'queued',
      htmlUrl: 'https://example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(mockGitHubService.triggerWorkflow).mockResolvedValue(Ok(workflowRun));

    const res = await service.queueBuild(project);
    expect(res.ok).toBe(true);

    // Inspect payload passed to GitHubService
    expect(mockGitHubService.triggerWorkflow).toHaveBeenCalled();
    const call = vi.mocked(mockGitHubService.triggerWorkflow).mock.calls[0][0];

    const files = JSON.parse(call.inputs.source_files) as Record<string, string>;
    const cleaned = files['src/components/component.jsx'];

    // Style objects must remain with double braces
    expect(cleaned).toMatch(/style=\{\{\s*padding:\s*'20px'/);
    // Double-brace text wrappers must be reduced to single brace
    expect(cleaned).not.toContain('{{isActive');
    expect(cleaned).toContain('{isActive && `Count is');
    expect(cleaned).toContain('{isActive && `Total clicks:');
    // Existing valid single-brace expressions remain untouched
    expect(cleaned).toContain('{count === 0 && "Click to start"}');
  });
});
