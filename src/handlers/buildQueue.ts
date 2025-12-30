/**
 * Build Queue Handler - Phase 4.1 Implementation
 * 
 * ATTEMPT 1/5: Basic build queue functionality
 * 
 * Handles build queue requests for scaffolded projects:
 * - Validates project exists and is ready for build
 * - Creates build job with timeout and options
 * - Queues build job for processing
 * - Returns job tracking information
 * 
 * Success Criteria:
 * - Accept POST /api/projects/{id}/build requests
 * - Validate project has scaffolding ready
 * - Create build job with proper metadata
 * - Queue job to BUILD_QUEUE
 * - Return 202 with job tracking info
 */

import { 
  BuildJob, 
  BuildQueueRequest, 
  BuildQueueResponse, 
  ProjectMetadata,
  ScaffoldedProject,
  BuildPriority,
  OptimizationLevel 
} from '../types/api';
import { 
  getProjectMetadata, 
  createErrorResponse, 
  createSuccessResponse, 
  updateProjectStatus, 
  extractProjectIdFromPath 
} from '../utils/projectHelpers';
import { isManifestEnabled } from '../config/featureFlags';
import { ManifestService } from '../services/ManifestService';

/**
 * Handle build queue requests
 * POST /api/projects/{projectId}/build
 */
export async function buildQueueHandler(
  request: Request, 
  env: Env
): Promise<Response> {
  try {
    // Extract project ID from URL
    const url = new URL(request.url);
    const projectId = extractProjectIdFromPath(url.pathname);
    
    if (!projectId) {
      return createErrorResponse(
        'MISSING_PROJECT_ID',
        'Project ID is required',
        undefined,
        400
      );
    }

    // Parse request body - handle both empty body and provided options
    let buildRequest: BuildQueueRequest = { project_id: projectId };
    try {
      const contentType = request.headers.get('content-type');
      if (request.body && contentType?.includes('application/json')) {
        const body = await request.json() as any;
        // If body has project_id at root (from router redirect), use it
        if (body.project_id) {
          buildRequest = body;
        } else {
          // Otherwise treat body as options
          buildRequest = { project_id: projectId, options: body };
        }
      }
    } catch (error) {
      // If JSON parsing fails, continue with default empty options
      console.warn('Failed to parse JSON body, using defaults:', error);
    }

    // Validate project exists and is ready for build
    const projectMetadata = await getProjectMetadata(projectId, env);
    if (!projectMetadata) {
      return createErrorResponse(
        'PROJECT_NOT_FOUND',
        `Project ${projectId} not found`,
        undefined,
        404
      );
    }

    // Check if project has scaffolding ready
    const scaffolding = await getProjectScaffolding(projectId, env);
    if (!scaffolding) {
      return createErrorResponse(
        'SCAFFOLDING_NOT_READY',
        'Project must be scaffolded before building',
        { 
          currentStatus: projectMetadata.status,
          requiredStatus: ['analyzing', 'building']
        },
        400
      );
    }

    // Create build job
    const buildJob = await createBuildJob(
      projectId, 
      projectMetadata, 
      scaffolding, 
      buildRequest, 
      env
    );

    // Queue the build job
    await env.BUILD_QUEUE.send(buildJob);

    // Update project status to building
    await updateProjectStatus(projectId, 'building', env);

    // Create initial build status
    await createInitialBuildStatus(buildJob, env);

    // Update per-owner manifest so dashboards show "Building" immediately
    if (isManifestEnabled(env)) {
      try {
        const ownerId = (projectMetadata as any).ownerId || (projectMetadata as any).owner_id;
        if (ownerId) {
          const manifestService = new ManifestService(env);
          await manifestService.updateBuildStatus(ownerId, projectId, 'building', buildJob.job_id);
        }
      } catch (manifestError) {
        // Manifest is a performance cache; never fail the build queue path
        console.error('[BUILD-QUEUE] Failed to update manifest build status', manifestError);
      }
    }

    // Return success response
    const response: BuildQueueResponse = {
      project_id: projectId,
      job_id: buildJob.job_id,
      status: 'queued',
      estimated_duration_seconds: buildJob.timeout_seconds,
      message: `Build job ${buildJob.job_id} queued successfully`,
    };

    return createSuccessResponse(response, 202); // Return 202 Accepted for async operations

  } catch (error) {
    console.error('Build queue handler error:', error);
    return createErrorResponse(
      'INTERNAL_ERROR',
      'Internal server error during build queue processing',
      { error: error.message }
    );
  }
}


