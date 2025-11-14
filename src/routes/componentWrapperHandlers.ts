/**
 * Component Wrapper Generator Handler Functions
 * Individual handler functions for component wrapper analysis and generation
 */

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
  FileMetadata,
  FrameworkType,
  AppWrapperOptions,
  PropProperty
} from '../types/api';
import { corsResponse, errorResponse, successResponse } from '../utils/responses';

/**
 * Handler for POST /api/component-wrapper/{project_id}/analyze
 * Analyzes component wrapper requirements
 */
export async function analyzeComponentWrapperHandler(request: Request, env: Env): Promise<Response> {
  try {
    const requestData: ComponentWrapperRequest = await request.json();
    const { component_structure, original_files, framework } = requestData;

    const analysis = analyzeComponentWrapper(component_structure, original_files, framework);

    const response: ComponentWrapperResponse = {
      project_id: requestData.project_id,
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

    return successResponse(response);
  } catch (error) {
    console.error('Component wrapper analysis error:', error);
    return errorResponse(
      'ANALYSIS_FAILED',
      'Failed to analyze component wrapper',
      400,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Handler for POST /api/component-wrapper/{project_id}/generate
 * Generates complete component wrapper with App component
 */
export async function generateComponentWrapperHandler(request: Request, env: Env): Promise<Response> {
  try {
    const requestData: ComponentWrapperRequest = await request.json();
    const { component_structure, original_files, framework, options } = requestData;

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
      project_id: requestData.project_id,
      wrapper_analysis: analysis,
      generated_wrapper: wrapperResult,
      providers_detected: providers,
      sample_props_count: wrapperResult.sampleProps?.length ?? 0,
      wrapper_strategy: analysis.wrapperStrategy
    };

    return successResponse(response);
  } catch (error) {
    console.error('Component wrapper generation error:', error);
    return errorResponse(
      'GENERATION_FAILED',
      'Failed to generate component wrapper',
      400,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Handler for POST /api/component-wrapper/generate-props
 * Generates sample props for a component interface
 */
export async function generatePropsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const { properties, includeOptional = true } = await request.json();

    if (!Array.isArray(properties)) {
      return errorResponse(
        'INVALID_INPUT',
        'Properties must be an array',
        400,
        { expected: 'array', received: typeof properties }
      );
    }

    const sampleProps = generateSampleProps(properties, includeOptional);

    const response = {
      sampleProps,
      propsCount: Object.keys(sampleProps).length,
      patterns: properties.map((prop: PropProperty) => ({
        name: prop.name,
        type: prop.type,
        generated: sampleProps[prop.name] !== undefined,
        sampleValue: sampleProps[prop.name]
      }))
    };

    return successResponse(response);
  } catch (error) {
    console.error('Props generation error:', error);
    return errorResponse(
      'PROPS_GENERATION_FAILED',
      'Failed to generate sample props',
      400,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Handler for GET /api/component-wrapper/demo
 * Provides demonstration data for component wrapper generator
 */
export async function componentWrapperDemoHandler(request: Request, env: Env): Promise<Response> {
  try {
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

    const response = {
      demo_description: 'TASK-013: Component Wrapper Generator Demo - Intelligent wrapper for AI-generated React component',
      original_component: {
        name: 'UserProfileCard',
        framework: 'react',
        has_props: true,
        props_interface: 'UserProfileCardProps',
        complexity: 'moderate',
        ai_generated: true,
        ai_source: 'claude'
      },
      wrapper_analysis: analysis,
      generated_wrapper: {
        strategy: analysis.wrapperStrategy,
        app_component_preview: wrapperResult.appComponent.content.split('\n').slice(0, 25).join('\n') + '\n// ... (truncated for preview)',
        full_file_path: wrapperResult.appComponent.path,
        sample_props: analysis.sampleProps,
        imports_added: wrapperResult.imports.length,
        providers_needed: providers.length
      },
      key_features: [
        'Intelligent props analysis from TypeScript interfaces',
        'Automatic sample prop generation with realistic contextual data',
        'Provider detection and wrapping (Router, Theme, State providers)',
        'Framework-specific App component generation (React/Vue/Svelte)',
        'AI code pattern recognition and quality assessment',
        'Complex prop type handling (objects, arrays, functions)',
        'Optional vs required prop distinction with smart defaults'
      ],
      sample_props_generated: analysis.sampleProps,
      usage_example: {
        step1: 'Upload AI-generated component files',
        step2: 'System analyzes component structure and props',
        step3: 'Generates intelligent App wrapper with sample data',
        step4: 'Ready-to-deploy application with working component'
      }
    };

    return successResponse(response);
  } catch (error) {
    console.error('Component wrapper demo error:', error);
    return errorResponse(
      'DEMO_FAILED',
      'Failed to generate demo data',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}