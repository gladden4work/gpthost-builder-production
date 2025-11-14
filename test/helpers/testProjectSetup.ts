/**
 * Test Project Setup Helper
 * Creates proper test data for integration tests
 * 
 * This helper eliminates the TDD anti-pattern by providing
 * realistic test data that matches production types exactly.
 */

import { 
  ProjectMetadata, 
  ScaffoldedProject, 
  FrameworkType,
  ScaffoldedFile,
  FileMetadata,
  ProjectAnalysis,
  ComponentStructure,
  ComponentDetection,
  ExportAnalysis,
  ComponentComplexityAnalysis,
  AICodePatterns,
  DependencyAnalysis,
  ImportAnalysis
} from '../../src/types/api';

export interface TestProject {
  project_id: string;
  metadata: ProjectMetadata;
  scaffolding: ScaffoldedProject;
}

// Import the actual Env interface
// For MVP, we use type casting to match Cloudflare interfaces
// This is a minimal fix that maintains type safety while allowing mocks

// Properly typed mock environment that matches the real Env interface
export interface MockEnv extends Env {
  // MockEnv extends the real Env interface from worker-configuration.d.ts
  // The actual mock implementations are created in createMockEnv()
}

/**
 * Generate a valid UUID for test projects
 */
function generateTestUUID(): string {
  // Generate a valid UUID v4 for testing
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Create a complete test project with proper metadata and scaffolding
 * Fixed for TDD GREEN phase: Uses valid UUID project IDs that pass validation
 */
export async function createTestProject(
  projectId: string | null, 
  framework: FrameworkType,
  env: MockEnv,
  useTypeScript: boolean = false
): Promise<TestProject> {
  
  // Generate valid UUID if not provided or if provided ID is not a valid UUID
  const validProjectId = projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)
    ? projectId 
    : generateTestUUID();
  
  const metadata: ProjectMetadata = {
    id: validProjectId,
    status: 'analyzing',
    name: `test-${framework}-project`,
    description: 'Test project for TDD integration',
    framework: framework,
    files: [
      {
        id: `${validProjectId}-file-1`,
        name: getMainFileName(framework, useTypeScript),
        path: `source/${getMainFileName(framework, useTypeScript)}`,
        size: 1024,
        type: getMimeType(framework),
        upload_time: new Date().toISOString(),
        hash: 'test-hash-123'
      }
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    analysis: createTestAnalysis(framework)
  };

  const scaffolding: ScaffoldedProject = {
    files: createScaffoldedFiles(framework, useTypeScript),
    packageJson: createTestPackageJson(framework),
    framework: framework,
    buildConfig: createTestBuildConfig(framework),
    projectStructure: {
      hasTypeScript: useTypeScript,
      hasCSS: true,
      hasTesting: false
    },
    entryPoints: [
      {
        path: `src/${getMainFileName(framework, useTypeScript)}`,
        type: 'component',
        framework: framework,
        isMain: true
      }
    ]
  };

  // Store in mock R2 buckets
  await storeTestProject(validProjectId, metadata, scaffolding, env);
  
  return { project_id: validProjectId, metadata, scaffolding };
}

/**
 * Store test project data in functional R2 buckets
 * Updated for TDD GREEN phase: Actually stores data instead of just mocking
 */
async function storeTestProject(
  projectId: string,
  metadata: ProjectMetadata, 
  scaffolding: ScaffoldedProject,
  env: MockEnv
): Promise<void> {
  // Store data in functional R2 buckets (they have in-memory storage now)
  const metadataKey = `projects/${projectId}/metadata.json`;
  const scaffoldingKey = `projects/${projectId}/scaffolding.json`;
  
  // Actually store the data using the functional R2 bucket
  await env.PROJECTS_BUCKET.put(
    metadataKey,
    JSON.stringify(metadata, null, 2),
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        project_id: projectId,
        status: metadata.status,
        created_at: metadata.created_at
      }
    }
  );

  await env.PROJECTS_BUCKET.put(
    scaffoldingKey,
    JSON.stringify(scaffolding, null, 2),
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        project_id: projectId,
        framework: scaffolding.framework,
        created_at: new Date().toISOString()
      }
    }
  );
  
  console.log(`Test project ${projectId} stored with metadata and scaffolding`);
}

