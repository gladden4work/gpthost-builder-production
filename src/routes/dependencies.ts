/**
 * Dependency Resolution API Endpoints
 * REST endpoints for dependency resolution, package.json generation,
 * and version conflict management
 */

import { Request, Response } from '@cloudflare/workers-types';
import {
  DependencyResolutionRequest,
  DependencyResolutionResponse,
  DependencyResolutionResult,
  GeneratedPackageJson,
  FrameworkType,
  DependencyConflict,
  DependencySuggestion
} from '../types/api';
import {
  resolveDependencies,
  generateFrameworkPackageJson,
  inferPeerDependencies,
  detectVersionConflictsSingle
} from '../utils/dependencyResolver';
import { successResponse, errorResponse } from '../utils/responses';

/**
 * Resolve dependencies for a project
 * POST /api/dependencies/{project_id}/resolve
 */
export async function handleDependencyResolution(
  request: Request,
  projectId: string
): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    const body = await request.json() as DependencyResolutionRequest;
    
    // Validate required fields
    if (!body.importAnalysis || !body.componentStructure || !body.framework) {
      return errorResponse(
        'Missing required fields: importAnalysis, componentStructure, framework',
        400
      );
    }

    // Ensure project ID matches
    if (body.projectId && body.projectId !== projectId) {
      return errorResponse('Project ID mismatch', 400);
    }

    // Perform dependency resolution
    const startTime = Date.now();
    const result = await resolveDependencies(
      body.importAnalysis,
      body.componentStructure,
      body.framework,
      body.options
    );

    const response: DependencyResolutionResponse = {
      projectId,
      status: 'success',
      result,
      timestamp: new Date().toISOString()
    };

    return successResponse(response);
  } catch (error) {
    console.error('Dependency resolution error:', error);
    
    const errorResponse: DependencyResolutionResponse = {
      projectId,
      status: 'failed',
      error: error.message,
      timestamp: new Date().toISOString()
    };
    
    return errorResponse(errorResponse, 500);
  }
}

/**
 * Generate package.json for a specific framework
 * GET /api/dependencies/templates/{framework}
 */
