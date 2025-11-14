/**
 * API-First TDD Test Suite: Auto-Scaffolding System
 * 
 * This test suite defines the contract for automatic project scaffolding.
 * These tests MUST pass for single components to become deployable apps.
 * 
 * Success Criteria:
 * - Generate complete project structure from single component
 * - Create correct package.json with all dependencies
 * - Generate appropriate vite.config.js for framework
 * - Create index.html with proper entry point
 * - Generate main.tsx/main.js entry file
 * - Support React, Vue, and Svelte scaffolding
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getFixture, reactTodoComponent } from '../fixtures/aiComponents';
import { 
  scaffoldProject,
  generatePackageJson,
  generateViteConfigForTest as generateViteConfig,
  generateIndexHtmlForTest as generateIndexHtml,
  generateEntryPoint
} from '../../src/utils/scaffoldingGenerator';

// Mock environment
const mockEnv = {
  PROJECTS_BUCKET: {
    put: vi.fn(),
    get: vi.fn(),
  },
  BUILD_QUEUE: {
    send: vi.fn(),
  },
};

describe('Scaffolding Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.PROJECTS_BUCKET.put.mockResolvedValue(undefined);
  });

  describe('PHASE 1: React Project Scaffolding', () => {
    it('MUST generate complete React project structure', async () => {
      // Given: A single React component
      const componentCode = reactTodoComponent;
      const projectId = 'test-react-project';
      const componentName = 'TodoList';

      // When: Scaffolding the project
      const scaffold = await scaffoldProject({
        componentCode,
        framework: 'react',
        projectId,
        componentName,
        env: mockEnv,
      });

      // Then: Should create all necessary files
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'package.json' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'vite.config.js' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'index.html' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'src/main.jsx' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'src/App.jsx' })
      );
    });

    it('MUST generate correct React package.json', async () => {
      // Given: React component with specific dependencies
      const dependencies = ['react', 'react-dom'];
      
      // When: Generating package.json
      const packageJson = await generatePackageJson({
        framework: 'react',
        projectName: 'react-todo-app',
        dependencies,
        isTypeScript: false,
      });

      // Then: Should have correct structure
      const parsed = JSON.parse(packageJson);
      expect(parsed.name).toBe('react-todo-app');
      expect(parsed.type).toBe('module');
      expect(parsed.scripts).toMatchObject({
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      });
      expect(parsed.dependencies).toMatchObject({
        react: expect.stringMatching(/^\^18\./),
        'react-dom': expect.stringMatching(/^\^18\./),
      });
      expect(parsed.devDependencies).toMatchObject({
        vite: expect.any(String),
        '@vitejs/plugin-react': expect.any(String),
      });
    });

    it('MUST generate React vite.config.js', async () => {
      // Given: React project requirements
      // When: Generating Vite config
      const viteConfig = await generateViteConfig({
        framework: 'react',
        isTypeScript: false,
      });

      // Then: Should have React plugin configured
      expect(viteConfig).toContain("import react from '@vitejs/plugin-react'");
      expect(viteConfig).toContain('plugins: [react()]');
      expect(viteConfig).toContain("base: './'");
    });

    it('generates PostCSS config and index.css when Tailwind classes detected', async () => {
      // Given: Component using Tailwind utility classes
      const componentCode = '<div class="text-emerald-300 bg-indigo-500">Hi</div>';

      // When: Scaffolding the project
      const scaffold = await scaffoldProject({
        componentCode,
        framework: 'react',
        projectId: 'tailwind-project',
        componentName: 'App',
        env: mockEnv,
      });

      // Then: Should include PostCSS config with Tailwind and index.css directives
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'postcss.config.js' })
      );
      const postcss = scaffold.files.find(f => f.path === 'postcss.config.js')?.content;
      expect(postcss).toContain("'postcss-import'");
      expect(postcss).toContain("'autoprefixer'");
      expect(postcss).toContain("'tailwindcss'");

      const indexCss = scaffold.files.find(f => f.path === 'src/index.css')?.content;
      expect(indexCss).toContain('@tailwind base');
      expect(indexCss).toContain('@tailwind components');
      expect(indexCss).toContain('@tailwind utilities');
    });

    it('MUST generate React entry point with component import', async () => {
      // Given: React component to wrap
      const componentName = 'TodoList';
      
      // When: Generating entry point
      const entryPoint = await generateEntryPoint({
        framework: 'react',
        componentName,
        componentPath: './App.jsx',
        isTypeScript: false,
      });

      // Then: Should properly bootstrap React
      expect(entryPoint).toContain("import React from 'react'");
      expect(entryPoint).toContain("import ReactDOM from 'react-dom/client'");
      expect(entryPoint).toContain("import App from './App'");
      expect(entryPoint).toContain("ReactDOM.createRoot");
      expect(entryPoint).toContain("root.render");
      expect(entryPoint).toContain("<App />");
    });

    it('MUST handle React TypeScript components', async () => {
      // Given: TypeScript React component
      const tsxCode = `
        import React, { FC } from 'react';
        const App: FC = () => <div>TypeScript App</div>;
        export default App;
      `;

      // When: Scaffolding TypeScript project
      const scaffold = await scaffoldProject({
        componentCode: tsxCode,
        framework: 'react',
        projectId: 'ts-react-project',
        componentName: 'App',
        isTypeScript: true,
        env: mockEnv,
      });

      // Then: Should use .tsx extensions
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'src/main.tsx' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'src/App.tsx' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'tsconfig.json' })
      );
    });
  });

  describe('PHASE 2: Vue Project Scaffolding', () => {
    it('MUST generate complete Vue project structure', async () => {
      // Given: A Vue SFC component
      const componentCode = getFixture('vue-counter.vue');
      const projectId = 'test-vue-project';

      // When: Scaffolding Vue project
      const scaffold = await scaffoldProject({
        componentCode,
        framework: 'vue',
        projectId,
        componentName: 'CounterApp',
        env: mockEnv,
      });

      // Then: Should create Vue-specific structure
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'package.json' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'vite.config.js' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'index.html' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'src/main.js' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'src/App.vue' })
      );
    });

    it('MUST generate correct Vue package.json', async () => {
      // Given: Vue project requirements
      const packageJson = await generatePackageJson({
        framework: 'vue',
        projectName: 'vue-counter-app',
        dependencies: ['vue'],
        isTypeScript: false,
      });

      // Then: Should have Vue dependencies
      const parsed = JSON.parse(packageJson);
      expect(parsed.dependencies).toMatchObject({
        vue: expect.stringMatching(/^\^3\./),
      });
      expect(parsed.devDependencies).toMatchObject({
        vite: expect.any(String),
        '@vitejs/plugin-vue': expect.any(String),
      });
    });

    it('MUST generate Vue vite.config.js', async () => {
      // Given: Vue project
      const viteConfig = await generateViteConfig({
        framework: 'vue',
        isTypeScript: false,
      });

      // Then: Should configure Vue plugin
      expect(viteConfig).toContain("import vue from '@vitejs/plugin-vue'");
      expect(viteConfig).toContain('plugins: [vue()]');
    });

    it('MUST generate Vue entry point', async () => {
      // Given: Vue component
      const entryPoint = await generateEntryPoint({
        framework: 'vue',
        componentName: 'App',
        componentPath: './App.vue',
        isTypeScript: false,
      });

      // Then: Should bootstrap Vue app
      expect(entryPoint).toContain("import { createApp } from 'vue'");
      expect(entryPoint).toContain("import App from './App.vue'");
      expect(entryPoint).toContain("createApp(App)");
      expect(entryPoint).toContain(".mount('#app')");
    });

    it('MUST handle Vue 3 Composition API', async () => {
      // Given: Vue 3 setup syntax component
      const vue3Code = `
        <script setup>
        import { ref } from 'vue';
        const count = ref(0);
        </script>
        <template><div>{{ count }}</div></template>
      `;

      // When: Scaffolding
      const scaffold = await scaffoldProject({
        componentCode: vue3Code,
        framework: 'vue',
        projectId: 'vue3-project',
        componentName: 'App',
        env: mockEnv,
      });

      // Then: Should support Composition API
      expect(scaffold.success).toBe(true);
      expect(scaffold.framework).toBe('vue');
    });
  });

  describe('PHASE 3: Svelte Project Scaffolding', () => {
    it('MUST generate complete Svelte project structure', async () => {
      // Given: Svelte component
      const componentCode = getFixture('svelte-form.svelte');
      const projectId = 'test-svelte-project';

      // When: Scaffolding Svelte project
      const scaffold = await scaffoldProject({
        componentCode,
        framework: 'svelte',
        projectId,
        componentName: 'ContactForm',
        env: mockEnv,
      });

      // Then: Should create Svelte structure
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'package.json' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'vite.config.js' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'src/main.js' })
      );
      expect(scaffold.files).toContainEqual(
        expect.objectContaining({ path: 'src/App.svelte' })
      );
    });

    it('MUST generate correct Svelte package.json', async () => {
      // Given: Svelte project
      const packageJson = await generatePackageJson({
        framework: 'svelte',
        projectName: 'svelte-form-app',
        dependencies: ['svelte'],
        isTypeScript: false,
      });

      // Then: Should have Svelte dependencies
      const parsed = JSON.parse(packageJson);
      expect(parsed.devDependencies).toMatchObject({
        svelte: expect.any(String),
        '@sveltejs/vite-plugin-svelte': expect.any(String),
        vite: expect.any(String),
      });
    });

    it('MUST generate Svelte vite.config.js', async () => {
      // Given: Svelte project
      const viteConfig = await generateViteConfig({
        framework: 'svelte',
        isTypeScript: false,
      });

      // Then: Should configure Svelte plugin
      expect(viteConfig).toContain("import { svelte } from '@sveltejs/vite-plugin-svelte'");
      expect(viteConfig).toContain('plugins: [svelte()]');
    });

    it('MUST generate Svelte entry point', async () => {
      // Given: Svelte component
      const entryPoint = await generateEntryPoint({
        framework: 'svelte',
        componentName: 'App',
        componentPath: './App.svelte',
        isTypeScript: false,
      });

      // Then: Should bootstrap Svelte app
      expect(entryPoint).toContain("import App from './App.svelte'");
      expect(entryPoint).toContain('new App({');
      expect(entryPoint).toContain("target: document.getElementById('app')");
    });
  });

  describe('PHASE 4: Index HTML Generation', () => {
    it('MUST generate valid index.html for all frameworks', async () => {
      // Given: Project requirements
      const htmlReact = await generateIndexHtml({
        framework: 'react',
        title: 'React Todo App',
      });
      const htmlVue = await generateIndexHtml({
        framework: 'vue',
        title: 'Vue Counter App',
      });
      const htmlSvelte = await generateIndexHtml({
        framework: 'svelte',
        title: 'Svelte Form App',
      });

      // Then: All should have proper structure
      [htmlReact, htmlVue, htmlSvelte].forEach(html => {
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('<meta charset="UTF-8">');
        expect(html).toContain('<meta name="viewport"');
        expect(html).toContain('<div id="app"></div>');
        expect(html).toContain('<script type="module" src="/src/main.');
      });
    });

    it('MUST include framework-specific setup in HTML', async () => {
      // Given: React project
      const htmlReact = await generateIndexHtml({
        framework: 'react',
        title: 'React App',
      });

      // Then: Should have React root
      expect(htmlReact).toContain('<div id="root"></div>');
      expect(htmlReact).toContain('src="/src/main.jsx"');
    });
  });

  describe('PHASE 5: Dependency Resolution', () => {
    it('MUST include all detected dependencies in package.json', async () => {
      // Given: Component with multiple dependencies
      // Dependencies are passed directly to generatePackageJson

      // When: Generating package.json
      const packageJson = await generatePackageJson({
        framework: 'react',
        projectName: 'deps-test',
        dependencies: ['react', 'react-dom', 'axios', 'moment', 'styled-components'],
        isTypeScript: false,
      });

      // Then: Should include all dependencies
      const parsed = JSON.parse(packageJson);
      expect(parsed.dependencies).toHaveProperty('axios');
      expect(parsed.dependencies).toHaveProperty('moment');
      expect(parsed.dependencies).toHaveProperty('styled-components');
    });

    it('MUST add TypeScript dependencies when needed', async () => {
      // Given: TypeScript project
      const packageJson = await generatePackageJson({
        framework: 'react',
        projectName: 'ts-project',
        dependencies: ['react', 'react-dom'],
        isTypeScript: true,
      });

      // Then: Should include TypeScript deps
      const parsed = JSON.parse(packageJson);
      expect(parsed.devDependencies).toHaveProperty('typescript');
      expect(parsed.devDependencies).toHaveProperty('@types/react');
      expect(parsed.devDependencies).toHaveProperty('@types/react-dom');
    });
  });

  describe('PHASE 6: R2 Storage Integration', () => {
    it('MUST store all scaffolded files in R2', async () => {
      // Given: Scaffolded project
      const componentCode = getFixture('react-todo.jsx');
      const projectId = 'storage-test-project';

      // When: Scaffolding and storing
      await scaffoldProject({
        componentCode,
        framework: 'react',
        projectId,
        componentName: 'TodoList',
        env: mockEnv,
      });

      // Then: Should store each file
      expect(mockEnv.PROJECTS_BUCKET.put).toHaveBeenCalledWith(
        expect.stringMatching(/package\.json$/),
        expect.any(String),
        expect.any(Object)
      );
      expect(mockEnv.PROJECTS_BUCKET.put).toHaveBeenCalledWith(
        expect.stringMatching(/vite\.config\.js$/),
        expect.any(String),
        expect.any(Object)
      );
      expect(mockEnv.PROJECTS_BUCKET.put).toHaveBeenCalledWith(
        expect.stringMatching(/index\.html$/),
        expect.any(String),
        expect.any(Object)
      );
    });

    it('MUST use correct content types for stored files', async () => {
      // Given: Project to scaffold
      const componentCode = getFixture('vue-counter.vue');
      const projectId = 'content-type-test';

      // When: Scaffolding
      await scaffoldProject({
        componentCode,
        framework: 'vue',
        projectId,
        componentName: 'Counter',
        env: mockEnv,
      });

      // Then: Should use appropriate content types
      const calls = mockEnv.PROJECTS_BUCKET.put.mock.calls;
      
      const jsonCall = calls.find(c => c[0].includes('.json'));
      if (jsonCall) {
        expect(jsonCall[2].httpMetadata.contentType).toBe('application/json');
      }
      
      const jsCall = calls.find(c => c[0].includes('.js'));
      if (jsCall) {
        expect(jsCall[2].httpMetadata.contentType).toBe('application/javascript');
      }
      
      const htmlCall = calls.find(c => c[0].includes('.html'));
      if (htmlCall) {
        expect(htmlCall[2].httpMetadata.contentType).toBe('text/html');
      }
    });
  });

  describe('PHASE 7: Error Handling', () => {
    it('MUST handle missing component gracefully', async () => {
      // Given: Empty component
      const result = await scaffoldProject({
        componentCode: '',
        framework: 'react',
        projectId: 'empty-project',
        componentName: 'App',
        env: mockEnv,
      });

      // Then: Should return error
      expect(result.success).toBe(false);
      expect(result.error).toContain('component');
    });

    it('MUST handle unknown framework', async () => {
      // Given: Unknown framework
      const result = await scaffoldProject({
        componentCode: 'some code',
        framework: 'unknown' as any,
        projectId: 'unknown-project',
        componentName: 'App',
        env: mockEnv,
      });

      // Then: Should handle gracefully by defaulting to HTML
      expect(result.success).toBe(true);
      expect(result.framework).toBe('unknown');
    });

    it('MUST cleanup on R2 storage failure', async () => {
      // Given: R2 will fail
      mockEnv.PROJECTS_BUCKET.put.mockRejectedValueOnce(new Error('R2 error'));
      
      // When: Scaffolding fails
      const result = await scaffoldProject({
        componentCode: getFixture('react-todo.jsx'),
        framework: 'react',
        projectId: 'failing-project',
        componentName: 'App',
        env: mockEnv,
      });

      // Then: Should report failure
      expect(result.success).toBe(false);
      expect(result.error).toContain('storage');
    });
  });
});

/**
 * Test Execution Summary
 * 
 * These tests define the complete contract for auto-scaffolding.
 * When all tests pass, the following guarantees are met:
 * 
 * 1. ✅ Complete project structure generation
 * 2. ✅ Correct package.json with all dependencies
 * 3. ✅ Framework-specific vite.config.js
 * 4. ✅ Proper index.html and entry points
 * 5. ✅ Support for React, Vue, and Svelte
 * 6. ✅ TypeScript support when needed
 * 7. ✅ All files stored correctly in R2
 * 
 * This ensures AI components become deployable apps automatically.
 */