/**
 * Get main file name for framework (deterministic for reliable testing)
 */
function getMainFileName(framework: FrameworkType, useTypeScript: boolean = false): string {
  switch (framework) {
    case 'react':
      return useTypeScript ? 'App.tsx' : 'App.jsx';
    case 'vue':
      return 'App.vue';
    case 'svelte':
      return 'App.svelte';
    case 'html':
      return 'index.html';
    default:
      return 'App.jsx';
  }
}

/**
 * Get MIME type for framework
 */
function getMimeType(framework: FrameworkType): string {
  switch (framework) {
    case 'react':
      return 'text/jsx';
    case 'vue':
      return 'text/x-vue';
    case 'svelte':
      return 'text/x-svelte';
    case 'html':
      return 'text/html';
    default:
      return 'text/plain';
  }
}

/**
 * Create test component code for different frameworks
 */
function getTestComponentCode(framework: FrameworkType): string {
  switch (framework) {
    case 'react':
      return `import React, { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  
  return (
    <div className="app">
      <h1>Test React App</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
      <button onClick={() => setCount(count - 1)}>
        Decrement
      </button>
    </div>
  );
}`;

    case 'vue':
      return `<template>
  <div class="app">
    <h1>Test Vue App</h1>
    <p>Count: {{ count }}</p>
    <button @click="increment">Increment</button>
    <button @click="decrement">Decrement</button>
  </div>
</template>

<script>
export default {
  name: 'App',
  data() {
    return {
      count: 0
    }
  },
  methods: {
    increment() {
      this.count++
    },
    decrement() {
      this.count--
    }
  }
}
</script>

<style>
.app {
  padding: 20px;
}
</style>`;

    case 'svelte':
      return `<script>
  let count = 0;
  
  function increment() {
    count += 1;
  }
  
  function decrement() {
    count -= 1;
  }
</script>

<div class="app">
  <h1>Test Svelte App</h1>
  <p>Count: {count}</p>
  <button on:click={increment}>Increment</button>
  <button on:click={decrement}>Decrement</button>
</div>

<style>
  .app {
    padding: 20px;
  }
</style>`;

    case 'html':
      return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test HTML App</title>
</head>
<body>
    <div class="app">
        <h1>Test HTML App</h1>
        <p>Count: <span id="count">0</span></p>
        <button onclick="increment()">Increment</button>
        <button onclick="decrement()">Decrement</button>
    </div>
    
    <script>
        let count = 0;
        
        function increment() {
            count++;
            document.getElementById('count').textContent = count;
        }
        
        function decrement() {
            count--;
            document.getElementById('count').textContent = count;
        }
    </script>
</body>
</html>`;

    default:
      return `// Test ${framework} component
console.log('Hello from ${framework}!');`;
  }
}

/**
 * Create scaffolded files for test project
 */
function createScaffoldedFiles(framework: FrameworkType, useTypeScript: boolean = false): ScaffoldedFile[] {
  const files: ScaffoldedFile[] = [
    {
      path: `src/${getMainFileName(framework, useTypeScript)}`,
      content: getTestComponentCode(framework),
      type: 'component',
      isGenerated: false,
      template: 'user-component'
    },
    {
      path: 'package.json',
      content: JSON.stringify(createTestPackageJson(framework), null, 2),
      type: 'package',
      isGenerated: true,
      template: `${framework}-package-json`
    }
  ];

  // Add framework-specific files
  if (framework === 'react') {
    files.push({
      path: 'src/main.tsx',
      content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)`,
      type: 'entry',
      isGenerated: true,
      template: 'react-main'
    });

    files.push({
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})`,
      type: 'config',
      isGenerated: true,
      template: 'vite-config'
    });
  }

  if (framework === 'vue') {
    files.push({
      path: 'src/main.js',
      content: `import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')`,
      type: 'entry',
      isGenerated: true,
      template: 'vue-main'
    });
  }

  // Add index.html for all frameworks
  files.push({
    path: 'index.html',
    content: createTestIndexHtml(framework),
    type: 'html',
    isGenerated: true,
    template: 'index-html'
  });

  return files;
}

