/**
 * SubdomainService - Service for managing subdomain-to-project mappings
 * Implements KV-based subdomain routing for staging environment
 * Pattern: {project-name}-staging.gpthost.online → project_id
 */

import { Result, Ok, Err } from '../lib/result';
import { SubdomainError, SubdomainErrorCode } from '../lib/errors';
import type { KVNamespace } from '@cloudflare/workers-types';
import type { Env } from '../types/env';

/**
 * Subdomain metadata stored in KV
 * Structure changed from simple string to JSON object for multi-tenant support
 */
export interface SubdomainMetadata {
  projectId: string;
  userId: string;
  createdAt: string;
  isActive: boolean;
}

/**
 * Interface for subdomain service operations
 */
export interface ISubdomainService {
  /**
   * Register a subdomain mapping for a project
   * @param projectName - User-provided project name (will be sanitized)
   * @param projectId - UUID of the project
   * @param userId - User ID who owns this subdomain (for multi-tenant isolation)
   * @returns Result with void on success, SubdomainError on failure
   */
  registerSubdomain(projectName: string, projectId: string, userId?: string): Promise<Result<void, SubdomainError>>;

  /**
   * Get project ID from subdomain
   * @param subdomain - Full subdomain (e.g., "todo-app-staging")
   * @returns Result with project ID on success, SubdomainError on failure
   */
  getProjectIdFromSubdomain(subdomain: string): Promise<Result<string, SubdomainError>>;

  /**
   * Get subdomain from project ID (reverse lookup)
   * @param projectId - UUID of the project
   * @returns Result with subdomain on success (null if not found), SubdomainError on failure
   */
  getSubdomainForProject(projectId: string): Promise<Result<string | null, SubdomainError>>;

  /**
   * Delete a subdomain mapping
   * @param subdomain - Full subdomain to delete
   * @param userId - User ID requesting deletion (for ownership validation)
   * @returns Result with void on success, SubdomainError on failure
   */
  deleteSubdomain(subdomain: string, userId?: string): Promise<Result<void, SubdomainError>>;

  /**
   * Check if a subdomain is already registered
   * @param subdomain - Full subdomain to check
   * @returns Result with boolean on success, SubdomainError on failure
   */
  subdomainExists(subdomain: string): Promise<Result<boolean, SubdomainError>>;

  /**
   * Generate full subdomain from project name
   * @param projectName - User-provided project name
   * @returns Sanitized subdomain with environment suffix
   */
  generateSubdomain(projectName: string): string;
}

/**
 * SubdomainService implementation using Cloudflare KV
 */
export class SubdomainService implements ISubdomainService {
  private readonly kv: KVNamespace;
  private readonly subdomainSuffix: string;

  constructor(env: Env) {
    if (!env.SUBDOMAIN_MAPPINGS) {
      throw new Error('SUBDOMAIN_MAPPINGS KV namespace not configured');
    }
    this.kv = env.SUBDOMAIN_MAPPINGS;
    // CRITICAL: Use ?? instead of || so empty string (production) is valid
    // Production must have SUBDOMAIN_SUFFIX="" (empty), staging has "-staging"
    this.subdomainSuffix = env.SUBDOMAIN_SUFFIX ?? '';
  }

