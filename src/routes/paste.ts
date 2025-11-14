/**
 * Code Paste Handler for GPTHost API
 * Handles plain text code paste with intelligent framework detection and file conversion
 */

import { successResponse, errorResponse } from '../utils/responses';
import { ProjectMetadata, FileMetadata, PasteRequest, PasteResponse, ProjectStatus } from '../types/api';
import { 
  convertContentToFile, 
  validatePastedContent, 
  createFileFromContent,
  generateDetectionFeedback
} from '../utils/contentConversion';
import { analyzeFrameworkFromContent, analyzeFile, aggregateProjectAnalysis } from '../utils/fileAnalysis';
import { generateScaffoldingHandler } from './scaffolding';
import { createDeploymentManager } from '../utils/deploymentManager';
import { preprocessJSX, shouldPreprocessFile } from '../utils/jsxPreprocessor';
import type { AuthenticatedRequest } from '../utils/authUtils';

// Owner scoping
const LEGACY_OWNER_ID = 'legacy-single-tenant' as const;

const translateStatus = (status: ProjectStatus): ProjectStatus =>
  status === 'scaffolding' || status === 'scaffolded' ? 'queueing' : status;

/**
 * Handle code paste requests
 * POST /api/paste
 */
export async function pasteHandler(request: Request, env: Env): Promise<Response> {
  try {
    // Verify request method
    if (request.method !== 'POST') {
      return errorResponse(
        'METHOD_NOT_ALLOWED',
        'Only POST method is allowed for code paste',
        405
      );
    }

    // Check content type for JSON
    const contentType = request.headers.get('Content-Type');
    if (!contentType || !contentType.includes('application/json')) {
      return errorResponse(
        'INVALID_CONTENT_TYPE',
        'Content-Type must be application/json',
        400,
        { received: contentType }
      );
    }

    // Parse JSON request body
    let requestData: PasteRequest;
    try {
      requestData = await request.json();
    } catch (jsonError) {
      return errorResponse(
        'INVALID_JSON',
        'Request body must be valid JSON',
        400,
        { error: jsonError instanceof Error ? jsonError.message : String(jsonError) }
      );
    }

    // Extract and validate inputs
    const { content, project_name, description } = requestData;
    
    // Validate project name
    const sanitizedProjectName = project_name?.toString()?.trim()?.slice(0, 100);
    if (!sanitizedProjectName || sanitizedProjectName.length === 0) {
      return errorResponse(
        'INVALID_PROJECT_NAME',
        'Project name is required and must be non-empty',
        400
      );
    }

    // Validate pasted content
    const contentValidation = validatePastedContent(content);
    if (!contentValidation.isValid) {
      return errorResponse(
        contentValidation.errorCode!,
        contentValidation.message!,
        400,
        contentValidation.details
      );
    }

    // Generate unique project ID
    const projectId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    console.info(`Processing paste request for project: ${sanitizedProjectName} (ID: ${projectId})`);

    // Step 1: Detect framework from content
    const detectedFramework = analyzeFrameworkFromContent(content);
    console.info(`Detected framework: ${detectedFramework}`);

    // Step 2: Convert content to appropriate file format
    let { filename, mimeType, content: processedContent } = convertContentToFile(content, detectedFramework);
    console.info(`Generated filename: ${filename} with MIME type: ${mimeType}`);

    // Step 2.5: Preprocess JSX content to fix AI-generated patterns BEFORE saving to R2
    // This ensures clean content throughout the entire pipeline
    if (shouldPreprocessFile(filename)) {
      console.info(`🧹 [PASTE] Preprocessing ${filename} to fix AI-generated JSX patterns`);
      processedContent = preprocessJSX(processedContent, filename);
    }

    // Step 3: Create File object for analysis (using cleaned content)
    const fileForAnalysis = createFileFromContent(processedContent, filename, mimeType);

    // Step 4: Perform comprehensive file analysis
    let fileAnalysis;
    try {
      fileAnalysis = await analyzeFile(fileForAnalysis);
      console.info(`Analysis complete for ${filename}:`, {
        framework: fileAnalysis.framework,
        componentType: fileAnalysis.componentType,
        language: fileAnalysis.language,
        componentCount: fileAnalysis.componentNames.length
      });
    } catch (analysisError) {
      console.error(`Failed to analyze pasted content:`, analysisError);
      // Continue with basic metadata but without detailed analysis
      fileAnalysis = undefined;
    }

    // Step 5: Store file in R2 (align with multi-project structure under projects/active)
    const storagePath = `projects/active/${projectId}/source/${filename}`;
    try {
      await env.PROJECTS_BUCKET.put(storagePath, fileForAnalysis.stream(), {
        httpMetadata: {
          contentType: mimeType,
        },
        customMetadata: {
          originalName: filename,
          uploadTime: timestamp,
          projectId: projectId,
          source: 'paste', // Distinguish from file uploads
          contentLength: content.length.toString()
        }
      });

      console.info(`File stored successfully at: ${storagePath}`);
    } catch (r2Error) {
      console.error(`Failed to store pasted content in R2:`, r2Error);
      return errorResponse(
        'STORAGE_ERROR',
        `Failed to store pasted content`,
        500,
        { 
          filename, 
          projectId,
          error: r2Error instanceof Error ? r2Error.message : String(r2Error) 
        }
      );
    }

    // Step 6: Create file metadata
    const fileMetadata: FileMetadata = {
      name: filename,
      path: storagePath,
      size: content.length, // Use original content length
      type: mimeType,
      upload_time: timestamp,
      analysis: fileAnalysis
    };

    // Step 7: Generate project analysis
    const fileAnalyses = fileAnalysis ? [fileAnalysis] : [];
    const projectAnalysis = aggregateProjectAnalysis(fileAnalyses);
    
    // Step 7.5: Add security warnings for suspicious patterns
    const suspiciousPatterns = [
      { pattern: /require\s*\(\s*['"`]fs['"`]/, warning: 'File system access detected' },
      { pattern: /\.readFileSync/, warning: 'File system read operation detected' },
      { pattern: /process\.env/, warning: 'Environment variable access detected' },
      { pattern: /eval\s*\(/, warning: 'Dynamic code execution detected' },
      { pattern: /document\.write/, warning: 'Potential DOM manipulation detected' }
    ];
    
    const warnings: string[] = [];
    for (const { pattern, warning } of suspiciousPatterns) {
      if (pattern.test(content)) {
        warnings.push(warning);
      }
    }
    
    if (warnings.length > 0) {
      projectAnalysis.warnings = warnings;
    }
    
    console.info('Project analysis complete:', {
      primaryFramework: projectAnalysis.primaryFramework,
      componentType: projectAnalysis.componentType,
      totalComponents: projectAnalysis.totalComponents
    });

    // Step 8: Create and store project metadata
    // Attach owner information so the project is visible under the user's dashboard scope
    const authContext = (request as AuthenticatedRequest).authContext;
    const ownerId = authContext?.authType === 'legacy-token'
      ? LEGACY_OWNER_ID
      : (authContext?.user?.id || undefined);

    const projectMetadata: ProjectMetadata = {
      id: projectId,
      status: 'analyzing',
      name: sanitizedProjectName,
      description: description?.toString()?.trim()?.slice(0, 500),
      framework: projectAnalysis.primaryFramework,
      files: [fileMetadata],
      created_at: timestamp,
      updated_at: timestamp,
      analysis: projectAnalysis
    };

    // Persist ownerId alongside metadata (backward compatible: extra field)
    // Note: ProjectService.listProjects reads this field to filter by owner
    (projectMetadata as any).ownerId = ownerId || LEGACY_OWNER_ID;

    // Store metadata in active path for listing, and legacy path for backward compatibility
    const metadataActivePath = `projects/active/${projectId}/metadata.json`;
    const metadataLegacyPath = `projects/${projectId}/metadata.json`;
    try {
      // Primary: active path
      await env.PROJECTS_BUCKET.put(metadataActivePath, JSON.stringify(projectMetadata, null, 2), {
        httpMetadata: {
          contentType: 'application/json',
        },
        customMetadata: {
          projectId: projectId,
          type: 'metadata',
          created: timestamp,
          source: 'paste'
        }
      });
      // Legacy: flat path to avoid breaking existing readers
      await env.PROJECTS_BUCKET.put(metadataLegacyPath, JSON.stringify(projectMetadata, null, 2), {
        httpMetadata: {
          contentType: 'application/json',
        },
        customMetadata: {
          projectId: projectId,
          type: 'metadata',
          created: timestamp,
          source: 'paste'
        }
      });

      console.info(`Project metadata stored at: ${metadataActivePath} and ${metadataLegacyPath}`);
    } catch (metadataError) {
      console.error(`Failed to store project metadata for ${projectId}:`, metadataError);
      
      // Cleanup uploaded file on metadata failure
      try {
        console.info(`Cleaning up uploaded file due to metadata failure`);
        await env.PROJECTS_BUCKET.delete(storagePath);
        console.info('Successfully cleaned up uploaded file');
      } catch (cleanupError) {
        console.error('Failed to cleanup uploaded file:', cleanupError);
      }
      
      return errorResponse(
        'METADATA_STORAGE_ERROR',
        'Failed to store project metadata. Uploaded content has been cleaned up.',
        500,
        { 
          projectId, 
          error: metadataError instanceof Error ? metadataError.message : String(metadataError) 
        }
      );
    }

    // Step 9: Generate user-friendly feedback message
    const feedbackMessage = generateDetectionFeedback(
      detectedFramework,
      filename,
      fileAnalysis
    );

    // Step 10: If full HTML application, bypass scaffolding and deploy statically; otherwise auto-trigger scaffolding
    // Production-safe: use top-level import and always attempt scaffolding
    let pasteStatus: ProjectStatus = 'analyzing';
    let buildJobId: string | undefined;
    const isFullHtml = (projectAnalysis.primaryFramework === 'html') ||
      ((fileAnalysis?.componentType === 'full-application') && filename.toLowerCase().endsWith('.html'));
    try {
      if (isFullHtml) {
        // Direct static deployment path
        console.info(`Detected full HTML input for ${projectId}. Bypassing scaffolding and deploying statically.`);
        const deploymentManager = createDeploymentManager(env);
        const result = await deploymentManager.deployStaticSite(projectId);
        if (!result.success) {
          return errorResponse(
            result.error?.code || 'STATIC_DEPLOY_FAILED',
            result.error?.message || 'Static deployment failed',
            500,
            { project_id: projectId, error: result.error }
          );
        }
        pasteStatus = 'deployed';
      } else {
        // Update project metadata to indicate scaffolding is being triggered FIRST for concurrency safety
        projectMetadata.status = 'scaffolding';
        projectMetadata.updated_at = new Date().toISOString();

        // Persist status update in both active and legacy paths
        await env.PROJECTS_BUCKET.put(metadataActivePath, JSON.stringify(projectMetadata, null, 2), {
          httpMetadata: {
            contentType: 'application/json',
          },
          customMetadata: {
            projectId: projectId,
            type: 'metadata',
            created: timestamp,
            source: 'paste'
          }
        });
        await env.PROJECTS_BUCKET.put(metadataLegacyPath, JSON.stringify(projectMetadata, null, 2), {
          httpMetadata: {
            contentType: 'application/json',
          },
          customMetadata: {
            projectId: projectId,
            type: 'metadata',
            created: timestamp,
            source: 'paste'
          }
        });

        // Create scaffolding request (URL is only used for path parsing)
        const scaffoldingRequest = new Request(`https://internal/api/scaffolding/${projectId}/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': request.headers.get('Authorization') || ''
          }
        });

        const scaffoldingResponse = await generateScaffoldingHandler(scaffoldingRequest, env);
        if (scaffoldingResponse.status === 200) {
          pasteStatus = 'scaffolded';
          try {
            const scaffoldingData = await scaffoldingResponse.json();
            buildJobId = scaffoldingData.data?.build_job_id;
          } catch (parseError) {
            console.warn('Failed to parse scaffolding response:', parseError);
          }
          console.info(`✅ Auto-scaffolding completed successfully for project ${projectId}`);
        } else {
          pasteStatus = 'scaffolding';
          let errorDetails: any = { status: scaffoldingResponse.status };
          try {
            const errBody = await scaffoldingResponse.json();
            errorDetails = { ...errorDetails, ...errBody };
          } catch {}
          console.error(`❌ Auto-scaffolding failed for project ${projectId}:`, errorDetails);

          // Return accurate error to caller (avoid misleading 201)
          return errorResponse(
            'SCAFFOLDING_FAILED',
            'Auto-scaffolding failed after paste operation',
            500,
            {
              project_id: projectId,
              detected_framework: detectedFramework,
              ...errorDetails
            }
          );
        }
      }
    } catch (scaffoldingError) {
      pasteStatus = 'scaffolding';
      console.error(`Error triggering auto-scaffolding for project ${projectId}:`, scaffoldingError);

      // Return accurate error to caller (avoid misleading 201)
      return errorResponse(
        'SCAFFOLDING_TRIGGER_ERROR',
        'Failed to trigger auto-scaffolding',
        500,
        {
          project_id: projectId,
          detected_framework: detectedFramework,
          error: scaffoldingError instanceof Error ? scaffoldingError.message : String(scaffoldingError)
        }
      );
    }

    // Step 11: Prepare successful response
    const pasteResponse: PasteResponse = {
      project_id: projectId,
      status: translateStatus(pasteStatus),
      message: feedbackMessage,
      detected_framework: detectedFramework,
      generated_filename: filename,
      analysis: projectAnalysis,
      build_job_id: buildJobId
    };

    console.info(`Paste operation completed successfully for project ${projectId}`);
    return successResponse(pasteResponse, 201);

  } catch (error) {
    console.error('Unexpected error in paste handler:', error);
    return errorResponse(
      'PASTE_ERROR',
      'An unexpected error occurred during code paste processing',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}