export async function handleFrameworkTemplate(
  request: Request,
  framework: string
): Promise<Response> {
  try {
    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', 405);
    }

    // Validate framework
    const validFrameworks: FrameworkType[] = ['react', 'vue', 'svelte', 'html'];
    if (!validFrameworks.includes(framework as FrameworkType)) {
      return errorResponse(
        `Invalid framework: ${framework}. Must be one of: ${validFrameworks.join(', ')}`,
        400
      );
    }

    const url = new URL(request.url);
    const version = url.searchParams.get('version') || 'latest';
    const projectName = url.searchParams.get('projectName') || 'gpthost-project';

    const packageJson = generateFrameworkPackageJson(
      framework as FrameworkType,
      version,
      projectName
    );

    return successResponse({
      framework,
      version,
      packageJson,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Framework template error:', error);
    return errorResponse(`Failed to generate template: ${error.message}`, 500);
  }
}

/**
 * Analyze dependency conflicts
 * POST /api/dependencies/analyze-conflicts
 */
export async function handleConflictAnalysis(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    const body = await request.json();
    
    if (!body.dependencies || !Array.isArray(body.dependencies)) {
      return errorResponse('Missing or invalid dependencies array', 400);
    }

    const conflicts = detectVersionConflictsSingle(body.dependencies);
    
    return successResponse({
      conflicts,
      hasConflicts: conflicts.length > 0,
      conflictCount: conflicts.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Conflict analysis error:', error);
    return errorResponse(`Conflict analysis failed: ${error.message}`, 500);
  }
}

/**
 * Get peer dependency recommendations
 * POST /api/dependencies/infer-peers
 */
export async function handlePeerInference(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    const body = await request.json();
    
    if (!body.dependencies || !body.framework) {
      return errorResponse('Missing required fields: dependencies, framework', 400);
    }

    const peerDependencies = inferPeerDependencies(
      body.dependencies,
      body.framework as FrameworkType
    );
    
    return successResponse({
      peerDependencies,
      count: peerDependencies.length,
      framework: body.framework,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Peer inference error:', error);
    return errorResponse(`Peer inference failed: ${error.message}`, 500);
  }
}

/**
 * Validate package.json structure and dependencies
 * POST /api/dependencies/validate
 */
export async function handlePackageJsonValidation(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    const body = await request.json();
    
    if (!body.packageJson) {
      return errorResponse('Missing packageJson field', 400);
    }

    const validation = validatePackageJson(body.packageJson);
    
    return successResponse({
      isValid: validation.isValid,
      errors: validation.errors,
      warnings: validation.warnings,
      suggestions: validation.suggestions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Package.json validation error:', error);
    return errorResponse(`Validation failed: ${error.message}`, 500);
  }
}

/**
 * Get dependency recommendations based on component analysis
 * POST /api/dependencies/recommendations
 */
export async function handleDependencyRecommendations(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    const body = await request.json();
    
    if (!body.componentStructure || !body.framework) {
      return errorResponse('Missing required fields: componentStructure, framework', 400);
    }

    const recommendations = generateDependencyRecommendations(
      body.componentStructure,
      body.framework as FrameworkType,
      body.existingDependencies || []
    );
    
    return successResponse({
      recommendations,
      count: recommendations.length,
      framework: body.framework,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Recommendations error:', error);
    return errorResponse(`Recommendations failed: ${error.message}`, 500);
  }
}

/**
 * Validate package.json structure
 */
function validatePackageJson(packageJson: any): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: DependencySuggestion[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: DependencySuggestion[] = [];
  
  // Required fields
  if (!packageJson.name) {
    errors.push('Missing required field: name');
  }
  
  if (!packageJson.version) {
    errors.push('Missing required field: version');
  }
  
  // Validate scripts
  if (packageJson.scripts) {
    if (!packageJson.scripts.build) {
      warnings.push('Missing build script');
      suggestions.push({
        type: 'add',
        package: 'build-script',
        reason: 'Build script is essential for deployment',
        impact: 'minor',
        priority: 'medium'
      });
    }
    
    if (!packageJson.scripts.dev && !packageJson.scripts.start) {
      warnings.push('Missing dev/start script');
    }
  }
  
  // Validate dependencies
  if (packageJson.dependencies) {
    for (const [name, version] of Object.entries(packageJson.dependencies)) {
      if (typeof version !== 'string') {
        errors.push(`Invalid version for ${name}: must be a string`);
      }
      
      // Check for common version issues
      if (typeof version === 'string' && !version.match(/^[\^~><=\d]/)) {
        warnings.push(`Unusual version format for ${name}: ${version}`);
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    suggestions
  };
}

/**
 * Generate dependency recommendations based on component structure
 */
function generateDependencyRecommendations(
  componentStructure: any,
  framework: FrameworkType,
  existingDependencies: string[]
): DependencySuggestion[] {
  const recommendations: DependencySuggestion[] = [];
  const existing = new Set(existingDependencies);
  
  // React-specific recommendations
  if (framework === 'react') {
    // Recommend routing if multiple components
    if (componentStructure.detection?.hasMultipleComponents && !existing.has('react-router-dom')) {
      recommendations.push({
        type: 'add',
        package: 'react-router-dom',
        suggestedVersion: '^6.15.0',
        reason: 'Multiple components detected - routing might be beneficial',
        impact: 'minor',
        priority: 'low'
      });
    }
    
    // Recommend state management for complex components
    if (componentStructure.complexity?.overall === 'complex' && 
        !existing.has('@reduxjs/toolkit') && 
        !existing.has('zustand')) {
      recommendations.push({
        type: 'add',
        package: '@reduxjs/toolkit',
        suggestedVersion: '^1.9.0',
        reason: 'Complex component structure could benefit from centralized state management',
        impact: 'minor',
        priority: 'medium'
      });
    }
    
    // Recommend TypeScript if code quality is good
    if (componentStructure.patterns?.codeQuality === 'excellent' && 
        !existing.has('typescript')) {
      recommendations.push({
        type: 'add',
        package: 'typescript',
        suggestedVersion: '^5.0.0',
        reason: 'High code quality suggests TypeScript would be beneficial',
        impact: 'minor',
        priority: 'medium'
      });
    }
  }
  
  // Vue-specific recommendations
  if (framework === 'vue') {
    if (componentStructure.complexity?.overall === 'complex' && !existing.has('pinia')) {
      recommendations.push({
        type: 'add',
        package: 'pinia',
        suggestedVersion: '^2.1.0',
        reason: 'Complex components could benefit from Pinia state management',
        impact: 'minor',
        priority: 'medium'
      });
    }
  }
  
  // Universal recommendations
  if (componentStructure.complexity?.stateComplexity?.hasAsyncOperations) {
    if (!existing.has('axios') && !existing.has('fetch')) {
      recommendations.push({
        type: 'add',
        package: 'axios',
        suggestedVersion: '^1.5.0',
        reason: 'Async operations detected - HTTP client recommended',
        impact: 'minor',
        priority: 'low'
      });
    }
  }
  
  return recommendations;
}

/**
 * Route handler factory for dependency endpoints
 */
export function createDependencyRoutes() {
  return {
    // Main resolution endpoint
    'POST /api/dependencies/:projectId/resolve': handleDependencyResolution,
    
    // Framework templates
    'GET /api/dependencies/templates/:framework': handleFrameworkTemplate,
    
    // Conflict analysis
    'POST /api/dependencies/analyze-conflicts': handleConflictAnalysis,
    
    // Peer dependency inference
    'POST /api/dependencies/infer-peers': handlePeerInference,
    
    // Package.json validation
    'POST /api/dependencies/validate': handlePackageJsonValidation,
    
    // Dependency recommendations
    'POST /api/dependencies/recommendations': handleDependencyRecommendations
  };
}