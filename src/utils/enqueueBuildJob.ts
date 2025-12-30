/**
 * Build Queue Utility - Enqueue Build Jobs with Proper Format
 * 
 * This utility ensures build jobs are properly formatted before being sent to the queue.
 * It creates valid BuildJob objects with all required fields for the queue consumer.
 */

import {
  BuildJob,
  BuildPriority,
  OptimizationLevel,
  ProjectMetadata,
  ScaffoldedProject
} from '../types/api';
import { appendTimelineEvent } from './projectTimeline';
import { isManifestEnabled } from '../config/featureFlags';
import { ManifestService } from '../services/ManifestService';

/**
 * Options for enqueuing a build job
 */
export interface EnqueueBuildJobOptions {
  priority?: BuildPriority;
  timeout_seconds?: number;
  optimization_level?: OptimizationLevel;
  enable_source_maps?: boolean;
  framework_specific_options?: any;
}

/**
 * Enqueue a build job to the BUILD_QUEUE with proper format
 * 
 * This function creates a properly formatted BuildJob and sends it to the queue.
 * It ensures all required fields are present for the queue consumer to process.
 * 
 * @param projectId - The project ID to build
 * @param env - Environment with BUILD_QUEUE binding
 * @param options - Optional build configuration
 * @returns The created BuildJob that was queued
 */
export async function enqueueBuildJob(
  projectId: string,
  env: Env,
  options?: EnqueueBuildJobOptions
): Promise<BuildJob> {
  try {
    // Idempotency guard: if a build is already queued/processing, return it instead of enqueueing another
    try {
      const existingStatusObj = await env.PROJECTS_BUCKET.get(`projects/${projectId}/build-status.json`);
      if (existingStatusObj) {
        const existing = await existingStatusObj.json() as any;
        const st = (existing?.status || existing?.state || '').toString();
        const jid = existing?.metadata?.job_id;
        if (['queued', 'processing', 'building'].includes(st) && jid) {
          try {
            const metadata = await getProjectMetadata(projectId, env);
            await updateManifestBuildStatusIfEnabled(metadata, projectId, env, jid);
          } catch (manifestError) {
            console.warn(`[ENQUEUE] Manifest update skipped for in-progress build ${projectId}:`, manifestError);
          }
          console.info(`🔁 Build already in progress for ${projectId} (job ${jid}); skipping enqueue`);
          return {
            job_id: jid,
            project_id: projectId,
            framework: (existing?.metadata?.framework as any) || 'react',
            scaffolding_path: `projects/${projectId}/scaffolding/files/`,
            source_files: {},
            priority: options?.priority || 'normal',
            timeout_seconds: options?.timeout_seconds || 90,
            build_config: {
              framework_specific_options: options?.framework_specific_options || {},
              optimization_level: options?.optimization_level || 'production',
              enable_source_maps: options?.enable_source_maps || false,
            },
            metadata: {
              queued_at: existing?.metadata?.queued_at || new Date().toISOString(),
              retry_count: existing?.metadata?.retry_count || 0,
            },
          } as BuildJob;
        }
      }
    } catch (e) {
      console.warn(`[ENQUEUE] Existing build status check failed for ${projectId}:`, e);
    }
    // Retrieve project metadata
    const projectMetadata = await getProjectMetadata(projectId, env);
    if (!projectMetadata) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Retrieve scaffolding data
    const scaffolding = await getProjectScaffolding(projectId, env);
    if (!scaffolding) {
      throw new Error(`Scaffolding not found for project ${projectId}`);
    }

    // Generate unique job ID
    const jobId = `build-${projectId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Extract build options with defaults
    const priority: BuildPriority = options?.priority || 'normal';
    const timeoutSeconds = options?.timeout_seconds || 90;
    const optimizationLevel: OptimizationLevel = options?.optimization_level || 'production';
    
    // Create source files map from scaffolding
    const sourceFiles: Record<string, string> = {};
    for (const file of scaffolding.files) {
      sourceFiles[file.path] = file.content;
    }

    // Create the BuildJob object
    const buildJob: BuildJob = {
      job_id: jobId,
      project_id: projectId,
      framework: scaffolding.framework || projectMetadata.framework || 'react',
      scaffolding_path: `projects/${projectId}/scaffolding/files/`,
      source_files: sourceFiles,
      priority,
      timeout_seconds: timeoutSeconds,
      build_config: {
        framework_specific_options: options?.framework_specific_options || {},
        optimization_level: optimizationLevel,
        enable_source_maps: options?.enable_source_maps || false,
      },
      metadata: {
        queued_at: new Date().toISOString(),
        retry_count: 0,
      },
    };

    // Send to queue
    await env.BUILD_QUEUE.send(buildJob);
    
    console.info(`✅ Build job ${jobId} queued for project ${projectId}`, {
      project_id: projectId,
      job_id: jobId,
      framework: buildJob.framework,
      priority: priority,
      timeout: timeoutSeconds
    });

    // Update project status to building
    await updateProjectStatus(projectId, 'building', env);

    // Create initial build status
    await createInitialBuildStatus(buildJob, env);

    // Update per-owner manifest so dashboard shows "Building" immediately (staging runs manifest mode)
    await updateManifestBuildStatusIfEnabled(projectMetadata, projectId, env, jobId);

    // Record timeline event
    await appendTimelineEvent(projectId, env, 'queued', { job_id: jobId });

    return buildJob;

  } catch (error) {
    console.error(`Failed to enqueue build job for project ${projectId}:`, error);
    throw error;
  }
}

async function updateManifestBuildStatusIfEnabled(
  projectMetadata: ProjectMetadata | null,
  projectId: string,
  env: Env,
  buildId: string
): Promise<void> {
  if (!isManifestEnabled(env)) return;

  const ownerId = (projectMetadata as any)?.ownerId || (projectMetadata as any)?.owner_id;
  if (!ownerId) {
    console.warn(`[ENQUEUE] Manifest enabled but ownerId missing for ${projectId}; skipping manifest build status update`);
    return;
  }

  try {
    const manifestService = new ManifestService(env);
    await manifestService.updateBuildStatus(ownerId, projectId, 'building', buildId);
  } catch (error) {
    console.error('[ENQUEUE] Failed to update manifest build status', {
      projectId,
      ownerId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Helper: Get project metadata from R2
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
 * Helper: Get project scaffolding from R2
 */
async function getProjectScaffolding(
  projectId: string,
  env: Env
): Promise<ScaffoldedProject | null> {
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
 * Helper: Update project status
 */
async function updateProjectStatus(
  projectId: string,
  status: ProjectMetadata['status'],
  env: Env
): Promise<void> {
  try {
    const metadataKey = `projects/${projectId}/metadata.json`;
    const object = await env.PROJECTS_BUCKET.get(metadataKey);
    
    if (!object) {
      console.warn(`Project metadata not found for ${projectId}`);
      return;
    }

    const metadata = await object.json() as ProjectMetadata;
    metadata.status = status;
    metadata.updated_at = new Date().toISOString();
    
    await env.PROJECTS_BUCKET.put(
      metadataKey,
      JSON.stringify(metadata, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          project_id: projectId,
          status,
          updated_at: new Date().toISOString()
        }
      }
    );

    console.info(`Project status updated to ${status} for ${projectId}`);
  } catch (error) {
    console.error(`Failed to update project status for ${projectId}:`, error);
    // Don't throw - this is not critical
  }
}

/**
 * Helper: Create initial build status tracking
 */
async function createInitialBuildStatus(
  buildJob: BuildJob,
  env: Env
): Promise<void> {
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
    // Don't throw - continue with build even if status creation fails
  }
}