/**
 * Get project scaffolding from R2
 */
async function getProjectScaffolding(projectId: string, env: Env): Promise<ScaffoldedProject | null> {
  try {
    // Try the new path first
    let scaffoldingKey = `projects/${projectId}/scaffolding/result.json`;
    let scaffoldingObject = await env.PROJECTS_BUCKET.get(scaffoldingKey);
    
    // Fallback to old path for backwards compatibility
    if (!scaffoldingObject) {
      scaffoldingKey = `projects/${projectId}/scaffolding.json`;
      scaffoldingObject = await env.PROJECTS_BUCKET.get(scaffoldingKey);
    }
    
    if (!scaffoldingObject) {
      return null;
    }

    return await scaffoldingObject.json() as ScaffoldedProject;
  } catch (error) {
    console.error(`Failed to get project scaffolding for ${projectId}:`, error);
    return null;
  }
}

/**
 * Create build job with proper configuration
 */
async function createBuildJob(
  projectId: string,
  metadata: ProjectMetadata,
  scaffolding: ScaffoldedProject,
  request: BuildQueueRequest,
  env: Env
): Promise<BuildJob> {
  
  // Generate unique job ID
  const jobId = `build-${projectId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  
  // Extract build options with defaults
  const options = request.options || {};
  const priority: BuildPriority = options.priority || 'normal';
  const timeoutSeconds = options.timeout_seconds || 90;
  const optimizationLevel: OptimizationLevel = options.optimization_level || 'production';
  
  // Create source files map from scaffolding
  const sourceFiles: Record<string, string> = {};
  for (const file of scaffolding.files) {
    sourceFiles[file.path] = file.content;
  }

  // Build job configuration
  const buildJob: BuildJob = {
    job_id: jobId,
    project_id: projectId,
    framework: scaffolding.framework,
    scaffolding_path: `projects/${projectId}/scaffolding/files/`,
    source_files: sourceFiles,
    priority,
    timeout_seconds: timeoutSeconds,
    build_config: {
      framework_specific_options: options.framework_specific_options || {},
      optimization_level: optimizationLevel,
      enable_source_maps: options.enable_source_maps || false,
    },
    metadata: {
      queued_at: new Date().toISOString(),
      retry_count: 0,
    },
  };

  return buildJob;
}


/**
 * Create initial build status tracking
 */
async function createInitialBuildStatus(buildJob: BuildJob, env: Env): Promise<void> {
  try {
    const buildStatus = {
      status: 'queued',
      progress: 0,
      current_stage: 'queued',
      logs: [
        `Build job ${buildJob.job_id} created at ${buildJob.metadata.queued_at}`,
        `Framework: ${buildJob.framework}`,
        `Timeout: ${buildJob.timeout_seconds} seconds`,
        `Priority: ${buildJob.priority}`,
      ],
      metadata: {
        job_id: buildJob.job_id,
        queued_at: buildJob.metadata.queued_at,
        retry_count: 0,
      },
    };

    const statusKey = `projects/${buildJob.project_id}/build-status.json`;
    
    await env.PROJECTS_BUCKET.put(
      statusKey,
      JSON.stringify(buildStatus, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          project_id: buildJob.project_id,
          job_id: buildJob.job_id,
          status: 'queued',
          updated_at: buildJob.metadata.queued_at,
        },
      }
    );

    console.info(`Build status created for job ${buildJob.job_id}`);
  } catch (error) {
    console.error(`Failed to create build status for ${buildJob.job_id}:`, error);
    throw error;
  }
}
