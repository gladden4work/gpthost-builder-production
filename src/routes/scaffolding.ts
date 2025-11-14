/**
 * TASK-012 & TASK-014: Enhanced Scaffolding API Routes
 * REST endpoints for generating complete application scaffolding from AI components
 * with framework-specific optimizations and intelligent template selection
 */

import { 
  generateScaffoldedProject,
  optimizeForAIPatterns
} from '../utils/scaffoldingGenerator';
import { analyzeFileStructure } from '../utils/fileAnalysis';
import { parseImports } from '../utils/importParser';
import { analyzeComponentStructure } from '../utils/componentStructureAnalyzer';
import { successResponse, errorResponse } from '../utils/responses';
import { preprocessJSX, shouldPreprocessFile } from '../utils/jsxPreprocessor';
import { enqueueBuildJob } from '../utils/enqueueBuildJob';
import { appendTimelineEvent } from '../utils/projectTimeline';
import {
  ProjectMetadata,
  FileMetadata,
  ComponentStructure,
  ImportAnalysis,
  FrameworkType,
  ScaffoldedProject,
  ScaffoldingOptions
} from '../types/api';

/**
 * Scaffolding generation request
 */
export interface ScaffoldingRequest {
  project_id: string;
  options?: ScaffoldingOptions;
}

/**
 * Scaffolding generation response with TASK-014 framework-specific enhancements
 */
export interface ScaffoldingResponse {
  project_id: string;
  scaffolding: ScaffoldedProject;
  framework: FrameworkType;
  optimization_applied: boolean;
  generation_time_ms: number;
  file_count: number;
  ready_for_build: boolean;
  // TASK-014: Framework-specific feature indicators
  framework_features?: {
    enhanced_vite_config: boolean;
    error_handling: boolean;
    advanced_templates: boolean;
    typescript_optimized: boolean;
    complexity_level: string;
    ai_source: string;
  };
}

/**
 * POST /api/scaffolding/{project_id}/generate
 * Generate complete application scaffolding for a project
 */
