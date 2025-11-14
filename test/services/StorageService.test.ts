// StorageService RED tests (Day 3 TDD 1.1/1.2)
// Aligns with .claude/steering error codes and Result pattern

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { R2Bucket } from '@cloudflare/workers-types';

// These imports will be implemented in 1.3 (GREEN phase)
import { StorageService } from '../../src/services/StorageService';
import { Ok, Err } from '../../src/lib/result';
import { StorageErrorCode } from '../../src/lib/errors';

describe('StorageService', () => {
  let service: StorageService;
  let mockR2Bucket: any; // Simplified: using any to avoid complex type issues

  beforeEach(() => {
    // Create a simplified mock R2Bucket
    mockR2Bucket = {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      head: vi.fn(),
      createMultipartUpload: vi.fn(),
      resumeMultipartUpload: vi.fn()
    };

    service = new StorageService(mockR2Bucket as R2Bucket);
  });

  describe('uploadFile', () => {
    it('should upload file successfully to R2', async () => {
      const path = 'projects/test-id/src/App.tsx';
      const content = new TextEncoder().encode('export default function App() {}');
      const metadata = { contentType: 'text/typescript' };

      mockR2Bucket.put.mockResolvedValue({
        key: path,
        version: '1',
        size: content.byteLength,
        uploaded: new Date()
      });

      const result = await service.uploadFile(path, content, metadata);

      expect(result.ok).toBe(true);
      expect(mockR2Bucket.put).toHaveBeenCalledWith(path, content, {
        customMetadata: metadata
      });
    });

    it('should return error when upload fails', async () => {
      const path = 'projects/test-id/src/App.tsx';
      const content = new TextEncoder().encode('content');

      mockR2Bucket.put.mockRejectedValue(new Error('R2 connection failed'));

      const result = await service.uploadFile(path, content);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(StorageErrorCode.OPERATION_FAILED);
        expect(result.error.message).toContain('R2 connection failed');
      }
    });

    it('should validate path against traversal attacks', async () => {
      const maliciousPath = '../../../etc/passwd';
      const content = new TextEncoder().encode('malicious');

      const result = await service.uploadFile(maliciousPath, content);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(StorageErrorCode.INVALID_PATH);
        expect(result.error.message).toContain('Path traversal');
      }
    });
  });

  describe('downloadFile', () => {
    it('should download file successfully from R2', async () => {
      const path = 'projects/test-id/dist/index.html';
      const expectedContent = new TextEncoder().encode('<html>Test</html>');

      mockR2Bucket.get.mockResolvedValue({
        body: expectedContent,
        bodyUsed: false,
        arrayBuffer: () => Promise.resolve(expectedContent.buffer),
        customMetadata: { contentType: 'text/html' }
      });

      const result = await service.downloadFile(path);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(expectedContent.buffer);
      }
      expect(mockR2Bucket.get).toHaveBeenCalledWith(path);
    });

    it('should return NOT_FOUND error for missing files', async () => {
      const path = 'projects/test-id/missing.txt';
      mockR2Bucket.get.mockResolvedValue(null);

      const result = await service.downloadFile(path);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(StorageErrorCode.NOT_FOUND);
        expect(result.error.message).toContain(path);
      }
    });
  });

  describe('listFiles', () => {
    it('should list files with prefix', async () => {
      const prefix = 'projects/test-id/';
      const mockObjects = [
        { key: 'projects/test-id/src/App.tsx', size: 1024, uploaded: new Date() },
        { key: 'projects/test-id/src/index.tsx', size: 512, uploaded: new Date() }
      ];

      mockR2Bucket.list.mockResolvedValue({
        objects: mockObjects,
        truncated: false,
        cursor: undefined
      });

      const result = await service.listFiles(prefix);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].key).toBe('projects/test-id/src/App.tsx');
        expect(result.value[0].size).toBe(1024);
      }
    });

    it('should handle pagination with cursor', async () => {
      const prefix = 'projects/test-id/';
      const cursor = 'next-page-cursor';

      mockR2Bucket.list.mockResolvedValue({
        objects: [],
        truncated: true,
        cursor: 'next-cursor'
      });

      const result = await service.listFiles(prefix, { cursor });

      expect(mockR2Bucket.list).toHaveBeenCalledWith({
        prefix,
        cursor,
        limit: 1000
      });
    });
  });

  describe('deleteFile', () => {
    it('should delete single file', async () => {
      const path = 'projects/test-id/old-file.txt';
      mockR2Bucket.delete.mockResolvedValue(undefined);

      const result = await service.deleteFile(path);

      expect(result.ok).toBe(true);
      expect(mockR2Bucket.delete).toHaveBeenCalledWith(path);
    });

    it('should delete directory recursively', async () => {
      const dirPath = 'projects/test-id/';
      const mockObjects = [
        { key: 'projects/test-id/file1.txt' },
        { key: 'projects/test-id/file2.txt' }
      ];

      mockR2Bucket.list.mockResolvedValue({
        objects: mockObjects,
        truncated: false
      });
      mockR2Bucket.delete.mockResolvedValue(undefined);

      const result = await service.deleteFile(dirPath);

      expect(result.ok).toBe(true);
      expect(mockR2Bucket.delete).toHaveBeenCalledWith(['projects/test-id/file1.txt', 'projects/test-id/file2.txt']);
    });
  });

  describe('copyDirectory', () => {
    it('should copy all files from source to destination', async () => {
      const source = 'builds/test-id/';
      const destination = 'sites/test-id/';

      const mockObjects = [
        { key: 'builds/test-id/index.html', size: 1024 },
        { key: 'builds/test-id/app.js', size: 2048 }
      ];

      mockR2Bucket.list.mockResolvedValue({
        objects: mockObjects,
        truncated: false
      });

      mockR2Bucket.get.mockImplementation((key) => {
        const content = key.includes('index.html') ? '<html>Test</html>' : 'console.log("app")';
        const buf = new TextEncoder().encode(content);
        return Promise.resolve({
          body: buf,
          arrayBuffer: () => Promise.resolve(buf.buffer)
        });
      });
      
      mockR2Bucket.head.mockImplementation(() => Promise.resolve({
        httpMetadata: {},
        customMetadata: {}
      }));

      mockR2Bucket.put.mockResolvedValue({});

      const result = await service.copyDirectory(source, destination);

      expect(result.ok).toBe(true);
      expect(mockR2Bucket.put).toHaveBeenCalledTimes(2);
      expect(mockR2Bucket.put).toHaveBeenCalledWith(
        'sites/test-id/index.html',
        expect.any(ArrayBuffer),
        expect.any(Object)
      );
    });
  });

  describe('exists', () => {
    it('should return true for existing file', async () => {
      const path = 'projects/test-id/package.json';
      mockR2Bucket.head.mockResolvedValue({
        key: path,
        size: 256,
        uploaded: new Date()
      });

      const result = await service.exists(path);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(true);
      }
    });

    it('should return false for non-existing file', async () => {
      const path = 'projects/test-id/missing.txt';
      mockR2Bucket.head.mockResolvedValue(null);

      const result = await service.exists(path);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(false);
      }
    });
  });

  describe('getMetadata', () => {
    it('should return file metadata without downloading content', async () => {
      const path = 'projects/test-id/README.md';
      const uploadDate = new Date();

      mockR2Bucket.head.mockResolvedValue({
        key: path,
        size: 1024,
        uploaded: uploadDate,
        etag: '"abc123"',
        httpMetadata: { contentType: 'text/markdown' },
        customMetadata: { author: 'test-user' }
      });

      const result = await service.getMetadata(path);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.size).toBe(1024);
        expect(result.value.contentType).toBe('text/markdown');
        expect(result.value.etag).toBe('"abc123"');
        expect(result.value.customMetadata?.author).toBe('test-user');
      }
    });
  });
});

