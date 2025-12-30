/**
 * Metadata Migration Utility
 * 
 * Utility functions to migrate existing basic project metadata to the new
 * enhanced metadata system. Provides seamless transition and backward compatibility.
 */

import { ProjectMetadata, EnhancedProjectMetadata, ExtendedProjectStatus } from '../types/api';
import { getEnhancedMetadataManager } from './enhancedMetadataManager';
import { createProjectMetadataManager } from './projectMetadataManager';

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  projects_migrated: number;
  projects_skipped: number;
  projects_failed: number;
  errors: Array<{
    project_id: string;
    error: string;
  }>;
}

/**
 * Migrate a single project from basic to enhanced metadata
 */
export async function migrateProjectMetadata(
  projectId: string,
  env: Env,
  userId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.info('[METADATA-MIGRATION] Migrating project', { project_id: projectId });

    const basicMetadataManager = createProjectMetadataManager(env);
    const enhancedMetadataManager = getEnhancedMetadataManager(env);

    // Check if enhanced metadata already exists
    const existingEnhanced = await enhancedMetadataManager.getMetadata(projectId);
    if (existingEnhanced) {
      console.info('[METADATA-MIGRATION] Enhanced metadata already exists', { project_id: projectId });
      return { success: true };
    }

    // Load basic metadata
    const basicMetadata = await basicMetadataManager.loadProjectMetadata(projectId);
    if (!basicMetadata) {
      return { success: false, error: 'Basic metadata not found' };
    }

    // Create enhanced metadata from basic metadata
    const enhancedData = createEnhancedFromBasic(basicMetadata);

    // Create the enhanced metadata
    const result = await enhancedMetadataManager.createMetadata(
      projectId,
      basicMetadata,
      enhancedData,
      userId || 'system-migration'
    );

    if (!result.success) {
      return { 
        success: false, 
        error: result.error?.message || 'Failed to create enhanced metadata' 
      };
    }

    console.info('✅ [METADATA-MIGRATION] Project migrated successfully', { 
      project_id: projectId,
      version: result.version 
    });

    return { success: true };

  } catch (error) {
    console.error('[METADATA-MIGRATION] Migration failed', {
      project_id: projectId,
      error: error instanceof Error ? error.message : String(error)
    });

    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Batch migrate all existing projects to enhanced metadata
 */
export async function migrateAllProjects(
  env: Env,
  options?: {
    batch_size?: number;
    skip_existing?: boolean;
    user_id?: string;
  }
): Promise<MigrationResult> {
  const batchSize = options?.batch_size || 10;
  const skipExisting = options?.skip_existing !== false;
  const userId = options?.user_id || 'batch-migration';

  const result: MigrationResult = {
    success: true,
    projects_migrated: 0,
    projects_skipped: 0,
    projects_failed: 0,
    errors: []
  };

  try {
    console.info('[METADATA-MIGRATION] Starting batch migration', {
      batch_size: batchSize,
      skip_existing: skipExisting
    });

    // List all projects in R2
    const projectsBucket = env.PROJECTS_BUCKET;
    const listResult = await projectsBucket.list({
      prefix: 'projects/',
      include: ['customMetadata', 'httpMetadata']
    });

    // Find all project metadata files
    const projectIds = new Set<string>();
    for (const object of listResult.objects) {
      if (object.key.endsWith('/metadata.json') && !object.key.includes('/enhanced-metadata.json')) {
        const projectId = object.key.split('/')[1];
        if (projectId) {
          projectIds.add(projectId);
        }
      }
    }

    console.info('[METADATA-MIGRATION] Found projects to migrate', { 
      total_projects: projectIds.size 
    });

    // Process projects in batches
    const projectIdArray = Array.from(projectIds);
    for (let i = 0; i < projectIdArray.length; i += batchSize) {
      const batch = projectIdArray.slice(i, i + batchSize);
      
      console.info('[METADATA-MIGRATION] Processing batch', { 
        batch_start: i + 1,
        batch_end: Math.min(i + batchSize, projectIdArray.length),
        total: projectIdArray.length
      });

      // Process batch in parallel
      const batchPromises = batch.map(projectId => 
        migrateProjectMetadata(projectId, env, userId)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);

      // Process results
      for (let j = 0; j < batchResults.length; j++) {
        const projectId = batch[j];
        const batchResult = batchResults[j];

        if (batchResult.status === 'fulfilled') {
          if (batchResult.value.success) {
            result.projects_migrated++;
          } else {
            result.projects_failed++;
            result.errors.push({
              project_id: projectId,
              error: batchResult.value.error || 'Unknown error'
            });
          }
        } else {
          result.projects_failed++;
          result.errors.push({
            project_id: projectId,
            error: batchResult.reason instanceof Error ? batchResult.reason.message : String(batchResult.reason)
          });
        }
      }

      // Small delay between batches to avoid overwhelming the system
      if (i + batchSize < projectIdArray.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Check if we had any failures
    result.success = result.projects_failed === 0;

    console.info('✅ [METADATA-MIGRATION] Batch migration completed', {
      projects_migrated: result.projects_migrated,
      projects_skipped: result.projects_skipped,
      projects_failed: result.projects_failed,
      success: result.success
    });

  } catch (error) {
    console.error('[METADATA-MIGRATION] Batch migration failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    result.success = false;
    result.errors.push({
      project_id: 'BATCH_MIGRATION',
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return result;
}

/**
 * Create enhanced metadata structure from basic metadata
 */
function createEnhancedFromBasic(basicMetadata: ProjectMetadata): Partial<EnhancedProjectMetadata> {
  const now = new Date().toISOString();

  return {
    display_name: basicMetadata.name || basicMetadata.id,
    category: inferProjectCategory(basicMetadata),
    visibility: 'private', // Default to private for existing projects
    owner: {
      id: 'legacy-user', // Default owner for migrated projects
      email: undefined,
      username: undefined
    },
    collaborators: [],
    tags: generateTagsFromBasic(basicMetadata),
    extended_status: mapStatusToExtended(basicMetadata.status),
    status_history: [{
      status: mapStatusToExtended(basicMetadata.status),
      timestamp: basicMetadata.updated_at || now,
      reason: 'Migrated from basic metadata',
      changed_by: 'system-migration'
    }],
    custom_fields: {
      migration_source: 'basic_metadata',
      migration_timestamp: now,
      original_status: basicMetadata.status
    },
    system_info: {
      created_by_system: 'metadata-migration',
      api_version: '1.0.0',
      import_source: 'upload'
    }
  };
}

/**
 * Infer project category from basic metadata
 */
function inferProjectCategory(basicMetadata: ProjectMetadata): 'prototype' | 'demo' | 'production' | 'experiment' | 'template' {
  const description = (basicMetadata.description || '').toLowerCase();
  const name = (basicMetadata.name || '').toLowerCase();
  
  if (description.includes('template') || name.includes('template')) {
    return 'template';
  }
  
  if (description.includes('demo') || name.includes('demo') || name.includes('example')) {
    return 'demo';
  }
  
  if (description.includes('production') || description.includes('live')) {
    return 'production';
  }
  
  if (description.includes('experiment') || description.includes('test') || name.includes('test')) {
    return 'experiment';
  }
  
  // Default to prototype for migrated projects
  return 'prototype';
}

/**
 * Generate tags from basic metadata
 */
function generateTagsFromBasic(basicMetadata: ProjectMetadata) {
  const tags = [];
  const now = new Date().toISOString();

  // Add framework tag
  if (basicMetadata.framework && basicMetadata.framework !== 'unknown') {
    tags.push({
      id: `framework-${basicMetadata.framework}`,
      name: basicMetadata.framework,
      color: getFrameworkColor(basicMetadata.framework),
      description: `Generated from framework: ${basicMetadata.framework}`,
      created_at: now,
      created_by: 'system-migration'
    });
  }

  // Add migration tag
  tags.push({
    id: 'migrated',
    name: 'migrated',
    color: '#6b7280',
    description: 'Project migrated from basic metadata',
    created_at: now,
    created_by: 'system-migration'
  });

  return tags;
}

/**
 * Get color for framework tags
 */
function getFrameworkColor(framework: string): string {
  const colors: Record<string, string> = {
    'react': '#61dafb',
    'vue': '#4fc08d',
    'svelte': '#ff3e00',
    'html': '#e34f26',
    'unknown': '#6b7280'
  };
  
  return colors[framework] || '#6b7280';
}

/**
 * Map basic status to extended status
 */
function mapStatusToExtended(status: string): ExtendedProjectStatus {
  const statusMap: Record<string, ExtendedProjectStatus> = {
    'pending': 'pending',
    'analyzing': 'analyzing',
    'building': 'building',
    'deploying': 'deploying',
    'deployed': 'deployed',
    'failed': 'failed'
  };

  return statusMap[status] || 'pending';
}

/**
 * Check if a project needs migration
 */
export async function needsMigration(projectId: string, env: Env): Promise<boolean> {
  try {
    const enhancedMetadataManager = getEnhancedMetadataManager(env);
    const enhancedMetadata = await enhancedMetadataManager.getMetadata(projectId);
    
    // If enhanced metadata doesn't exist, it needs migration
    return enhancedMetadata === null;
  } catch (error) {
    console.warn('[METADATA-MIGRATION] Error checking migration status', {
      project_id: projectId,
      error: error instanceof Error ? error.message : String(error)
    });
    return true; // Assume it needs migration if we can't check
  }
}

/**
 * Get migration statistics
 */
export async function getMigrationStats(env: Env): Promise<{
  total_projects: number;
  enhanced_metadata_projects: number;
  basic_metadata_only: number;
  migration_needed: number;
}> {
  try {
    const projectsBucket = env.PROJECTS_BUCKET;
    const listResult = await projectsBucket.list({
      prefix: 'projects/',
      include: ['customMetadata']
    });

    let totalProjects = 0;
    let enhancedProjects = 0;
    let basicOnly = 0;

    const projectIds = new Set<string>();
    const enhancedProjectIds = new Set<string>();

    // Count all project metadata files
    for (const object of listResult.objects) {
      if (object.key.endsWith('/metadata.json')) {
        const projectId = object.key.split('/')[1];
        if (projectId) {
          projectIds.add(projectId);
        }
      }
      
      if (object.key.endsWith('/enhanced-metadata.json')) {
        const projectId = object.key.split('/')[1];
        if (projectId) {
          enhancedProjectIds.add(projectId);
        }
      }
    }

    totalProjects = projectIds.size;
    enhancedProjects = enhancedProjectIds.size;
    basicOnly = totalProjects - enhancedProjects;

    return {
      total_projects: totalProjects,
      enhanced_metadata_projects: enhancedProjects,
      basic_metadata_only: basicOnly,
      migration_needed: basicOnly
    };

  } catch (error) {
    console.error('[METADATA-MIGRATION] Error getting migration stats', {
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      total_projects: 0,
      enhanced_metadata_projects: 0,
      basic_metadata_only: 0,
      migration_needed: 0
    };
  }
}