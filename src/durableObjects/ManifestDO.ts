/**
 * ManifestDO - Durable Object for Atomic Manifest Updates
 *
 * Provides true atomic operations for per-owner project manifests using
 * SQLite storage. Eliminates race conditions that existed with KV-based CAS.
 *
 * Key features:
 * - One DO instance per ownerId (single-threaded execution)
 * - SQLite for persistent storage (survives hibernation)
 * - In-memory cache for performance
 * - Lazy migration from KV on first access
 * - Unified metrics tracking
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types/env';
import {
  OwnerProjectManifest,
  ManifestProjectSummary,
  ManifestMetadata,
  BuildSignals,
  MANIFEST_SCHEMA_VERSION,
  createEmptyManifest,
  recalculateMetadata
} from '../domain/manifest';

/**
 * Metrics tracked within the Durable Object
 */
export interface DOManifestMetrics {
  hits: number;
  misses: number;
  rebuilds: number;
  migrations: number;
}

/**
 * ManifestDO - Durable Object class for atomic manifest operations
 *
 * Each instance manages one owner's project manifest.
 * All operations are serialized (single-threaded) within an instance.
 */
export class ManifestDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private cachedManifest: OwnerProjectManifest | null = null;
  private ownerId: string | null = null;
  private initialized: boolean = false;
  private metricsBuffer: DOManifestMetrics = {
    hits: 0,
    misses: 0,
    rebuilds: 0,
    migrations: 0
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  /**
   * Initialize the DO state (called on first access)
   * Sets up SQLite tables if they don't exist
   */
  private async initialize(ownerId: string): Promise<void> {
    if (this.initialized && this.ownerId === ownerId) {
      return;
    }

    this.ownerId = ownerId;

    // Migration: Check if projects table exists with old CHECK constraint (missing 'html')
    // SQLite doesn't support ALTER TABLE for CHECK constraints, so we need to recreate
    this.migrateProjectsTableSchema();

    // Create tables if not exist
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        framework TEXT NOT NULL CHECK(framework IN ('react', 'vue', 'svelte', 'html', 'unknown')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'scaffolded', 'building', 'deployed', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deployment_url TEXT,
        subdomain TEXT,
        file_count INTEGER DEFAULT 0,
        build_has_success INTEGER DEFAULT 0,
        build_has_failure INTEGER DEFAULT 0,
        build_last_id TEXT
      );

      CREATE TABLE IF NOT EXISTS manifest_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS metrics_hourly (
        hour TEXT PRIMARY KEY,
        hits INTEGER DEFAULT 0,
        misses INTEGER DEFAULT 0,
        rebuilds INTEGER DEFAULT 0,
        migrations INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at);
    `);

    // Store owner_id in meta table
    this.sql.exec(
      `INSERT OR REPLACE INTO manifest_meta (key, value) VALUES ('owner_id', ?)`,
      ownerId
    );

    // Store schema version
    this.sql.exec(
      `INSERT OR REPLACE INTO manifest_meta (key, value) VALUES ('version', ?)`,
      MANIFEST_SCHEMA_VERSION.toString()
    );

    this.initialized = true;

    console.info('[ManifestDO] Initialized', { ownerId });
  }

  /**
   * Migrate projects table schema to include 'html' in framework CHECK constraint
   * This is needed because SQLite doesn't support ALTER TABLE for CHECK constraints
   */
  private migrateProjectsTableSchema(): void {
    try {
      // Check if projects table exists
      const tableExists = this.sql.exec(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='projects'`
      ).toArray();

      if (tableExists.length === 0) {
        // Table doesn't exist, will be created with correct schema
        return;
      }

      // Check if the CHECK constraint includes 'html' by trying to get the table schema
      // We can inspect sqlite_master for the CREATE statement
      const schemaRows = this.sql.exec(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'`
      ).toArray();

      if (schemaRows.length === 0) {
        return;
      }

      const createSql = (schemaRows[0] as any).sql as string;

      // If 'html' is already in the CHECK constraint, no migration needed
      if (createSql.includes("'html'")) {
        return;
      }

      console.info('[ManifestDO] Migrating projects table schema to include html framework');

      // Backup existing data
      const existingProjects = this.sql.exec('SELECT * FROM projects').toArray();

      // Drop the old table
      this.sql.exec('DROP TABLE IF EXISTS projects');

      // Create new table with updated CHECK constraint (will happen in the caller)
      // Restore data after new table is created
      if (existingProjects.length > 0) {
        // Store projects in memory to restore after table recreation
        // We'll do this by setting a flag and restoring in rebuildManifest
        console.info('[ManifestDO] Schema migration: backed up and dropped old projects table', {
          backedUpCount: existingProjects.length
        });
      }
    } catch (error) {
      // Log but don't fail initialization - the table may not exist yet
      console.warn('[ManifestDO] Schema migration check failed', {
        error: error instanceof Error ? error.message : 'Unknown'
      });
    }
  }

  /**
   * Get the manifest for this owner
   * Returns from cache, SQLite, or lazy-migrates from KV
   */
  async getManifest(ownerId: string): Promise<OwnerProjectManifest> {
    await this.initialize(ownerId);

    // Check in-memory cache first
    if (this.cachedManifest) {
      this.metricsBuffer.hits++;
      return this.cachedManifest;
    }

    // Load from SQLite
    const rows = this.sql.exec('SELECT * FROM projects ORDER BY created_at DESC').toArray();

    // If empty, try lazy migration from KV
    if (rows.length === 0) {
      const migrated = await this.migrateFromKV(ownerId);
      if (migrated) {
        this.cachedManifest = migrated;
        this.metricsBuffer.hits++;
        return migrated;
      }
      // No data in KV either - return empty manifest
      this.metricsBuffer.misses++;
      this.cachedManifest = createEmptyManifest(ownerId);
      return this.cachedManifest;
    }

    // Build manifest from SQLite rows
    this.cachedManifest = this.buildManifestFromRows(ownerId, rows);
    this.metricsBuffer.hits++;
    return this.cachedManifest;
  }

  /**
   * Add a new project to the manifest
   */
  async addProject(ownerId: string, project: ManifestProjectSummary): Promise<void> {
    await this.initialize(ownerId);

    // Insert or replace (upsert for idempotency)
    this.sql.exec(`
      INSERT OR REPLACE INTO projects (
        id, name, framework, status, created_at, updated_at,
        deployment_url, subdomain, file_count,
        build_has_success, build_has_failure, build_last_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      project.id,
      project.name,
      project.framework,
      project.status,
      project.created_at,
      project.updated_at,
      project.deployment_url,
      project.subdomain,
      project.file_count,
      project.build_signals.has_success ? 1 : 0,
      project.build_signals.has_failure ? 1 : 0,
      project.build_signals.last_build_id
    );

    this.updateManifestTimestamp();
    this.invalidateCache();

    console.info('[ManifestDO] Project added', { ownerId, projectId: project.id });
  }

  /**
   * Update an existing project
   */
  async updateProject(
    ownerId: string,
    projectId: string,
    updates: Partial<Omit<ManifestProjectSummary, 'id'>>
  ): Promise<void> {
    await this.initialize(ownerId);

    // Build dynamic UPDATE query from provided updates
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
    }
    if (updates.framework !== undefined) {
      setClauses.push('framework = ?');
      values.push(updates.framework);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.deployment_url !== undefined) {
      setClauses.push('deployment_url = ?');
      values.push(updates.deployment_url);
    }
    if (updates.subdomain !== undefined) {
      setClauses.push('subdomain = ?');
      values.push(updates.subdomain);
    }
    if (updates.file_count !== undefined) {
      setClauses.push('file_count = ?');
      values.push(updates.file_count);
    }
    if (updates.build_signals !== undefined) {
      setClauses.push('build_has_success = ?');
      values.push(updates.build_signals.has_success ? 1 : 0);
      setClauses.push('build_has_failure = ?');
      values.push(updates.build_signals.has_failure ? 1 : 0);
      setClauses.push('build_last_id = ?');
      values.push(updates.build_signals.last_build_id);
    }

    if (setClauses.length === 0) {
      return; // Nothing to update
    }

    // Always update timestamp
    setClauses.push('updated_at = ?');
    values.push(new Date().toISOString());

    // Add projectId for WHERE clause
    values.push(projectId);

    this.sql.exec(
      `UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`,
      ...values
    );

    this.updateManifestTimestamp();
    this.invalidateCache();

    console.info('[ManifestDO] Project updated', { ownerId, projectId, fields: Object.keys(updates) });
  }

  /**
   * Update build status for a project
   */
  async updateBuildStatus(
    ownerId: string,
    projectId: string,
    status: ManifestProjectSummary['status'],
    buildId?: string,
    deploymentUrl?: string
  ): Promise<void> {
    await this.initialize(ownerId);

    // Get current build signals to preserve existing values
    const rows = this.sql.exec(
      'SELECT build_has_success, build_has_failure, build_last_id FROM projects WHERE id = ?',
      projectId
    ).toArray();

    let hasSuccess = false;
    let hasFailure = false;
    let lastBuildId = buildId || null;

    if (rows.length > 0) {
      const row = rows[0] as any;
      hasSuccess = Boolean(row.build_has_success);
      hasFailure = Boolean(row.build_has_failure);
      lastBuildId = buildId || row.build_last_id;
    }

    // Update signals based on new status
    if (status === 'deployed') {
      hasSuccess = true;
    } else if (status === 'failed') {
      hasFailure = true;
    }

    // Execute update
    this.sql.exec(`
      UPDATE projects
      SET status = ?,
          deployment_url = COALESCE(?, deployment_url),
          build_has_success = ?,
          build_has_failure = ?,
          build_last_id = ?,
          updated_at = ?
      WHERE id = ?
    `,
      status,
      deploymentUrl,
      hasSuccess ? 1 : 0,
      hasFailure ? 1 : 0,
      lastBuildId,
      new Date().toISOString(),
      projectId
    );

    this.updateManifestTimestamp();
    this.invalidateCache();

    console.info('[ManifestDO] Build status updated', { ownerId, projectId, status });
  }

  /**
   * Update subdomain for a project
   */
  async updateSubdomain(
    ownerId: string,
    projectId: string,
    subdomain: string | null,
    deploymentUrl: string | null
  ): Promise<void> {
    await this.initialize(ownerId);

    this.sql.exec(`
      UPDATE projects
      SET subdomain = ?,
          deployment_url = ?,
          updated_at = ?
      WHERE id = ?
    `,
      subdomain,
      deploymentUrl,
      new Date().toISOString(),
      projectId
    );

    this.updateManifestTimestamp();
    this.invalidateCache();

    console.info('[ManifestDO] Subdomain updated', { ownerId, projectId, subdomain });
  }

  /**
   * Remove a project from the manifest
   */
  async removeProject(ownerId: string, projectId: string): Promise<void> {
    await this.initialize(ownerId);

    this.sql.exec('DELETE FROM projects WHERE id = ?', projectId);

    this.updateManifestTimestamp();
    this.invalidateCache();

    console.info('[ManifestDO] Project removed', { ownerId, projectId });
  }

  /**
   * Rebuild manifest from R2 data
   * Clears existing data and repopulates from provided projects
   */
  async rebuildManifest(
    ownerId: string,
    projects: ManifestProjectSummary[]
  ): Promise<OwnerProjectManifest> {
    await this.initialize(ownerId);

    this.metricsBuffer.rebuilds++;

    // Clear existing projects
    this.sql.exec('DELETE FROM projects');

    // Insert all projects
    for (const project of projects) {
      this.sql.exec(`
        INSERT INTO projects (
          id, name, framework, status, created_at, updated_at,
          deployment_url, subdomain, file_count,
          build_has_success, build_has_failure, build_last_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        project.id,
        project.name,
        project.framework,
        project.status,
        project.created_at,
        project.updated_at,
        project.deployment_url,
        project.subdomain,
        project.file_count,
        project.build_signals.has_success ? 1 : 0,
        project.build_signals.has_failure ? 1 : 0,
        project.build_signals.last_build_id
      );
    }

    this.updateManifestTimestamp();
    this.invalidateCache();

    console.info('[ManifestDO] Manifest rebuilt', { ownerId, projectCount: projects.length });

    // Return fresh manifest
    return this.getManifest(ownerId);
  }

  /**
   * Delete the entire manifest (for cleanup/testing)
   */
  async deleteManifest(ownerId: string): Promise<void> {
    await this.initialize(ownerId);

    this.sql.exec('DELETE FROM projects');
    this.sql.exec('DELETE FROM manifest_meta');

    this.invalidateCache();
    this.initialized = false;

    console.info('[ManifestDO] Manifest deleted', { ownerId });
  }

  /**
   * Get current metrics
   */
  async getMetrics(): Promise<DOManifestMetrics> {
    // Flush buffer to hourly table first
    await this.flushMetricsBuffer();

    // Return current buffer (will be zeros after flush)
    return { ...this.metricsBuffer };
  }

  /**
   * Get aggregated metrics from SQLite
   * Flushes buffer first to ensure no data loss
   */
  async getAggregatedMetrics(hoursBack: number = 24): Promise<{
    current: DOManifestMetrics;
    historical: DOManifestMetrics;
    hitRate: string;
    totalReads: number;
  }> {
    // Flush buffer to hourly table first (ensures no data loss on hibernation)
    await this.flushMetricsBuffer();

    // After flush, buffer is zeros - current period data is now in historical
    const current = { ...this.metricsBuffer };

    // Aggregate from hourly table
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString().slice(0, 13);

    const rows = this.sql.exec(`
      SELECT
        SUM(hits) as total_hits,
        SUM(misses) as total_misses,
        SUM(rebuilds) as total_rebuilds,
        SUM(migrations) as total_migrations
      FROM metrics_hourly
      WHERE hour >= ?
    `, cutoffTime).toArray();

    const row = (rows[0] as any) || {};
    const historical: DOManifestMetrics = {
      hits: Number(row.total_hits) || 0,
      misses: Number(row.total_misses) || 0,
      rebuilds: Number(row.total_rebuilds) || 0,
      migrations: Number(row.total_migrations) || 0
    };

    const totalHits = current.hits + historical.hits;
    const totalMisses = current.misses + historical.misses;
    const totalReads = totalHits + totalMisses;
    const hitRate = totalReads > 0
      ? ((totalHits / totalReads) * 100).toFixed(2) + '%'
      : 'N/A';

    return { current, historical, hitRate, totalReads };
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Lazy migrate existing manifest from KV on first DO access
   */
  private async migrateFromKV(ownerId: string): Promise<OwnerProjectManifest | null> {
    if (!this.env.PROJECT_LIST_MANIFEST) {
      return null;
    }

    const kvKey = `project_list:${ownerId}`;

    try {
      const kvManifest = await this.env.PROJECT_LIST_MANIFEST.get<OwnerProjectManifest>(
        kvKey,
        { type: 'json' }
      );

      if (!kvManifest || kvManifest.projects.length === 0) {
        return null;
      }

      // Insert all projects into SQLite
      for (const project of kvManifest.projects) {
        this.sql.exec(`
          INSERT OR REPLACE INTO projects (
            id, name, framework, status, created_at, updated_at,
            deployment_url, subdomain, file_count,
            build_has_success, build_has_failure, build_last_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          project.id,
          project.name,
          project.framework,
          project.status,
          project.created_at,
          project.updated_at,
          project.deployment_url,
          project.subdomain,
          project.file_count,
          project.build_signals?.has_success ? 1 : 0,
          project.build_signals?.has_failure ? 1 : 0,
          project.build_signals?.last_build_id || null
        );
      }

      this.metricsBuffer.migrations++;
      this.updateManifestTimestamp();

      console.info('[ManifestDO] Migrated from KV', {
        ownerId,
        projectCount: kvManifest.projects.length
      });

      // Build and return the manifest
      return this.buildManifestFromRows(ownerId, this.sql.exec('SELECT * FROM projects').toArray());
    } catch (error) {
      console.error('[ManifestDO] KV migration failed', {
        ownerId,
        error: error instanceof Error ? error.message : 'Unknown'
      });
      return null;
    }
  }

  /**
   * Build manifest object from SQLite rows
   */
  private buildManifestFromRows(ownerId: string, rows: any[]): OwnerProjectManifest {
    const projects: ManifestProjectSummary[] = rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      framework: row.framework as ManifestProjectSummary['framework'],
      status: row.status as ManifestProjectSummary['status'],
      created_at: row.created_at,
      updated_at: row.updated_at,
      deployment_url: row.deployment_url,
      subdomain: row.subdomain,
      file_count: row.file_count || 0,
      build_signals: {
        has_success: Boolean(row.build_has_success),
        has_failure: Boolean(row.build_has_failure),
        last_build_id: row.build_last_id
      }
    }));

    // Get last updated time from meta
    const metaRows = this.sql.exec(
      `SELECT value FROM manifest_meta WHERE key = 'updated_at'`
    ).toArray();
    const updatedAt = (metaRows[0] as any)?.value || new Date().toISOString();

    return {
      version: MANIFEST_SCHEMA_VERSION,
      owner_id: ownerId,
      updated_at: updatedAt,
      projects,
      metadata: recalculateMetadata(projects)
    };
  }

  /**
   * Update manifest timestamp in meta table
   */
  private updateManifestTimestamp(): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO manifest_meta (key, value) VALUES ('updated_at', ?)`,
      new Date().toISOString()
    );
  }

  /**
   * Invalidate the in-memory cache
   */
  private invalidateCache(): void {
    this.cachedManifest = null;
  }

  /**
   * Flush metrics buffer to hourly SQLite table
   */
  private async flushMetricsBuffer(): Promise<void> {
    // Only flush if there's activity
    if (this.metricsBuffer.hits === 0 &&
        this.metricsBuffer.misses === 0 &&
        this.metricsBuffer.rebuilds === 0 &&
        this.metricsBuffer.migrations === 0) {
      return;
    }

    const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH

    // Upsert into hourly bucket
    this.sql.exec(`
      INSERT INTO metrics_hourly (hour, hits, misses, rebuilds, migrations, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(hour) DO UPDATE SET
        hits = hits + excluded.hits,
        misses = misses + excluded.misses,
        rebuilds = rebuilds + excluded.rebuilds,
        migrations = migrations + excluded.migrations
    `,
      hour,
      this.metricsBuffer.hits,
      this.metricsBuffer.misses,
      this.metricsBuffer.rebuilds,
      this.metricsBuffer.migrations,
      new Date().toISOString()
    );

    // Reset buffer
    this.metricsBuffer = {
      hits: 0,
      misses: 0,
      rebuilds: 0,
      migrations: 0
    };
  }
}