describe('StorageService Performance', () => {
  let service: StorageService;
  let mockR2Bucket: any;

  beforeEach(() => {
    mockR2Bucket = {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      head: vi.fn()
    };
    service = new StorageService(mockR2Bucket as R2Bucket);
  });

  it('should complete upload operation within 100ms', async () => {
    const path = 'projects/test-id/large-file.js';
    const content = new ArrayBuffer(1024 * 1024); // 1MB file

    mockR2Bucket.put.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({}), 50))
    );

    const startTime = performance.now();
    const result = await service.uploadFile(path, content);
    const duration = performance.now() - startTime;

    expect(result.ok).toBe(true);
    expect(duration).toBeLessThan(100);
  });

  it('should handle concurrent operations efficiently', async () => {
    const operations = Array.from({ length: 10 }, (_, i) => ({
      path: `projects/test-id/file-${i}.txt`,
      content: new TextEncoder().encode(`Content ${i}`)
    }));

    mockR2Bucket.put.mockResolvedValue({});

    const startTime = performance.now();
    const results = await Promise.all(
      operations.map(op => service.uploadFile(op.path, op.content))
    );
    const duration = performance.now() - startTime;

    expect(results.every(r => r.ok)).toBe(true);
    expect(duration).toBeLessThan(200);
  });
});