/**
 * GitHub Repository Management Routes for GPTHost
 * 
 * GitHub Repository Setup & Token Management
 * 
 * These routes handle:
 * - GitHub token validation and management
 * - Build repository setup and configuration
 * - Repository status monitoring
 * - GitHub Actions workflow management
 */

import { createGitHubApiClient, isValidGitHubTokenFormat } from '../utils/githubApi';
import { initializeGitHubBuildRepository, createGitHubBuildExecutor } from '../utils/githubBuildExecutor';
import { successResponse, errorResponse } from '../utils/responses';
import { ServiceFactory } from '../services/ServiceFactory';

/**
 * Enhanced file discovery for GitHub build artifacts
 * Searches multiple possible locations where GitHub Actions might upload files
 */
async function findBuildArtifacts(env: Env, projectId: string, buildPath: string): Promise<{
  files: any[];
  sourcePath: string;
  type: 'dist' | 'build' | 'direct' | 'assets';
}> {
  const basePath = buildPath.endsWith('/') ? buildPath : buildPath + '/';
  
  console.info(`[BUILD-ARTIFACTS] 🔍 Starting artifact search for project ${projectId}`);
  console.info(`[BUILD-ARTIFACTS] 📂 Base path: ${basePath}`);
  
  // Try multiple possible locations in order of preference
  const possiblePaths = [
    { path: basePath + 'dist/', type: 'dist' as const },
    { path: basePath + 'build/', type: 'build' as const },
    { path: basePath + 'assets/', type: 'assets' as const },
    { path: basePath, type: 'direct' as const },
  ];
  
  for (const { path, type } of possiblePaths) {
    console.info(`[BUILD-ARTIFACTS] Checking path: ${path}`);
    
    try {
      // CRITICAL FIX: Increase limit to handle larger projects and use delimiter for efficiency
      const result = await env.BUILDS_BUCKET.list({ 
        prefix: path, 
        limit: 1000,
        delimiter: undefined // Don't use delimiter to get all nested files
      });
      
      console.info(`[BUILD-ARTIFACTS] R2 list result for ${path}: ${result.objects?.length || 0} objects found`);
      
      if (result.objects && result.objects.length > 0) {
        // Log first few objects for debugging
        console.info(`[BUILD-ARTIFACTS] Sample objects:`, result.objects.slice(0, 5).map(o => o.key));
        
        // CRITICAL FIX: Don't filter out files here - let the deployment function handle it
        // We need to return ALL objects to ensure nothing is missed
        const actualFiles = result.objects.filter(obj => 
          !obj.key.endsWith('/') && 
          !obj.key.includes('.deployment.json') &&
          !obj.key.includes('.gitkeep')
        );
        
        // Return files if we found any actual files (not just directories)
        if (actualFiles.length > 0) {
          console.info(`[BUILD-ARTIFACTS] ✅ Found ${actualFiles.length} actual files at ${path} with type ${type}`);
          console.info(`[BUILD-ARTIFACTS] 📦 Returning all ${result.objects.length} objects for processing`);
          return { files: result.objects, sourcePath: path, type };
        } else {
          console.info(`[BUILD-ARTIFACTS] ⚠️ Found ${result.objects.length} objects but no actual files (only directories/metadata)`);
        }
      }
    } catch (error) {
      console.error(`[BUILD-ARTIFACTS] ❌ Error listing ${path}:`, error);
    }
  }
  
  // If no files found in standard locations, do a broader search
  console.info(`[BUILD-ARTIFACTS] ⚠️ No files in standard locations, doing broad search for project ${projectId}`);
  
  try {
    // CRITICAL FIX: Search with larger limit and no delimiter to get all nested files
    const broadSearch = await env.BUILDS_BUCKET.list({ 
      prefix: `builds/${projectId}/`, 
      limit: 10000,
      delimiter: undefined
    });
    
    console.info(`[BUILD-ARTIFACTS] 🔍 Broad search found ${broadSearch.objects?.length || 0} total objects`);
    
    if (broadSearch.objects && broadSearch.objects.length > 0) {
      // Log all paths for debugging
      const allPaths = broadSearch.objects.map(o => o.key);
      console.info(`[BUILD-ARTIFACTS] All object paths found (first 20):`, allPaths.slice(0, 20));
      
      const actualFiles = broadSearch.objects.filter(obj => 
        !obj.key.endsWith('/') && 
        !obj.key.includes('.deployment.json') &&
        !obj.key.includes('.gitkeep')
      );
      
      console.info(`[BUILD-ARTIFACTS] After filtering: ${actualFiles.length} actual files`);
      
      if (actualFiles.length > 0) {
        // Find the common prefix for all files
        let commonPrefix = '';
        if (actualFiles.length === 1) {
          commonPrefix = actualFiles[0].key.substring(0, actualFiles[0].key.lastIndexOf('/') + 1);
        } else {
          // Find longest common prefix
          commonPrefix = actualFiles[0].key;
          for (let i = 1; i < actualFiles.length; i++) {
            while (!actualFiles[i].key.startsWith(commonPrefix)) {
              commonPrefix = commonPrefix.substring(0, commonPrefix.lastIndexOf('/'));
              if (!commonPrefix.includes('/')) {
                commonPrefix = '';
                break;
              }
            }
          }
          // Ensure it ends with / and is a proper directory
          if (commonPrefix && !commonPrefix.endsWith('/')) {
            const lastSlash = commonPrefix.lastIndexOf('/');
            commonPrefix = lastSlash >= 0 ? commonPrefix.substring(0, lastSlash + 1) : '';
          }
        }
        console.info(`[BUILD-ARTIFACTS] ✅ Found ${actualFiles.length} files with broad search`);
        console.info(`[BUILD-ARTIFACTS] 📂 Common prefix: ${commonPrefix}`);
        return { files: broadSearch.objects, sourcePath: commonPrefix || basePath, type: 'direct' };
      } else {
        console.info(`[BUILD-ARTIFACTS] ❌ All ${broadSearch.objects.length} objects were filtered out (likely all directories or metadata files)`);
      }
    } else {
      console.info(`[BUILD-ARTIFACTS] ❌ No objects found at all for project ${projectId}`);
    }
  } catch (error) {
    console.error(`[BUILD-ARTIFACTS] ❌ Error during broad search:`, error);
  }
  
  console.info(`[BUILD-ARTIFACTS] ❌ CRITICAL: No build artifacts found anywhere for project ${projectId}`);
  return { files: [], sourcePath: basePath, type: 'direct' };
}

