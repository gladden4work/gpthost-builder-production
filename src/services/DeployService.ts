/**
 * DeployService - GREEN phase implementation
 * Handles deployment of build artifacts to production and serves deployed sites
 * 
 * Following DAY5-TDD-STRATEGY.md v1.1 canonical specifications:
 * - Multi-bucket storage (builds and sites)
 * - SPA fallback support
 * - Security headers for HTML
 * - Path sanitization
 * - Content-type detection
 */

import { Result, Ok, Err } from '../lib/result';
import { DeploymentError, DeploymentErrorCode } from '../lib/errors';
import { IStorageService, IProjectService, IBuildService, ProjectStatus, IDeployService } from './interfaces';
import { getDeploymentUrl as getWorkerDeploymentUrl } from '../utils/workerUrl';
import { maybeInjectResourceProxy, isResourceProxyEnabled } from '../utils/resourceProxy';

// Constants (moved hardcoded values here for clarity and reuse)
const BUILD_STATUS_SUCCESS = 'success' as const;
const BUILDS_PREFIX = 'builds' as const;
const SITES_PREFIX = 'sites' as const;
const DEFAULT_DIST_DIR = 'dist' as const;
const SPA_INDEX_FILE = 'index.html' as const;
const DEPLOYMENT_METADATA_FILENAME = '_deployment.json' as const;
const JSON_CONTENT_TYPE = 'application/json' as const;
// Domain suffix is now determined by the worker URL dynamically

// Cache-Control header presets
const CACHE_CONTROL_HTML = 'no-cache, no-store, must-revalidate' as const;
const CACHE_CONTROL_ASSETS = 'public, max-age=31536000, immutable' as const;
const CACHE_CONTROL_DEFAULT = 'public, max-age=3600' as const;

type ServedContent = {
  body: ArrayBuffer;
  headers: Record<string, string>;
  contentType: string;
};

type DeploymentResult = {
  deploymentUrl: string;
  status: 'deployed';
  projectId: string;
  deployedAt: Date;
};

type ServeOptions = {
  spa?: boolean;
};

type GenerateUrlOptions = {
  customDomain?: string;
};

export class DeployService implements IDeployService {
  // Concurrency guard: track active deployments per project
  // NOTE: This only works within a single isolate. Cross-isolate safety requires
  // a Durable Object or storage-backed lock.
  private readonly activeDeployments = new Map<string, Promise<void>>();
  
  constructor(
    private readonly buildsStorage: IStorageService,
    private readonly sitesStorage: IStorageService,
    private readonly projectService: IProjectService,
    private readonly buildService: IBuildService,
    private readonly env?: Env
  ) {}

