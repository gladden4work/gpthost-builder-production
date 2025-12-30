/**
 * MANUAL BUILD TRIGGER - REAL & SIMULATED BUILDS
 * 
 * INTEGRATION COMPLETE: This endpoint now triggers REAL builds via GitHub Actions!
 * 
 * ✅ REAL BUILDS (when GitHub is configured):
 * - Actual npm install and Vite build execution via GitHub Actions
 * - Real packages installed and dependencies resolved  
 * - Functional websites generated and deployed
 * - Real build progress tracking and artifacts
 * 
 * ⚠️ SIMULATION FALLBACK (development only):
 * - Falls back to simulation when GitHub not configured
 * - Used for local development and testing
 * - Provides build status polling for UI development
 * 
 * 🔧 ENVIRONMENT DETECTION:
 * - Checks GITHUB_TOKEN and GITHUB_REPOSITORY environment variables
 * - Uses GitHub executor when both are configured
 * - Falls back to simulation executor for development
 */

import { BuildJob, FrameworkType, ProjectMetadata } from '../types/api';
import { processBuildJob, detectBuildEnvironment, BuildJobResult } from '../utils/buildQueueConsumer';
import { errorResponse, successResponse, corsResponse } from '../utils/responses';
import { isManifestEnabled } from '../config/featureFlags';
import { ManifestService } from '../services/ManifestService';


/**
 * Handle manual build trigger - POST /api/build/{project_id}
 * 
 * Triggers a build manually by directly calling the build processing logic
 * without using the Cloudflare Queue system.
 */
