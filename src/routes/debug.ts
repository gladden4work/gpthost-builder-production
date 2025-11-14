/**
 * Debug route to inspect R2 bucket structure
 * This is a temporary route to help diagnose the project listing issue
 */

import { successResponse, errorResponse } from '../utils/responses';

/**
 * List all objects in R2 bucket with their prefixes
 * GET /api/debug/r2-structure
 */
export async function debugR2StructureHandler(request: Request, env: Env): Promise<Response> {
  try {
    const results: any = {
      all_objects: [],
      projects_active: [],
      projects_root: [],
      metadata_files: []
    };
    
    // List all objects with limit
    const allObjects = await env.PROJECTS_BUCKET.list({ limit: 100 });
    results.all_objects = allObjects.objects.map(obj => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded
    }));
    
    // List objects under projects/active/
    const activeObjects = await env.PROJECTS_BUCKET.list({ 
      prefix: 'projects/active/',
      delimiter: '/',
      limit: 100 
    });
    results.projects_active = {
      objects: activeObjects.objects.map(obj => obj.key),
      delimitedPrefixes: activeObjects.delimitedPrefixes || []
    };
    
    // List objects directly under projects/
    const rootObjects = await env.PROJECTS_BUCKET.list({ 
      prefix: 'projects/',
      delimiter: '/',
      limit: 100 
    });
    results.projects_root = {
      objects: rootObjects.objects.map(obj => obj.key),
      delimitedPrefixes: rootObjects.delimitedPrefixes || []
    };
    
    // Find all metadata.json files
    const metadataSearch = await env.PROJECTS_BUCKET.list({ 
      prefix: 'projects/',
      limit: 100 
    });
    results.metadata_files = metadataSearch.objects
      .filter(obj => obj.key.endsWith('metadata.json'))
      .map(obj => obj.key);
    
    return successResponse({
      bucket_structure: results,
      summary: {
        total_objects: allObjects.objects.length,
        active_projects: results.projects_active.delimitedPrefixes.length,
        root_projects: results.projects_root.delimitedPrefixes.filter((p: string) => 
          !p.includes('/active/') && !p.includes('/archived/') && !p.includes('/cleanup/')
        ).length,
        metadata_files: results.metadata_files.length
      }
    });
    
  } catch (error) {
    console.error('Debug R2 structure error:', error);
    return errorResponse(
      'DEBUG_ERROR',
      'Failed to list R2 structure',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}