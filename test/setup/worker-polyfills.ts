/**
 * Worker runtime polyfills executed before Vitest loads worker suites.
 * Augments minimal Node shims so libraries like TypeScript behave.
 */

import { vi } from 'vitest';
import fs from 'node:fs';
import process from 'node:process';
import { StorageService } from '@/services/StorageService';
import { Ok } from '@/lib/result';

// Stub heavy TypeScript-dependent utilities so Workers harness avoids node built-ins.
vi.mock('@/utils/jsxPreprocessor', () => ({
  preprocessJSX: (content: string) => content,
  preprocessJSXStateMachine: (content: string) => content,
  shouldPreprocessFile: () => false,
  isReactContent: () => false,
  preprocessFiles: (files: Record<string, string>) => ({ ...files }),
}));

vi.mock('@/utils/tsxNormalizer', () => ({
  normalizeTsx: (source: string) => ({ code: source, fixes: [], diagnostics: [], timeMs: 0 }),
}));

// Patch StorageService downloadFile to supply deterministic fixtures for worker tests.
const originalDownloadFile = StorageService.prototype.downloadFile;
StorageService.prototype.downloadFile = vi.fn(async function (this: StorageService, path: string) {
  const fixtures: Record<string, string> = {
    'projects/p1/github-runs/123.json': JSON.stringify({ projectId: 'p1', buildId: 'p1', githubRunId: 123 }),
    'projects/p1/metadata.json': JSON.stringify({
      id: 'p1',
      name: 'project-p1',
      framework: 'react',
      status: 'building',
      buildId: 'p1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    'builds/p1/metadata.json': JSON.stringify({
      id: 'p1',
      projectId: 'p1',
      status: 'success',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      artifactPath: 'builds/p1/dist/',
    }),
  };

  const match = fixtures[path];
  if (match) {
    return Ok(new TextEncoder().encode(match).buffer as ArrayBuffer);
  }

  return originalDownloadFile.call(this, path);
});

// Ensure realpathSync.native exists even if the shim only exposes the plain function.
if (fs && typeof fs.realpathSync === 'function' && !(fs.realpathSync as any).native) {
  const realpath = fs.realpathSync.bind(fs);
  (fs.realpathSync as any).native = realpath;
}

// Provide predictable platform metadata for downstream consumers.
if (typeof process.platform === 'undefined') {
  (process as any).platform = 'linux';
}
if (typeof process.arch === 'undefined') {
  (process as any).arch = 'x64';
}

// Normalize cwd getter in case the shim omits it.
if (!process.cwd) {
  process.cwd = () => '/';
}

// Provide minimal hrtime shim for libraries expecting it.
if (!process.hrtime) {
  (process as any).hrtime = () => [0, 0];
}

if (!process.hrtime.bigint) {
  (process.hrtime as any).bigint = () => BigInt(0);
}
