/**
 * Component Wrapper Generator API Routes
 * Provides endpoints for analyzing and generating intelligent component wrappers
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { 
  analyzeComponentWrapper,
  generateSampleProps,
  generateProviderConfigs,
  generateEnhancedAppWrapper
} from '../utils/componentWrapperGenerator';
import {
  ComponentStructure,
  ComponentWrapperRequest,
  ComponentWrapperResponse,
  ComponentWrapperAnalysis,
  FileMetadata,
  FrameworkType,
  AppWrapperOptions,
  PropProperty
} from '../types/api';
import { createSuccessResponse, createErrorResponse } from '../utils/responses';

const app = new Hono();

// Enable CORS for all routes
app.use('*', cors());

/**
 * POST /analyze - Analyze component wrapper requirements
 */
app.post('/analyze', async (c) => {
  try {
    const request: ComponentWrapperRequest = await c.req.json();
    const { component_structure, original_files, framework } = request;

    const analysis = analyzeComponentWrapper(component_structure, original_files, framework);

    const response: ComponentWrapperResponse = {
      project_id: request.project_id,
      wrapper_analysis: analysis,
      generated_wrapper: {
        appComponent: {
          path: '',
          content: '',
          type: 'component',
          isGenerated: true,
          template: 'placeholder'
        },
        providers: [],
        imports: [],
        analysis
      },
      providers_detected: analysis.needsProviders.map(provider => ({
        name: provider,
        import: `// ${provider} import`,
        wrapperCode: `// ${provider} wrapper`,
        dependencies: []
      })),
      sample_props_count: analysis.sampleProps ? Object.keys(analysis.sampleProps).length : 0,
      wrapper_strategy: analysis.wrapperStrategy
    };

    return c.json(createSuccessResponse(response));
  } catch (error) {
    console.error('Component wrapper analysis error:', error);
    return c.json(createErrorResponse('Failed to analyze component wrapper'), 400);
  }
});

/**
 * POST /generate-wrapper - Generate complete component wrapper
 */
app.post('/generate-wrapper', async (c) => {
  try {
    const request: ComponentWrapperRequest = await c.req.json();
    const { component_structure, original_files, framework, options } = request;

    // Analyze wrapper requirements
    const analysis = analyzeComponentWrapper(component_structure, original_files, framework);

    // Generate provider configurations
    const providers = generateProviderConfigs(analysis.needsProviders, framework, options?.includeTypeScript ?? true);

    // Find the original component file
    const originalComponent = original_files.find(f => 
      f.name.endsWith('.jsx') || f.name.endsWith('.tsx') || f.name.endsWith('.vue') || f.name.endsWith('.svelte')
    );

    const componentPath = originalComponent 
      ? `./components/${originalComponent.name.replace(/\.(jsx|tsx|vue|svelte)$/, '')}`
      : './components/Component';

    // Create options for wrapper generation
    const wrapperOptions: AppWrapperOptions = {
      componentName: analysis.componentName,
      componentPath,
      hasProps: analysis.hasProps,
      sampleProps: analysis.sampleProps,
      providers,
      framework,
      hasTypeScript: options?.includeTypeScript ?? true
    };

    // Generate the complete wrapper
    const wrapperResult = generateEnhancedAppWrapper(wrapperOptions);

    const response: ComponentWrapperResponse = {
      project_id: request.project_id,
      wrapper_analysis: analysis,
      generated_wrapper: wrapperResult,
      providers_detected: providers,
      sample_props_count: wrapperResult.sampleProps?.length ?? 0,
      wrapper_strategy: analysis.wrapperStrategy
    };

    return c.json(createSuccessResponse(response));
  } catch (error) {
    console.error('Component wrapper generation error:', error);
    return c.json(createErrorResponse('Failed to generate component wrapper'), 400);
  }
});

/**
 * POST /generate-props - Generate sample props for a component interface
 */
app.post('/generate-props', async (c) => {
  try {
    const { properties, includeOptional = true } = await c.req.json();

    if (!Array.isArray(properties)) {
      return c.json(createErrorResponse('Properties must be an array'), 400);
    }

    const sampleProps = generateSampleProps(properties, includeOptional);

    return c.json(createSuccessResponse({
      sampleProps,
      propsCount: Object.keys(sampleProps).length,
      patterns: properties.map((prop: PropProperty) => ({
        name: prop.name,
        type: prop.type,
        generated: sampleProps[prop.name] !== undefined
      }))
    }));
  } catch (error) {
    console.error('Props generation error:', error);
    return c.json(createErrorResponse('Failed to generate sample props'), 400);
  }
});