/**
 * Create test package.json
 */
function createTestPackageJson(framework: FrameworkType): any {
  const base = {
    name: `test-${framework}-app`,
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview'
    },
    devDependencies: {
      vite: '^4.4.5'
    }
  };

  switch (framework) {
    case 'react':
      return {
        ...base,
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0'
        },
        devDependencies: {
          ...base.devDependencies,
          '@types/react': '^18.2.15',
          '@types/react-dom': '^18.2.7',
          '@vitejs/plugin-react': '^4.0.3'
        }
      };

    case 'vue':
      return {
        ...base,
        dependencies: {
          vue: '^3.3.4'
        },
        devDependencies: {
          ...base.devDependencies,
          '@vitejs/plugin-vue': '^4.2.3'
        }
      };

    case 'svelte':
      return {
        ...base,
        dependencies: {
          svelte: '^4.0.5'
        },
        devDependencies: {
          ...base.devDependencies,
          '@sveltejs/vite-plugin-svelte': '^2.4.2'
        }
      };

    default:
      return base;
  }
}

/**
 * Create test build configuration
 */
function createTestBuildConfig(framework: FrameworkType): any {
  return {
    framework,
    entry: `src/${getMainFileName(framework, false)}`,
    output: 'dist',
    optimization: 'production',
    sourcemap: false,
    minify: true
  };
}

/**
 * Create test index.html
 */
function createTestIndexHtml(framework: FrameworkType): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Test ${framework.charAt(0).toUpperCase() + framework.slice(1)} App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
}

/**
 * Create test project analysis
 */
function createTestAnalysis(framework: FrameworkType, useTypeScript: boolean = false): ProjectAnalysis {
  return {
    primaryFramework: framework,
    componentType: 'single-component',
    totalComponents: 1,
    componentNames: ['App'],
    entryPoints: [`src/${getMainFileName(framework, useTypeScript)}`],
    dependencies: getTestDependencies(framework),
    analysisComplete: true,
    analysisTimestamp: new Date().toISOString(),
    componentStructure: createTestComponentStructure(framework),
    importAnalysis: createTestImportAnalysis(framework),
    confidence: 0.95
  };
}

/**
 * Create test dependencies
 */
function getTestDependencies(framework: FrameworkType): string[] {
  switch (framework) {
    case 'react':
      return ['react', 'react-dom'];
    case 'vue':
      return ['vue'];
    case 'svelte':
      return ['svelte'];
    default:
      return [];
  }
}

/**
 * Create test component structure
 */
function createTestComponentStructure(framework: FrameworkType): ComponentStructure {
  return {
    detection: {
      componentCount: 1,
      mainComponent: 'App',
      components: ['App'],
      framework: framework,
      hasMultipleComponents: false,
      isLibrary: false
    },
    exports: {
      default: {
        name: 'App',
        type: 'component',
        isComponent: true,
        componentType: 'functional',
        framework: framework
      },
      named: [],
      reExports: [],
      totalExports: 1,
      hasMultipleComponents: false
    },
    complexity: {
      score: 25,
      level: 'simple',
      factors: {
        linesOfCode: 50,
        cyclomaticComplexity: 2,
        dependencyCount: 2,
        exportCount: 1,
        hookCount: framework === 'react' ? 1 : 0
      },
      breakdown: {
        structure: 5,
        logic: 10,
        dependencies: 5,
        ui: 5
      }
    },
    patterns: {
      hasAIGeneratedCode: true,
      aiConfidence: 0.8,
      commonPatterns: ['state-management', 'event-handling'],
      codeQuality: 'good',
      suggestions: []
    }
  };
}

/**
 * Create test import analysis
 */
function createTestImportAnalysis(framework: FrameworkType): ImportAnalysis {
  const dependencies: DependencyAnalysis = {
    external: getTestDependencies(framework),
    local: [],
    nodeBuiltins: [],
    scoped: [],
    assets: [],
    dynamicImports: [],
    typeOnlyImports: [],
    allUnique: getTestDependencies(framework)
  };

  return {
    statements: [],
    dependencies,
    hasCircularImports: false,
    unusedImports: [],
    importCount: {
      total: dependencies.external.length,
      es6: dependencies.external.length,
      commonjs: 0,
      dynamic: 0,
      typeOnly: 0,
      assets: 0
    }
  };
}