/**
 * Deploy GitHub build artifacts directly from R2 storage
 * This handles the special case where GitHub Actions uploads directly to R2
 * bypassing the normal build pipeline
 */
async function deployGitHubBuildArtifacts(
  env: Env,
  projectId: string,
  buildPath: string,
  deploymentUrl: string
): Promise<{
  success: boolean;
  url: string;
  deploymentId: string;
  error?: string;
}> {
  const deploymentId = crypto.randomUUID();
  const deploymentTimestamp = new Date().toISOString();
  
  try {
    console.info(`[GITHUB-DEPLOY] 🚀 Starting deployment for project ${projectId}`);
    console.info(`[GITHUB-DEPLOY] 📁 Source path: ${buildPath}`);
    console.info(`[GITHUB-DEPLOY] 🎯 Target URL: ${deploymentUrl}`);
    
    // Use enhanced file discovery to find build artifacts
    let { files: buildFiles, sourcePath, type: buildType } = await findBuildArtifacts(env, projectId, buildPath);
    console.info(`[GITHUB-DEPLOY] 📊 File discovery result: ${buildFiles.length} files found, type: ${buildType}`);
    
    // Retry discovery to mitigate R2 eventual consistency after upload
    if (buildFiles.length === 0) {
      const maxAttempts = 10; // Increased from 5 to 10 for better consistency handling
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Exponential backoff with jitter: 1s, 2s, 4s, 8s... up to 30s max
        const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
        const jitter = Math.random() * 500; // Add 0-500ms jitter
        const delayMs = baseDelay + jitter;
        
        console.info(`[GITHUB-DEPLOY] ⏳ No artifacts yet. Retry ${attempt}/${maxAttempts} after ${Math.round(delayMs)}ms`);
        await new Promise(res => setTimeout(res, delayMs));
        
        const retry = await findBuildArtifacts(env, projectId, buildPath);
        if (retry.files.length > 0) {
          buildFiles = retry.files;
          sourcePath = retry.sourcePath;
          buildType = retry.type;
          console.info(`[GITHUB-DEPLOY] ✅ Artifacts found on retry ${attempt}: ${buildFiles.length} files, type: ${buildType}`);
          break;
        }
        
        // On later attempts, try a broader search
        if (attempt >= 5) {
          console.info(`[GITHUB-DEPLOY] 🔍 Attempting broader search on attempt ${attempt}`);
          // Try without the timestamp in the path
          const broadPath = `builds/${projectId}/`;
          const broadRetry = await findBuildArtifacts(env, projectId, broadPath);
          if (broadRetry.files.length > 0) {
            buildFiles = broadRetry.files;
            sourcePath = broadRetry.sourcePath;
            buildType = broadRetry.type;
            console.info(`[GITHUB-DEPLOY] ✅ Artifacts found with broader search: ${buildFiles.length} files`);
            break;
          }
        }
      }
    }
    
    const deploymentPath = `sites/${projectId}/`;
    
    if (buildFiles.length === 0) {
      console.error(`[GITHUB-DEPLOY] ❌ CRITICAL: No build artifacts found for project ${projectId}`);
      console.error(`[GITHUB-DEPLOY] Searched paths: dist/, build/, assets/, and direct path under ${buildPath}`);
      
      // Don't update status to deployed if no files found
      await updateProjectDeploymentStatus(
        env,
        projectId,
        'failed',
        '',
        '',
        `No build artifacts found at ${buildPath}`
      );
      
      throw new Error(`No build artifacts found at ${buildPath} - build may have failed or artifacts were not uploaded correctly`);
    }
    
    let filesDeployed = 0;
    let filesFailed = 0;
    let totalSize = 0;
    const failedFiles: string[] = [];
    
    // Copy all files to deployment bucket
    const eligibleFiles = buildFiles.filter(obj => 
      !obj.key.endsWith('/') && 
      !obj.key.includes('.deployment.json')
    );
    
    console.info(`[GITHUB-DEPLOY] 📋 Processing ${eligibleFiles.length} files for deployment`);
    console.info(`[GITHUB-DEPLOY] 📂 Source path: ${sourcePath}`);
    console.info(`[GITHUB-DEPLOY] 🎯 Deployment path: ${deploymentPath}`);
    
    for (const object of eligibleFiles) {
      // CRITICAL FIX: Ensure proper path handling
      let relativePath = object.key;
      
      // Remove the source path prefix to get the relative path
      if (relativePath.startsWith(sourcePath)) {
        relativePath = relativePath.substring(sourcePath.length);
      } else {
        console.warn(`[GITHUB-DEPLOY] ⚠️ File ${object.key} doesn't start with source path ${sourcePath}`);
        // Try to extract just the filename or last part
        const parts = object.key.split('/');
        relativePath = parts[parts.length - 1];
      }
      
      // Remove leading slash if present
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.substring(1);
      }
      
      const destKey = `${deploymentPath}${relativePath}`;
      
      console.info(`[GITHUB-DEPLOY] 📄 Copying: ${object.key} -> ${destKey}`);
      
      try {
        // Get the file from builds bucket
        const file = await env.BUILDS_BUCKET.get(object.key);
        
        if (!file) {
          console.error(`[GITHUB-DEPLOY] ❌ Failed to retrieve file: ${object.key}`);
          failedFiles.push(object.key);
          filesFailed++;
          continue;
        }
        
        // Copy to deployments bucket with proper headers
        await env.DEPLOYMENTS_BUCKET.put(destKey, file.body, {
          httpMetadata: file.httpMetadata as any,
          customMetadata: {
            ...((file.customMetadata as any) || {}),
            project_id: projectId,
            deployment_id: deploymentId,
            deployed_at: deploymentTimestamp,
            source_path: object.key
          }
        });
        
        filesDeployed++;
        totalSize += object.size || 0;
        console.info(`[GITHUB-DEPLOY] ✅ Successfully deployed: ${relativePath} (${object.size} bytes)`);
        
      } catch (fileError) {
        console.error(`[GITHUB-DEPLOY] ❌ Error deploying ${object.key}:`, fileError);
        failedFiles.push(object.key);
        filesFailed++;
      }
    }
    
    // CRITICAL VALIDATION: Check if any files were actually deployed
    console.info(`[GITHUB-DEPLOY] 📊 Deployment summary:`);
    console.info(`[GITHUB-DEPLOY]   - Files deployed: ${filesDeployed}`);
    console.info(`[GITHUB-DEPLOY]   - Files failed: ${filesFailed}`);
    console.info(`[GITHUB-DEPLOY]   - Total size: ${totalSize} bytes`);
    
    if (failedFiles.length > 0) {
      console.error(`[GITHUB-DEPLOY] ⚠️ Failed files:`, failedFiles);
    }
    
    if (filesDeployed === 0) {
      const errorMsg = `CRITICAL: No files were deployed successfully. ${filesFailed} files failed to copy.`;
      console.error(`[GITHUB-DEPLOY] ❌ ${errorMsg}`);
      
      // Update project status to failed
      await updateProjectDeploymentStatus(
        env,
        projectId,
        'failed',
        '',
        '',
        errorMsg
      );
      
      throw new Error(errorMsg);
    }
    
    // Warn if some files failed but deployment can continue
    if (filesFailed > 0 && filesDeployed > 0) {
      console.warn(`[GITHUB-DEPLOY] ⚠️ Partial deployment: ${filesDeployed} succeeded, ${filesFailed} failed`);
    }
    
    // Create deployment metadata with deployment statistics
    const deploymentMetadata = {
      projectId,
      deploymentId,
      deploymentTimestamp,
      buildPath,
      deploymentPath,
      url: deploymentUrl,
      version: '1.0',
      source: 'github-action',
      statistics: {
        filesDeployed,
        filesFailed,
        totalSize,
        failedFiles: failedFiles.length > 0 ? failedFiles : undefined
      }
    };
    
    // Store deployment metadata
    await env.DEPLOYMENTS_BUCKET.put(
      `${deploymentPath}.deployment.json`,
      JSON.stringify(deploymentMetadata, null, 2),
      {
        httpMetadata: {
          contentType: 'application/json'
        },
        customMetadata: {
          project_id: projectId,
          deployment_id: deploymentId,
          deployed_at: deploymentTimestamp,
          type: 'deployment_metadata'
        }
      }
    );
    
    console.info(`[GITHUB-DEPLOY] ✅ Created deployment metadata at ${deploymentPath}.deployment.json`);
    
    // Verify critical files exist (especially index.html)
    const indexPath = `${deploymentPath}index.html`;
    const indexFile = await env.DEPLOYMENTS_BUCKET.get(indexPath);
    
    if (!indexFile) {
      console.error(`[GITHUB-DEPLOY] ⚠️ WARNING: index.html not found at ${indexPath}`);
      console.error(`[GITHUB-DEPLOY] Site may not be accessible. Deployed files:`, filesDeployed);
    } else {
      console.info(`[GITHUB-DEPLOY] ✅ Verified index.html exists at ${indexPath}`);
    }
    
    // Only update to 'deployed' status if files were actually deployed
    if (filesDeployed > 0) {
      console.info(`[GITHUB-DEPLOY] 🎉 Deployment successful! ${filesDeployed} files deployed to ${deploymentUrl}`);
      
      await updateProjectDeploymentStatus(
        env,
        projectId,
        'deployed',
        deploymentUrl,
        deploymentId
      );
    } else {
      // This should never be reached due to earlier validation, but as safety
      throw new Error('Deployment validation failed: no files deployed');
    }
    
    return {
      success: true,
      url: deploymentUrl,
      deploymentId
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[GITHUB-DEPLOY] ❌ DEPLOYMENT FAILED for project ${projectId}:`, error);
    console.error(`[GITHUB-DEPLOY] Error details:`, {
      projectId,
      buildPath,
      deploymentUrl,
      errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // Update project status to failed
    await updateProjectDeploymentStatus(
      env,
      projectId,
      'failed',
      '',
      '',
      errorMessage
    );
    
    return {
      success: false,
      url: '',
      deploymentId,
      error: `Deployment failed: ${errorMessage}. Check logs for details.`
    };
  }
}

/**
 * Update project metadata with deployment status
 * (Simplified version for GitHub deployments)
 */
async function updateProjectDeploymentStatus(
  env: Env,
  projectId: string,
  status: 'deployed' | 'failed',
  url: string,
  deploymentId: string,
  errorMessage?: string
): Promise<void> {
  try {
    // Try active path first, then legacy
    const activePath = `projects/active/${projectId}/metadata.json`;
    const legacyPath = `projects/${projectId}/metadata.json`;
    
    let metadataObject = await env.PROJECTS_BUCKET.get(activePath);
    let usingActivePath = true;
    
    if (!metadataObject) {
      metadataObject = await env.PROJECTS_BUCKET.get(legacyPath);
      usingActivePath = false;
    }
    
    if (!metadataObject) {
      console.warn(`[GITHUB-DEPLOY] Project metadata not found for ${projectId}`);
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
    
    // Update top-level fields
    if (status === 'deployed') {
      metadata.status = 'deployed';
      metadata.deployment_url = url;
    } else if (status === 'failed') {
      metadata.status = 'failed';
    }
    
    metadata.updated_at = new Date().toISOString();
    
    // Save to both paths
    const metadataString = JSON.stringify(metadata, null, 2);
    const metadataConfig = {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        project_id: projectId,
        updated_at: metadata.updated_at,
        deployment_status: status
      }
    };
    
    if (usingActivePath || await env.PROJECTS_BUCKET.get(activePath)) {
      await env.PROJECTS_BUCKET.put(activePath, metadataString, metadataConfig);
    }
    
    await env.PROJECTS_BUCKET.put(legacyPath, metadataString, metadataConfig);
    
    console.info(`[GITHUB-DEPLOY] Updated project metadata for ${projectId} (status: ${status})`);
    
  } catch (error) {
    console.error(`[GITHUB-DEPLOY] Error updating project deployment status:`, error);
  }
}

/**
 * Validate GitHub Personal Access Token
 * POST /api/github/validate-token
 * 
 * Body: { token: string }
 * Response: { valid: boolean, user?: string, scopes?: string[], repository_access?: boolean }
 */
export async function validateGitHubTokenHandler(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { token: string };
    
    if (!body.token) {
      return errorResponse(
        'MISSING_TOKEN',
        'GitHub token is required',
        400
      );
    }

    // Validate token format first
    if (!isValidGitHubTokenFormat(body.token)) {
      return errorResponse(
        'INVALID_TOKEN_FORMAT',
        'Invalid GitHub token format. Expected ghp_*, github_pat_*, or ghs_* format',
        400
      );
    }

    const githubClient = createGitHubApiClient(body.token);
    const validation = await githubClient.validateToken();

    if (!validation.valid) {
      return errorResponse(
        'INVALID_TOKEN',
        'GitHub token is invalid or expired',
        401
      );
    }

    // Check required scopes for repository management
    const requiredScopes = ['repo'];
    const hasRequiredScopes = validation.scopes?.some(scope => 
      requiredScopes.some(required => scope.includes(required))
    ) || false;

    return successResponse({
      valid: true,
      user: validation.user,
      scopes: validation.scopes,
      repository_access: hasRequiredScopes,
      message: hasRequiredScopes 
        ? 'Token is valid and has required permissions'
        : 'Token is valid but may lack repository permissions'
    });

  } catch (error) {
    console.error('GitHub token validation error:', error);
    return errorResponse(
      'VALIDATION_FAILED',
      'Failed to validate GitHub token',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Setup GitHub build repository
 * POST /api/github/setup-repository
 * 
 * Body: { token: string, org_or_user?: string, repository_name?: string }
 * Response: { repository: GitHubRepository, repository_full_name: string }
 */
export async function setupGitHubRepositoryHandler(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { 
      token: string; 
      org_or_user?: string; 
      repository_name?: string; 
    };

    if (!body.token) {
      return errorResponse(
        'MISSING_TOKEN',
        'GitHub token is required',
        400
      );
    }

    // Initialize repository
    const { repository, repositoryFullName } = await initializeGitHubBuildRepository(
      body.token,
      body.org_or_user,
      body.repository_name || 'gpthost-builds'
    );

    // Store repository configuration in environment secrets
    // Note: In production, this would be stored securely in Cloudflare Workers secrets
    console.info(`GitHub repository setup completed: ${repositoryFullName}`);

    return successResponse({
      repository,
      repository_full_name: repositoryFullName,
      message: 'GitHub build repository setup successfully',
      next_steps: [
        'Store GitHub token as GITHUB_TOKEN secret in Cloudflare Workers',
        `Store repository name as GITHUB_REPOSITORY=${repositoryFullName} in environment variables`,
        'Trigger test build to verify integration'
      ]
    });

  } catch (error) {
    console.error('GitHub repository setup error:', error);
    return errorResponse(
      'SETUP_FAILED',
      'Failed to setup GitHub repository',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get GitHub repository status
 * GET /api/github/repository-status
 * 
 * Response: { repository: GitHubRepository, recent_workflows: GitHubWorkflowRun[], status: string }
 */
export async function getGitHubRepositoryStatusHandler(request: Request, env: Env): Promise<Response> {
  try {
    const githubToken = env.GITHUB_TOKEN;
    const repositoryFullName = env.GITHUB_REPOSITORY;

    if (!githubToken) {
      return errorResponse(
        'MISSING_CONFIGURATION',
        'GitHub token not configured. Run setup-repository first.',
        400
      );
    }

    if (!repositoryFullName) {
      return errorResponse(
        'MISSING_CONFIGURATION',
        'GitHub repository not configured. Run setup-repository first.',
        400
      );
    }

    const githubClient = createGitHubApiClient(githubToken);
    const [owner, repo] = repositoryFullName.split('/');

    // Get repository information
    const repository = await githubClient.getRepository(owner, repo);
    if (!repository) {
      return errorResponse(
        'REPOSITORY_NOT_FOUND',
        `Repository ${repositoryFullName} not found or not accessible`,
        404
      );
    }

    // Get recent workflow runs
    const recentWorkflows = await githubClient.getLatestWorkflowRun(repositoryFullName, 'gpthost-build.yml');

    const status = repository ? 'active' : 'inactive';

    return successResponse({
      repository,
      recent_workflows: recentWorkflows ? [recentWorkflows] : [],
      status,
      configured_at: new Date().toISOString(),
      message: 'GitHub repository is properly configured and accessible'
    });

  } catch (error) {
    console.error('GitHub repository status error:', error);
    return errorResponse(
      'STATUS_CHECK_FAILED',
      'Failed to check GitHub repository status',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Trigger test build to verify GitHub Actions integration
 * POST /api/github/test-build
 * 
 * Body: { project_id?: string }
 * Response: { workflow_run_id: number, workflow_run_url: string, status: string }
 */
export async function triggerGitHubTestBuildHandler(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { project_id?: string };
    const projectId = body.project_id || `test-${Date.now()}`;

    const githubToken = env.GITHUB_TOKEN;
    const repositoryFullName = env.GITHUB_REPOSITORY;

    if (!githubToken || !repositoryFullName) {
      return errorResponse(
        'MISSING_CONFIGURATION',
        'GitHub integration not configured. Run setup-repository first.',
        400
      );
    }

    // Create a simple test build job
    const testBuildJob = {
      project_id: projectId,
      framework: 'react' as const,
      source_files: {
        'App.tsx': `import React from 'react';

function App() {
  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h1>GPTHost Test Build</h1>
      <p>This is a test build from GitHub Actions integration.</p>
      <p>Build triggered at: {new Date().toISOString()}</p>
    </div>
  );
}

