/**
 * Project Owner ID Migration Endpoint
 * POST /api/admin/migrate-owner-ids
 *
 * Backfills ownerId for legacy projects that don't have one set
 */

interface MigrationResult {
  projectId: string;
  status: 'migrated' | 'skipped' | 'error';
  before: string | undefined;
  after?: string;
  error?: string;
}

interface MigrationReport {
  timestamp: string;
  dryRun: boolean;
  totalProcessed: number;
  migrated: number;
  skipped: number;
  errors: number;
  results: MigrationResult[];
}

const LEGACY_OWNER_ID = 'legacy-single-tenant';

/**
 * Migrate a single project's metadata to add owner ID
 */
async function migrateProject(
  bucket: R2Bucket,
  projectId: string,
  dryRun: boolean
): Promise<MigrationResult> {
  const metadataPath = `projects/${projectId}/metadata.json`;

  try {
    // Read current metadata
    const object = await bucket.get(metadataPath);

    if (!object) {
      return {
        projectId,
        status: 'error',
        before: undefined,
        error: 'Metadata file not found'
      };
    }

    const content = await object.text();
    let metadata: any;

    try {
      metadata = JSON.parse(content);
    } catch (parseError) {
      return {
        projectId,
        status: 'error',
        before: undefined,
        error: `JSON parse error: ${(parseError as Error).message}`
      };
    }

    // Check if already has owner ID
    if (metadata.ownerId !== undefined && metadata.ownerId !== null && metadata.ownerId !== '') {
      return {
        projectId,
        status: 'skipped',
        before: String(metadata.ownerId),
        after: String(metadata.ownerId)
      };
    }

    // Add owner ID
    const updatedMetadata = {
      ...metadata,
      ownerId: LEGACY_OWNER_ID,
      updatedAt: new Date().toISOString()
    };

    if (!dryRun) {
      // Write back to R2
      await bucket.put(metadataPath, JSON.stringify(updatedMetadata, null, 2), {
        httpMetadata: {
          contentType: 'application/json'
        }
      });
    }

    return {
      projectId,
      status: 'migrated',
      before: metadata.ownerId === undefined ? 'undefined' : metadata.ownerId === null ? 'null' : 'empty',
      after: LEGACY_OWNER_ID
    };
  } catch (error) {
    return {
      projectId,
      status: 'error',
      before: undefined,
      error: `Migration failed: ${(error as Error).message}`
    };
  }
}

/**
 * Migrate specific projects by ID list
 */
export async function migrateOwnerIds(
  bucket: R2Bucket,
  projectIds: string[],
  dryRun: boolean = true
): Promise<MigrationReport> {
  const results: MigrationResult[] = [];

  for (const projectId of projectIds) {
    const result = await migrateProject(bucket, projectId, dryRun);
    results.push(result);
  }

  const report: MigrationReport = {
    timestamp: new Date().toISOString(),
    dryRun,
    totalProcessed: results.length,
    migrated: results.filter(r => r.status === 'migrated').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length,
    results
  };

  return report;
}

/**
 * Handle migration request
 */
export async function handleMigrateOwnerIds(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const bucket = env.PROJECTS_BUCKET;

    if (!bucket) {
      return new Response(
        JSON.stringify({ error: 'PROJECTS_BUCKET not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    let body: { projectIds?: string[]; dryRun?: boolean } = {};
    try {
      body = await request.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON body' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { projectIds = [], dryRun = true } = body;

    if (!Array.isArray(projectIds) || projectIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'projectIds array is required and must not be empty' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const report = await migrateOwnerIds(bucket, projectIds, dryRun);

    return new Response(
      JSON.stringify(report, null, 2),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Migration failed',
        message: (error as Error).message
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