/**
 * GET /demo - Get demonstration data for component wrapper generator
 */
app.get('/demo', async (c) => {
  // Sample component structure for demonstration
  const demoComponentStructure: ComponentStructure = {
    detection: {
      componentCount: 1,
      mainComponent: 'UserProfileCard',
      components: [{
        name: 'UserProfileCard',
        type: 'functional',
        declarationType: 'function',
        isMainComponent: true,
        isExported: true,
        framework: 'react'
      }],
      framework: 'react',
      hasMultipleComponents: false
    },
    props: {
      interfaceName: 'UserProfileCardProps',
      properties: [
        { name: 'user', type: '{ id: number; name: string; email: string; avatar?: string; }', isRequired: true },
        { name: 'onEdit', type: '() => void', isRequired: true },
        { name: 'className', type: 'string', isRequired: false },
        { name: 'isLoading', type: 'boolean', isRequired: false },
        { name: 'tags', type: 'string[]', isRequired: false },
        { name: 'metadata', type: 'Record<string, any>', isRequired: false }
      ],
      isRequired: true,
      hasDefaults: false,
      complexity: 'moderate'
    },
    exports: {
      default: {
        name: 'UserProfileCard',
        type: 'component',
        isComponent: true,
        componentType: 'functional'
      },
      named: [],
      reExports: [],
      totalExports: 1,
      hasMultipleComponents: false
    },
    complexity: {
      overall: 'moderate',
      stateComplexity: {
        stateVariables: 2,
        stateUpdatePatterns: ['useState'],
        hasComplexState: false,
        hasStateEffects: true,
        stateManagementApproach: 'local'
      },
      logicComplexity: {
        functionCount: 3,
        cyclomaticComplexity: 4,
        hasAsyncOperations: false,
        hasErrorHandling: true,
        hasValidation: true,
        computationIntensity: 'low'
      },
      maintainabilityScore: 85,
      performanceFlags: []
    },
    patterns: {
      likelyAIGenerated: true,
      aiSource: 'claude',
      patterns: ['claude-style'],
      codeQuality: 'excellent',
      bestPractices: {
        follows: ['typescript-interfaces', 'performance-optimization', 'memoization'],
        missing: []
      },
      commonIssues: []
    }
  };

  const demoFiles: FileMetadata[] = [{
    name: 'UserProfileCard.tsx',
    path: 'UserProfileCard.tsx',
    size: 1500,
    type: 'application/typescript',
    upload_time: new Date().toISOString()
  }];

  // Generate analysis and wrapper
  const analysis = analyzeComponentWrapper(demoComponentStructure, demoFiles, 'react');
  const providers = generateProviderConfigs(analysis.needsProviders, 'react', true);

  const wrapperOptions: AppWrapperOptions = {
    componentName: analysis.componentName,
    componentPath: './components/UserProfileCard',
    hasProps: analysis.hasProps,
    sampleProps: analysis.sampleProps,
    providers,
    framework: 'react',
    hasTypeScript: true
  };

  const wrapperResult = generateEnhancedAppWrapper(wrapperOptions);

  return c.json(createSuccessResponse({
    demo_description: 'Component Wrapper Generator Demo - Intelligent wrapper for AI-generated React component',
    original_component: {
      name: 'UserProfileCard',
      framework: 'react',
      has_props: true,
      complexity: 'moderate',
      ai_generated: true
    },
    wrapper_analysis: analysis,
    generated_wrapper: {
      strategy: analysis.wrapperStrategy,
      app_component_preview: wrapperResult.appComponent.content.split('\n').slice(0, 20).join('\n') + '\n// ... (truncated)',
      sample_props: analysis.sampleProps,
      imports_added: wrapperResult.imports.length,
      providers_needed: providers.length
    },
    key_features: [
      'Intelligent props analysis from TypeScript interfaces',
      'Automatic sample prop generation with realistic data',
      'Provider detection and wrapping (Router, Theme, etc.)',
      'Framework-specific App component generation',
      'AI code pattern recognition and optimization'
    ]
  }));
});

export default app;