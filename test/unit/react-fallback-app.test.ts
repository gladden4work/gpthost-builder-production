import { describe, it, expect } from 'vitest';
import { generateEnhancedReactAppComponent } from '../../src/utils/componentWrapperGenerator';
import type { ComponentStructure, FileMetadata } from '../../src/types/api';

describe('React App fallback (no original component)', () => {
  it('generates a self-contained App.jsx without broken imports', () => {
    // Minimal component structure indicating a single React component named Hello
    const componentStructure: ComponentStructure = {
      detection: {
        componentCount: 1,
        mainComponent: 'Hello',
        components: [{
          name: 'Hello',
          type: 'functional',
          declarationType: 'function',
          isMainComponent: true,
          isExported: true,
          framework: 'react'
        }],
        framework: 'react',
        hasMultipleComponents: false,
      },
      props: undefined,
      exports: {
        default: true,
        named: [],
        hasMultipleExports: false,
        exportedComponents: ['Hello'],
        exportedUtilities: []
      },
      hooks: undefined,
      complexity: {
        overall: 'simple',
        jsxComplexity: undefined,
        templateComplexity: undefined,
        stateComplexity: {
          stateVariables: 0,
          stateUpdatePatterns: [],
          hasComplexState: false,
          hasStateEffects: false,
          stateManagementApproach: 'local'
        },
        logicComplexity: {
          functionCount: 1,
          cyclomaticComplexity: 1,
          hasAsyncOperations: false,
          hasErrorHandling: false,
          hasValidation: false,
          computationIntensity: 'low'
        },
        maintainabilityScore: 90,
        performanceFlags: []
      },
      patterns: {
        likelyAIGenerated: true,
        aiSource: 'unknown',
        patterns: [],
        codeQuality: 'good',
        bestPractices: { follows: [], missing: [] },
        commonIssues: []
      }
    };

    // No original files (this is the exact fallback scenario)
    const originalFiles: FileMetadata[] = [];

    const result = generateEnhancedReactAppComponent(
      componentStructure,
      originalFiles,
      /* hasTypeScript */ false
    );

    // Should generate a React App component under src/App.jsx
    expect(result.path).toBe('src/App.jsx');
    expect(result.type).toBe('component');

    // Critically: no broken import to a non-existent component
    expect(result.content).not.toContain("import Component from './components/Component'");

    // Contains a local placeholder component and guidance text
    expect(result.content).toContain('Placeholder component');
    expect(result.content).toContain("src/components/");

    // Template identifier should reflect the fallback path
    expect(result.template).toBe('enhanced-app-wrapper-fallback');
  });
});