export async function generateScaffoldingHandler(
  request: Request, 
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/');
    const projectId = pathSegments[3]; // /api/scaffolding/{project_id}/generate

    if (!projectId) {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in the URL path',
        400
      );
    }

    // Parse request body for options
    let options: ScaffoldingOptions = {};
    try {
      if (request.headers.get('content-type')?.includes('application/json')) {
        const bodyText = await request.text();
        if (bodyText && bodyText.trim()) {
          const body = JSON.parse(bodyText) as { options?: ScaffoldingOptions };
          options = body.options || {};
        }
      }
    } catch (error) {
      // JSON parsing error - use defaults
      console.warn('Failed to parse scaffolding options, using defaults:', error);
    }

    const startTime = Date.now();

    // 1. Retrieve project metadata from R2
    const projectMetadata = await getProjectMetadata(projectId, env);
    if (!projectMetadata) {
      return errorResponse(
        'PROJECT_NOT_FOUND',
        `Project ${projectId} not found`,
        404
      );
    }

    // 1.5. Check for concurrent operations
    if (projectMetadata.status === 'building' || projectMetadata.status === 'deploying') {
      return errorResponse(
        'OPERATION_IN_PROGRESS',
        `Cannot scaffold while project is ${projectMetadata.status}. Please wait for current operation to complete.`,
        409,
        { 
          project_id: projectId,
          current_status: projectMetadata.status
        }
      );
    }

    // 1.6. If project is a static HTML site, bypass scaffolding
    try {
      const framework = projectMetadata.analysis?.primaryFramework || projectMetadata.framework;
      const componentType = projectMetadata.analysis?.componentType;
      const hasHtmlFiles = Array.isArray(projectMetadata.files) && projectMetadata.files.some((f: any) => typeof f.name === 'string' && f.name.toLowerCase().endsWith('.html'));
      const isStaticHtml = framework === 'html' || (componentType === 'full-application' && hasHtmlFiles);
      if (isStaticHtml) {
        // Update status to reflect no scaffolding needed
        projectMetadata.status = 'scaffolded';
        projectMetadata.updated_at = new Date().toISOString();
        await env.PROJECTS_BUCKET.put(`projects/${projectId}/metadata.json`, JSON.stringify(projectMetadata, null, 2), {
          httpMetadata: { contentType: 'application/json' }
        });

        const response = {
          project_id: projectId,
          scaffolding: {
            framework: 'html',
            files: (projectMetadata.files || []).map((f: any) => ({ path: f.name, content: '[original]', type: 'html' })),
            buildConfig: { bundler: 'none', commands: [] }
          },
          framework: 'html',
          optimization_applied: false,
          generation_time_ms: 0,
          file_count: projectMetadata.files?.length || 0,
          ready_for_build: false,
          framework_features: {
            enhanced_vite_config: false,
            error_handling: false,
            advanced_templates: false,
            typescript_optimized: false,
            complexity_level: 'simple',
            ai_source: 'unknown'
          },
          static_deploy: true
        } as any;

        return successResponse(response, 200);
      }
    } catch (e) {
      console.warn('[SCAFFOLDING] Static HTML detection failed:', e);
    }

    // 2. Extract analysis data - it may be stored in different ways depending on the source
    let fileAnalysis: any = null;
    
    // For pasted code or analyzed uploads, analysis may be at project level
    if (projectMetadata.analysis) {
      // Create a synthetic file analysis from the project-level analysis
      fileAnalysis = {
        componentStructure: {
          componentCount: projectMetadata.analysis.totalComponents || 1,
          components: [],
          componentNames: projectMetadata.analysis.componentNames || projectMetadata.component_names || [],
          hasHooks: false,
          hooks: [],
          componentType: 'functional',
          hasProps: false,
          exports: { named: [], reExports: [], totalExports: 0, hasMultipleComponents: false },
          complexity: { overall: 'simple' },
          patterns: { likelyAIGenerated: true },
          detection: {
            componentCount: projectMetadata.analysis.totalComponents || 1,
            components: [],
            framework: projectMetadata.framework || 'javascript',
            hasMultipleComponents: false,
            dependencies: projectMetadata.analysis.dependencies || []
          }
        },
        importAnalysis: {
          statements: [],
          dependencies: {
            external: projectMetadata.analysis.dependencies || [],
            local: [],
            nodeBuiltins: [],
            scoped: [],
            assets: [],
            dynamicImports: [],
            typeOnlyImports: [],
            allUnique: projectMetadata.analysis.dependencies || []
          },
          hasCircularImports: false,
          unusedImports: [],
          importCount: { total: 0, es6: 0, commonjs: 0, dynamic: 0, typeOnly: 0, assets: 0 }
        }
      };
    } 
    // For uploaded files, try to load analysis from a separate file
    else {
      const analysisKey = `projects/${projectId}/analysis.json`;
      const analysisObject = await env.PROJECTS_BUCKET.get(analysisKey);
      
      if (analysisObject) {
        const analysisData = await analysisObject.json() as any;
        const firstFile = analysisData.files?.[0];
        
        if (firstFile?.analysis) {
          fileAnalysis = {
            componentStructure: firstFile.analysis.componentStructure,
            importAnalysis: firstFile.analysis.importAnalysis
          };
        }
      }
    }
    
    // 3. Validate we have the required analysis data
    if (!fileAnalysis || !fileAnalysis.componentStructure || !fileAnalysis.importAnalysis) {
      return errorResponse(
        'INCOMPLETE_ANALYSIS',
        'Project analysis is incomplete - missing component structure or import analysis',
        400,
        { 
          project_id: projectId,
          has_metadata_analysis: !!projectMetadata.analysis,
          metadata_keys: Object.keys(projectMetadata)
        }
      );
    }

    // 3.5. Load original user files (with content) from R2 based on metadata paths
    const originalFiles: any[] = [];
    try {
      const filesFromMetadata: FileMetadata[] = Array.isArray(projectMetadata.files) ? projectMetadata.files : [];
      for (const f of filesFromMetadata) {
        if (!f?.path || !f?.name) continue;
        const obj = await env.PROJECTS_BUCKET.get(f.path);
        if (!obj) {
          console.warn(`[SCAFFOLDING] Missing source file in R2: ${f.path}`);
          continue;
        }
        const content = await obj.text();
        originalFiles.push({
          name: f.name,
          size: content.length,
          type: f.type || 'text/plain',
          content
        });
      }
      console.info(`Loaded ${originalFiles.length} original file(s) from metadata for project ${projectId}`);
    } catch (e) {
      console.warn('[SCAFFOLDING] Failed to load original files from metadata:', e);
    }

    // 4. Generate scaffolded project
    // Convert 'javascript' to 'react' for scaffolding since plain JS components usually use JSX
    let frameworkForScaffolding = projectMetadata.framework || 'unknown';
    if (frameworkForScaffolding === 'javascript' || frameworkForScaffolding === 'unknown') {
      // Default to React for JSX components
      frameworkForScaffolding = 'react';
    }
    
    const scaffoldedProject = await generateScaffoldedProject(
      fileAnalysis.componentStructure,
      fileAnalysis.importAnalysis,
      frameworkForScaffolding,
      originalFiles, // Now uses the updated originalFiles that includes the component
      options
    );

    // 5. Apply AI-specific optimizations
    const optimizedProject = optimizeForAIPatterns(
      scaffoldedProject,
      fileAnalysis.componentStructure
    );

    // 6. Store scaffolding results in R2 (for potential reuse)
    await storeScaffoldingResults(projectId, optimizedProject, env);
    
    // 7. Update project metadata status to indicate scaffolding is complete
    projectMetadata.status = 'scaffolded';
    projectMetadata.updated_at = new Date().toISOString();
    
    const metadataKey = `projects/${projectId}/metadata.json`;
    await env.PROJECTS_BUCKET.put(
      metadataKey,
      JSON.stringify(projectMetadata, null, 2),
      {
        httpMetadata: {
          contentType: 'application/json'
        },
        customMetadata: {
          projectId: projectId,
          type: 'metadata',
          updated: new Date().toISOString()
        }
      }
    );

    // 8. Auto-trigger build queue after scaffolding is complete
    // Auto-triggering build queue is now handled after the response is prepared
    // It uses env.BUILD_QUEUE.send() directly instead of calling the handler

    const generationTime = Date.now() - startTime;

    // TASK-014: Enhanced response with framework-specific optimization details
    const componentStructure = fileAnalysis.componentStructure;
    const hasFrameworkSpecificFeatures = 
      optimizedProject.files.some(f => 
        f.template?.includes('enhanced') || 
        f.template?.includes('error-boundary') ||
        f.template?.includes('composables') ||
        f.template?.includes('stores')
      );

    const response: ScaffoldingResponse = {
      project_id: projectId,
      scaffolding: optimizedProject,
      framework: optimizedProject.framework,
      optimization_applied: true,
      generation_time_ms: generationTime,
      file_count: optimizedProject.files.length,
      ready_for_build: true,
      // TASK-014: Framework-specific enhancement indicators
      framework_features: {
        enhanced_vite_config: optimizedProject.files.some(f => f.template?.includes('enhanced') && f.type === 'config'),
        error_handling: optimizedProject.files.some(f => f.template?.includes('error')),
        advanced_templates: hasFrameworkSpecificFeatures,
        typescript_optimized: optimizedProject.files.some(f => f.path.endsWith('.ts') || f.path.endsWith('.tsx')),
        complexity_level: componentStructure.complexity.overall,
        ai_source: componentStructure.patterns?.aiSource || 'unknown'
      }
    };

    // Log scaffolding completion
    await appendTimelineEvent(projectId, env, 'scaffolded');

    // Determine if auto-queue is enabled
    const autoQueue = (env.SCAFFOLDING_AUTO_QUEUE || 'on').toLowerCase() !== 'off';

    if (autoQueue) {
      // Trigger build queue for the next stage in the pipeline
      try {
        const buildJob = await enqueueBuildJob(projectId, env, {
          priority: 'normal',
          timeout_seconds: 90,
          optimization_level: 'production',
          enable_source_maps: false
        });

        console.info(`✅ Build job ${buildJob.job_id} queued for project ${projectId}`);
        (response as any).build_job_queued = true;
        (response as any).build_job_id = buildJob.job_id;
      } catch (queueError) {
        console.error(`Failed to queue build job for project ${projectId}:`, queueError);
        (response as any).build_job_queued = false;
        (response as any).build_queue_error = queueError instanceof Error ? queueError.message : String(queueError);
      }
    } else {
      console.info(`⚙️  Auto enqueue disabled via SCAFFOLDING_AUTO_QUEUE for project ${projectId}`);
      (response as any).build_job_queued = false;
    }

    return successResponse(response, 200);

  } catch (error) {
    console.error('Scaffolding generation failed:', error);
    return errorResponse(
      'SCAFFOLDING_GENERATION_FAILED',
      'Failed to generate project scaffolding',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * GET /api/scaffolding/{project_id}/status
 * Get scaffolding status for a project
 */
export async function getScaffoldingStatusHandler(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/');
    const projectId = pathSegments[3]; // /api/scaffolding/{project_id}/status

    if (!projectId) {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in the URL path',
        400
      );
    }

    // Check if scaffolding results exist
    const scaffoldingKey = `projects/${projectId}/scaffolding/result.json`;
    const scaffoldingObject = await env.PROJECTS_BUCKET.get(scaffoldingKey);

    if (!scaffoldingObject) {
      return successResponse({
        project_id: projectId,
        scaffolding_generated: false,
        message: 'Scaffolding has not been generated for this project'
      });
    }

    const scaffoldingData = await scaffoldingObject.json() as ScaffoldedProject;

    return successResponse({
      project_id: projectId,
      scaffolding_generated: true,
      framework: scaffoldingData.framework,
      file_count: scaffoldingData.files.length,
      has_typescript: scaffoldingData.files.some(f => f.path.includes('.ts')),
      has_tests: scaffoldingData.files.some(f => f.path.includes('test')),
      build_config: scaffoldingData.buildConfig,
      last_generated: scaffoldingObject.uploaded?.toISOString()
    });

  } catch (error) {
    console.error('Failed to get scaffolding status:', error);
    return errorResponse(
      'STATUS_CHECK_FAILED',
      'Failed to check scaffolding status',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * GET /api/scaffolding/{project_id}/files
 * Get generated files for a scaffolded project
 */
export async function getScaffoldingFilesHandler(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/');
    const projectId = pathSegments[3]; // /api/scaffolding/{project_id}/files

    if (!projectId) {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in the URL path',
        400
      );
    }

    // Retrieve scaffolding results
    const scaffoldingKey = `projects/${projectId}/scaffolding/result.json`;
    const scaffoldingObject = await env.PROJECTS_BUCKET.get(scaffoldingKey);

    if (!scaffoldingObject) {
      return errorResponse(
        'SCAFFOLDING_NOT_FOUND',
        'Scaffolding has not been generated for this project',
        404,
        { 
          project_id: projectId,
          suggestion: `Call POST /api/scaffolding/${projectId}/generate first`
        }
      );
    }

    const scaffoldingData = await scaffoldingObject.json() as ScaffoldedProject;

    // Parse query parameters for filtering
    const fileType = url.searchParams.get('type');
    const includeContent = url.searchParams.get('include_content') === 'true';

    let files = scaffoldingData.files;

    // Filter by file type if specified
    if (fileType) {
      files = files.filter(f => f.type === fileType);
    }

    // Optionally exclude content to reduce response size
    if (!includeContent) {
      files = files.map(f => ({
        ...f,
        content: `[Content hidden - use include_content=true to view]`
      }));
    }

    return successResponse({
      project_id: projectId,
      framework: scaffoldingData.framework,
      files,
      total_files: scaffoldingData.files.length,
      filtered_files: files.length,
      file_types: [...new Set(scaffoldingData.files.map(f => f.type))],
      includes_content: includeContent
    });

  } catch (error) {
    console.error('Failed to get scaffolding files:', error);
    return errorResponse(
      'FILE_RETRIEVAL_FAILED',
      'Failed to retrieve scaffolding files',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * POST /api/scaffolding/{project_id}/regenerate
 * Regenerate scaffolding with new options
 */
export async function regenerateScaffoldingHandler(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/');
    const projectId = pathSegments[3]; // /api/scaffolding/{project_id}/regenerate

    if (!projectId) {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in the URL path',
        400
      );
    }

    // Parse new options
    let options: ScaffoldingOptions = {};
    try {
      const body = await request.json() as { options?: ScaffoldingOptions };
      options = body.options || {};
    } catch (error) {
      return errorResponse(
        'INVALID_REQUEST_BODY',
        'Request body must be valid JSON with options field',
        400
      );
    }

    // Call the generation handler with new options
    // Create a new request with the options
    const newRequest = new Request(request.url.replace('/regenerate', '/generate'), {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ options })
    });

    return await generateScaffoldingHandler(newRequest, env);

  } catch (error) {
    console.error('Scaffolding regeneration failed:', error);
    return errorResponse(
      'REGENERATION_FAILED',
      'Failed to regenerate project scaffolding',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Helper: Retrieve project metadata from R2
 */
async function getProjectMetadata(
  projectId: string,
  env: Env
): Promise<ProjectMetadata | null> {
  try {
    const metadataKey = `projects/${projectId}/metadata.json`;
    const metadataObject = await env.PROJECTS_BUCKET.get(metadataKey);
    
    if (!metadataObject) {
      return null;
    }
    
    return await metadataObject.json() as ProjectMetadata;
  } catch (error) {
    console.error(`Failed to retrieve project metadata for ${projectId}:`, error);
    return null;
  }
}

/**
 * Helper: Store scaffolding results in R2
 */
async function storeScaffoldingResults(
  projectId: string,
  scaffoldedProject: ScaffoldedProject,
  env: Env
): Promise<void> {
  try {
    const scaffoldingKey = `projects/${projectId}/scaffolding/result.json`;
    const scaffoldingData = JSON.stringify(scaffoldedProject, null, 2);

    await env.PROJECTS_BUCKET.put(scaffoldingKey, scaffoldingData, {
      httpMetadata: {
        contentType: 'application/json',
      },
      customMetadata: {
        project_id: projectId,
        framework: scaffoldedProject.framework,
        file_count: scaffoldedProject.files.length.toString(),
        generated_at: new Date().toISOString()
      }
    });

    // Also store individual files for potential direct access
    for (const file of scaffoldedProject.files) {
      const fileKey = `projects/${projectId}/scaffolding/files/${file.path}`;
      
      // Preprocess JSX content before saving to R2 to fix AI-generated patterns
      let contentToSave = file.content;
      if (shouldPreprocessFile(file.path)) {
        console.info(`🧹 [SCAFFOLDING] Preprocessing ${file.path} to fix AI-generated JSX patterns`);
        contentToSave = preprocessJSX(file.content, file.path);
      }
      
      await env.PROJECTS_BUCKET.put(fileKey, contentToSave, {
        httpMetadata: {
          contentType: getContentTypeForFile(file.path),
        },
        customMetadata: {
          project_id: projectId,
          file_type: file.type,
          is_generated: file.isGenerated.toString(),
          template: file.template
        }
      });
    }

    console.info(`Stored scaffolding results for project ${projectId}: ${scaffoldedProject.files.length} files`);
  } catch (error) {
    console.error(`Failed to store scaffolding results for ${projectId}:`, error);
    throw error;
  }
}

/**
 * Helper: Get content type for a file based on extension
 */
function getContentTypeForFile(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase();
  
  switch (extension) {
    case 'json':
      return 'application/json';
    case 'html':
      return 'text/html';
    case 'css':
      return 'text/css';
    case 'js':
    case 'jsx':
      return 'application/javascript';
    case 'ts':
    case 'tsx':
      return 'application/typescript';
    case 'vue':
      return 'text/x-vue';
    case 'svelte':
      return 'text/x-svelte';
    case 'md':
      return 'text/markdown';
    default:
      return 'text/plain';
  }
}

/**
 * Helper: Get scaffolding preview (metadata only, no content)
 */
export async function getScaffoldingPreviewHandler(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/');
    const projectId = pathSegments[3]; // /api/scaffolding/{project_id}/preview

    if (!projectId) {
      return errorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required in the URL path',
        400
      );
    }

    const scaffoldingKey = `projects/${projectId}/scaffolding/result.json`;
    const scaffoldingObject = await env.PROJECTS_BUCKET.get(scaffoldingKey);

    if (!scaffoldingObject) {
      return errorResponse(
        'SCAFFOLDING_NOT_FOUND',
        'Scaffolding has not been generated for this project',
        404
      );
    }

    const scaffoldingData = await scaffoldingObject.json() as ScaffoldedProject;

    // Return preview without file contents
    const preview = {
      project_id: projectId,
      framework: scaffoldingData.framework,
      build_config: scaffoldingData.buildConfig,
      project_structure: scaffoldingData.projectStructure,
      entry_points: scaffoldingData.entryPoints,
      files: scaffoldingData.files.map(f => ({
        path: f.path,
        type: f.type,
        is_generated: f.isGenerated,
        template: f.template,
        size_bytes: f.content.length
      })),
      package_json_preview: {
        name: scaffoldingData.packageJson.name,
        dependencies_count: Object.keys(scaffoldingData.packageJson.dependencies || {}).length,
        dev_dependencies_count: Object.keys(scaffoldingData.packageJson.devDependencies || {}).length,
        scripts: scaffoldingData.packageJson.scripts
      }
    };

    return successResponse(preview);

  } catch (error) {
    console.error('Failed to get scaffolding preview:', error);
    return errorResponse(
      'PREVIEW_FAILED',
      'Failed to get scaffolding preview',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}