  /**
   * Deploy build artifacts from a specific R2 path
   * This method is used by GitHub callbacks to deploy directly from a known build path
   * without requiring BuildService metadata
   */
  async deployBuildFromPath(projectId: string, buildPath: string): Promise<Result<DeploymentResult, DeploymentError>> {
    try {
      // Concurrency guard: serialize deployments per project within this isolate
      const existingDeployment = this.activeDeployments.get(projectId);
      
      if (existingDeployment) {
        // Wait for the existing deployment to complete before proceeding
        await existingDeployment;
      }
      
      // Create a promise that represents this deployment operation
      let deploymentResolve: () => void;
      const deploymentPromise = new Promise<void>((resolve) => {
        deploymentResolve = resolve;
      });
      
      // Mark this project as having an active deployment
      this.activeDeployments.set(projectId, deploymentPromise);
      
      try {
        // Ensure the build path ends with a trailing slash for directory operations
        const normalizedBuildPath = buildPath.endsWith('/') ? buildPath : `${buildPath}/`;
        
        // Determine source storage for artifacts: prefer BUILDS bucket, then DEPLOYMENTS bucket
        let sourceStorage: IStorageService | null = null;
        // R2 does not have directory objects; use listFiles to detect presence
        const buildsList = await this.buildsStorage.listFiles(normalizedBuildPath, { maxKeys: 1 });
        if (buildsList.ok && buildsList.value.length > 0) {
          sourceStorage = this.buildsStorage;
        } else {
          const deploymentsList = await this.sitesStorage.listFiles(normalizedBuildPath, { maxKeys: 1 });
          if (deploymentsList.ok && deploymentsList.value.length > 0) {
            sourceStorage = this.sitesStorage;
          }
        }

        if (!sourceStorage) {
          return Err(new DeploymentError(
            DeploymentErrorCode.INVALID_ARTIFACTS,
            `Build artifacts not found at ${normalizedBuildPath}`,
            { projectId, buildPath: normalizedBuildPath }
          ));
        }
        
        // Define the target site path
        const sitePath = this.getSitePath(projectId);
        
        // Copy artifacts from build path to site path
        const copyResult = await this.copyDirectoryBetweenStorages(sourceStorage, this.sitesStorage, normalizedBuildPath, sitePath);
        if (!copyResult.ok) {
          return Err(new DeploymentError(
            DeploymentErrorCode.INVALID_ARTIFACTS,
            `Failed to copy artifacts to sites: ${copyResult.error.message}`,
            { projectId, source: normalizedBuildPath, destination: sitePath },
            copyResult.error
          ));
        }
        
        // Write deployment metadata for traceability
        const metadata = {
          projectId,
          buildPath: normalizedBuildPath,
          deployedAt: new Date().toISOString(),
          deploymentUrl: this.generateDeploymentUrl(projectId),
          status: 'deployed',
          deployedFrom: 'github-callback'
        };
        
        await this.writeDeploymentMetadata(sitePath, metadata);
        
        // Update project status to deployed
        await this.updateProjectPostDeployment(projectId);
        
        // Return success result
        return Ok({
          deploymentUrl: this.generateDeploymentUrl(projectId),
          status: 'deployed',
          projectId,
          deployedAt: new Date()
        });
        
      } finally {
        // Clean up: remove from active deployments and resolve the promise
        this.activeDeployments.delete(projectId);
        deploymentResolve!();
      }
    } catch (error) {
      return Err(new DeploymentError(
        DeploymentErrorCode.INVALID_ARTIFACTS,
        `Unexpected error during deployment: ${(error as Error).message}`,
        { projectId, buildPath },
        error as Error
      ));
    }
  }

  /**
   * Copy directory from one storage service to another
   */
  private async copyDirectoryBetweenStorages(
    source: IStorageService,
    destination: IStorageService,
    sourcePrefix: string,
    destinationPrefix: string
  ): Promise<Result<void, DeploymentError>> {
    try {
      const listResult = await source.listFiles(sourcePrefix);
      if (!listResult.ok) {
        return Err(new DeploymentError(
          DeploymentErrorCode.INVALID_ARTIFACTS,
          `Failed to list source files: ${listResult.error.message}`
        ));
      }

      for (const file of listResult.value) {
        const srcKey = file.key;
        const dstKey = srcKey.replace(sourcePrefix, destinationPrefix);

        const download = await source.downloadFile(srcKey);
        if (!download.ok) {
          return Err(new DeploymentError(
            DeploymentErrorCode.INVALID_ARTIFACTS,
            `Failed to read ${srcKey}: ${download.error.message}`
          ));
        }

        const meta = await source.getMetadata(srcKey);
        const metadata: Record<string, string> | undefined = meta.ok && meta.value.customMetadata
          ? meta.value.customMetadata
          : undefined;

        const upload = await destination.uploadFile(dstKey, download.value, metadata);
        if (!upload.ok) {
          return Err(new DeploymentError(
            DeploymentErrorCode.INVALID_ARTIFACTS,
            `Failed to write ${dstKey}: ${upload.error.message}`
          ));
        }
      }

      return Ok(undefined);
    } catch (e: any) {
      return Err(new DeploymentError(
        DeploymentErrorCode.INVALID_ARTIFACTS,
        `Copy failed: ${e?.message || String(e)}`
      ));
    }
  }