export default App;`,
        'main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);`
      },
      build_config: {
        framework: 'react',
        mode: 'production',
        minify: true,
        sourcemap: false
      },
      timeout_seconds: 600,
      metadata: {
        test_build: true,
        queued_at: new Date().toISOString()
      }
    };

    const githubClient = createGitHubApiClient(githubToken);
    
    // Trigger build
    const triggerResult = await githubClient.triggerBuild(
      repositoryFullName,
      testBuildJob,
      `${new URL(request.url).origin}/api/v2/github/build-callback`
    );

    if (!triggerResult.success) {
      return errorResponse(
        'BUILD_TRIGGER_FAILED',
        'Failed to trigger test build',
        500,
        triggerResult.error
      );
    }

    // Get workflow run details
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for workflow to start
    const workflowRun = await githubClient.getLatestWorkflowRun(repositoryFullName, 'gpthost-build.yml');

    return successResponse({
      workflow_run_id: triggerResult.runId,
      workflow_run_url: workflowRun?.html_url || `https://github.com/${repositoryFullName}/actions`,
      status: 'triggered',
      project_id: projectId,
      message: 'Test build triggered successfully. Check GitHub Actions for progress.',
      instructions: [
        `Visit ${workflowRun?.html_url || 'GitHub Actions'} to monitor build progress`,
        'Build artifacts will be available after successful completion',
        'Check build logs for any configuration issues'
      ]
    });

  } catch (error) {
    console.error('GitHub test build error:', error);
    return errorResponse(
      'TEST_BUILD_FAILED',
      'Failed to trigger test build',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Handle GitHub Actions build callback
 * POST /api/github/build-callback
 * 
 * This endpoint receives status updates from GitHub Actions workflows
 * Enhanced for TASK-024: Now handles R2 storage information
 */
export async function githubBuildCallbackHandler(request: Request, env: Env): Promise<Response> {
  try {
    // Check for Bearer token authentication (required for workflow callbacks)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.warn('GitHub callback missing Bearer token authorization');
      return errorResponse(
        'UNAUTHORIZED',
        'Missing or invalid authorization header. Expected Bearer token',
        401
      );
    }
    
    const token = authHeader.slice(7); // Remove 'Bearer ' prefix
    if (token !== env.GITHUB_CALLBACK_TOKEN) {
      console.warn('GitHub callback received with invalid Bearer token');
      return errorResponse(
        'UNAUTHORIZED',
        'Invalid callback token',
        401
      );
    }
    
    console.info('GitHub callback authenticated successfully via Bearer token');
    
    const body = await request.json() as {
      project_id: string;
      status: 'completed' | 'failed';
      github_run_id: string;
      github_run_url: string;
      framework: string;
      node_version: string;
      r2_storage?: {
        build_path: string;
        bucket_name: string;
        endpoint: string;
        build_timestamp: string;
        public_url_base?: string;
      };
      artifacts?: {
        github_url: string;
        r2_manifest: string;
      };
      build_metadata?: {
        build_timestamp: string;
        build_duration_seconds: number;
        github_sha: string;
        workflow_name: string;
        runner_os: string;
      };
      deployment?: {
        ready: boolean;
        url_template: string;
        r2_path: string;
      };
      error?: {
        message: string;
        logs_url: string;
        possible_causes: string[];
      };
      troubleshooting?: {
        logs_location: string;
        documentation: string;
        support_contact: string;
      };
      // Tolerate flat keys from workflow callback
      r2_build_path?: string;
      public_url?: string;
    };

    console.info(`🔔 GitHub build callback received for project ${body.project_id}:`, {
      status: body.status,
      framework: body.framework,
      node_version: body.node_version,
      has_r2_info: !!body.r2_storage,
      r2_path: body.r2_storage?.build_path || body.r2_build_path
    });

    // Attempt correlation lookup (runId -> buildId) saved during dispatch
    try {
      const buildsStorage = ServiceFactory.getStorageService(env); // PROJECTS_BUCKET-backed
      const runMapPath = `projects/${body.project_id}/github-runs/${body.github_run_id}.json`;
      const runMap = await buildsStorage.downloadFile(runMapPath);
      if (runMap.ok) {
        const decoded = JSON.parse(new TextDecoder().decode(runMap.value));
        console.info(`[GITHUB-CALLBACK] Correlation found`, {
          projectId: body.project_id,
          githubRunId: body.github_run_id,
          buildId: decoded.buildId
        });
      } else {
        console.info(`[GITHUB-CALLBACK] No correlation mapping found for run`, {
          projectId: body.project_id,
          githubRunId: body.github_run_id
        });
      }
    } catch (e) {
      console.warn('[GITHUB-CALLBACK] Correlation lookup failed', e);
    }

    // Validate required fields
    if (!body.project_id || !body.status || !body.github_run_id) {
      return errorResponse(
        'INVALID_CALLBACK_DATA',
        'Missing required callback fields: project_id, status, github_run_id',
        400
      );
    }

    // Normalize R2 info: support both nested (r2_storage) and flat (r2_build_path/public_url)
    const normalizedR2 = body.r2_storage || (body.r2_build_path ? {
      build_path: body.r2_build_path,
      bucket_name: (body as any).r2_bucket_name || '',
      endpoint: '',
      build_timestamp: body.build_metadata?.build_timestamp || new Date().toISOString(),
      public_url_base: body.public_url
    } : undefined);

    // Prepare enhanced build status with R2 information
    // Accept both 'completed' and 'success' as successful build status
    const isSuccess = (body.status === 'completed' || body.status === 'success');
    const buildStatus = {
      status: body.status,
      progress: isSuccess ? 100 : 0,
      current_stage: isSuccess ? 'deployment' : 'build',
      framework: body.framework,
      node_version: body.node_version,
      logs: [
        `🚀 GitHub Actions build ${body.status}`,
        `📋 Framework: ${body.framework} (Node.js ${body.node_version})`,
        `🔗 Run: ${body.github_run_url}`,
        ...(normalizedR2 ? [
          `📦 R2 Path: ${normalizedR2.build_path}`,
          `🪣 R2 Bucket: ${normalizedR2.bucket_name}`,
          `⏰ Build Time: ${normalizedR2.build_timestamp}`,
          ...(normalizedR2.public_url_base ? [`🔗 Public URL Base: ${normalizedR2.public_url_base}`] : [])
        ] : []),
        ...(body.build_metadata ? [
          `⏱️ Duration: ${body.build_metadata.build_duration_seconds}s`,
          `🏃 Runner: ${body.build_metadata.runner_os}`
        ] : []),
        ...(body.error ? [
          `❌ Error: ${body.error.message}`,
          `📄 Logs: ${body.error.logs_url}`,
          `💡 Causes: ${body.error.possible_causes.join(', ')}`
        ] : [])
      ],
      metadata: {
        job_id: `gh-${body.github_run_id}`,
        github_run_id: body.github_run_id,
        github_run_url: body.github_run_url,
        github_build: true,
        callback_received_at: new Date().toISOString(),
        framework: body.framework,
        node_version: body.node_version,
        ...(body.build_metadata && {
          build_duration_seconds: body.build_metadata.build_duration_seconds,
          github_sha: body.build_metadata.github_sha,
          workflow_name: body.build_metadata.workflow_name,
          runner_os: body.build_metadata.runner_os
        })
      },
      // Enhanced R2 storage information
      r2_storage: normalizedR2 ? {
        build_path: normalizedR2.build_path,
        bucket_name: normalizedR2.bucket_name,
        endpoint: normalizedR2.endpoint,
        build_timestamp: normalizedR2.build_timestamp,
        public_url_base: normalizedR2.public_url_base,
        manifest_path: body.artifacts?.r2_manifest,
        storage_ready: isSuccess
      } : undefined,
      // Deployment information
      deployment: body.deployment ? {
        ready: body.deployment.ready && isSuccess,
        url_template: body.deployment.url_template,
        r2_path: body.deployment.r2_path,
        deployment_timestamp: new Date().toISOString()
      } : undefined,
      // Error details for failed builds
      error_details: body.error ? {
        message: body.error.message,
        logs_url: body.error.logs_url,
        possible_causes: body.error.possible_causes,
        troubleshooting: body.troubleshooting
      } : undefined
    };

    // Update project metadata in correct directory structure
    const metadataActivePath = `projects/active/${body.project_id}/metadata.json`;
    const metadataLegacyPath = `projects/${body.project_id}/metadata.json`;

    // Try to load existing metadata from active path first, then legacy path
    let existingMetadata = null;
    let metadataSource = 'none';

    try {
      const activeMetadataObj = await env.PROJECTS_BUCKET.get(metadataActivePath);
      if (activeMetadataObj) {
        existingMetadata = await activeMetadataObj.json();
        metadataSource = 'active';
      } else {
        const legacyMetadataObj = await env.PROJECTS_BUCKET.get(metadataLegacyPath);
        if (legacyMetadataObj) {
          existingMetadata = await legacyMetadataObj.json();
          metadataSource = 'legacy';
        }
      }
    } catch (error) {
      console.warn(`Failed to load existing metadata for ${body.project_id}:`, error);
    }

    if (!existingMetadata) {
      console.error(`No metadata found for project ${body.project_id} in either active or legacy paths`);
      return errorResponse(
        'PROJECT_NOT_FOUND',
        `Project metadata not found for ${body.project_id}`,
        404
      );
    }

    // Determine Workers base URL for correct public links
    let workersBaseUrl = '';
    try {
      const cb = env.GITHUB_BUILD_CALLBACK_URL as string | undefined;
      if (cb && cb.includes('workers.dev')) {
        const u = new URL(cb);
        workersBaseUrl = `${u.protocol}//${u.host}`;
      } else if ((env.ENVIRONMENT as string) === 'production') {
        workersBaseUrl = 'https://gpthost-builder.gladden4work.workers.dev';
      } else if ((env.ENVIRONMENT as string) === 'staging') {
        workersBaseUrl = 'https://gpthost-builder-staging.gladden4work.workers.dev';
      } else {
        workersBaseUrl = 'http://localhost:8787';
      }
    } catch {}

    const workersDeploymentUrl = `${workersBaseUrl}/sites/${body.project_id}/`;

    // Update the metadata with build/deployment information
    const updatedMetadata = {
      ...existingMetadata,
      status: isSuccess ? 'active' : (body.status === 'failed' ? 'failed' : existingMetadata.status),
      updated_at: new Date().toISOString(),
      // Important: always expose the Worker URL for public viewing
      // R2 public URLs do not support our site routing and cause blank pages
      deployment_url: isSuccess 
        ? workersDeploymentUrl 
        : existingMetadata.deployment_url,
      
      // Store build information
      last_build: {
        status: body.status,
        github_run_id: body.github_run_id,
        github_run_url: body.github_run_url,
        framework: body.framework,
        node_version: body.node_version,
        completed_at: new Date().toISOString(),
        ...(normalizedR2 && {
          r2_path: normalizedR2.build_path,
          bucket_name: normalizedR2.bucket_name,
          // Prefer Worker URL so clients don't surface unusable R2 links
          public_url_base: workersDeploymentUrl,
          build_timestamp: normalizedR2.build_timestamp
        }),
        ...(body.build_metadata && {
          build_duration_seconds: body.build_metadata.build_duration_seconds,
          github_sha: body.build_metadata.github_sha,
          workflow_name: body.build_metadata.workflow_name,
          runner_os: body.build_metadata.runner_os
        }),
        ...(body.error && {
          error: {
            message: body.error.message,
            logs_url: body.error.logs_url,
            possible_causes: body.error.possible_causes
          }
        })
      },

      // For successful deployments, update deployment information
      ...(isSuccess && normalizedR2 && {
        deployment_info: {
          status: 'ready',
          r2_path: normalizedR2.build_path,
          bucket_name: normalizedR2.bucket_name,
          // Prefer Worker URL for live access
          public_url_base: workersDeploymentUrl,
          manifest_url: body.artifacts?.r2_manifest,
          deployed_at: new Date().toISOString(),
          build_artifacts: body.artifacts
        }
      })
    };

    // Save updated metadata to both paths for compatibility
    const metadataContent = JSON.stringify(updatedMetadata, null, 2);
    const metadataOptions = {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        project_id: body.project_id,
        status: updatedMetadata.status,
        framework: body.framework,
        updated_at: updatedMetadata.updated_at,
        has_deployment: isSuccess && normalizedR2 ? 'true' : 'false'
      }
    };

    await Promise.all([
      env.PROJECTS_BUCKET.put(metadataActivePath, metadataContent, metadataOptions),
      env.PROJECTS_BUCKET.put(metadataLegacyPath, metadataContent, metadataOptions)
    ]);

    // CRITICAL: Update build-status.json for real-time dashboard accuracy
    // This is the canonical source that projectsList reads for current status
    const statusKey = `projects/${body.project_id}/build-status.json`;
    const statusContent = JSON.stringify(buildStatus, null, 2);
    await env.PROJECTS_BUCKET.put(statusKey, statusContent, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        project_id: body.project_id,
        status: body.status,
        updated_at: new Date().toISOString(),
        source: 'github_actions_callback'
      }
    });

    console.info(`✅ Project metadata updated for ${body.project_id} (source: ${metadataSource}, status: ${body.status})`);

    // Auto-deploy on successful builds
    let autoDeploy: {
      triggered: boolean;
      success?: boolean;
      url?: string;
      deployment_id?: string;
      error?: string;
    } | undefined;

    // CRITICAL FIX: Accept multiple success status values
    // GitHub workflow might send 'success', 'completed', or 'succeeded'
    const successStatuses = ['completed', 'success', 'succeeded'];
    const isSuccessfulBuild = successStatuses.includes(body.status?.toLowerCase());
    
    console.info(`[GITHUB-CALLBACK] Build status: ${body.status}, is successful: ${isSuccessfulBuild}`);
    console.info(`[GITHUB-CALLBACK] Has R2 info: ${!!normalizedR2}`);
    
    if (isSuccessfulBuild && normalizedR2) {
      try {
        console.info(`🔄 Starting GitHub build deployment for project ${body.project_id} (status: ${body.status})`);
        console.info(`[GITHUB-DEPLOY] R2 build path from callback: ${normalizedR2.build_path}`);
        
        // CRITICAL FIX: Normalize the build path to ensure consistency
        // GitHub might send various formats, we need to handle them all
        let normalizedBuildPath = normalizedR2.build_path;
        
        // Remove any trailing slashes
        normalizedBuildPath = normalizedBuildPath.replace(/\/$/, '');
        
        // If path doesn't start with 'builds/', add it
        if (!normalizedBuildPath.startsWith('builds/')) {
          // Handle old format: projects/{id}/builds/{timestamp}
          if (normalizedBuildPath.startsWith('projects/')) {
            // Extract the meaningful part: {id}/builds/{timestamp}
            const match = normalizedBuildPath.match(/projects\/([^\/]+)\/builds\/(.+)/);
            if (match) {
              normalizedBuildPath = `builds/${match[1]}/${match[2]}`;
            }
          } else {
            // Assume it's missing the builds/ prefix
            normalizedBuildPath = `builds/${normalizedBuildPath}`;
          }
        }
        
        console.info(`📍 Normalized build path: ${normalizedBuildPath} (original: ${normalizedR2.build_path})`);
        
        // DAY 7 REFACTOR: Use DeployService instead of custom deployment logic
        // This ensures consistent deployment behavior across all handlers
        const deployService = ServiceFactory.getDeployService(env);
        const deployResult = await deployService.deployBuildFromPath(
          body.project_id,
          normalizedBuildPath
        );
        
        if (deployResult.ok) {
          autoDeploy = {
            triggered: true,
            success: true,
            url: deployResult.value.deploymentUrl,
            deployment_id: crypto.randomUUID(),
            error: undefined
          };
          console.info(`✅ Successfully deployed GitHub build for ${body.project_id} to ${deployResult.value.deploymentUrl}`);
        } else {
          autoDeploy = {
            triggered: true,
            success: false,
            url: '',
            deployment_id: '',
            error: deployResult.error.message
          };
          console.error(`❌ Failed to deploy GitHub build for ${body.project_id}: ${deployResult.error.message}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Auto-deploy failed for ${body.project_id}:`, e);
        autoDeploy = { triggered: true, success: false, error: msg };
      }
    }

    const responseMessage = isSuccess 
      ? `✅ Build completed successfully! Artifacts stored at R2 path: ${(normalizedR2 && normalizedR2.build_path) || 'unknown'}`
      : `❌ Build failed: ${body.error?.message || 'Unknown error'}`;

    return successResponse({
      message: 'Enhanced build status updated successfully',
      project_id: body.project_id,
      status: body.status,
      // Prefer Worker live URL for clients
      deployment_url: isSuccess ? (autoDeploy?.url || workersDeploymentUrl) : undefined,
      details: responseMessage,
      r2_info: normalizedR2 ? {
        build_path: normalizedR2.build_path,
        bucket_name: normalizedR2.bucket_name,
        ready: isSuccess
      } : undefined,
      next_steps: isSuccess && body.r2_storage ? [
        'Build artifacts are ready in R2 storage',
        `Access build manifest: ${body.artifacts?.r2_manifest}`,
        'Auto-deploy executed; Worker URL returned below',
        `Expected live URL: ${workersDeploymentUrl}`
      ] : body.status === 'failed' && body.troubleshooting ? [
        `Check build logs: ${body.troubleshooting.logs_location}`,
        `Documentation: ${body.troubleshooting.documentation}`,
        'Review error causes and retry build if needed'
      ] : undefined,
      auto_deploy: autoDeploy
    });

  } catch (error) {
    console.error('GitHub build callback error:', error);
    return errorResponse(
      'CALLBACK_FAILED',
      'Failed to process enhanced build callback',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * List available GitHub Actions workflows
 * GET /api/github/workflows
 */
export async function listGitHubWorkflowsHandler(_request: Request, env: Env): Promise<Response> {
  try {
    const githubToken = env.GITHUB_TOKEN;
    const repositoryFullName = env.GITHUB_REPOSITORY;

    if (!githubToken || !repositoryFullName) {
      return errorResponse(
        'MISSING_CONFIGURATION',
        'GitHub integration not configured',
        400
      );
    }

    const githubClient = createGitHubApiClient(githubToken);
    
    // Get recent workflow runs
    const recentRuns = await githubClient.getLatestWorkflowRun(repositoryFullName, 'gpthost-build.yml');
    
    return successResponse({
      workflows: [
        {
          name: 'GPTHost Build',
          filename: 'gpthost-build.yml',
          status: 'active',
          recent_run: recentRuns
        }
      ],
      repository: repositoryFullName,
      total_workflows: 1
    });

  } catch (error) {
    console.error('GitHub workflows list error:', error);
    return errorResponse(
      'WORKFLOWS_LIST_FAILED',
      'Failed to list GitHub workflows',
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}