  /**
   * Sanitize project name to valid subdomain format
   * - Lowercase
   * - Replace spaces and underscores with hyphens
   * - Remove invalid characters
   * - Ensure starts and ends with alphanumeric
   */
  private sanitizeProjectName(projectName: string): string {
    return projectName
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, '-')  // Replace spaces/underscores with hyphens
      .replace(/[^a-z0-9-]/g, '')  // Remove invalid characters
      .replace(/^-+|-+$/g, '')  // Remove leading/trailing hyphens
      .replace(/-+/g, '-');  // Collapse multiple hyphens
  }

  /**
   * Validate subdomain format
   * - Must start and end with alphanumeric
   * - Can contain hyphens in the middle
   * - Length between 1 and 63 characters
   */
  private isValidSubdomain(subdomain: string): boolean {
    // Check length
    if (subdomain.length < 1 || subdomain.length > 63) {
      return false;
    }

    // Check format: start/end with alphanumeric, can contain hyphens
    const subdomainPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
    return subdomainPattern.test(subdomain);
  }

  /**
   * Normalize user input (project name or subdomain) into the full subdomain we store in KV
   * - Sanitizes the input
   * - Appends the environment suffix when not already present
   */
  normalizeSubdomainInput(input: string): string {
    const sanitized = this.sanitizeProjectName(input);

    if (!sanitized) return '';

    // Avoid double-appending the suffix if caller already provided it
    if (sanitized.endsWith(this.subdomainSuffix)) {
      return sanitized;
    }

    return `${sanitized}${this.subdomainSuffix}`;
  }

  /**
   * Generate full subdomain from project name
   * Example: "Todo App" → "todo-app-staging"
   */
  generateSubdomain(projectName: string): string {
    return this.normalizeSubdomainInput(projectName);
  }

  /**
   * Register a subdomain mapping in KV
   * Now stores JSON metadata instead of simple string for multi-tenant support
   */
  async registerSubdomain(
    projectName: string,
    projectId: string,
    userId?: string
  ): Promise<Result<void, SubdomainError>> {
    try {
      const subdomain = this.normalizeSubdomainInput(projectName);

      if (!subdomain) {
        return Err(new SubdomainError(
          SubdomainErrorCode.INVALID_NAME,
          'Subdomain cannot be empty after sanitization',
          { projectName }
        ));
      }

      // Validate subdomain format
      if (!this.isValidSubdomain(subdomain)) {
        return Err(new SubdomainError(
          SubdomainErrorCode.INVALID_NAME,
          `Invalid subdomain format: ${subdomain}`,
          { projectName, subdomain }
        ));
      }

      // Check if subdomain already exists
      const existsResult = await this.subdomainExists(subdomain);
      if (!existsResult.ok) {
        return existsResult;
      }

      if (existsResult.value) {
        return Err(new SubdomainError(
          SubdomainErrorCode.ALREADY_EXISTS,
          `Subdomain already registered: ${subdomain}`,
          { subdomain, projectName }
        ));
      }

      // Store mapping in KV: subdomain → JSON metadata
      const metadata: SubdomainMetadata = {
        projectId,
        userId: userId || 'legacy-user',  // Fallback for backward compatibility
        createdAt: new Date().toISOString(),
        isActive: true
      };

      await this.kv.put(subdomain, JSON.stringify(metadata));

      return Ok(undefined);
    } catch (error) {
      return Err(new SubdomainError(
        SubdomainErrorCode.KV_ERROR,
        `Failed to register subdomain: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectName, projectId },
        error instanceof Error ? error : undefined
      ));
    }
  }

  /**
   * Get project ID from subdomain
   * Handles both legacy string values and new JSON metadata
   */
  async getProjectIdFromSubdomain(
    subdomain: string
  ): Promise<Result<string, SubdomainError>> {
    try {
      const value = await this.kv.get(subdomain);

      if (!value) {
        return Err(new SubdomainError(
          SubdomainErrorCode.NOT_FOUND,
          `No project found for subdomain: ${subdomain}`,
          { subdomain }
        ));
      }

      // Try to parse as JSON (new format)
      try {
        const metadata: SubdomainMetadata = JSON.parse(value);
        return Ok(metadata.projectId);
      } catch {
        // Fallback: treat as legacy string format (projectId directly)
        return Ok(value);
      }
    } catch (error) {
      return Err(new SubdomainError(
        SubdomainErrorCode.KV_ERROR,
        `Failed to lookup subdomain: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { subdomain },
        error instanceof Error ? error : undefined
      ));
    }
  }

  /**
   * Get subdomain from project ID (reverse lookup)
   * Iterates through KV keys to find matching projectId
   */
  async getSubdomainForProject(
    projectId: string
  ): Promise<Result<string | null, SubdomainError>> {
    try {
      // List all KV keys (Cloudflare KV list operation)
      const listResult = await this.kv.list();

      // Iterate through keys and check values
      for (const key of listResult.keys) {
        const subdomain = key.name;
        const value = await this.kv.get(subdomain);

        if (!value) continue;

        // Try to parse as JSON (new format)
        try {
          const metadata: SubdomainMetadata = JSON.parse(value);
          if (metadata.projectId === projectId) {
            return Ok(subdomain);
          }
        } catch {
          // Legacy string format: check if value matches projectId directly
          if (value === projectId) {
            return Ok(subdomain);
          }
        }
      }

      // No matching subdomain found
      return Ok(null);
    } catch (error) {
      return Err(new SubdomainError(
        SubdomainErrorCode.KV_ERROR,
        `Failed to lookup project subdomain: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectId },
        error instanceof Error ? error : undefined
      ));
    }
  }

  /**
   * Delete subdomain mapping
   * Now includes ownership validation for multi-tenant support
   */
  async deleteSubdomain(
    subdomain: string,
    userId?: string
  ): Promise<Result<void, SubdomainError>> {
    try {
      // If userId provided, verify ownership
      if (userId) {
        const value = await this.kv.get(subdomain);

        if (!value) {
          return Err(new SubdomainError(
            SubdomainErrorCode.NOT_FOUND,
            `Subdomain not found: ${subdomain}`,
            { subdomain }
          ));
        }

        // Try to parse metadata to check ownership
        try {
          const metadata: SubdomainMetadata = JSON.parse(value);
          if (metadata.userId !== userId) {
            return Err(new SubdomainError(
              SubdomainErrorCode.UNAUTHORIZED,
              `Not authorized to delete subdomain: ${subdomain}`,
              { subdomain, userId }
            ));
          }
        } catch {
          // Legacy string format - skip ownership check for backward compatibility
          console.warn(`[SubdomainService] Legacy subdomain format detected for ${subdomain}, skipping ownership check`);
        }
      }

      // Delete subdomain
      await this.kv.delete(subdomain);
      return Ok(undefined);
    } catch (error) {
      return Err(new SubdomainError(
        SubdomainErrorCode.KV_ERROR,
        `Failed to delete subdomain: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { subdomain },
        error instanceof Error ? error : undefined
      ));
    }
  }

  /**
   * Build an in-memory map of projectId → subdomain for fast lookups
   * Used by list endpoints to avoid repeated KV scans per project card render
   */
  async listProjectSubdomainMap(): Promise<Result<Map<string, string>, SubdomainError>> {
    try {
      const mapping = new Map<string, string>();
      const listResult = await this.kv.list();

      for (const key of listResult.keys) {
        const subdomain = key.name;
        const value = await this.kv.get(subdomain);

        if (!value) continue;

        try {
          const metadata: SubdomainMetadata = JSON.parse(value);
          if (metadata.projectId) {
            mapping.set(metadata.projectId, subdomain);
          }
        } catch {
          // Legacy string format stores projectId directly
          mapping.set(value, subdomain);
        }
      }

      return Ok(mapping);
    } catch (error) {
      return Err(new SubdomainError(
        SubdomainErrorCode.KV_ERROR,
        `Failed to list subdomains: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        error instanceof Error ? error : undefined
      ));
    }
  }

  /**
   * Check if subdomain exists
   */
  async subdomainExists(subdomain: string): Promise<Result<boolean, SubdomainError>> {
    try {
      const projectId = await this.kv.get(subdomain);
      return Ok(projectId !== null);
    } catch (error) {
      return Err(new SubdomainError(
        SubdomainErrorCode.KV_ERROR,
        `Failed to check subdomain existence: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { subdomain },
        error instanceof Error ? error : undefined
      ));
    }
  }
}
