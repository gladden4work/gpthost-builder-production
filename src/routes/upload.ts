/**
 * File Upload Handler for GPTHost API
 * Handles multipart/form-data uploads and stores files in R2
 */

import { successResponse, errorResponse } from '../utils/responses';
import { ProjectMetadata, FileMetadata, UploadResponse, ProjectAnalysis } from '../types/api';
import { validateFile } from '../utils/fileValidation';
import { analyzeFile, aggregateProjectAnalysis } from '../utils/fileAnalysis';

/**
 * Handle file upload requests
 * POST /api/upload
 */
export async function uploadHandler(request: Request, env: Env): Promise<Response> {
  try {
    // Verify request method
    if (request.method !== 'POST') {
      return errorResponse(
        'METHOD_NOT_ALLOWED',
        'Only POST method is allowed for file uploads',
        405
      );
    }

    // Check content type for multipart/form-data
    const contentType = request.headers.get('Content-Type');
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return errorResponse(
        'INVALID_CONTENT_TYPE',
        'Content-Type must be multipart/form-data',
        400,
        { received: contentType }
      );
    }

    // Parse multipart/form-data using native FormData API
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    // Sanitize and validate inputs
    const projectName = formData.get('project_name')?.toString()?.trim()?.slice(0, 100);
    const description = formData.get('description')?.toString()?.trim()?.slice(0, 500);
    
    // Validate project name
    if (!projectName || projectName.length === 0) {
      return errorResponse(
        'INVALID_PROJECT_NAME',
        'Project name is required and must be non-empty',
        400
      );
    }

    // Validate that files were uploaded
    if (!files || files.length === 0) {
      return errorResponse(
        'NO_FILES_UPLOADED',
        'No files were uploaded. Please include files in the "files" field.',
        400
      );
    }

    // Generate unique project ID using crypto API
    const projectId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    // Process and store each file
    const uploadedFiles: FileMetadata[] = [];
    // Validate file size configuration with proper error handling
    const maxFileSize = parseInt(env.MAX_FILE_SIZE || '104857600') || 104857600; // 100MB default
    if (isNaN(maxFileSize)) {
      console.error('Invalid MAX_FILE_SIZE configuration:', env.MAX_FILE_SIZE);
      return errorResponse(
        'CONFIGURATION_ERROR',
        'Invalid server configuration for file size limits',
        500
      );
    }

    // Prepare validation configuration
    const supportedExtensions = env.SUPPORTED_EXTENSIONS?.split(',') || 
      ['.html', '.jsx', '.tsx', '.vue', '.svelte'];
    
    const validationConfig = {
      maxFileSize,
      supportedExtensions
    };

    for (const file of files) {
      // Enhanced comprehensive file validation
      const validationResult = await validateFile(file, validationConfig);
      
      if (!validationResult.isValid) {
        // Determine appropriate HTTP status code based on error type
        let statusCode = 400;
        if (validationResult.errorCode === 'FILE_TOO_LARGE') {
          statusCode = 413;
        } else if (validationResult.errorCode?.includes('FILE_TYPE') || 
                   validationResult.errorCode?.includes('MIME_TYPE') ||
                   validationResult.errorCode?.includes('EXECUTABLE') ||
                   validationResult.errorCode?.includes('SECURITY') ||
                   validationResult.errorCode?.includes('SUSPICIOUS_FILE_EXTENSION')) {
          statusCode = 415;
        }

        return errorResponse(
          validationResult.errorCode!,
          validationResult.message!,
          statusCode,
          validationResult.details
        );
      }

      // Analyze file for framework detection and metadata
      console.info(`Analyzing file: ${file.name}`);
      let fileAnalysis;
      try {
        fileAnalysis = await analyzeFile(file);
        console.info(`Analysis complete for ${file.name}:`, {
          framework: fileAnalysis.framework,
          componentType: fileAnalysis.componentType,
          language: fileAnalysis.language,
          componentCount: fileAnalysis.componentNames.length
        });
      } catch (analysisError) {
        console.error(`Failed to analyze file ${file.name}:`, analysisError);
        // Continue with upload but without analysis data
        fileAnalysis = undefined;
      }

      // Create R2 storage path: projects/{project-id}/source/{filename}
      const storagePath = `projects/${projectId}/source/${file.name}`;

      try {
        // Store file in R2 bucket
        await env.PROJECTS_BUCKET.put(storagePath, file.stream(), {
          httpMetadata: {
            contentType: file.type || 'application/octet-stream',
          },
          customMetadata: {
            originalName: file.name,
            uploadTime: timestamp,
            projectId: projectId,
          }
        });

        // Track uploaded file metadata with analysis
        uploadedFiles.push({
          name: file.name,
          path: storagePath,
          size: file.size,
          type: file.type || 'application/octet-stream',
          upload_time: timestamp,
          analysis: fileAnalysis
        });

      } catch (r2Error) {
        console.error(`Failed to store file ${file.name} in R2:`, r2Error);
        return errorResponse(
          'STORAGE_ERROR',
          `Failed to store file ${file.name}`,
          500,
          { fileName: file.name, error: r2Error instanceof Error ? r2Error.message : String(r2Error) }
        );
      }
    }

    // Aggregate project analysis from individual file analyses
    const fileAnalyses = uploadedFiles
      .map(file => file.analysis)
      .filter(analysis => analysis !== undefined);
    
    const projectAnalysis = aggregateProjectAnalysis(fileAnalyses);
    
    console.info('Project analysis complete:', {
      primaryFramework: projectAnalysis.primaryFramework,
      componentType: projectAnalysis.componentType,
      totalComponents: projectAnalysis.totalComponents,
      filesAnalyzed: fileAnalyses.length
    });

    // Create project metadata with analysis
    const projectMetadata: ProjectMetadata = {
      id: projectId,
      status: 'analyzing',
      name: projectName,
      description: description,
      framework: projectAnalysis.primaryFramework,
      files: uploadedFiles,
      created_at: timestamp,
      updated_at: timestamp,
      analysis: projectAnalysis
    };

    // Store project metadata in R2
    const metadataPath = `projects/${projectId}/metadata.json`;
    try {
      await env.PROJECTS_BUCKET.put(metadataPath, JSON.stringify(projectMetadata, null, 2), {
        httpMetadata: {
          contentType: 'application/json',
        },
        customMetadata: {
          projectId: projectId,
          type: 'metadata',
          created: timestamp,
        }
      });
    } catch (metadataError) {
      console.error(`Failed to store project metadata for ${projectId}:`, metadataError);
      
      // Cleanup uploaded files on metadata failure
      try {
        console.info(`Cleaning up ${uploadedFiles.length} uploaded files due to metadata failure`);
        for (const file of uploadedFiles) {
          await env.PROJECTS_BUCKET.delete(file.path);
        }
        console.info('Successfully cleaned up uploaded files');
      } catch (cleanupError) {
        console.error('Failed to cleanup uploaded files:', cleanupError);
        // Continue with error response even if cleanup fails
      }
      
      return errorResponse(
        'METADATA_STORAGE_ERROR',
        'Failed to store project metadata. All uploaded files have been cleaned up.',
        500,
        { projectId, error: metadataError instanceof Error ? metadataError.message : String(metadataError) }
      );
    }

    // Prepare successful response with analysis
    const uploadResponse: UploadResponse = {
      project_id: projectId,
      status: 'analyzing',
      message: `Successfully uploaded and analyzed ${uploadedFiles.length} file(s). Detected ${projectAnalysis.primaryFramework} project with ${projectAnalysis.totalComponents} components.`,
      files_uploaded: uploadedFiles.length,
      analysis: projectAnalysis
    };

    return successResponse(uploadResponse, 201);

  } catch (error) {
    console.error('Unexpected error in upload handler:', error);
    return errorResponse(
      'UPLOAD_ERROR',
      'An unexpected error occurred during file upload',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}