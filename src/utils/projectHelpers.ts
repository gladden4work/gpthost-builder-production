/**
 * Shared Project Helper Functions
 * 
 * This module contains shared utility functions used across multiple handlers
 * to eliminate code duplication and ensure consistency.
 */

import { ProjectMetadata, BuildStatus } from '../types/api';

/**
 * Get project metadata from R2
 * Centralized function to retrieve project metadata across handlers
 */
export async function getProjectMetadata(projectId: string, env: Env): Promise<ProjectMetadata | null> {
  try {
    const metadataKey = `projects/${projectId}/metadata.json`;
    const metadataObject = await env.PROJECTS_BUCKET.get(metadataKey);
    
    if (!metadataObject) {
      return null;
    }

    return await metadataObject.json() as ProjectMetadata;
  } catch (error) {
    console.error(`Failed to get project metadata for ${projectId}:`, error);
    return null;
  }
}

/**
 * Get build status from R2
 * Centralized function to retrieve build status across handlers
 */
export async function getBuildStatus(projectId: string, env: Env): Promise<BuildStatus | null> {
  try {
    const statusKey = `projects/${projectId}/build-status.json`;
    const statusObject = await env.PROJECTS_BUCKET.get(statusKey);
    
    if (!statusObject) {
      return null;
    }

    return await statusObject.json() as BuildStatus;
  } catch (error) {
    console.error(`Failed to get build status for ${projectId}:`, error);
    return null;
  }
}

/**
 * Get build artifacts information
 * Centralized function to retrieve build artifacts across handlers
 */
export async function getBuildArtifacts(projectId: string, buildId: string, env: Env): Promise<any | null> {
  try {
    const artifactsKey = `builds/${projectId}/${buildId}/artifacts.json`;
    const artifactsObject = await env.BUILDS_BUCKET.get(artifactsKey);
    
    if (!artifactsObject) {
      return null;
    }

    return await artifactsObject.json();
  } catch (error) {
    console.error(`Failed to get build artifacts for ${projectId}/${buildId}:`, error);
    return null;
  }
}

/**
 * Standardized error response format
 * Ensures consistent error responses across all handlers
 */
export interface StandardErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Create standardized error response
 */
export function createErrorResponse(
  code: string, 
  message: string, 
  details?: any,
  status: number = 500
): Response {
  const errorResponse: StandardErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };

  return new Response(JSON.stringify(errorResponse), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Create standardized success response
 */
export function createSuccessResponse<T>(data: T, status: number = 200): Response {
  return new Response(JSON.stringify({
    success: true,
    data,
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Secure hash function using crypto.subtle
 * Replaces basic hash function with cryptographically secure alternative
 */
export async function secureHashString(content: string): Promise<string> {
  try {
    // Convert string to Uint8Array
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    
    // Create SHA-256 hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    
    // Convert to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
  } catch (error) {
    console.error('Failed to generate secure hash:', error);
    // Fallback to basic hash if crypto.subtle fails
    return basicHashString(content);
  }
}

/**
 * Basic hash function (fallback)
 * Used as fallback when crypto.subtle is not available
 */
function basicHashString(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Validate project ID format
 * Ensures project IDs meet expected format requirements
 */
export function validateProjectId(projectId: string): boolean {
  if (!projectId || typeof projectId !== 'string') {
    return false;
  }
  
  // UUID format validation (basic)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(projectId);
}

/**
 * Extract project ID from URL path
 * Standardized way to extract project ID from API paths
 */
export function extractProjectIdFromPath(pathname: string): string | null {
  const parts = pathname.split('/');
  const projectIdIndex = parts.indexOf('projects') + 1;
  
  if (projectIdIndex === 0 || projectIdIndex >= parts.length) {
    return null;
  }
  
  const projectId = parts[projectIdIndex];
  return validateProjectId(projectId) ? projectId : null;
}

/**
 * Update project status in metadata
 * Centralized function to update project status consistently
 */
export async function updateProjectStatus(
  projectId: string, 
  status: string, 
  env: Env,
  additionalData?: Record<string, any>
): Promise<void> {
  try {
    const metadataKey = `projects/${projectId}/metadata.json`;
    const metadataObject = await env.PROJECTS_BUCKET.get(metadataKey);
    
    if (!metadataObject) {
      throw new Error('Project metadata not found');
    }

    const metadata = await metadataObject.json() as ProjectMetadata;
    metadata.status = status as any;
    metadata.updated_at = new Date().toISOString();

    // Apply additional data if provided
    if (additionalData) {
      Object.assign(metadata, additionalData);
    }

    await env.PROJECTS_BUCKET.put(
      metadataKey,
      JSON.stringify(metadata, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          project_id: projectId,
          status: status,
          updated_at: metadata.updated_at,
        },
      }
    );

    console.info(`Project ${projectId} status updated to ${status}`);
  } catch (error) {
    console.error(`Failed to update project status for ${projectId}:`, error);
    throw error;
  }
}