  /**
   * Deploy build artifacts to production sites storage
   * Copies from builds/{projectId}/dist/ to sites/{projectId}/
   */
  async deployBuild(buildId: string): Promise<Result<DeploymentResult, DeploymentError>> {
    try {
      // 1. Get build status and validate it's ready for deployment
      const buildStatusResult = await this.buildService.getBuildStatus(buildId);
      if (!buildStatusResult.ok) {
        return Err(new DeploymentError(
          DeploymentErrorCode.BUILD_NOT_READY,
          `Build ${buildId} not found or not ready`,
          { buildId }
        ));
      }

      const buildStatus = buildStatusResult.value;
      
      // Concurrency guard: serialize deployments per project within this isolate
      const projectId = buildStatus.projectId;
      const existingDeployment = this.activeDeployments.get(projectId);
      
      if (existingDeployment) {
        // Wait for the existing deployment to complete before proceeding
        await existingDeployment;
      }
      
      // Create a promise that represents this deployment operation
      let deploymentResolve: () => void;
      const deploymentPromise = new Promise<void>((resolve) => {
        deploymentResolve = resolve;
      });
      
      // Mark this project as having an active deployment
      this.activeDeployments.set(projectId, deploymentPromise);
      
      try {
        // Perform the actual deployment
        const result = await this.performDeployment(buildStatus, buildId);
        return result;
      } finally {
        // Clean up: remove from active deployments and resolve the promise
        this.activeDeployments.delete(projectId);
        deploymentResolve!();
      }
    } catch (error) {
      return Err(new DeploymentError(
        DeploymentErrorCode.INVALID_ARTIFACTS,
        `Unexpected error during deployment: ${(error as Error).message}`,
        { buildId },
        error as Error
      ));
    }
  }
  
  /**
   * Internal method that performs the actual deployment
   */
  private async performDeployment(
    buildStatus: any,
    buildId: string
  ): Promise<Result<DeploymentResult, DeploymentError>> {
    // Check if build is successful
    const successful = this.isBuildSuccessful(buildStatus?.status);
    if (!successful) {
      return Err(new DeploymentError(
        DeploymentErrorCode.BUILD_NOT_READY,
        `Build ${buildId} is not successful (status: ${buildStatus?.status})`,
        { buildId, status: buildStatus?.status }
      ));
    }

    // Resolve paths and verify artifacts
    const artifactPath = this.getArtifactPath(buildStatus);
    const sitePath = this.getSitePath(buildStatus.projectId);

    const artifactsOk = await this.verifyArtifactsExist(artifactPath, buildId);
    if (!artifactsOk.ok) return artifactsOk;

    // Copy artifacts
    const copyOk = await this.copyArtifactsToSite(artifactPath, sitePath, buildId);
    if (!copyOk.ok) return copyOk;

    // Best-effort: write deployment metadata for traceability
    await this.writeDeploymentMetadata(sitePath, this.buildDeploymentMetadata(buildStatus, artifactPath, buildId));

    // Update project (non-fatal on failure)
    await this.updateProjectPostDeployment(buildStatus.projectId);

    // Return success result
    return Ok({
      deploymentUrl: this.generateDeploymentUrl(buildStatus.projectId),
      status: 'deployed',
      projectId: buildStatus.projectId,
      deployedAt: new Date()
    });
  }

  /**
   * Serve site content with SPA fallback and security headers
   */
  async serveSite(
    projectId: string, 
    path: string, 
    options: ServeOptions = {}
  ): Promise<Result<ServedContent, DeploymentError>> {
    try {
      // 1. Sanitize path to prevent traversal attacks
      const sanitizedPath = this.sanitizePath(path);
      if (!sanitizedPath) {
        return Err(new DeploymentError(
          DeploymentErrorCode.NOT_FOUND,
          `Invalid path: ${path}`,
          { projectId, path }
        ));
      }

      // 2. Build full file path
      let filePath = `${SITES_PREFIX}/${projectId}/${sanitizedPath}`;
      let effectivePath = filePath;
      
      // 3. Try to download the requested file
      let downloadResult = await this.sitesStorage.downloadFile(filePath);
      
      // 4. Handle SPA fallback for missing routes
      if (!downloadResult.ok && options.spa && !this.hasFileExtension(sanitizedPath)) {
        // For SPA mode, try serving index.html for missing routes
        const indexPath = `${SITES_PREFIX}/${projectId}/${SPA_INDEX_FILE}`;
        downloadResult = await this.sitesStorage.downloadFile(indexPath);
        effectivePath = indexPath;
        
        if (!downloadResult.ok) {
          return Err(new DeploymentError(
            DeploymentErrorCode.NOT_FOUND,
            `Index file not found for SPA fallback`,
            { projectId, requestedPath: path, indexPath }
          ));
        }
      } else if (!downloadResult.ok) {
        return Err(new DeploymentError(
          DeploymentErrorCode.NOT_FOUND,
          `File not found: ${filePath}`,
          { projectId, path: filePath }
        ));
      }

      // 5. Get content type
      const contentType = await this.getContentType(effectivePath, projectId);

      // 6. Build headers based on content type
      const headers = this.buildHeaders(contentType);

      // 7. Apply subpath hotfix for index.html
      let bodyBuffer = downloadResult.value;
      if (
        effectivePath.endsWith(SPA_INDEX_FILE) &&
        contentType === 'text/html'
      ) {
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const html = decoder.decode(bodyBuffer);
        const rewrite = this.rewriteHtmlForSubpath(html, projectId);
        if (rewrite.rewritten) {
          bodyBuffer = encoder.encode(rewrite.html).buffer;
          headers['X-GPThost-BasePath-Rewrite'] = 'true';
          console.log(JSON.stringify({
            event: 'basepath_rewrite',
            projectId,
            path: effectivePath,
          }));
        }

      }

      if (contentType === 'text/html' && this.env && isResourceProxyEnabled(this.env)) {
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const injected = await maybeInjectResourceProxy(decoder.decode(bodyBuffer), projectId, this.env);
        if (injected) {
          bodyBuffer = encoder.encode(injected).buffer;
          headers['X-GPThost-Resource-Proxy'] = 'injected';
        }
      }

      // 8. Return served content
      return Ok({
        body: bodyBuffer,
        headers,
        contentType
      });

    } catch (error) {
      return Err(new DeploymentError(
        DeploymentErrorCode.NOT_FOUND,
        `Error serving site: ${(error as Error).message}`,
        { projectId, path },
        error as Error
      ));
    }
  }

