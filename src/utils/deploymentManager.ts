/**
 * Deployment Manager - TASK-018
 * 
 * Core system for managing deployment pipeline that takes built applications 
 * from BUILDS_BUCKET and serves them as live websites from DEPLOYMENTS_BUCKET.
 * 
 * Handles:
 * - Moving build artifacts from BUILDS_BUCKET to public serving location
 * - Generating unique deployment URLs for each project
 * - Configuring CDN serving with proper cache headers and MIME types
 * - Managing deployment metadata and versioning
 */

import { getWorkerUrl } from './workerUrl';

/**
 * Deployment result from deployment process
 */
export interface DeploymentResult {
  success: boolean;
  url: string;
  deploymentId: string;
  timestamp: string;
  filesDeployed: number;
  totalSize: number;
  buildPath: string; // Original build path in BUILDS_BUCKET
  deploymentPath: string; // New deployment path in DEPLOYMENTS_BUCKET
  error?: {
    code: string;
    message: string;
    details: any;
  };
}

/**
 * Deployment status information
 */
export interface DeploymentStatus {
  projectId: string;
  status: 'not_deployed' | 'deploying' | 'deployed' | 'failed';
  url?: string;
  deploymentId?: string;
  deployedAt?: string;
  filesDeployed?: number;
  totalSize?: number;
  lastError?: {
    code: string;
    message: string;
    timestamp: string;
  };
}

/**
 * Serving configuration for CDN and caching
 */
export interface ServingConfig {
  domain: string;
  pathPrefix: string;
  cacheControl: {
    html: string;
    assets: string;
    images: string;
    default: string;
  };
  compression: boolean;
  security: {
    cors: boolean;
    headers: Record<string, string>;
  };
}

/**
 * Deployment metadata stored with deployment
 */
export interface DeploymentMetadata {
  projectId: string;
  deploymentId: string;
  deploymentTimestamp: string;
  buildPath: string;
  deploymentPath: string;
  url: string;
  filesDeployed: number;
  totalSize: number;
  artifacts: Array<{
    path: string;
    size: number;
    hash: string;
    contentType: string;
    compressed: boolean;
  }>;
  servingConfig: ServingConfig;
  version: string; // Deployment format version
}

/**
 * Core deployment manager interface
 */
export interface DeploymentManager {
  deployProject(projectId: string, buildId?: string): Promise<DeploymentResult>;
  /**
   * Deploy static site directly from original uploaded files (HTML/CSS/JS/assets)
   * Bypasses build pipeline entirely.
   */
  deployStaticSite(projectId: string): Promise<DeploymentResult>;
  getDeploymentStatus(projectId: string): Promise<DeploymentStatus>;
  getDeploymentURL(projectId: string): Promise<string | null>;
  removeDeployment(projectId: string): Promise<boolean>;
  listProjectBuilds(projectId: string): Promise<string[]>;
  validateBuildExists(projectId: string, buildId?: string): Promise<boolean>;
}

/**
 * Production Deployment Manager Implementation
 * 
 * This implementation handles the complete deployment pipeline from
 * build artifacts to live websites with CDN serving.
 */
export class R2DeploymentManager implements DeploymentManager {
  private env: Env;
  private servingConfig: ServingConfig;
  