export async function manualBuildHandler(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return corsResponse();
  }

  if (request.method !== 'POST') {
    return errorResponse(
      'METHOD_NOT_ALLOWED',
      'Only POST method is allowed',
      405
    );
  }

  const url = new URL(request.url);
  const pathSegments = url.pathname.split('/');
  const projectId = pathSegments[3]; // /api/build/{project_id}

  if (!projectId) {
    return errorResponse(
      'MISSING_PROJECT_ID',
      'Project ID is required',
      400
    );
  }

  try {
    // Validate that the project exists and is in analyzable state
    const projectMetadata = await getProjectMetadata(projectId, env);
    if (!projectMetadata) {
      return errorResponse(
        'PROJECT_NOT_FOUND',
        `Project ${projectId} not found`,
        404
      );
    }

    // Check if project is in a state that can be built
    if (!canTriggerBuild(projectMetadata)) {
      return errorResponse(
        'INVALID_PROJECT_STATE',
        `Project is in '${projectMetadata.status}' state and cannot be built. Expected 'analyzing' or 'scaffolded'.`,
        400,
        { 
          current_status: projectMetadata.status,
          allowed_statuses: ['analyzing', 'scaffolded']
        }
      );
    }

    // Check if a build is already in progress
    const existingBuildStatus = await getBuildStatus(projectId, env);
    if (existingBuildStatus && ['processing', 'queued'].includes(existingBuildStatus.status)) {
      return errorResponse(
        'BUILD_IN_PROGRESS',
        'A build is already in progress for this project',
        409,
        {
          current_build_status: existingBuildStatus.status,
          current_stage: existingBuildStatus.current_stage,
          progress: existingBuildStatus.progress
        }
      );
    }

    // Parse request body for build options (optional)
    let buildOptions = {};
    try {
      if (request.headers.get('content-type')?.includes('application/json')) {
        buildOptions = await request.json();
      }
    } catch (error) {
      // Continue with default options if JSON parsing fails
      console.warn(`[MANUAL-BUILD] Failed to parse build options for ${projectId}:`, error);
    }

    // Create build job based on project metadata and scaffolding
    const buildJob = await createBuildJobFromProject(projectId, projectMetadata, buildOptions, env);

    // Update project status to indicate build is starting
    await updateProjectStatus(projectId, 'building', env);
    if (isManifestEnabled(env)) {
      try {
        const ownerId = (projectMetadata as any).ownerId || (projectMetadata as any).owner_id;
        if (ownerId) {
          const manifestService = new ManifestService(env);
          await manifestService.updateBuildStatus(ownerId, projectId, 'building', buildJob.job_id);
        }
      } catch (manifestError) {
        // Manifest is a performance cache; never fail the manual build path
        console.error('[MANUAL-BUILD] Failed to update manifest build status', manifestError);
      }
    }

    // Detect build environment
    const buildType = await detectBuildEnvironment(env);
    const isRealBuild = buildType.type === 'github';
    
    if (isRealBuild) {
      console.info(`✅ [MANUAL-BUILD-REAL] Starting REAL build for project ${projectId}`, {
        BUILD_TYPE: 'REAL',
        project_id: projectId,
        framework: buildJob.framework,
        job_id: buildJob.job_id,
        scaffolding_path: buildJob.scaffolding_path,
        github_repository: buildType.repository,
        github_user: buildType.user
      });
    } else {
      console.warn(`⚠️ [MANUAL-BUILD-SIMULATION] Starting SIMULATED build for project ${projectId}`, {
        BUILD_TYPE: 'SIMULATION', 
        project_id: projectId,
        framework: buildJob.framework,
        job_id: buildJob.job_id,
        scaffolding_path: buildJob.scaffolding_path,
        reason: buildType.reason
      });
    }

    // Create build context to pass environment detection results
    const buildContext = {
      isRealBuild,
      buildType
    };

    // Trigger the build process directly (asynchronously)
    // We don't await this to return a quick response to the user
    processBuildJob(buildJob, env, buildContext).then(result => {
      if (result.success) {
        console.info(`[MANUAL-BUILD] Build job completed successfully for project ${projectId}:`, result.message);
      } else {
        console.error(`[MANUAL-BUILD] Build job failed for project ${projectId}:`, result.message);
      }
    }).catch(error => {
      console.error(`[MANUAL-BUILD] Unexpected error for project ${projectId}:`, error);
    });

    // Return immediate response with build job information
    const response = isRealBuild 
      ? {
          message: '✅ REAL BUILD: Build triggered successfully via GitHub Actions',
          notice: 'This is a real build process - actual npm install and Vite build will execute',
          github_repository: buildType.repository,
          github_user: buildType.user,
          project_id: projectId,
          job_id: buildJob.job_id,
          framework: buildJob.framework,
          status: 'building',
          build_type: 'REAL',
          build_started_at: new Date().toISOString(),
          estimated_duration: `${buildJob.timeout_seconds} seconds max (real timing)`,
          status_endpoint: `/api/build/status/${projectId}`,
          logs_endpoint: `/api/build/logs/${projectId}`,
          real_builds_available: true,
          github_actions_enabled: true
        }
      : {
          message: '⚠️ SIMULATION: Build triggered successfully (NOT A REAL BUILD)',
          warning: 'This is a simulated build process - no actual npm install or Vite build will occur',
          reason: buildType.reason,
          project_id: projectId,
          job_id: buildJob.job_id,
          framework: buildJob.framework,
          status: 'building',
          build_type: 'SIMULATION_ONLY',
          build_started_at: new Date().toISOString(),
          estimated_duration: `${buildJob.timeout_seconds} seconds max (fake timing)`,
          status_endpoint: `/api/build/status/${projectId}`,
          logs_endpoint: `/api/build/logs/${projectId}`,
          real_builds_available: false,
          github_actions_required: true
        };
        
    return successResponse(response);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[MANUAL-BUILD] Error triggering build for project ${projectId}:`, error);
    
    return errorResponse(
      'BUILD_TRIGGER_FAILED',
      `Failed to trigger build: ${errorMessage}`,
      500,
      { 
        project_id: projectId,
        error_details: errorMessage
      }
    );
  }
}

/**
 * Get project metadata from R2
 */
async function getProjectMetadata(projectId: string, env: Env): Promise<ProjectMetadata | null> {
  try {
    const metadataKey = `projects/${projectId}/metadata.json`;
    const object = await env.PROJECTS_BUCKET.get(metadataKey);
    
    if (!object) {
      return null;
    }

    return await object.json() as ProjectMetadata;
  } catch (error) {
    console.error(`Error getting project metadata for ${projectId}:`, error);
    return null;
  }
}

/**
 * Check if project can trigger a build based on its current status
 */
function canTriggerBuild(metadata: ProjectMetadata): boolean {
  const allowedStatuses = ['analyzing', 'scaffolded', 'failed'];
  return allowedStatuses.includes(metadata.status);
}

/**
 * Get current build status for a project
 */
async function getBuildStatus(projectId: string, env: Env): Promise<any | null> {
  try {
    const statusKey = `projects/${projectId}/build-status.json`;
    const object = await env.PROJECTS_BUCKET.get(statusKey);
    
    if (!object) {
      return null;
    }

    return await object.json();
  } catch (error) {
    console.error(`Error getting build status for ${projectId}:`, error);
    return null;
  }
}

/**
 * Update project status in metadata
 */
async function updateProjectStatus(projectId: string, status: string, env: Env): Promise<void> {
  try {
    const metadataKey = `projects/${projectId}/metadata.json`;
    const object = await env.PROJECTS_BUCKET.get(metadataKey);
    
    if (!object) {
      throw new Error('Project metadata not found');
    }

    const metadata = await object.json() as ProjectMetadata;
    metadata.status = status as ProjectMetadata['status'];
    metadata.updated_at = new Date().toISOString();
    
    await env.PROJECTS_BUCKET.put(
      metadataKey,
      JSON.stringify(metadata, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          project_id: projectId,
          status,
          updated_at: metadata.updated_at
        }
      }
    );

    console.info(`[MANUAL-BUILD] Updated project ${projectId} status to ${status}`);
  } catch (error) {
    console.error(`Error updating project status for ${projectId}:`, error);
    throw error;
  }
}

/**
 * Create a BuildJob from project metadata and scaffolding information
 */
async function createBuildJobFromProject(
  projectId: string,
  metadata: ProjectMetadata,
  buildOptions: any,
  env: Env
): Promise<BuildJob> {
  // Generate unique job ID
  const jobId = crypto.randomUUID();
  const queuedAt = new Date().toISOString();

  // Determine framework from project metadata
  const framework = metadata.framework || 'react' as FrameworkType;

  // Determine scaffolding path
  const scaffoldingPath = `projects/${projectId}/scaffolding/`;

  // Build configuration with defaults
  const buildConfig = {
    optimization_level: buildOptions.optimization_level || 'production',
    enable_source_maps: buildOptions.enable_source_maps ?? true,
    framework_specific_options: buildOptions.framework_specific_options || {}
  };

  // Calculate timeout based on framework (existing logic from buildExecutor)
  const timeout = calculateBuildTimeout(framework);

  const buildJob: BuildJob = {
    project_id: projectId,
    job_id: jobId,
    framework,
    scaffolding_path: scaffoldingPath,
    build_config: buildConfig,
    timeout_seconds: Math.floor(timeout / 1000), // Convert to seconds
    metadata: {
      queued_at: queuedAt,
      retry_count: 0,
      triggered_manually: true,
      original_status: metadata.status
    }
  };

  return buildJob;
}

/**
 * Calculate build timeout based on framework
 */
function calculateBuildTimeout(framework: FrameworkType): number {
  const timeouts = {
    react: 180000,    // 3 minutes
    vue: 240000,      // 4 minutes  
    svelte: 150000,   // 2.5 minutes
    html: 60000,      // 1 minute
    angular: 300000,  // 5 minutes
    next: 300000      // 5 minutes
  };
  
  return timeouts[framework] || 180000; // Default 3 minutes
}