  /**
   * Generate deployment URL with sanitization
   */
  generateDeploymentUrl(projectId: string, options: GenerateUrlOptions = {}): string {
    if (options.customDomain) {
      return `https://${options.customDomain}`;
    }
    
    // Use the centralized workerUrl utility to generate proper deployment URLs
    // This ensures URLs work in both staging and production environments
    // If env is not available, create a minimal env object for the utility
    const envForUrl = this.env || {} as Env;
    return getWorkerDeploymentUrl(projectId, envForUrl);
  }

  /**
   * Sanitize path to prevent directory traversal
   */
  private sanitizePath(path: string): string | null {
    // Remove leading slashes
    let sanitized = path.replace(/^\/+/, '');
    
    // Check for traversal attempts
    if (sanitized.includes('..')) {
      return null;
    }
    
    // Collapse multiple consecutive slashes into single slash
    sanitized = sanitized.replace(/\/+/g, '/');
    
    // Remove trailing slashes except for empty path
    if (sanitized.length > 0) {
      sanitized = sanitized.replace(/\/+$/, '');
    }
    
    return sanitized;
  }

  /**
   * Determine if path has a file extension
   */
  private hasFileExtension(path: string): boolean {
    const lastSegment = path.split('/').pop() || '';
    return lastSegment.includes('.');
  }

  /**
   * Get content type for a file
   */
  private async getContentType(filePath: string, projectId: string): Promise<string> {
    // Try to get metadata first
    const metadataResult = await this.sitesStorage.getMetadata(filePath);
    if (metadataResult.ok && metadataResult.value.contentType) {
      return metadataResult.value.contentType;
    }
    
    // Fallback to extension-based detection
    return this.getContentTypeByExtension(filePath);
  }

  /**
   * Get content type based on file extension
   */
  private getContentTypeByExtension(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    
    const contentTypes: Record<string, string> = {
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'mjs': 'application/javascript',
      'json': 'application/json',
      'svg': 'image/svg+xml',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'ico': 'image/x-icon',
      'webp': 'image/webp',
      'woff': 'font/woff',
      'woff2': 'font/woff2',
      'ttf': 'font/ttf',
      'otf': 'font/otf',
      'txt': 'text/plain',
      'xml': 'application/xml',
      'pdf': 'application/pdf'
    };
    
    return contentTypes[ext] || 'application/octet-stream';
  }

  /**
   * Inject <base> tag and rewrite root-relative asset paths for subpath hosting
   */
  private rewriteHtmlForSubpath(html: string, projectId: string): { html: string; rewritten: boolean } {
    const baseHref = `/sites/${projectId}/`;
    let updated = html;
    let rewritten = false;

    // First, convert absolute asset paths to relative paths
    // But specifically exclude base tag hrefs from this replacement
    const replaced = updated.replace(/<(?!base\b)[^>]+(src|href)="\/(?!\/)([^"']*)"/gi, (match, attr, path) => {
      return match.replace(`${attr}="/${path}"`, `${attr}="./${path}"`);
    });
    if (replaced !== updated) {
      rewritten = true;
      updated = replaced;
    }

