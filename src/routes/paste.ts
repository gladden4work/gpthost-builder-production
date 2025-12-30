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
import { SubdomainService } from '../services/SubdomainService';
import { createSharedLogger } from '../utils/sharedLogger';
import { ProjectService } from '../services/ProjectService';
import { StorageService } from '../services/StorageService';
import { sanitizeProjectName } from '../utils/projectName';
import { ProjectErrorCode } from '../lib/errors';
import { ManifestService } from '../services/ManifestService';
import { isManifestEnabled } from '../config/featureFlags';

// Owner scoping
const LEGACY_OWNER_ID = 'legacy-single-tenant' as const;

const translateStatus = (status: ProjectStatus): ProjectStatus =>
  status === 'scaffolding' || status === 'scaffolded' ? 'queueing' : status;

/**
 * Handle code paste requests
 * POST /api/paste
 */
export async function pasteHandler(request: Request, env: Env): Promise<Response> {
  // Track variables for error logging (need to be accessible in catch block)
  let contentForLogging: string | undefined;
  let frameworkForLogging: string | undefined;
  let userIdForLogging: string | undefined;

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
    contentForLogging = content; // Store for potential error logging
    
    // Validate and sanitize project name
    const projectNameResult = sanitizeProjectName(project_name);
    if (projectNameResult.error) {
      return errorResponse(
        'INVALID_PROJECT_NAME',
        projectNameResult.error,
        400,
        { received: project_name, sanitized: projectNameResult.sanitized }
      );
    }
    const sanitizedProjectName = projectNameResult.sanitized;

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

    // Extract owner information early for ProjectService
    const authContext = (request as AuthenticatedRequest).authContext;
    userIdForLogging = authContext?.user?.id;
    const ownerId = authContext?.authType === 'legacy-token'
      ? LEGACY_OWNER_ID
      : (authContext?.user?.id || LEGACY_OWNER_ID);

    console.info(`Processing paste request for project: ${sanitizedProjectName} (ID: ${projectId})`);

    // Step 1: Detect framework from content
    const detectedFramework = analyzeFrameworkFromContent(content);
    frameworkForLogging = detectedFramework; // Store for potential error logging
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

    // Step 5-8: Create project via ProjectService (handles file storage + manifest updates)
    // This consolidates 6 direct R2 writes into a single service call
    const storageService = new StorageService(env.PROJECTS_BUCKET);
    const projectService = new ProjectService(storageService, env);

    const createResult = await projectService.createProject({
      name: sanitizedProjectName,
      description: description?.toString()?.trim()?.slice(0, 500),
      framework: detectedFramework,
      ownerId,
      sourcePrefix: 'source/',
      files: [{
        path: filename,
        content: processedContent,
      }]
    });

    if (!createResult.ok) {
      console.error(`Failed to create project via ProjectService:`, createResult.error);
      const statusCode = createResult.error.code === ProjectErrorCode.INVALID_INPUT ? 400 : 500;
      return errorResponse(
        createResult.error.code || 'PROJECT_CREATE_FAILED',
        createResult.error.message,
        statusCode,
        { projectId, error: createResult.error }
      );
    }

    // ProjectService generated a new ID, but we want to use our pre-generated one for consistency
    // So we need to use the returned project's file path
    const createdProject = createResult.value;
    const storagePath = createdProject.files[0]?.path || `projects/${createdProject.id}/source/${filename}`;
    console.info(`File stored successfully at: ${storagePath}`);

    // NOTE: Legacy path (projects/active/) writes removed to prevent duplicate data
    // See: Duplicate detection logging task - Nov 2025

    // Step 6: Create file metadata with analysis (ProjectService doesn't store analysis)
    const fileMetadata: FileMetadata = {
      name: filename,
      path: storagePath,
      size: content.length,
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

    // Step 8: Create full project metadata with analysis for scaffolding compatibility
    // ProjectService creates basic metadata; we enhance it with analysis for scaffolding
    const projectMetadata: ProjectMetadata = {
      id: createdProject.id,
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
    (projectMetadata as any).ownerId = ownerId;

    // Overwrite metadata with full version including analysis (scaffolding needs this)
    // NOTE: Legacy path (projects/active/) writes removed to prevent duplicate data - Nov 2025
    const metadataPath = `projects/${createdProject.id}/metadata.json`;
    try {
      // Write to canonical path only (legacy path writes removed)
      await env.PROJECTS_BUCKET.put(metadataPath, JSON.stringify(projectMetadata, null, 2), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          projectId: createdProject.id,
          type: 'metadata',
          created: timestamp,
          source: 'paste'
        }
      });
      console.info(`Project metadata stored at: ${metadataPath}`);

      // Register subdomain mapping if subdomain routing is enabled
      if (env.ENABLE_SUBDOMAIN_ROUTING === 'true') {
        try {
          const subdomainService = new SubdomainService(env);
          const normalizedSubdomain = subdomainService.generateSubdomain(sanitizedProjectName);
          const subdomainResult = await subdomainService.registerSubdomain(
            sanitizedProjectName,
            createdProject.id,
            ownerId
          );

          if (subdomainResult.ok) {
            console.info(`✅ Subdomain registered: ${normalizedSubdomain} → ${createdProject.id}`);

            // Keep manifest in sync (dashboard reads from manifest fast-path)
            if (isManifestEnabled(env)) {
              try {
                const manifestService = new ManifestService(env);
                const baseDomain = env.BASE_DOMAIN || 'gpthost.online';
                await manifestService.updateSubdomain(
                  ownerId,
                  createdProject.id,
                  normalizedSubdomain,
                  `https://${normalizedSubdomain}.${baseDomain}`
                );
              } catch (manifestError) {
                console.warn(`Failed to update manifest subdomain for ${createdProject.id}:`, manifestError);
              }
            }
          } else {
            console.error(`⚠️ Failed to register subdomain for ${createdProject.id}:`, subdomainResult.error);

            // If the mapping already exists (idempotent), still sync it into the manifest.
            if (
              subdomainResult.error?.code === 'SUBDOMAIN_ALREADY_EXISTS' &&
              env.SUBDOMAIN_MAPPINGS &&
              isManifestEnabled(env)
            ) {
              try {
                const existing = await env.SUBDOMAIN_MAPPINGS.get(normalizedSubdomain);
                if (existing) {
                  let existingProjectId: string | null = null;
                  try {
                    const parsed = JSON.parse(existing) as { projectId?: string };
                    existingProjectId = parsed?.projectId ?? null;
                  } catch {
                    existingProjectId = existing;
                  }

                  if (existingProjectId === createdProject.id) {
                    const manifestService = new ManifestService(env);
                    const baseDomain = env.BASE_DOMAIN || 'gpthost.online';
                    await manifestService.updateSubdomain(
                      ownerId,
                      createdProject.id,
                      normalizedSubdomain,
                      `https://${normalizedSubdomain}.${baseDomain}`
                    );
                  }
                }
              } catch (manifestError) {
                console.warn(`Failed to heal manifest subdomain for ${createdProject.id}:`, manifestError);
              }
            }
          }
        } catch (subdomainError) {
          console.error(`⚠️ Error registering subdomain for ${createdProject.id}:`, subdomainError);
        }
      }
    } catch (metadataError) {
      console.error(`Failed to store enhanced project metadata for ${createdProject.id}:`, metadataError);
      // Don't fail - basic project already created via ProjectService
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
    let staticDeploymentUrl: string | undefined;
    const isFullHtml = (projectAnalysis.primaryFramework === 'html') ||
      ((fileAnalysis?.componentType === 'full-application') && filename.toLowerCase().endsWith('.html'));
    try {
      if (isFullHtml) {
        // Direct static deployment path
        console.info(`Detected full HTML input for ${createdProject.id}. Bypassing scaffolding and deploying statically.`);
        const deploymentManager = createDeploymentManager(env);
        const result = await deploymentManager.deployStaticSite(createdProject.id);
        if (!result.success) {
          return errorResponse(
            result.error?.code || 'STATIC_DEPLOY_FAILED',
            result.error?.message || 'Static deployment failed',
            500,
            { project_id: createdProject.id, error: result.error }
          );
        }
        pasteStatus = 'deployed';
        staticDeploymentUrl = result.url;

        // Persist status and deployment_url to R2 (mirrors scaffolding path behavior)
        projectMetadata.status = 'deployed';
        projectMetadata.deployment_url = staticDeploymentUrl;
        projectMetadata.updated_at = new Date().toISOString();

        // Write to canonical path only (legacy path writes removed - Nov 2025)
        await env.PROJECTS_BUCKET.put(metadataPath, JSON.stringify(projectMetadata, null, 2), {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            projectId: createdProject.id,
            type: 'metadata',
            created: timestamp,
            source: 'paste'
          }
        });

        // Update manifest via ProjectService for consistency
        try {
          await projectService.updateProject(createdProject.id, {
            status: 'deployed' as ProjectStatus,
            deploymentUrl: staticDeploymentUrl
          });
          console.info(`✅ Static HTML project ${createdProject.id} status updated to 'deployed' with URL in manifest`);
        } catch (manifestError) {
          // Non-critical: log but don't fail the request
          console.warn(`Failed to update manifest for static HTML project ${createdProject.id}:`, manifestError);
        }

        console.info(`✅ Static HTML deployed successfully for project ${createdProject.id}`);
      } else {
        // Update project metadata to indicate scaffolding is being triggered FIRST for concurrency safety
        projectMetadata.status = 'scaffolding';
        projectMetadata.updated_at = new Date().toISOString();

        // Persist status update to single canonical path
        await env.PROJECTS_BUCKET.put(metadataPath, JSON.stringify(projectMetadata, null, 2), {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            projectId: createdProject.id,
            type: 'metadata',
            created: timestamp,
            source: 'paste'
          }
        });

        // Create scaffolding request (URL is only used for path parsing)
        const scaffoldingRequest = new Request(`https://internal/api/scaffolding/${createdProject.id}/generate`, {
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
          console.info(`✅ Auto-scaffolding completed successfully for project ${createdProject.id}`);
        } else {
          pasteStatus = 'scaffolding';
          let errorDetails: any = { status: scaffoldingResponse.status };
          try {
            const errBody = await scaffoldingResponse.json();
            errorDetails = { ...errorDetails, ...errBody };
          } catch {}
          console.error(`❌ Auto-scaffolding failed for project ${createdProject.id}:`, errorDetails);

          // Return accurate error to caller (avoid misleading 201)
          return errorResponse(
            'SCAFFOLDING_FAILED',
            'Auto-scaffolding failed after paste operation',
            500,
            {
              project_id: createdProject.id,
              detected_framework: detectedFramework,
              ...errorDetails
            }
          );
        }
      }
    } catch (scaffoldingError) {
      pasteStatus = 'scaffolding';
      console.error(`Error triggering auto-scaffolding for project ${createdProject.id}:`, scaffoldingError);

      // Return accurate error to caller (avoid misleading 201)
      return errorResponse(
        'SCAFFOLDING_TRIGGER_ERROR',
        'Failed to trigger auto-scaffolding',
        500,
        {
          project_id: createdProject.id,
          detected_framework: detectedFramework,
          error: scaffoldingError instanceof Error ? scaffoldingError.message : String(scaffoldingError)
        }
      );
    }

    // Step 11: Prepare successful response
    const pasteResponse: PasteResponse = {
      project_id: createdProject.id,
      status: translateStatus(pasteStatus),
      message: feedbackMessage,
      detected_framework: detectedFramework,
      generated_filename: filename,
      analysis: projectAnalysis,
      build_job_id: buildJobId,
      deployment_url: staticDeploymentUrl
    };

    console.info(`Paste operation completed successfully for project ${createdProject.id}`);
    return successResponse(pasteResponse, 201);

  } catch (error) {
    console.error('Unexpected error in paste handler:', error);

    // Log error to admin dashboard for observability
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      const logger = createSharedLogger(env);

      // Determine if this is a parse/unsupported code error
      const isParseError = errorMessage.includes('parse failed') ||
                           errorMessage.includes('Parse error') ||
                           errorMessage.includes('Expression expected');

      if (isParseError && contentForLogging) {
        // Log as unsupported code pattern for /admin/patterns dashboard
        await logger.logUnsupportedCode(
          frameworkForLogging || 'unknown',
          errorMessage,
          contentForLogging,
          undefined, // projectId not created yet
          userIdForLogging
        );
      } else {
        // Log as general paste error for /admin/logs dashboard
        await logger.logCodePasteError(
          errorMessage,
          contentForLogging || '',
          userIdForLogging,
          { framework: frameworkForLogging }
        );
      }
    } catch (loggingError) {
      // Don't let logging failure break the error response
      console.error('Failed to log paste error:', loggingError);
    }

    return errorResponse(
      'PASTE_ERROR',
      'An unexpected error occurred during code paste processing',
      500,
      errorMessage
    );
  }
}