  constructor(env: Env, customDomain?: string) {
    this.env = env;
    this.servingConfig = {
      domain: customDomain || env.DEPLOYMENT_DOMAIN || 'gpthost-deployments-staging.r2.dev',
      pathPrefix: 'sites',
      cacheControl: {
        html: 'public, max-age=3600, s-maxage=3600', // 1 hour for HTML
        assets: 'public, max-age=31536000, s-maxage=31536000, immutable', // 1 year for assets with hash
        images: 'public, max-age=86400, s-maxage=86400', // 1 day for images
        default: 'public, max-age=3600, s-maxage=3600' // 1 hour default
      },
      compression: true,
      security: {
        cors: true,
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'X-XSS-Protection': '1; mode=block',
          'Referrer-Policy': 'strict-origin-when-cross-origin'
        }
      }
    };
  }

  /**
   * Acquire deployment lock to prevent concurrent deployments for the same project
   */
  private async acquireDeploymentLock(projectId: string): Promise<boolean> {
    const lockKey = `deployment-lock/${projectId}`;
    const existing = await this.env.DEPLOYMENTS_BUCKET.get(lockKey);
    if (existing) return false;
    
    await this.env.DEPLOYMENTS_BUCKET.put(lockKey, 'locked', {
      httpMetadata: { cacheControl: 'max-age=300' } // 5 minute lock
    });
    return true;
  }

  /**
   * Release deployment lock for a project
   */
  private async releaseDeploymentLock(projectId: string): Promise<void> {
    const lockKey = `deployment-lock/${projectId}`;
    await this.env.DEPLOYMENTS_BUCKET.delete(lockKey);
  }

  /**
   * Deploy a project by copying build artifacts to public serving location
   */
  async deployProject(projectId: string, buildId?: string): Promise<DeploymentResult> {
    const startTime = Date.now();
    const deploymentId = this.generateDeploymentId();
    const deploymentTimestamp = new Date().toISOString();
    
    // Acquire deployment lock to prevent concurrent deployments
    const lockAcquired = await this.acquireDeploymentLock(projectId);
    if (!lockAcquired) {
      return {
        success: false,
        url: '',
        deploymentId,
        timestamp: deploymentTimestamp,
        filesDeployed: 0,
        totalSize: 0,
        buildPath: '',
        deploymentPath: '',
        error: {
          code: 'DEPLOYMENT_IN_PROGRESS',
          message: `Another deployment is currently in progress for project ${projectId}`,
          details: { projectId, buildId }
        }
      };
    }
    
    try {
      // Find the build to deploy (latest if buildId not specified)
      const buildPath = buildId || await this.findLatestBuild(projectId);
      if (!buildPath) {
        // Release deployment lock
        await this.releaseDeploymentLock(projectId);
        return {
          success: false,
          url: '',
          deploymentId,
          timestamp: deploymentTimestamp,
          filesDeployed: 0,
          totalSize: 0,
          buildPath: '',
          deploymentPath: '',
          error: {
            code: 'NO_BUILD_FOUND',
            message: `No completed builds found for project ${projectId}`,
            details: { projectId, buildId }
          }
        };
      }

      // Load build manifest to understand what to deploy
      const manifest = await this.loadBuildManifest(buildPath);
      if (!manifest) {
        // Release deployment lock
        await this.releaseDeploymentLock(projectId);
        return {
          success: false,
          url: '',
          deploymentId,
          timestamp: deploymentTimestamp,
          filesDeployed: 0,
          totalSize: 0,
          buildPath,
          deploymentPath: '',
          error: {
            code: 'INVALID_BUILD',
            message: `Build manifest not found or corrupted for build ${buildPath}`,
            details: { projectId, buildPath }
          }
        };
      }

      // Generate deployment path and URL
      const deploymentPath = `${this.servingConfig.pathPrefix}/${projectId}`;
      
      // CRITICAL FIX: Always use Workers URL for serving, never direct R2 URLs
      // R2 public buckets cannot handle path-based routing like /sites/{projectId}/
      // All traffic must go through Workers which handles the routing logic
      
      // Use shared utility for consistent Worker URL generation
      const workersUrl = getWorkerUrl(this.env);
      const deploymentUrl = `${workersUrl}/${deploymentPath}/`;

      // Copy build artifacts to deployment location
      let filesDeployed = 0;
      let totalSize = 0;

      for (const artifact of manifest.artifacts) {
        const sourcePath = `${buildPath}/${artifact.path}`;
        const destPath = `${deploymentPath}/${artifact.path}`;

        // Get artifact from builds bucket
        const artifactObject = await this.env.BUILDS_BUCKET.get(sourcePath);
        if (!artifactObject) {
          console.warn(`Artifact not found: ${sourcePath}`);
          continue;
        }

        // Verify content hash matches manifest during deployment
        let actualContent: ArrayBuffer;
        if (typeof (artifactObject as any).arrayBuffer === 'function') {
          // Real R2 object
          actualContent = await artifactObject.arrayBuffer();
        } else {
          // Mock object or string content
          const textContent = typeof artifactObject.body === 'string' 
            ? artifactObject.body 
            : await artifactObject.text();
          actualContent = new TextEncoder().encode(textContent);
        }
        
        const actualHash = await crypto.subtle.digest('SHA-256', actualContent);
        const actualHashHex = Buffer.from(actualHash).toString('hex');
        if (actualHashHex !== artifact.hash) {
          console.warn(`Hash mismatch for artifact: ${artifact.path}. Expected: ${artifact.hash}, Got: ${actualHashHex}`);
          // Continue deployment but log discrepancy
        }

        // Determine cache control headers based on file type
        const cacheControl = this.getCacheControlForFile(artifact.path, artifact.contentType);

        // Copy to deployments bucket with serving configuration
        const deploymentContent = typeof (artifactObject as any).arrayBuffer === 'function' 
          ? actualContent 
          : artifactObject.body;
        
        await this.env.DEPLOYMENTS_BUCKET.put(
          destPath,
          deploymentContent,
          {
            httpMetadata: {
              contentType: artifact.contentType,
              cacheControl,
              contentEncoding: artifact.compressed ? 'gzip' : undefined,
              ...this.servingConfig.security.headers
            },
            customMetadata: {
              project_id: projectId,
              deployment_id: deploymentId,
              deployed_at: deploymentTimestamp,
              original_build_path: buildPath,
              artifact_hash: artifact.hash,
              file_size: artifact.size.toString()
            }
          }
        );

        filesDeployed++;
        totalSize += artifact.size;
      }

      // Create deployment metadata
      const deploymentMetadata: DeploymentMetadata = {
        projectId,
        deploymentId,
        deploymentTimestamp,
        buildPath,
        deploymentPath,
        url: deploymentUrl,
        filesDeployed,
        totalSize,
        artifacts: manifest.artifacts,
        servingConfig: this.servingConfig,
        version: '1.0'
      };

      // Store deployment metadata
      await this.env.DEPLOYMENTS_BUCKET.put(
        `${deploymentPath}/.deployment.json`,
        JSON.stringify(deploymentMetadata, null, 2),
        {
          httpMetadata: {
            contentType: 'application/json',
            cacheControl: this.servingConfig.cacheControl.default
          },
          customMetadata: {
            project_id: projectId,
            deployment_id: deploymentId,
            deployed_at: deploymentTimestamp,
            type: 'deployment_metadata'
          }
        }
      );

      // Update project metadata with deployment information
      await this.updateProjectDeploymentStatus(projectId, 'deployed', deploymentUrl, deploymentId);

      const duration = Date.now() - startTime;
      console.info(`[DEPLOYMENT] Successfully deployed project ${projectId} in ${duration}ms`);
      console.info(`[DEPLOYMENT] Files deployed: ${filesDeployed}, Total size: ${(totalSize / 1024).toFixed(2)}KB`);
      console.info(`[DEPLOYMENT] Live URL: ${deploymentUrl}`);

      // Release deployment lock
      await this.releaseDeploymentLock(projectId);

      return {
        success: true,
        url: deploymentUrl,
        deploymentId,
        timestamp: deploymentTimestamp,
        filesDeployed,
        totalSize,
        buildPath,
        deploymentPath
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DEPLOYMENT] Error deploying project ${projectId}:`, error);

      // Update project status to failed
      await this.updateProjectDeploymentStatus(projectId, 'failed', '', '', errorMessage);

      // Release deployment lock
      await this.releaseDeploymentLock(projectId);

      return {
        success: false,
        url: '',
        deploymentId,
        timestamp: deploymentTimestamp,
        filesDeployed: 0,
        totalSize: 0,
        buildPath: buildId || '',
        deploymentPath: '',
        error: {
          code: 'DEPLOYMENT_FAILED',
          message: errorMessage,
          details: { projectId, buildId, error }
        }
      };
    }
  }

  /**
   * Deploy static site by copying original uploaded files to the deployments bucket.
   * Handles index resolution and content types.
   */
  async deployStaticSite(projectId: string): Promise<DeploymentResult> {
    const startTime = Date.now();
    const deploymentId = this.generateDeploymentId();
    const deploymentTimestamp = new Date().toISOString();

    // Acquire deployment lock
    const lockAcquired = await this.acquireDeploymentLock(projectId);
    if (!lockAcquired) {
      return {
        success: false,
        url: '',
        deploymentId,
        timestamp: deploymentTimestamp,
        filesDeployed: 0,
        totalSize: 0,
        buildPath: '',
        deploymentPath: '',
        error: {
          code: 'DEPLOYMENT_IN_PROGRESS',
          message: `Another deployment is currently in progress for project ${projectId}`,
          details: { projectId }
        }
      };
    }

    try {
      // Load project metadata
      const metadataObject = await this.env.PROJECTS_BUCKET.get(`projects/${projectId}/metadata.json`);
      if (!metadataObject) {
        await this.releaseDeploymentLock(projectId);
        return {
          success: false,
          url: '',
          deploymentId,
          timestamp: deploymentTimestamp,
          filesDeployed: 0,
          totalSize: 0,
          buildPath: '',
          deploymentPath: '',
          error: {
            code: 'PROJECT_NOT_FOUND',
            message: `Project metadata not found for ${projectId}`,
            details: { projectId }
          }
        };
      }

      const projectMetadata = JSON.parse(await metadataObject.text());
      const files: Array<{ name: string; path: string; type?: string }> = projectMetadata.files || [];
      if (!files || files.length === 0) {
        await this.releaseDeploymentLock(projectId);
        return {
          success: false,
          url: '',
          deploymentId,
          timestamp: deploymentTimestamp,
          filesDeployed: 0,
          totalSize: 0,
          buildPath: '',
          deploymentPath: '',
          error: {
            code: 'NO_FILES',
            message: `No source files found to deploy for project ${projectId}`,
            details: { projectId }
          }
        };
      }

      // Determine deployment path and URL
      const deploymentPath = `${this.servingConfig.pathPrefix}/${projectId}`;
      
      // CRITICAL FIX: Always use Workers URL for serving, never direct R2 URLs
      // R2 public buckets cannot handle path-based routing like /sites/{projectId}/
      // All traffic must go through Workers which handles the routing logic
      
      // Use shared utility for consistent Worker URL generation
      const workersUrl = getWorkerUrl(this.env);
      const deploymentUrl = `${workersUrl}/${deploymentPath}/`;

      // Copy all files from source to deployments bucket
      let filesDeployed = 0;
      let totalSize = 0;

      // Determine if there is an index.html; if not, pick first HTML to be index.html
      const htmlFiles = files.filter(f => f.name.toLowerCase().endsWith('.html') || f.name.toLowerCase().endsWith('.htm'));
      const hasIndexHtml = htmlFiles.some(f => f.name.toLowerCase() === 'index.html');
      const fallbackIndex = !hasIndexHtml && htmlFiles.length > 0 ? htmlFiles[0] : null;

      for (const file of files) {
        const object = await this.env.PROJECTS_BUCKET.get(file.path);
        if (!object) {
          console.warn(`[STATIC-DEPLOY] Source file not found: ${file.path}`);
          continue;
        }

        const arrayBuffer = typeof (object as any).arrayBuffer === 'function'
          ? await (object as any).arrayBuffer()
          : new TextEncoder().encode(await object.text());

        const contentType = (file.type && typeof file.type === 'string' && file.type.length > 0)
          ? file.type
          : this.inferContentType(file.name);

        const destPath = `${deploymentPath}/${file.name}`;
        const cacheControl = this.getCacheControlForFile(file.name, contentType);

        await this.env.DEPLOYMENTS_BUCKET.put(destPath, arrayBuffer, {
          httpMetadata: {
            contentType,
            cacheControl,
            ...this.servingConfig.security.headers
          },
          customMetadata: {
            project_id: projectId,
            deployment_id: deploymentId,
            deployed_at: deploymentTimestamp,
            source_path: file.path
          }
        });

        filesDeployed++;
        totalSize += arrayBuffer.byteLength;
      }

      // Ensure index.html exists
      if (!hasIndexHtml && fallbackIndex) {
        const object = await this.env.PROJECTS_BUCKET.get(fallbackIndex.path);
        if (object) {
          const arrayBuffer = typeof (object as any).arrayBuffer === 'function'
            ? await (object as any).arrayBuffer()
            : new TextEncoder().encode(await object.text());
          const contentType = 'text/html';
          const cacheControl = this.servingConfig.cacheControl.html;
          await this.env.DEPLOYMENTS_BUCKET.put(`${deploymentPath}/index.html`, arrayBuffer, {
            httpMetadata: {
              contentType,
              cacheControl,
              ...this.servingConfig.security.headers
            },
            customMetadata: {
              project_id: projectId,
              deployment_id: deploymentId,
              deployed_at: deploymentTimestamp,
              source_path: fallbackIndex.path,
              note: 'auto-index-from-first-html'
            }
          });
          filesDeployed++;
          totalSize += arrayBuffer.byteLength;
        }
      }

      // Store minimal deployment metadata
      const deploymentMetadata = {
        projectId,
        deploymentId,
        deploymentTimestamp,
        buildPath: 'static-source',
        deploymentPath,
        url: deploymentUrl,
        filesDeployed,
        totalSize,
        artifacts: files.map(f => ({ path: f.name, size: 0, hash: '', contentType: (f as any).type || this.inferContentType(f.name), compressed: false })),
        servingConfig: this.servingConfig,
        version: '1.0'
      };

      await this.env.DEPLOYMENTS_BUCKET.put(
        `${deploymentPath}/.deployment.json`,
        JSON.stringify(deploymentMetadata, null, 2),
        { httpMetadata: { contentType: 'application/json', cacheControl: this.servingConfig.cacheControl.default } }
      );

      // Update project status
      await this.updateProjectDeploymentStatus(projectId, 'deployed', deploymentUrl, deploymentId);

      await this.releaseDeploymentLock(projectId);

      const duration = Date.now() - startTime;
      console.info(`[STATIC-DEPLOYMENT] Deployed static site for ${projectId} in ${duration}ms at ${deploymentUrl}`);

      return {
        success: true,
        url: deploymentUrl,
        deploymentId,
        timestamp: deploymentTimestamp,
        filesDeployed,
        totalSize,
        buildPath: 'static-source',
        deploymentPath
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.updateProjectDeploymentStatus(projectId, 'failed', '', '', message);
      await this.releaseDeploymentLock(projectId);
      return {
        success: false,
        url: '',
        deploymentId,
        timestamp: deploymentTimestamp,
        filesDeployed: 0,
        totalSize: 0,
        buildPath: 'static-source',
        deploymentPath: '',
        error: { code: 'STATIC_DEPLOY_FAILED', message, details: { projectId, error } }
      };
    }
  }

  // Infer MIME type from filename
  private inferContentType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop() || '';
    switch (ext) {
      case 'html':
      case 'htm':
        return 'text/html';
      case 'css':
        return 'text/css';
      case 'js':
        return 'application/javascript';
      case 'json':
        return 'application/json';
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'gif':
        return 'image/gif';
      case 'svg':
        return 'image/svg+xml';
      case 'ico':
        return 'image/x-icon';
      default:
        return 'application/octet-stream';
    }
  }

  /**
   * Get deployment status for a project
   */
  async getDeploymentStatus(projectId: string): Promise<DeploymentStatus> {
    try {
      // Check if deployment metadata exists (try both formats)
      const deploymentPath = `${this.servingConfig.pathPrefix}/${projectId}/.deployment.json`;
      const altDeploymentPath = `${this.servingConfig.pathPrefix}/${projectId}.deployment.json`; // GitHub format
      
      let metadataObject = await this.env.DEPLOYMENTS_BUCKET.get(deploymentPath);
      if (!metadataObject) {
        // Try alternative path format (used by GitHub deployment)
        metadataObject = await this.env.DEPLOYMENTS_BUCKET.get(altDeploymentPath);
      }
      
      if (metadataObject) {
        const metadata: DeploymentMetadata = JSON.parse(await metadataObject.text());
        return {
          projectId,
          status: 'deployed',
          url: metadata.url,
          deploymentId: metadata.deploymentId,
          deployedAt: metadata.deploymentTimestamp,
          filesDeployed: metadata.filesDeployed,
          totalSize: metadata.totalSize
        };
      }
      
      // Fallback: Check if index.html exists in deployment path
      const indexPath = `${this.servingConfig.pathPrefix}/${projectId}/index.html`;
      const indexFile = await this.env.DEPLOYMENTS_BUCKET.get(indexPath);
      
      if (indexFile) {
        // Files exist but no metadata - likely deployed via GitHub
        console.info(`[DEPLOYMENT-STATUS] Found index.html but no metadata for ${projectId}, assuming deployed`);
        
        // Get Worker URL for proper routing
        let workersUrl: string;
        const callbackUrl = this.env.GITHUB_BUILD_CALLBACK_URL as string | undefined;
        if (callbackUrl && callbackUrl.includes('workers.dev')) {
          const url = new URL(callbackUrl);
          workersUrl = `${url.protocol}//${url.host}`;
        } else if ((this.env.ENVIRONMENT as string) === 'production') {
          workersUrl = 'https://gpthost-builder.gladden4work.workers.dev';
        } else if ((this.env.ENVIRONMENT as string) === 'staging') {
          workersUrl = 'https://gpthost-builder-staging.gladden4work.workers.dev';
        } else {
          workersUrl = 'http://localhost:8787';
        }
        
        return {
          projectId,
          status: 'deployed',
          url: `${workersUrl}/${this.servingConfig.pathPrefix}/${projectId}/`,
          deployedAt: indexFile.uploaded?.toISOString()
        };
      }

      // Check project metadata for deployment status
      const projectMetadataObject = await this.env.PROJECTS_BUCKET.get(`projects/${projectId}/metadata.json`);
      if (projectMetadataObject) {
        const projectMetadata = JSON.parse(await projectMetadataObject.text());
        const deploymentStatus = projectMetadata.deployment?.status || 'not_deployed';
        
        return {
          projectId,
          status: deploymentStatus,
          url: projectMetadata.deployment?.url,
          deploymentId: projectMetadata.deployment?.deploymentId,
          deployedAt: projectMetadata.deployment?.deployedAt,
          lastError: projectMetadata.deployment?.lastError
        };
      }

      return {
        projectId,
        status: 'not_deployed'
      };

    } catch (error) {
      console.error(`[DEPLOYMENT] Error getting deployment status for ${projectId}:`, error);
      return {
        projectId,
        status: 'not_deployed',
        lastError: {
          code: 'STATUS_CHECK_FAILED',
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  /**
   * Get deployment URL for a project
   */
  async getDeploymentURL(projectId: string): Promise<string | null> {
    const status = await this.getDeploymentStatus(projectId);
    return status.url || null;
  }

  /**
   * Remove deployment for a project
   */
  async removeDeployment(projectId: string): Promise<boolean> {
    try {
      const deploymentPath = `${this.servingConfig.pathPrefix}/${projectId}`;
      
      // List all objects in the deployment path
      const objects = await this.env.DEPLOYMENTS_BUCKET.list({ prefix: `${deploymentPath}/` });
      
      // Delete all deployment files
      for (const object of objects.objects) {
        await this.env.DEPLOYMENTS_BUCKET.delete(object.key);
      }

      // Update project metadata to remove deployment info
      await this.updateProjectDeploymentStatus(projectId, 'not_deployed', '', '');

      console.info(`[DEPLOYMENT] Successfully removed deployment for project ${projectId}`);
      return true;

    } catch (error) {
      console.error(`[DEPLOYMENT] Error removing deployment for ${projectId}:`, error);
      return false;
    }
  }

  /**
   * List available builds for a project
   */
  async listProjectBuilds(projectId: string): Promise<string[]> {
    try {
      const objects = await this.env.BUILDS_BUCKET.list({ 
        prefix: `builds/${projectId}/`,
        delimiter: '/'
      });
      
      // Extract build timestamps from the prefixes
      const builds = objects.delimitedPrefixes
        ?.map(prefix => prefix.replace(`builds/${projectId}/`, '').replace('/', ''))
        .filter(build => build.length > 0) || [];

      return builds.sort().reverse(); // Latest first

    } catch (error) {
      console.error(`[DEPLOYMENT] Error listing builds for ${projectId}:`, error);
      return [];
    }
  }

  /**
   * Validate that a build exists and is complete
   */
  async validateBuildExists(projectId: string, buildId?: string): Promise<boolean> {
    try {
      const buildPath = buildId || await this.findLatestBuild(projectId);
      if (!buildPath) return false;

      // Check if manifest exists
      const manifest = await this.loadBuildManifest(buildPath);
      return manifest !== null;

    } catch (error) {
      console.error(`[DEPLOYMENT] Error validating build for ${projectId}:`, error);
      return false;
    }
  }

  /**
   * Find the latest completed build for a project
   */
  private async findLatestBuild(projectId: string): Promise<string | null> {
    try {
      const builds = await this.listProjectBuilds(projectId);
      if (builds.length === 0) return null;

      // Check builds from latest to oldest until we find a valid one
      for (const buildTimestamp of builds) {
        const buildPath = `builds/${projectId}/${buildTimestamp}`;
        const manifestExists = await this.env.BUILDS_BUCKET.get(`${buildPath}/manifest.json`);
        if (manifestExists) {
          return buildPath;
        }
      }

      return null;

    } catch (error) {
      console.error(`[DEPLOYMENT] Error finding latest build for ${projectId}:`, error);
      return null;
    }
  }

  /**
   * Load build manifest from BUILDS_BUCKET
   */
  private async loadBuildManifest(buildPath: string): Promise<any | null> {
    try {
      const manifestObject = await this.env.BUILDS_BUCKET.get(`${buildPath}/manifest.json`);
      if (!manifestObject) return null;

      return JSON.parse(await manifestObject.text());

    } catch (error) {
      console.error(`[DEPLOYMENT] Error loading build manifest for ${buildPath}:`, error);
      return null;
    }
  }

  /**
   * Generate unique deployment ID
   */
  private generateDeploymentId(): string {
    return crypto.randomUUID();
  }

  /**
   * Get appropriate cache control headers based on file type
   */
  private getCacheControlForFile(filePath: string, contentType: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase() || '';
    
    // HTML files - shorter cache for content updates
    if (extension === 'html' || contentType.includes('text/html')) {
      return this.servingConfig.cacheControl.html;
    }
    
    // Hashed assets (JS/CSS with hash in filename) - long cache
    if ((extension === 'js' || extension === 'css') && /[a-f0-9]{6,}/i.test(filePath)) {
      return this.servingConfig.cacheControl.assets;
    }
    
    // Images
    if (contentType.startsWith('image/')) {
      return this.servingConfig.cacheControl.images;
    }
    
    // Default cache control
    return this.servingConfig.cacheControl.default;
  }

  /**
   * Update project metadata with deployment status
   */
  private async updateProjectDeploymentStatus(
    projectId: string, 
    status: 'not_deployed' | 'deploying' | 'deployed' | 'failed',
    url: string = '',
    deploymentId: string = '',
    errorMessage?: string
  ): Promise<void> {
    try {
      // Try to load from active path first, then fallback to legacy path
      const activePath = `projects/active/${projectId}/metadata.json`;
      const legacyPath = `projects/${projectId}/metadata.json`;
      
      let metadataObject = await this.env.PROJECTS_BUCKET.get(activePath);
      let usingActivePath = true;
      
      if (!metadataObject) {
        // Fallback to legacy path
        metadataObject = await this.env.PROJECTS_BUCKET.get(legacyPath);
        usingActivePath = false;
      }
      
      if (!metadataObject) {
        console.warn(`[DEPLOYMENT] Project metadata not found for ${projectId} in either path`);
        return;
      }

      const metadata = JSON.parse(await metadataObject.text());
      
      // Update deployment information
      metadata.deployment = {
        status,
        url: url || undefined,
        deploymentId: deploymentId || undefined,
        deployedAt: status === 'deployed' ? new Date().toISOString() : metadata.deployment?.deployedAt,
        lastError: errorMessage ? {
          code: 'DEPLOYMENT_ERROR',
          message: errorMessage,
          timestamp: new Date().toISOString()
        } : undefined
      };

      // Ensure top-level fields used by UI are updated as well
      // - Set project status to reflect deployment outcome when applicable
      // - Expose top-level deployment_url so dashboards can render the live link
      if (status === 'deployed') {
        metadata.status = 'deployed';
        if (url) {
          (metadata as any).deployment_url = url;
        }
      } else if (status === 'failed') {
        metadata.status = 'failed';
      }

      metadata.updated_at = new Date().toISOString();

      // Save updated metadata to BOTH paths for consistency
      const metadataString = JSON.stringify(metadata, null, 2);
      const metadataConfig = {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          project_id: projectId,
          updated_at: metadata.updated_at,
          deployment_status: status
        }
      };
      
      // Update active path if it exists
      if (usingActivePath || await this.env.PROJECTS_BUCKET.get(activePath)) {
        await this.env.PROJECTS_BUCKET.put(activePath, metadataString, metadataConfig);
        console.info(`[DEPLOYMENT] Updated active path metadata for ${projectId}`);
      }
      
      // Always update legacy path for backward compatibility
      await this.env.PROJECTS_BUCKET.put(legacyPath, metadataString, metadataConfig);
      console.info(`[DEPLOYMENT] Updated project metadata for ${projectId}`, {
        status,
        url: url || 'none',
        deploymentId: deploymentId || 'none',
        paths_updated: usingActivePath ? 'both' : 'legacy_only'
      });

    } catch (error) {
      console.error(`[DEPLOYMENT] Error updating project deployment status for ${projectId}:`, error);
    }
  }
}

/**
 * Create deployment manager instance
 */
export function createDeploymentManager(env: Env, customDomain?: string): R2DeploymentManager {
  return new R2DeploymentManager(env, customDomain);
}

/**
 * Generate deployment URL for a project (utility function)
 */
export function generateDeploymentURL(projectId: string, domain: string = 'gpthost-deployments-staging.r2.dev'): string {
  return `https://${domain}/sites/${projectId}/`;
}

/**
 * Validate deployment URL format
 */
export function isValidDeploymentURL(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'https:' && 
           parsedUrl.pathname.includes('/sites/') &&
           parsedUrl.pathname.endsWith('/');
  } catch {
    return false;
  }
}
