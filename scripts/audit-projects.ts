/**
 * Project Owner ID Audit Script
 *
 * Analyzes all existing projects in R2 storage to determine which projects
 * need owner_id migration to 'legacy-single-tenant'.
 *
 * Usage:
 *   npx tsx scripts/audit-projects.ts [--output audit-report.json]
 *
 * This script runs against the production R2 bucket and generates a report
 * showing which projects have/don't have ownerId set.
 */

import type { R2Bucket, R2Objects } from '@cloudflare/workers-types';

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
 * Path format: projects/{projectId}/metadata.json
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
    // Fetch the metadata file
    const object = await bucket.get(key);

    if (!object) {
      return {
        projectId,
        metadataPath: key,
        status: 'error',
        error: 'Metadata file not found'
      };
    }

    // Parse the JSON
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

    // Check ownerId status
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
    const listing: R2Objects = await bucket.list({
      prefix: 'projects/',
      delimiter: undefined,
      cursor,
      limit: 1000
    });

    // Filter for metadata.json files
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
  console.log('🔍 Starting project owner ID audit...');

  // Step 1: List all metadata files
  console.log('📋 Listing all project metadata files...');
  const metadataFiles = await listAllMetadataFiles(bucket);
  console.log(`✅ Found ${metadataFiles.length} project(s)`);

  // Step 2: Analyze each project
  console.log('🔬 Analyzing projects...');
  const results: AuditResult[] = [];

  for (let i = 0; i < metadataFiles.length; i++) {
    const key = metadataFiles[i];
    const projectId = extractProjectId(key) || `unknown-${i}`;

    process.stdout.write(`\r  Analyzing ${i + 1}/${metadataFiles.length}: ${projectId}...`);

    const result = await analyzeProject(bucket, key);
    results.push(result);
  }

  console.log('\n✅ Analysis complete');

  // Step 3: Generate summary
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
 * Print audit report to console
 */
export function printAuditReport(report: AuditReport): void {
  console.log('\n' + '='.repeat(70));
  console.log('📊 PROJECT OWNER ID AUDIT REPORT');
  console.log('='.repeat(70));
  console.log(`\n📅 Timestamp: ${report.timestamp}`);
  console.log(`\n📈 Summary:`);
  console.log(`  Total Projects:          ${report.totalProjects}`);
  console.log(`  ✅ Has Owner ID:         ${report.hasOwner} (${Math.round(report.hasOwner / report.totalProjects * 100)}%)`);
  console.log(`  🔄 Needs Migration:      ${report.needsMigration} (${Math.round(report.needsMigration / report.totalProjects * 100)}%)`);
  console.log(`  ❌ Errors:               ${report.errors}`);
  console.log(`  ⚠️  Malformed:            ${report.malformed}`);

  if (report.needsMigration > 0) {
    console.log(`\n🔄 Projects Needing Migration (${report.needsMigration}):`);
    report.summary.needsMigrationList.forEach(id => {
      const project = report.projects.find(p => p.projectId === id);
      console.log(`  - ${id} (current: ${project?.currentOwnerId})`);
    });
  }

  if (report.hasOwner > 0) {
    console.log(`\n✅ Projects With Owner ID (${report.hasOwner}):`);
    report.summary.hasOwnerList.slice(0, 10).forEach(id => {
      const project = report.projects.find(p => p.projectId === id);
      console.log(`  - ${id} → ${project?.currentOwnerId}`);
    });
    if (report.hasOwner > 10) {
      console.log(`  ... and ${report.hasOwner - 10} more`);
    }
  }

  if (report.summary.errorList.length > 0) {
    console.log(`\n❌ Errors (${report.summary.errorList.length}):`);
    report.summary.errorList.forEach(({ projectId, error }) => {
      console.log(`  - ${projectId}: ${error}`);
    });
  }

  console.log('\n' + '='.repeat(70));
  console.log(`\n💡 Next Steps:`);
  if (report.needsMigration > 0) {
    console.log(`  1. Review the ${report.needsMigration} project(s) needing migration`);
    console.log(`  2. Run the migration script with: npm run migrate:owner-id`);
    console.log(`  3. Verify migration results with another audit`);
  } else {
    console.log(`  ✅ All projects have owner IDs set - no migration needed!`);
  }
  console.log('');
}

// Export for use as Worker or CLI tool
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
};
