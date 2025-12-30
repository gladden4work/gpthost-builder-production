/**
 * GPTHost API - Cloudflare Workers Backend
 * 
 * Main entry point for the GPTHost MVP backend service.
 * Handles file uploads, component parsing, build orchestration, and deployment.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { router } from './routes/router';
import { processBuildJob, BuildJobResult } from './utils/buildQueueConsumer';
import { BuildJob } from './types/api';
import { validateAndLog } from './middleware/envValidation';
import { handleManifestDriftCheck } from './scheduled/manifestDriftCheck';
import { createResourceProxyToken } from './routes/resourceProxy';

// Export Durable Object classes for Cloudflare Workers runtime
export { ManifestDO } from './durableObjects/ManifestDO';
export { ProxyProjectUsageDO } from './durableObjects/ProxyProjectUsageDO';

// Validate environment on Worker startup (cached across requests)
let envValidated = false;

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// Quick debug check
		const url = new URL(request.url);
		if (url.pathname === '/__debug__') {
				return new Response(JSON.stringify({
					path: url.pathname,
					timestamp: new Date().toISOString(),
					hasResourceProxySecret: !!env.RESOURCE_PROXY_SIGNING_SECRET,
					enableResourceProxy: env.ENABLE_RESOURCE_PROXY,
					featureFlags: env.FEATURE_FLAGS,
					proxyBackend: (env.PROXY_STATS_BACKEND || 'kv').toLowerCase(),
					hasProxyUsageDO: !!env.PROXY_USAGE_DO
				}, null, 2), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

			if (url.pathname === '/__proxy_token__') {
				const projectId = url.searchParams.get('project_id') || 'debug-project';
				try {
					const token = await createResourceProxyToken(projectId, env);
					return new Response(JSON.stringify({ projectId, token }, null, 2), {
						headers: { 'Content-Type': 'application/json' }
					});
				} catch (error) {
					return new Response(JSON.stringify({
						projectId,
						error: error instanceof Error ? error.message : String(error),
					}), {
						status: 500,
						headers: { 'Content-Type': 'application/json' }
					});
				}
			}
		
		// Validate environment once per Worker instance
		if (!envValidated) {
			try {
				validateAndLog(env);
				envValidated = true;
			} catch (error) {
				console.error('[WORKER] Environment validation failed:', error);
				return new Response(JSON.stringify({
					error: 'CONFIGURATION_ERROR',
					message: 'Worker environment misconfigured',
					details: error instanceof Error ? error.message : String(error)
				}), {
					status: 500,
					headers: { 'Content-Type': 'application/json' }
				});
			}
		}

		// Use the organized router system
		return await router(request, env, ctx);
	},

	/**
	 * Scheduled handler for cron triggers
	 * Phase 3: Manifest drift detection runs daily at 3 AM UTC
	 */
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		console.info('[WORKER] Scheduled event triggered', {
			scheduledTime: new Date(controller.scheduledTime).toISOString(),
			cron: controller.cron
		});

		// Convert ScheduledController to ScheduledEvent-like object for the handler
		const event = {
			scheduledTime: controller.scheduledTime,
			cron: controller.cron
		} as ScheduledEvent;

		// Route to manifest drift check handler
		ctx.waitUntil(handleManifestDriftCheck(event, env, ctx));
	},

	/**
	 * Queue consumer handler for BUILD_QUEUE
	 * Processes build jobs sequentially with timeout handling
	 */
	async queue(batch: MessageBatch<BuildJob>, env: Env): Promise<void> {
		// Check if this is a dead letter queue batch
		const isDeadLetterQueue = batch.queue === 'build-queue-dead-letter';
		
		if (isDeadLetterQueue) {
			await handleDeadLetterQueue(batch, env);
			return;
		}

		// Process each message in the batch
		for (const message of batch.messages) {
			try {
				console.info(`Processing build job for project: ${message.body.project_id}, job ID: ${message.body.job_id || 'unknown'}`);

				// Process the build job via GitHub Actions (TASK-023)
				// Build environment detection and idempotent dispatch handled inside processBuildJob
				const result = await processBuildJob(message.body, env);

				// CRITICAL FIX: Only acknowledge AFTER confirming success
				if (result.success) {
					message.ack();
					console.info(`Build job successfully processed and acknowledged for project: ${message.body.project_id}, job ID: ${message.body.job_id || 'unknown'}`, {
						dispatch_record_created: result.details?.dispatch_record_created,
						idempotency_skipped: result.details?.idempotency_skipped
					});
				} else {
					// Build processing failed - retry the message
					console.error(`Build job processing failed for project ${message.body.project_id}, retrying message:`, result.message);
					message.retry();
				}

			} catch (error) {
				console.error(`Failed to process build job for project ${message.body.project_id}, job ID: ${message.body.job_id || 'unknown'}:`, error);

				// Retry the message (will go to dead letter queue after max retries)
				message.retry();
			}
		}
	},
} satisfies ExportedHandler<Env>;

