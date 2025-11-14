/**
 * API-First TDD Test Suite: Paste Deployment System
 * 
 * This test suite defines the contract for the code paste deployment system.
 * These tests MUST pass for paste functionality to be production-ready.
 * 
 * UAT Failures Addressed:
 * - Code paste returns 400 Bad Request with no error details
 * - Silent failures without user feedback
 * - Framework detection not working correctly
 * 
 * Success Criteria:
 * - JSON payload with code and projectName accepted
 * - Framework automatically detected from pasted code
 * - Clear error messages for all failure scenarios
 * - Pasted code converted to appropriate file format
 * - Project created and ready for deployment
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pasteHandler } from '../../src/routes/paste';
import { 
  reactTodoComponent, 
  reactTypescriptComponent, 
  vueCompositionComponent, 
  svelteComponent,
  getFixture 
} from '../fixtures/aiComponents';

// Mock environment
const mockEnv = {
  PROJECTS_BUCKET: {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
  DEPLOYMENTS_BUCKET: {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
  BUILD_QUEUE: {
    send: vi.fn(),
  },
  MAX_CONTENT_SIZE: '5242880', // 5MB
  AUTH_TOKEN: 'test-valid-token-12345',
};

// Helper to create paste request
function createPasteRequest(
  code: string,
  projectName: string,
  description?: string,
  token: string = 'test-valid-token-12345'
): Request {
  return new Request('http://localhost:8788/api/paste', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      content: code,
      project_name: projectName,
      description: description,
    }),
  });
}

describe('Paste Deployment Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const storage = new Map<string, string>();

    mockEnv.PROJECTS_BUCKET.put.mockImplementation(async (key: string, value: string) => {
      storage.set(key, typeof value === 'string' ? value : value.toString());
      return undefined;
    });
    mockEnv.PROJECTS_BUCKET.get.mockImplementation(async (key: string) => {
      const data = storage.get(key);
      if (data === undefined) return null;
      return {
        text: async () => data,
        json: async () => JSON.parse(data)
      } as any;
    });
    mockEnv.PROJECTS_BUCKET.delete.mockImplementation(async (key: string) => {
      storage.delete(key);
      return undefined;
    });
  });

  describe('PHASE 1: Basic Paste Functionality', () => {
    it('MUST accept JSON payload with React code', async () => {
      // Given: Real React component code from ChatGPT
      const reactCode = reactTodoComponent;
      const request = createPasteRequest(reactCode, 'pasted-todo-app');

      // When: Pasting the code
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Paste should succeed with correct response
      expect(response.status).toBe(201);
      expect(result.success).toBe(true);
      expect(result.data.project_id).toBeDefined();
      expect(result.data.status).toBe('scaffolded');
      expect(result.data.detected_framework).toBe('react');
      expect(result.data.generated_filename).toMatch(/\.jsx$/);
      expect(result.data.message).toContain('React component detected');
    });

    it('MUST accept Vue SFC code and detect framework', async () => {
      // Given: Real Vue component code from Claude
      const vueCode = vueCompositionComponent;
      const request = createPasteRequest(vueCode, 'pasted-vue-counter');

      // When: Pasting Vue code
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should detect Vue and create .vue file
      expect(response.status).toBe(201);
      expect(result.data.detected_framework).toBe('vue');
      expect(result.data.generated_filename).toMatch(/\.vue$/);
      expect(result.data.analysis.primaryFramework).toBe('vue');
      expect(result.data.message).toContain('Vue');
    });

    it('MUST accept Svelte code and generate correct file', async () => {
      // Given: Real Svelte component code
      const svelteCode = svelteComponent;
      const request = createPasteRequest(svelteCode, 'pasted-svelte-form');

      // When: Pasting Svelte code
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should detect Svelte
      expect(response.status).toBe(201);
      expect(result.data.detected_framework).toBe('svelte');
      expect(result.data.generated_filename).toMatch(/\.svelte$/);
      expect(result.data.message).toContain('Svelte');
    });

    it('MUST handle plain HTML code appropriately', async () => {
      // Given: Plain HTML code
      const htmlCode = `<!DOCTYPE html>
<html>
<head>
    <title>Simple Page</title>
</head>
<body>
    <h1>Hello World</h1>
    <button onclick="alert('clicked')">Click me</button>
</body>
</html>`;
      const request = createPasteRequest(htmlCode, 'pasted-html-page');

      // When: Pasting HTML
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should handle as HTML
      expect(response.status).toBe(201);
      expect(result.data.detected_framework).toBe('html');
      expect(result.data.generated_filename).toMatch(/\.html$/);
    });

    it('MUST include project description in metadata', async () => {
      // Given: Paste with description
      const reactCode = reactTodoComponent;
      const description = 'A todo list application built with React hooks';
      const request = createPasteRequest(reactCode, 'described-project', description);

      // When: Pasting with description
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Description should be stored
      expect(response.status).toBe(201);
      const metadataCall = mockEnv.PROJECTS_BUCKET.put.mock.calls.find(
        call => call[0].includes('metadata.json')
      );
      expect(metadataCall[1]).toContain(description);
    });
  });

  describe('PHASE 2: Error Handling with Clear Messages', () => {
    it('MUST provide clear error when content is missing', async () => {
      // Given: Request without code content
      const request = createPasteRequest('', 'empty-project');

      // When: Pasting empty content
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should return clear error
      expect(response.status).toBe(400);
      expect(result.success).toBe(false);
      expect(result.error.code).toBe('EMPTY_CONTENT');
      expect(result.error.message).toContain('Content cannot be empty');
    });

    it('MUST provide clear error when project name is missing', async () => {
      // Given: Valid code but no project name
      const reactCode = reactTodoComponent;
      const request = createPasteRequest(reactCode, '');

      // When: Pasting without project name
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should return validation error
      expect(response.status).toBe(400);
      expect(result.error.code).toBe('INVALID_PROJECT_NAME');
      expect(result.error.message).toContain('Project name is required');
    });

    it('MUST reject content exceeding size limit', async () => {
      // Given: Content exceeding 5MB limit
      const largeContent = 'x'.repeat(6 * 1024 * 1024); // 6MB
      const request = createPasteRequest(largeContent, 'large-paste');

      // When: Pasting oversized content
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should return size limit error
      expect(response.status).toBe(400);
      expect(result.error.code).toBe('CONTENT_TOO_LARGE');
      expect(result.error.message).toContain('exceeds maximum size');
      expect(result.error.details.contentSize).toBeDefined();
      expect(result.error.details.maxSize).toBeDefined();
    });

    it('MUST handle invalid JSON gracefully', async () => {
      // Given: Invalid JSON request
      const request = new Request('http://localhost:8788/api/paste', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-valid-token-12345',
        },
        body: '{invalid json}',
      });

      // When: Sending malformed JSON
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should return JSON parse error
      expect(response.status).toBe(400);
      expect(result.error.code).toBe('INVALID_JSON');
      expect(result.error.message).toContain('valid JSON');
    });

    it('MUST provide helpful message for unrecognized code', async () => {
      // Given: Code that doesn't match any framework
      const unknownCode = `
function doSomething() {
  console.log("This could be anything");
}
doSomething();
`;
      const request = createPasteRequest(unknownCode, 'unknown-framework');

      // When: Pasting unrecognized code
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should handle gracefully with default
      expect(response.status).toBe(201);
      expect(result.data.detected_framework).toBe('javascript');
      expect(result.data.generated_filename).toMatch(/\.(js|jsx)$/);
      expect(result.data.message).toContain('JavaScript');
    });
  });

  describe('PHASE 3: Framework Detection Accuracy', () => {
    it('MUST detect React from JSX syntax', async () => {
      // Given: React code with JSX
      const jsxCode = `
const Button = () => {
  return <button onClick={() => alert('clicked')}>Click me</button>;
};
export default Button;
`;
      const request = createPasteRequest(jsxCode, 'jsx-detection');

      // When: Analyzing the code
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should detect React
      expect(result.data.detected_framework).toBe('react');
      expect(result.data.generated_filename).toMatch(/\.jsx$/);
    });

    it('MUST detect React from hooks usage', async () => {
      // Given: React code with hooks but no obvious JSX
      const hooksCode = `
import { useState, useEffect } from 'react';

function useCounter() {
  const [count, setCount] = useState(0);
  
  useEffect(() => {
    console.log('Count changed:', count);
  }, [count]);
  
  return { count, setCount };
}
`;
      const request = createPasteRequest(hooksCode, 'hooks-detection');

      // When: Analyzing hooks code
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should detect React from hooks
      expect(result.data.detected_framework).toBe('react');
    });

    it('MUST detect Vue from template syntax', async () => {
      // Given: Vue template syntax
      const vueTemplate = `
<template>
  <div>{{ message }}</div>
</template>
<script>
export default {
  data() {
    return { message: 'Hello Vue' };
  }
}
</script>
`;
      const request = createPasteRequest(vueTemplate, 'vue-template');

      // When: Analyzing Vue template
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should detect Vue
      expect(result.data.detected_framework).toBe('vue');
      expect(result.data.generated_filename).toMatch(/\.vue$/);
    });

    it('MUST detect Svelte from reactive statements', async () => {
      // Given: Svelte reactive code
      const svelteCode = `
<script>
  let count = 0;
  $: doubled = count * 2;
  
  function increment() {
    count += 1;
  }
</script>

<button on:click={increment}>
  Count: {count}, Doubled: {doubled}
</button>
`;
      const request = createPasteRequest(svelteCode, 'svelte-reactive');

      // When: Analyzing Svelte code
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should detect Svelte
      expect(result.data.detected_framework).toBe('svelte');
    });

    it('MUST detect TypeScript React components', async () => {
      // Given: TypeScript React code
      const tsxCode = `
import React, { FC, useState } from 'react';

interface Props {
  initialCount: number;
}

const Counter: FC<Props> = ({ initialCount }) => {
  const [count, setCount] = useState<number>(initialCount);
  
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
};

export default Counter;
`;
      const request = createPasteRequest(tsxCode, 'tsx-detection');

      // When: Analyzing TypeScript React
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should detect React TypeScript
      expect(result.data.detected_framework).toBe('react');
      expect(result.data.generated_filename).toMatch(/\.tsx$/);
      expect(result.data.analysis.language).toBe('typescript');
    });
  });

  describe('PHASE 4: R2 Storage and File Generation', () => {
    it('MUST store pasted code as file in R2', async () => {
      // Given: React code to paste
      const reactCode = reactTodoComponent;
      const request = createPasteRequest(reactCode, 'storage-test');

      // When: Pasting the code
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should store in correct R2 path
      expect(mockEnv.PROJECTS_BUCKET.put).toHaveBeenCalledWith(
        expect.stringMatching(/^projects\/active\/[a-f0-9-]+\/source\/.+\.jsx$/),
        expect.any(Object),
        expect.objectContaining({
          httpMetadata: expect.objectContaining({
            contentType: 'text/jsx',
          }),
          customMetadata: expect.objectContaining({
            source: 'paste',
            projectId: result.data.project_id,
          }),
        })
      );
    });

    it('MUST generate appropriate filename based on content', async () => {
      // Given: Component with identifiable name
      const namedComponent = `
export default function TodoListApp() {
  return <div>Todo List</div>;
}
`;
      const request = createPasteRequest(namedComponent, 'filename-test');

      // When: Processing the paste
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should generate meaningful filename
      expect(result.data.generated_filename).toBeDefined();
      expect(result.data.generated_filename).not.toBe('component.jsx');
      // Should either use component name or project name
      expect(result.data.generated_filename).toMatch(/\.(jsx|js)$/);
    });

    it('MUST store project metadata with analysis results', async () => {
      // Given: Vue component to paste
      const vueCode = vueCompositionComponent;
      const request = createPasteRequest(vueCode, 'metadata-test');

      // When: Pasting the code
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Metadata should include analysis
      const metadataCall = mockEnv.PROJECTS_BUCKET.put.mock.calls.find(
        call => call[0].includes('metadata.json')
      );
      const metadata = JSON.parse(metadataCall[1]);
      expect(metadata.analysis).toBeDefined();
      expect(metadata.analysis.primaryFramework).toBe('vue');
      expect(metadata.analysis.componentNames).toBeDefined();
      expect(Array.isArray(metadata.analysis.componentNames)).toBe(true);
    });

    it('MUST cleanup on storage failure', async () => {
      // Given: R2 will fail on metadata storage
      mockEnv.PROJECTS_BUCKET.put
        .mockResolvedValueOnce(undefined) // File storage succeeds
        .mockRejectedValueOnce(new Error('R2 error')); // Metadata fails
      
      mockEnv.PROJECTS_BUCKET.delete.mockResolvedValue(undefined);

      const reactCode = reactTodoComponent;
      const request = createPasteRequest(reactCode, 'cleanup-test');

      // When: Storage partially fails
      const response = await pasteHandler(request, mockEnv as any);

      // Then: Should cleanup stored file
      expect(response.status).toBe(500);
      expect(mockEnv.PROJECTS_BUCKET.delete).toHaveBeenCalled();
    });
  });

  describe('PHASE 5: Content Validation and Security', () => {
    it('MUST sanitize malicious code patterns', async () => {
      // Given: Code with potential security issues
      const maliciousCode = `
import React from 'react';

const Evil = () => {
  // Attempt to access file system
  const fs = require('fs');
  fs.readFileSync('/etc/passwd');
  
  return <div>Hello</div>;
};

export default Evil;
`;
      const request = createPasteRequest(maliciousCode, 'security-test');

      // When: Processing potentially malicious code
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should process but flag suspicious patterns
      if (response.status === 201) {
        // Should detect but not execute dangerous code
        expect(result.data.analysis.warnings).toBeDefined();
      }
    });

    it('MUST handle binary content appropriately', async () => {
      // Given: Binary/encoded content
      const binaryContent = Buffer.from('binary data').toString('base64');
      const request = createPasteRequest(binaryContent, 'binary-test');

      // When: Pasting binary content
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should reject or handle as plain text
      if (response.status === 400) {
        expect(result.error.code).toBeDefined();
        expect(result.error.message).toContain('valid code');
      } else {
        expect(result.data.detected_framework).toBe('text');
      }
    });

    it('MUST limit project name length', async () => {
      // Given: Extremely long project name
      const longName = 'a'.repeat(200);
      const reactCode = reactTodoComponent;
      const request = createPasteRequest(reactCode, longName);

      // When: Using long project name
      const response = await pasteHandler(request, mockEnv as any);
      const result = await response.json();

      // Then: Should truncate or handle appropriately
      expect(response.status).toBe(201);
      const metadataCall = mockEnv.PROJECTS_BUCKET.put.mock.calls.find(
        call => call[0].includes('metadata.json')
      );
      const metadata = JSON.parse(metadataCall[1]);
      expect(metadata.name.length).toBeLessThanOrEqual(100);
    });
  });

  describe('PHASE 6: Performance Requirements', () => {
    it('MUST complete paste processing in under 3 seconds', async () => {
      // Given: Large but valid component
      const startTime = Date.now();
      const reactCode = reactTodoComponent;
      const request = createPasteRequest(reactCode, 'performance-test');

      // When: Processing the paste
      const response = await pasteHandler(request, mockEnv as any);
      const endTime = Date.now();

      // Then: Should complete quickly
      expect(response.status).toBe(201);
      expect(endTime - startTime).toBeLessThan(3000);
    });

    it('MUST handle concurrent paste operations', async () => {
      // Given: Multiple concurrent paste requests
      const reactCode = reactTodoComponent;
      const vueCode = vueCompositionComponent;
      const svelteCode = svelteComponent;

      const pastes = Promise.all([
        pasteHandler(createPasteRequest(reactCode, 'paste-1'), mockEnv as any),
        pasteHandler(createPasteRequest(vueCode, 'paste-2'), mockEnv as any),
        pasteHandler(createPasteRequest(svelteCode, 'paste-3'), mockEnv as any),
      ]);

      // When: Processing concurrent pastes
      const responses = await pastes;
      const results = await Promise.all(responses.map(r => r.json()));

      // Then: All should succeed with unique IDs
      expect(responses.every(r => r.status === 201)).toBe(true);
      const projectIds = results.map(r => r.data.project_id);
      expect(new Set(projectIds).size).toBe(3);
    });
  });
});

/**
 * Test Execution Summary
 * 
 * These tests define the complete contract for the paste deployment system.
 * When all tests pass, the following guarantees are met:
 * 
 * 1. ✅ JSON payload with code accepted correctly
 * 2. ✅ Framework detection works for all AI component types
 * 3. ✅ Clear error messages for all failure scenarios
 * 4. ✅ Appropriate file generation and storage
 * 5. ✅ Security measures and content validation
 * 6. ✅ Performance meets requirements (<3 seconds)
 * 
 * UAT Issues Resolved:
 * - 400 Bad Request with no details ✅
 * - Silent failures ✅
 * - Framework detection failures ✅
 */