/**
 * Create functional test environment that works with both mocks and real infrastructure
 * Fixed for TDD GREEN phase: Provides working R2 storage for integration tests
 */
export function createMockEnv(): MockEnv {
  // Use vi from vitest for mocking  
  const vi = require('vitest').vi;
  
  // Create functional R2 bucket that stores data in memory for tests
  const createWorkingR2BucketMock = () => {
    const storage = new Map<string, any>();
    
    return {
      put: vi.fn().mockImplementation(async (key: string, content: any, options?: any) => {
        // Store both content and metadata for realistic behavior
        storage.set(key, {
          content: typeof content === 'string' ? content : JSON.stringify(content),
          metadata: options?.customMetadata || {},
          httpMetadata: options?.httpMetadata || {}
        });
        return undefined;
      }),
      get: vi.fn().mockImplementation(async (key: string) => {
        const stored = storage.get(key);
        if (!stored) return null;
        
        // Return object that matches R2Object interface
        return {
          key,
          customMetadata: stored.metadata,
          httpMetadata: stored.httpMetadata,
          text: () => Promise.resolve(stored.content),
          json: () => Promise.resolve(JSON.parse(stored.content)),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
          body: stored.content
        };
      }),
      list: vi.fn().mockImplementation(async (options?: any) => {
        const prefix = options?.prefix || '';
        const objects = Array.from(storage.keys())
          .filter(key => key.startsWith(prefix))
          .map(key => ({
            key,
            customMetadata: storage.get(key)?.metadata || {}
          }));
        return { objects };
      }),
      delete: vi.fn().mockImplementation(async (key: string) => {
        storage.delete(key);
        return undefined;
      }),
      head: vi.fn().mockResolvedValue(null),
      createMultipartUpload: vi.fn(),
      resumeMultipartUpload: vi.fn()
    } as unknown as R2Bucket;
  };
  
  // Create functional Queue mock
  const createWorkingQueueMock = () => ({
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue(undefined)
  } as unknown as Queue);
  
  return {
    // Environment configuration
    ENVIRONMENT: "test",
    MAX_FILE_SIZE: "104857600", 
    SUPPORTED_EXTENSIONS: ".html,.jsx,.tsx,.vue,.svelte",
    DEPLOYMENT_DOMAIN: "test-deployments.r2.dev",
    
    // Working R2 Bucket mocks with in-memory storage
    PROJECTS_BUCKET: createWorkingR2BucketMock(),
    BUILDS_BUCKET: createWorkingR2BucketMock(),
    DEPLOYMENTS_BUCKET: createWorkingR2BucketMock(),
    
    // Working Queue mock
    BUILD_QUEUE: createWorkingQueueMock(),
    
    // Authentication
    MVP_ACCESS_TOKEN: 'test-valid-token-12345',
    GITHUB_CALLBACK_TOKEN: 'test-callback-token-12345',
    
    // GitHub Integration - configured for simulation mode
    GITHUB_TOKEN: 'test-github-token',
    GITHUB_REPOSITORY: 'test-org/test-repo',
    GITHUB_WORKFLOW_FILENAME: 'gpthost-build.yml',
    GITHUB_BUILD_CALLBACK_URL: 'http://localhost:8787/api/v2/github/build-callback',
    GITHUB_MAX_RETRY_ATTEMPTS: '3',
    GITHUB_RETRY_BASE_DELAY_MS: '1000',
    GITHUB_RETRY_MAX_DELAY_MS: '30000',
    GITHUB_RATE_LIMIT_RETRY_DELAY_MS: '60000',
    
    // Polling Configuration  
    POLLING_INITIAL_INTERVAL_MS: '2000',
    POLLING_NORMAL_INTERVAL_MS: '5000'
  } as MockEnv;  // Ensure the full object matches MockEnv interface
}
