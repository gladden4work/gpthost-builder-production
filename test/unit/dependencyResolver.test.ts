/**
 * GREEN Phase TDD Test: Dependency Resolver HTML Support
 * 
 * Validates that the dependency resolver and template generator
 * support the 'html' framework with a minimal toolchain.
 */

import { describe, it, expect } from 'vitest';
import { 
  resolveDependencies,
  generateFrameworkPackageJson,
} from '../../src/utils/dependencyResolver';

describe('HTML Framework Dependency Resolution - Unit Tests (Green)', () => {
  
  describe('HTML Template Support', () => {
    it('returns valid HTML template via generateFrameworkPackageJson', () => {
      const pkg = generateFrameworkPackageJson('html', 'latest', 'html-test-project');
      expect(pkg).toBeDefined();
      expect(pkg.name).toBe('html-test-project');
      expect(pkg.scripts?.dev).toBeDefined();
      expect(pkg.scripts?.build).toBeDefined();
      expect(pkg.scripts?.preview).toBeDefined();
      // No runtime deps for plain HTML, but has vite as dev dependency
      expect(pkg.dependencies).toEqual({});
      expect(pkg.devDependencies?.vite).toBeDefined();
    });

    it('resolveDependencies processes HTML content without npm deps', async () => {
      const htmlWithCDN = `
        <!DOCTYPE html>
        <html>
        <head>
          <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
          <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body>
          <div id="root"></div>
        </body>
        </html>
      `;
      const dummyComponentStructure: any = {
        detection: { framework: 'html', componentCount: 0, components: [], hasMultipleComponents: false },
        exports: { named: [], reExports: [], totalExports: 0, hasMultipleComponents: false },
        complexity: { overall: 'simple' },
        patterns: {}
      };
      // Minimal import analysis for HTML
      const minimalImportAnalysis: any = {
        statements: [],
        dependencies: { external: [], local: [], nodeBuiltins: [], scoped: [], assets: [], dynamicImports: [], typeOnlyImports: [], allUnique: [] },
        hasCircularImports: false,
        unusedImports: [],
        importCount: { total: 0, es6: 0, commonjs: 0, dynamic: 0, typeOnly: 0, assets: 0 }
      };

      // Should not throw and should return a package.json based on HTML template when needed
      const result = await resolveDependencies(minimalImportAnalysis, dummyComponentStructure, 'html', { includeDevDependencies: true });
      // No production deps expected for plain HTML
      expect(result.resolved.production).toEqual([]);
      // DevDeps should include vite via template
      expect(Object.keys(result.packageJson.devDependencies || {})).toContain('vite');
    });
  });

  describe('HTML Static File Handling', () => {
    it('HTML template uses Vite with no framework plugins', () => {
      const pkg = generateFrameworkPackageJson('html', 'latest', 'html-app');
      expect(pkg.scripts?.build).toBe('vite build');
      expect(pkg.devDependencies?.vite).toBeDefined();
    });
  });

  describe('Framework Template Registry', () => {
    it('includes html entry (indirect via package json generation)', () => {
      const pkg = generateFrameworkPackageJson('html', 'latest', 'my-html');
      expect(pkg).toBeDefined();
      expect(pkg.scripts?.dev).toBeDefined();
    });
  });
});