    // Then inject base tag if not present (AFTER path rewriting to avoid base href being modified)
    if (!/<base\s+href=/i.test(updated)) {
      updated = updated.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`);
      rewritten = true;
    }

    return { html: updated, rewritten };
  }

  /**
   * Build response headers based on content type
   */
  private buildHeaders(contentType: string): Record<string, string> {
    const headers: Record<string, string> = {};
    headers['Content-Type'] = contentType;
    
    // Add security headers for HTML
    if (contentType.includes('text/html')) {
      headers['X-Content-Type-Options'] = 'nosniff';
      headers['X-Frame-Options'] = 'SAMEORIGIN';
      headers['X-XSS-Protection'] = '1; mode=block';
      headers['Cache-Control'] = CACHE_CONTROL_HTML;
    } 
    // Add cache headers for assets
    else if (
      contentType.includes('css') || 
      contentType.includes('javascript') || 
      contentType.includes('image') ||
      contentType.includes('font')
    ) {
      headers['Cache-Control'] = CACHE_CONTROL_ASSETS;
    }
    // Default cache control
    else {
      headers['Cache-Control'] = CACHE_CONTROL_DEFAULT;
    }
    
    return headers;
  }

  // ----- Helper methods (extracted for readability) -----

  private isBuildSuccessful(status: string): boolean {
    return status === BUILD_STATUS_SUCCESS;
  }

  private getArtifactPath(buildStatus: { projectId: string; artifactPath?: string }): string {
    return buildStatus.artifactPath || `${BUILDS_PREFIX}/${buildStatus.projectId}/${DEFAULT_DIST_DIR}/`;
  }

  private getSitePath(projectId: string): string {
    return `${SITES_PREFIX}/${projectId}/`;
  }

  private async verifyArtifactsExist(artifactPath: string, buildId: string): Promise<Result<true, DeploymentError>> {
    const existsResult = await this.buildsStorage.exists(artifactPath);
    if (!existsResult.ok || !existsResult.value) {
      return Err(new DeploymentError(
        DeploymentErrorCode.INVALID_ARTIFACTS,
        `Build artifacts not found at ${artifactPath}`,
        { buildId, artifactPath }
      ));
    }
    return Ok(true as const);
  }

  private async copyArtifactsToSite(
    artifactPath: string,
    sitePath: string,
    buildId: string
  ): Promise<Result<true, DeploymentError>> {
    const copyResult = await this.sitesStorage.copyDirectory(artifactPath, sitePath);
    if (!copyResult.ok) {
      return Err(new DeploymentError(
        DeploymentErrorCode.INVALID_ARTIFACTS,
        `Failed to copy artifacts to sites: ${copyResult.error.message}`,
        { buildId, source: artifactPath, destination: sitePath },
        copyResult.error
      ));
    }
    return Ok(true as const);
  }

  private buildDeploymentMetadata(
    buildStatus: { projectId: string; buildId?: string },
    artifactPath: string,
    fallbackBuildId: string
  ) {
    return {
      projectId: buildStatus.projectId,
      buildId: (buildStatus as any).buildId || fallbackBuildId,
      artifactPath,
      deployedAt: new Date().toISOString(),
      deploymentUrl: this.generateDeploymentUrl(buildStatus.projectId),
      status: 'deployed'
    };
  }

  private async writeDeploymentMetadata(sitePath: string, metadata: any): Promise<void> {
    try {
      await this.sitesStorage.uploadFile(
        `${sitePath}${DEPLOYMENT_METADATA_FILENAME}`,
        new TextEncoder().encode(JSON.stringify(metadata)).buffer,
        { contentType: JSON_CONTENT_TYPE }
      );
    } catch (e) {
      // Non-fatal: log and continue
      console.warn('Failed to write deployment metadata', e);
    }
  }

  private async updateProjectPostDeployment(projectId: string): Promise<void> {
    const updateResult = await this.projectService.updateProject(projectId, {
      status: ProjectStatus.DEPLOYED,
      deploymentUrl: this.generateDeploymentUrl(projectId),
      deployedAt: new Date()
    });
    if (!updateResult.ok) {
      // Log error but don't fail deployment - it's already deployed
      console.error('Failed to update project status:', updateResult.error);
    }
  }
}
