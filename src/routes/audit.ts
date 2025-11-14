/**
 * Project Owner ID Audit Endpoint
 * GET /api/admin/audit-projects
 *
 * Analyzes all projects in R2 to determine migration status
 */

interface ProjectMetadata {
  id: string;
  name: string;
  ownerId?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface AuditResult {
  projectId: string;
  metadataPath: string;
  status: 'has-owner' | 'needs-migration' | 'error' | 'malformed';
  currentOwnerId?: string;
  error?: string;
}

interface AuditReport {
  timestamp: string;
  totalProjects: number;
  hasOwner: number;
  needsMigration: number;
  errors: number;
  malformed: number;
  projects: AuditResult[];
  summary: {
    hasOwnerList: string[];
    needsMigrationList: string[];
    errorList: Array<{ projectId: string; error: string }>;
  };
}

/**
 * Extract project ID from metadata path
 */
function extractProjectId(path: string): string | null {
  const match = path.match(/^projects\/([^/]+)\/metadata\.json$/);
  return match ? match[1] : null;
}

/**
 * Analyze a single project metadata file
 */
async function analyzeProject(
  bucket: R2Bucket,
  key: string
): Promise<AuditResult> {
  const projectId = extractProjectId(key);

  if (!projectId) {
    return {
      projectId: 'unknown',
      metadataPath: key,
      status: 'malformed',
      error: 'Could not extract project ID from path'
    };
  }

  try {
    const object = await bucket.get(key);

    if (!object) {
      return {
        projectId,
        metadataPath: key,
        status: 'error',
        error: 'Metadata file not found'
      };
    }

    const content = await object.text();
    let metadata: ProjectMetadata;

    try {
      metadata = JSON.parse(content);
    } catch (parseError) {
      return {
        projectId,
        metadataPath: key,
        status: 'malformed',
        error: `JSON parse error: ${(parseError as Error).message}`
      };
    }

    const ownerId = metadata.ownerId;

    if (ownerId !== undefined && ownerId !== null && ownerId !== '') {
      return {
        projectId,
        metadataPath: key,
        status: 'has-owner',
        currentOwnerId: String(ownerId)
      };
    } else {
      return {
        projectId,
        metadataPath: key,
        status: 'needs-migration',
        currentOwnerId: ownerId === undefined ? 'undefined' : ownerId === null ? 'null' : 'empty-string'
      };
    }
  } catch (error) {
    return {
      projectId,
      metadataPath: key,
      status: 'error',
      error: `Failed to analyze: ${(error as Error).message}`
    };
  }
}

/**
 * List all metadata files in the projects bucket
 */
async function listAllMetadataFiles(bucket: R2Bucket): Promise<string[]> {
  const metadataFiles: string[] = [];
  let cursor: string | undefined;

  do {
    const listing = await bucket.list({
      prefix: 'projects/',
      delimiter: undefined,
      cursor,
      limit: 1000
    });

    for (const object of listing.objects) {
      if (object.key.endsWith('/metadata.json')) {
        metadataFiles.push(object.key);
      }
    }

    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);

  return metadataFiles;
}

/**
 * Main audit function
 */
export async function auditProjects(bucket: R2Bucket): Promise<AuditReport> {
  const metadataFiles = await listAllMetadataFiles(bucket);
  const results: AuditResult[] = [];

  for (const key of metadataFiles) {
    const result = await analyzeProject(bucket, key);
    results.push(result);
  }

  const summary = {
    hasOwnerList: results
      .filter(r => r.status === 'has-owner')
      .map(r => r.projectId),
    needsMigrationList: results
      .filter(r => r.status === 'needs-migration')
      .map(r => r.projectId),
    errorList: results
      .filter(r => r.status === 'error' || r.status === 'malformed')
      .map(r => ({ projectId: r.projectId, error: r.error || 'Unknown error' }))
  };

  const report: AuditReport = {
    timestamp: new Date().toISOString(),
    totalProjects: results.length,
    hasOwner: results.filter(r => r.status === 'has-owner').length,
    needsMigration: results.filter(r => r.status === 'needs-migration').length,
    errors: results.filter(r => r.status === 'error').length,
    malformed: results.filter(r => r.status === 'malformed').length,
    projects: results,
    summary
  };

  return report;
}

/**
 * Handle audit request
 */
export async function handleAuditProjects(
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

    const report = await auditProjects(bucket);

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
        error: 'Audit failed',
        message: (error as Error).message
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
