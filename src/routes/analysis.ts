/**
 * File Analysis API Handlers for GPTHost
 * Provides endpoints to retrieve file analysis results and project insights
 */

import { successResponse, errorResponse } from '../utils/responses';
import {
  ProjectMetadata,
  FileAnalysisResponse,
  DependencyAnalysis,
  ImportAnalysis,
  ComponentStructure,
  ComponentComplexity,
  DependencyVersion
} from '../types/api';
import { analyzeFile, aggregateProjectAnalysis } from '../utils/fileAnalysis';
import { inferPeerDependencies } from '../utils/dependencyResolver';

/**
 * Get analysis results for a specific project
 * GET /api/analysis/{project_id}
 */
export async function getProjectAnalysisHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const projectId = pathParts[pathParts.length - 1];

    if (!projectId || projectId === 'analysis') {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in the URL path: /api/analysis/{project_id}',
        400
      );
    }

    // Retrieve project metadata from R2
    const metadataPath = `projects/${projectId}/metadata.json`;
    
    try {
      const metadataObject = await env.PROJECTS_BUCKET.get(metadataPath);
      
      if (!metadataObject) {
        return errorResponse(
          'PROJECT_NOT_FOUND',
          `Project with ID ${projectId} not found`,
          404,
          { projectId }
        );
      }

      const metadataText = await metadataObject.text();
      const projectMetadata: ProjectMetadata = JSON.parse(metadataText);

      // Prepare file analysis response
      const fileAnalysisResponse: FileAnalysisResponse = {
        project_id: projectId,
        files: projectMetadata.files
          .filter(file => file.analysis)
          .map(file => ({
            name: file.name,
            analysis: file.analysis!
          })),
        project_analysis: projectMetadata.analysis || {
          primaryFramework: 'unknown',
          componentType: 'unknown',
          hasMultipleFrameworks: false,
          totalComponents: 0,
          entryPoints: [],
          dependencies: [],
          stylingApproaches: [],
          analysisComplete: false,
          analysisTimestamp: new Date().toISOString()
        }
      };

      return successResponse(fileAnalysisResponse, 200);

    } catch (r2Error) {
      console.error(`Failed to retrieve project metadata for ${projectId}:`, r2Error);
      return errorResponse(
        'PROJECT_RETRIEVAL_ERROR',
        'Failed to retrieve project analysis data',
        500,
        { projectId, error: r2Error instanceof Error ? r2Error.message : String(r2Error) }
      );
    }

  } catch (error) {
    console.error('Unexpected error in project analysis handler:', error);
    return errorResponse(
      'ANALYSIS_ERROR',
      'An unexpected error occurred while retrieving project analysis',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get analysis summary for all projects (for dashboard)
 * GET /api/analysis/projects/summary
 */
export async function getProjectsSummaryHandler(request: Request, env: Env): Promise<Response> {
  try {
    // List all projects in the bucket
    // When using delimiter='/', R2 returns folders in delimitedPrefixes
    const listResponse = await env.PROJECTS_BUCKET.list({
      prefix: 'projects/',
      delimiter: '/'
    });

    console.info('R2 list response:', {
      objects: listResponse.objects?.length || 0,
      delimitedPrefixes: listResponse.delimitedPrefixes?.length || 0,
      truncated: listResponse.truncated
    });

    const projectIds = new Set<string>();
    
    // Extract project IDs from delimitedPrefixes (folders)
    if (listResponse.delimitedPrefixes) {
      for (const prefix of listResponse.delimitedPrefixes) {
        // prefix is like "projects/project-id/"
        const parts = prefix.split('/');
        if (parts.length >= 2 && parts[0] === 'projects' && parts[1]) {
          projectIds.add(parts[1]);
        }
      }
    }
    
    // Also check objects in case there are files directly in projects/
    if (listResponse.objects) {
      for (const obj of listResponse.objects) {
        const parts = obj.key.split('/');
        if (parts.length >= 2 && parts[0] === 'projects' && parts[1]) {
          projectIds.add(parts[1]);
        }
      }
    }

    if (projectIds.size === 0) {
      console.info('No projects found in R2 bucket');
      return successResponse([], 200);
    }

    const projectSummaries = [];

    // Retrieve metadata for each project
    for (const projectId of projectIds) {
      try {
        const metadataPath = `projects/${projectId}/metadata.json`;
        const metadataObject = await env.PROJECTS_BUCKET.get(metadataPath);
        
        if (metadataObject) {
          const metadataText = await metadataObject.text();
          const projectMetadata: ProjectMetadata = JSON.parse(metadataText);
          
          projectSummaries.push({
            id: projectId,
            name: projectMetadata.name || 'Unnamed Project',
            status: projectMetadata.status,
            framework: projectMetadata.framework || 'unknown',
            created_at: projectMetadata.created_at,
            // Surface live link when available for dashboard cards
            deployment_url: (projectMetadata as any).deployment_url,
            files_count: projectMetadata.files.length,
            component_type: projectMetadata.analysis?.componentType || 'unknown',
            total_components: projectMetadata.analysis?.totalComponents || 0
          });
        }
      } catch (error) {
        console.warn(`Failed to retrieve metadata for project ${projectId}:`, error);
        // Continue processing other projects
      }
    }

    return successResponse(projectSummaries, 200);

  } catch (error) {
    console.error('Unexpected error in projects summary handler:', error);
    return errorResponse(
      'SUMMARY_ERROR',
      'An unexpected error occurred while retrieving projects summary',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Reanalyze project files (useful for updating analysis after algorithm improvements)
 * POST /api/analysis/{project_id}/reanalyze
 */
export async function reanalyzeProjectHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const projectId = pathParts[pathParts.indexOf('analysis') + 1];

    if (!projectId || projectId === 'reanalyze') {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in the URL path: /api/analysis/{project_id}/reanalyze',
        400
      );
    }

    // Retrieve existing project metadata
    const metadataPath = `projects/${projectId}/metadata.json`;
    
    try {
      const metadataObject = await env.PROJECTS_BUCKET.get(metadataPath);
      
      if (!metadataObject) {
        return errorResponse(
          'PROJECT_NOT_FOUND',
          `Project with ID ${projectId} not found`,
          404,
          { projectId }
        );
      }

      const metadataText = await metadataObject.text();
      const projectMetadata: ProjectMetadata = JSON.parse(metadataText);

      // 1. Retrieve source files and run analysis again
      const analyzedFiles = [] as typeof projectMetadata.files;
      for (const file of projectMetadata.files) {
        try {
          const fileObj = await env.PROJECTS_BUCKET.get(file.path);
          if (!fileObj) continue;
          const content = await fileObj.text();
          const reanalyzed = await analyzeFile(new File([content], file.name, { type: file.type }));
          analyzedFiles.push({ ...file, analysis: reanalyzed });
        } catch (fileError) {
          console.warn(`Reanalysis failed for ${file.name}:`, fileError);
          analyzedFiles.push(file);
        }
      }

      // 2. Aggregate new project analysis
      const projectAnalysis = aggregateProjectAnalysis(
        analyzedFiles.map(f => f.analysis!).filter(a => a)
      );

      // 3. Update metadata in R2
      projectMetadata.files = analyzedFiles;
      projectMetadata.analysis = projectAnalysis;
      projectMetadata.updated_at = new Date().toISOString();

      await env.PROJECTS_BUCKET.put(
        metadataPath,
        JSON.stringify(projectMetadata, null, 2),
        { httpMetadata: { contentType: 'application/json' }, customMetadata: { projectId } }
      );

      const response: FileAnalysisResponse = {
        project_id: projectId,
        files: analyzedFiles.map(f => ({ name: f.name, analysis: f.analysis! })),
        project_analysis: projectAnalysis
      };

      return successResponse(response, 200);

    } catch (r2Error) {
      console.error(`Failed to retrieve project for reanalysis ${projectId}:`, r2Error);
      return errorResponse(
        'PROJECT_RETRIEVAL_ERROR',
        'Failed to retrieve project for reanalysis',
        500,
        { projectId, error: r2Error instanceof Error ? r2Error.message : String(r2Error) }
      );
    }

  } catch (error) {
    console.error('Unexpected error in project reanalysis handler:', error);
    return errorResponse(
      'REANALYSIS_ERROR',
      'An unexpected error occurred during project reanalysis',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * TASK-009: Get detailed dependency analysis for a project
 * GET /api/analysis/{project_id}/dependencies
 * 
 * Provides comprehensive import and dependency information useful for:
 * - Auto-scaffolding (TASK-012)
 * - Package.json generation
 * - Build configuration
 * - Security auditing
 */
export async function getProjectDependenciesHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const projectId = pathParts[pathParts.indexOf('analysis') + 1];

    if (!projectId || projectId === 'dependencies') {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in the URL path: /api/analysis/{project_id}/dependencies',
        400
      );
    }

    // Retrieve project metadata from R2
    const metadataPath = `projects/${projectId}/metadata.json`;
    
    try {
      const metadataObject = await env.PROJECTS_BUCKET.get(metadataPath);
      
      if (!metadataObject) {
        return errorResponse(
          'PROJECT_NOT_FOUND',
          `Project with ID ${projectId} not found`,
          404,
          { projectId }
        );
      }

      const metadataText = await metadataObject.text();
      const projectMetadata: ProjectMetadata = JSON.parse(metadataText);

      // Aggregate all import analysis from files
      const allImportStatements: any[] = [];
      const aggregatedDependencies: DependencyAnalysis = {
        external: [],
        local: [],
        nodeBuiltins: [],
        scoped: [],
        assets: [],
        dynamicImports: [],
        typeOnlyImports: [],
        allUnique: []
      };
      
      let totalImports = 0;
      let hasCircularImports = false;
      const allUnusedImports: string[] = [];
      const frameworkBreakdown: Record<string, number> = {};
      
      // Process each file's import analysis
      for (const file of projectMetadata.files) {
        if (file.analysis?.importAnalysis) {
          const importAnalysis = file.analysis.importAnalysis;
          
          // Collect import statements
          allImportStatements.push(...importAnalysis.statements.map(stmt => ({
            ...stmt,
            fileName: file.name
          })));
          
          // Aggregate dependencies (avoid duplicates)
          for (const dep of importAnalysis.dependencies.external) {
            if (!aggregatedDependencies.external.includes(dep)) {
              aggregatedDependencies.external.push(dep);
            }
          }
          
          for (const dep of importAnalysis.dependencies.scoped) {
            if (!aggregatedDependencies.scoped.includes(dep)) {
              aggregatedDependencies.scoped.push(dep);
            }
          }
          
          for (const dep of importAnalysis.dependencies.nodeBuiltins) {
            if (!aggregatedDependencies.nodeBuiltins.includes(dep)) {
              aggregatedDependencies.nodeBuiltins.push(dep);
            }
          }
          
          for (const dep of importAnalysis.dependencies.local) {
            if (!aggregatedDependencies.local.includes(dep)) {
              aggregatedDependencies.local.push(dep);
            }
          }
          
          for (const asset of importAnalysis.dependencies.assets) {
            if (!aggregatedDependencies.assets.includes(asset)) {
              aggregatedDependencies.assets.push(asset);
            }
          }
          
          for (const dynamic of importAnalysis.dependencies.dynamicImports) {
            if (!aggregatedDependencies.dynamicImports.includes(dynamic)) {
              aggregatedDependencies.dynamicImports.push(dynamic);
            }
          }
          
          for (const typeOnly of importAnalysis.dependencies.typeOnlyImports) {
            if (!aggregatedDependencies.typeOnlyImports.includes(typeOnly)) {
              aggregatedDependencies.typeOnlyImports.push(typeOnly);
            }
          }
          
          // Track totals
          totalImports += importAnalysis.importCount.total;
          if (importAnalysis.hasCircularImports) hasCircularImports = true;
          allUnusedImports.push(...importAnalysis.unusedImports);
          
          // Framework breakdown
          const framework = file.analysis.framework;
          frameworkBreakdown[framework] = (frameworkBreakdown[framework] || 0) + 1;
        }
      }

      // Generate all unique dependencies
      aggregatedDependencies.allUnique = [
        ...aggregatedDependencies.external,
        ...aggregatedDependencies.scoped,
        ...aggregatedDependencies.nodeBuiltins
      ];

      // Detect missing dependencies and security warnings
      const missingDeps: string[] = [];
      const securityWarnings: string[] = [];
      for (const dep of [...aggregatedDependencies.external, ...aggregatedDependencies.scoped]) {
        try {
          const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(dep)}`);
          if (!res.ok) {
            missingDeps.push(dep);
            continue;
          }
          const data = await res.json();
          const latest = data['dist-tags']?.latest;
          const deprecated = latest && data.versions?.[latest]?.deprecated;
          if (deprecated) {
            securityWarnings.push(`${dep}: ${deprecated}`);
          }
        } catch {
          missingDeps.push(dep);
        }
      }

      // Infer peer dependencies
      const depVersions: DependencyVersion[] = [...aggregatedDependencies.external, ...aggregatedDependencies.scoped].map(
        name => ({ name, version: 'latest', source: 'inferred', confidence: 50 })
      );
      const inferredPeers = inferPeerDependencies(depVersions, projectMetadata.framework || 'unknown');
      const peerDeps: Record<string, string> = {};
      for (const peer of inferredPeers) {
        peerDeps[peer.name] = peer.version;
      }

      // Prepare detailed dependency response
      const dependencyResponse = {
        project_id: projectId,
        project_name: projectMetadata.name || 'Unnamed Project',
        analysis_timestamp: new Date().toISOString(),
        
        // Summary statistics
        summary: {
          total_files: projectMetadata.files.length,
          files_with_imports: projectMetadata.files.filter(f => f.analysis?.importAnalysis).length,
          total_import_statements: totalImports,
          total_unique_dependencies: aggregatedDependencies.allUnique.length,
          has_circular_imports: hasCircularImports,
          unused_imports_count: allUnusedImports.length,
          primary_framework: projectMetadata.analysis?.primaryFramework || 'unknown'
        },
        
        // Categorized dependencies
        dependencies: aggregatedDependencies,
        
        // Detailed import statements (for debugging/analysis)
        import_statements: allImportStatements,
        
        // Framework usage breakdown
        framework_breakdown: frameworkBreakdown,
        
        // Issues and warnings
        issues: {
          circular_imports: hasCircularImports ? ['Potential circular imports detected'] : [],
          unused_imports: allUnusedImports,
          missing_dependencies: missingDeps,
          security_warnings: securityWarnings
        },
        
        // Package.json suggestions for auto-scaffolding
          package_json_suggestions: {
            dependencies: aggregatedDependencies.external.concat(aggregatedDependencies.scoped),
            devDependencies: aggregatedDependencies.typeOnlyImports.filter(dep =>
              dep.startsWith('@types/') || dep.includes('typescript') || dep.includes('eslint')
            ),
            peerDependencies: peerDeps
          }
        };

      return successResponse(dependencyResponse, 200);

    } catch (r2Error) {
      console.error(`Failed to retrieve project dependencies for ${projectId}:`, r2Error);
      return errorResponse(
        'PROJECT_RETRIEVAL_ERROR',
        'Failed to retrieve project dependency data',
        500,
        { projectId, error: r2Error instanceof Error ? r2Error.message : String(r2Error) }
      );
    }

  } catch (error) {
    console.error('Unexpected error in project dependencies handler:', error);
    return errorResponse(
      'DEPENDENCIES_ERROR',
      'An unexpected error occurred while retrieving project dependencies',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * TASK-010: Get detailed component structure analysis for a project
 * GET /api/analysis/{project_id}/components
 * 
 * Provides comprehensive component analysis useful for:
 * - Understanding component architecture
 * - Code quality assessment
 * - AI-generated code pattern detection
 * - Performance optimization recommendations
 * - Auto-scaffolding template selection
 */
export async function getProjectComponentsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const projectId = pathParts[pathParts.indexOf('analysis') + 1];

    if (!projectId || projectId === 'components') {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in the URL path: /api/analysis/{project_id}/components',
        400
      );
    }

    // Retrieve project metadata from R2
    const metadataPath = `projects/${projectId}/metadata.json`;
    
    try {
      const metadataObject = await env.PROJECTS_BUCKET.get(metadataPath);
      
      if (!metadataObject) {
        return errorResponse(
          'PROJECT_NOT_FOUND',
          `Project with ID ${projectId} not found`,
          404,
          { projectId }
        );
      }

      const metadataText = await metadataObject.text();
      const projectMetadata: ProjectMetadata = JSON.parse(metadataText);

      // Aggregate component structure analysis from all files
      const fileComponents: Array<{
        fileName: string;
        framework: string;
        componentStructure?: ComponentStructure;
      }> = [];
      
      let totalComponents = 0;
      let totalProps = 0;
      let totalHooks = 0;
      let complexityDistribution: Record<ComponentComplexity, number> = {
        'simple': 0,
        'moderate': 0,
        'complex': 0,
        'very-complex': 0,
        'unknown': 0
      };
      
      const aiPatterns: Record<string, number> = {};
      const performanceIssues: string[] = [];
      const frameworkUsage: Record<string, number> = {};
      const exportPatterns: Record<string, number> = {};
      const hooksUsage: Record<string, number> = {};
      
      // Process each file's component structure analysis
      for (const file of projectMetadata.files) {
        if (file.analysis?.componentStructure) {
          const componentStructure = file.analysis.componentStructure;
          
          fileComponents.push({
            fileName: file.name,
            framework: file.analysis.framework,
            componentStructure
          });
          
          // Aggregate statistics
          totalComponents += componentStructure.detection.componentCount;
          if (componentStructure.props) {
            totalProps += componentStructure.props.properties.length;
          }
          if (componentStructure.hooks) {
            totalHooks += componentStructure.hooks.length;
            
            // Track hook usage
            for (const hook of componentStructure.hooks) {
              hooksUsage[hook.name] = (hooksUsage[hook.name] || 0) + hook.usageCount;
            }
          }
          
          // Track complexity distribution
          complexityDistribution[componentStructure.complexity.overall]++;
          
          // Track AI patterns
          for (const pattern of componentStructure.patterns.patterns) {
            aiPatterns[pattern] = (aiPatterns[pattern] || 0) + 1;
          }
          
          // Track performance issues
          performanceIssues.push(...componentStructure.complexity.performanceFlags);
          
          // Track framework usage
          frameworkUsage[componentStructure.detection.framework] = 
            (frameworkUsage[componentStructure.detection.framework] || 0) + 1;
          
          // Track export patterns
          exportPatterns['default'] = (exportPatterns['default'] || 0) + (componentStructure.exports.default ? 1 : 0);
          exportPatterns['named'] = (exportPatterns['named'] || 0) + componentStructure.exports.named.length;
          exportPatterns['reExports'] = (exportPatterns['reExports'] || 0) + componentStructure.exports.reExports.length;
        }
      }

      // Calculate aggregate metrics
      const avgComplexityScore = fileComponents.reduce((sum, file) => 
        sum + (file.componentStructure?.complexity.maintainabilityScore || 0), 0) / Math.max(fileComponents.length, 1);
      
      const mostCommonAISource = Object.keys(aiPatterns).length > 0 ? 
        Object.keys(aiPatterns).reduce((a, b) => aiPatterns[a] > aiPatterns[b] ? a : b) : 'unknown';
      
      // Count files with likely AI-generated code
      const aiGeneratedCount = fileComponents.filter(f => 
        f.componentStructure?.patterns.likelyAIGenerated).length;

      // Prepare detailed component analysis response
      const componentResponse = {
        project_id: projectId,
        project_name: projectMetadata.name || 'Unnamed Project',
        analysis_timestamp: new Date().toISOString(),
        
        // Summary statistics
        summary: {
          total_files: projectMetadata.files.length,
          files_with_components: fileComponents.length,
          total_components: totalComponents,
          total_props_analyzed: totalProps,
          total_hooks_found: totalHooks,
          average_maintainability_score: Math.round(avgComplexityScore * 100) / 100,
          likely_ai_generated_files: aiGeneratedCount,
          most_common_ai_source: aiGeneratedCount > 0 ? mostCommonAISource : null,
          primary_framework: projectMetadata.analysis?.primaryFramework || 'unknown'
        },
        
        // Component complexity breakdown
        complexity_analysis: {
          distribution: complexityDistribution,
          performance_issues: [...new Set(performanceIssues)],
          recommendations: generateComplexityRecommendations(complexityDistribution, performanceIssues)
        },
        
        // Framework and pattern analysis
        patterns_analysis: {
          framework_usage: frameworkUsage,
          export_patterns: exportPatterns,
          hooks_usage: hooksUsage,
          ai_patterns: aiPatterns,
          code_quality_issues: extractCodeQualityIssues(fileComponents)
        },
        
        // Individual file component details
        file_components: fileComponents.map(fc => ({
          file_name: fc.fileName,
          framework: fc.framework,
          component_count: fc.componentStructure?.detection.componentCount || 0,
          main_component: fc.componentStructure?.detection.mainComponent,
          complexity: fc.componentStructure?.complexity.overall || 'unknown',
          maintainability_score: fc.componentStructure?.complexity.maintainabilityScore || 0,
          has_props: !!fc.componentStructure?.props,
          props_count: fc.componentStructure?.props?.properties.length || 0,
          hooks_count: fc.componentStructure?.hooks?.length || 0,
          likely_ai_generated: fc.componentStructure?.patterns.likelyAIGenerated || false,
          ai_source: fc.componentStructure?.patterns.aiSource,
          performance_flags: fc.componentStructure?.complexity.performanceFlags || []
        })),
        
        // Detailed analysis (optional, based on query parameter)
        detailed_analysis: url.searchParams.get('detailed') === 'true' ? fileComponents : undefined,
        
        // Auto-scaffolding recommendations
        scaffolding_recommendations: {
          suggested_template: suggestScaffoldingTemplate(fileComponents, projectMetadata),
          required_dependencies: aggregateRequiredDependencies(fileComponents),
          build_optimizations: suggestBuildOptimizations(fileComponents),
          performance_recommendations: suggestPerformanceOptimizations(performanceIssues)
        }
      };

      return successResponse(componentResponse, 200);

    } catch (r2Error) {
      console.error(`Failed to retrieve project components for ${projectId}:`, r2Error);
      return errorResponse(
        'PROJECT_RETRIEVAL_ERROR',
        'Failed to retrieve project component data',
        500,
        { projectId, error: r2Error instanceof Error ? r2Error.message : String(r2Error) }
      );
    }

  } catch (error) {
    console.error('Unexpected error in project components handler:', error);
    return errorResponse(
      'COMPONENTS_ERROR',
      'An unexpected error occurred while retrieving project components',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Generate complexity recommendations based on analysis
 */
function generateComplexityRecommendations(
  distribution: Record<ComponentComplexity, number>,
  issues: string[]
): string[] {
  const recommendations: string[] = [];
  
  if (distribution['very-complex'] > 0) {
    recommendations.push('Consider breaking down very complex components into smaller, reusable pieces');
  }
  
  if (distribution['complex'] > distribution['simple']) {
    recommendations.push('High complexity detected - review component architecture for simplification opportunities');
  }
  
  if (issues.includes('inline-objects')) {
    recommendations.push('Move inline style objects to constants or CSS classes for better performance');
  }
  
  if (issues.includes('missing-keys')) {
    recommendations.push('Add key props to list items to improve React rendering performance');
  }
  
  if (issues.includes('inline-functions')) {
    recommendations.push('Move inline functions to useCallback hooks or component-level functions');
  }
  
  return recommendations;
}

/**
 * Extract code quality issues from component analysis
 */
function extractCodeQualityIssues(fileComponents: Array<{ componentStructure?: ComponentStructure }>): string[] {
  const issues = new Set<string>();
  
  for (const file of fileComponents) {
    if (file.componentStructure) {
      issues.add(...file.componentStructure.patterns.commonIssues);
      issues.add(...file.componentStructure.patterns.bestPractices.missing);
    }
  }
  
  return Array.from(issues);
}

/**
 * Suggest scaffolding template based on component analysis
 */
function suggestScaffoldingTemplate(
  fileComponents: Array<{ componentStructure?: ComponentStructure }>,
  projectMetadata: ProjectMetadata
): string {
  const primaryFramework = projectMetadata.analysis?.primaryFramework || 'unknown';
  const hasRouting = fileComponents.some(f => f.componentStructure?.complexity.logicComplexity.hasAsyncOperations);
  const hasComplexState = fileComponents.some(f => 
    f.componentStructure?.complexity.stateComplexity.stateManagementApproach !== 'local'
  );
  
  if (primaryFramework === 'react') {
    if (hasRouting && hasComplexState) return 'react-router-redux';
    if (hasRouting) return 'react-router';
    if (hasComplexState) return 'react-context';
    return 'react-basic';
  }
  
  return `${primaryFramework}-basic`;
}

/**
 * Aggregate required dependencies from component analysis
 */
function aggregateRequiredDependencies(fileComponents: Array<{ componentStructure?: ComponentStructure }>): string[] {
  const dependencies = new Set<string>();
  
  for (const file of fileComponents) {
    if (file.componentStructure?.hooks) {
      for (const hook of file.componentStructure.hooks) {
        if (hook.type === 'custom' && !hook.name.startsWith('use')) {
          // Potential external hook library
          dependencies.add(`@${hook.name}-hook-library`);
        }
      }
    }
  }
  
  return Array.from(dependencies);
}

/**
 * Suggest build optimizations based on component analysis
 */
function suggestBuildOptimizations(fileComponents: Array<{ componentStructure?: ComponentStructure }>): string[] {
  const optimizations: string[] = [];
  
  const hasDynamicImports = fileComponents.some(f => 
    f.componentStructure?.complexity.logicComplexity.hasAsyncOperations
  );
  
  if (hasDynamicImports) {
    optimizations.push('Enable code splitting with dynamic imports');
  }
  
  const hasComplexComponents = fileComponents.some(f =>
    f.componentStructure?.complexity.overall === 'very-complex'
  );
  
  if (hasComplexComponents) {
    optimizations.push('Consider lazy loading for complex components');
    optimizations.push('Enable React.memo for expensive component trees');
  }
  
  return optimizations;
}

/**
 * Suggest performance optimizations based on detected issues
 */
function suggestPerformanceOptimizations(issues: string[]): string[] {
  const recommendations: string[] = [];
  
  if (issues.includes('inline-objects')) {
    recommendations.push('Extract inline style objects to avoid recreation on each render');
  }
  
  if (issues.includes('missing-keys')) {
    recommendations.push('Add keys to list items to help React identify changes efficiently');
  }
  
  if (issues.includes('complex-conditions')) {
    recommendations.push('Simplify complex conditional rendering with helper functions or useMemo');
  }
  
  return recommendations;
}