/**
 * Handle permanently failed jobs from the dead letter queue
 */
async function handleDeadLetterQueue(batch: MessageBatch<BuildJob>, env: Env): Promise<void> {
	console.info(`Processing ${batch.messages.length} permanently failed build jobs from dead letter queue`);
	
	for (const message of batch.messages) {
		try {
			const job = message.body;
			const timestamp = new Date().toISOString();
			
			console.error(`Permanently failed build job - Project: ${job.project_id}, Job ID: ${job.job_id || 'unknown'}, Framework: ${job.framework}`);
			
			// Update build status to permanently failed
			await updateBuildStatusForDeadLetter(job.project_id, job.job_id || 'unknown', {
				status: 'failed',
				progress: 0,
				current_stage: 'npm-install',
				logs: [
					`Build started at ${job.metadata.queued_at}`,
					`Job ID: ${job.job_id || 'unknown'}`,
					`Framework: ${job.framework}`,
					`Build permanently failed after maximum retries`,
					`Moved to dead letter queue at ${timestamp}`
				],
				error: {
					stage: 'queue-processing',
					message: 'Build job permanently failed after maximum retry attempts',
					details: { 
						job_id: job.job_id || 'unknown',
						retry_count: job.metadata.retry_count || 0,
						dead_letter_timestamp: timestamp,
						original_timeout: job.timeout_seconds
					}
				},
				metadata: {
					job_id: job.job_id,
					...job.metadata,
					completed_at: timestamp,
					permanently_failed: true
				}
			}, env);
			
			// Update project status to failed
			await updateProjectMetadataForDeadLetter(job.project_id, 'failed', env);
			
			// Acknowledge the dead letter message
			message.ack();
			
		} catch (error) {
			console.error(`Failed to process dead letter message for project ${message.body.project_id}:`, error);
			// For dead letter queue, we still ack to prevent infinite loops
			message.ack();
		}
	}
}

/**
 * Update build status for dead letter queue jobs (simplified error handling)
 */
async function updateBuildStatusForDeadLetter(
	project_id: string,
	job_id: string, 
	buildStatus: any, 
	env: Env
): Promise<void> {
	try {
		const statusKey = `projects/${project_id}/build-status.json`;
		await env.PROJECTS_BUCKET.put(
			statusKey,
			JSON.stringify(buildStatus, null, 2),
			{
				httpMetadata: { contentType: 'application/json' },
				customMetadata: {
					project_id,
					job_id,
					status: 'failed',
					permanently_failed: 'true',
					updated_at: new Date().toISOString()
				}
			}
		);
		console.info(`Dead letter build status updated for ${project_id}`);
	} catch (error) {
		console.error(`Error updating dead letter build status for ${project_id}:`, error);
	}
}

/**
 * Update project metadata for dead letter queue jobs (simplified error handling)
 */
async function updateProjectMetadataForDeadLetter(
	project_id: string, 
	status: string, 
	env: Env
): Promise<void> {
	try {
		const metadataKey = `projects/${project_id}/metadata.json`;
		const object = await env.PROJECTS_BUCKET.get(metadataKey);
		
		if (object) {
			const metadata = await object.json() as any;
			metadata.status = status;
			metadata.updated_at = new Date().toISOString();
			metadata.permanently_failed = true;
			
			await env.PROJECTS_BUCKET.put(
				metadataKey,
				JSON.stringify(metadata, null, 2),
				{
					httpMetadata: { contentType: 'application/json' }
				}
			);
			console.info(`Dead letter project metadata updated for ${project_id}`);
		}
	} catch (error) {
		console.error(`Error updating dead letter project metadata for ${project_id}:`, error);
	}
}
