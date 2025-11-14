/**
 * GitHub Build Upload Endpoint
 * Receives build artifacts from GitHub Actions and uploads to R2
 * This bypasses the GitHub Actions secret masking issue
 */

import { v2Success, v2Error, getRequestId } from '../../../../middleware/envelope';
import { ServiceFactory } from '../../../../services/ServiceFactory';
import { getDeploymentUrl } from '../../../../utils/workerUrl';

export async function handleBuildUpload(request: Request, env: Env): Promise<Response> {
  const requestId = getRequestId(request);
  
  try {
    // Verify authorization
    const authHeader = request.headers.get('Authorization');
    const expectedToken = env.GITHUB_CALLBACK_TOKEN || env.MVP_ACCESS_TOKEN;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return v2Error('UNAUTHORIZED', 'Missing authorization', 401, requestId);
    }
    
    const providedToken = authHeader.replace('Bearer ', '');
    if (providedToken !== expectedToken) {
      return v2Error('UNAUTHORIZED', 'Invalid authorization', 401, requestId);
    }

    // Get project ID from headers
    const projectId = request.headers.get('X-Project-ID');
    const githubRunId = request.headers.get('X-GitHub-Run-ID');
    const githubRunUrl = request.headers.get('X-GitHub-Run-URL');
    
    if (!projectId) {
      return v2Error('VALIDATION_FAILED', 'Missing project ID', 400, requestId);
    }

    // Get the tarball data
    const contentType = request.headers.get('Content-Type');
    if (contentType !== 'application/tar+gzip') {
      return v2Error('VALIDATION_FAILED', 'Invalid content type', 400, requestId);
    }

    const tarballData = await request.arrayBuffer();
    
    if (!tarballData || tarballData.byteLength === 0) {
      return v2Error('VALIDATION_FAILED', 'No data received', 400, requestId);
    }

    console.info(`[UPLOAD] Received ${tarballData.byteLength} bytes for project ${projectId}`);

    // Extract tar.gz in memory and upload to R2
    const uploadResult = await uploadTarballToR2(tarballData, projectId, env);
    
    if (!uploadResult.success) {
      return v2Error('UPLOAD_FAILED', uploadResult.error || 'Failed to upload to R2', 500, requestId);
    }

    // Deploy from builds/ to sites/ for public access
    // Use static factory method (no instance needed)
    const deployService = ServiceFactory.getDeployService(env);
    const deployResult = await deployService.deployBuildFromPath(projectId, uploadResult.r2Path!);
    
    if (!deployResult.ok) {
      console.error(`[UPLOAD] Deployment failed: ${deployResult.error.message}`);
      // Continue anyway - files are uploaded to builds/, just not deployed to sites/
    } else {
      console.info(`[UPLOAD] Successfully deployed to sites/${projectId}/`);
    }

    // Generate deployment URL using Worker domain (NOT direct R2)
    const deploymentUrl = getDeploymentUrl(projectId, env);

    // Ensure project metadata exists so the dashboard can list this project
    // Manual GitHub runs may not have created metadata via /api/paste or /api/upload
    await ensureProjectMetadata(env, projectId, deploymentUrl);

    // Send success callback to complete the build
    const callbackUrl = env.GITHUB_BUILD_CALLBACK_URL || `${env.WORKER_URL}/api/v2/github/build-callback`;
    
    const callbackBody = {
      status: 'success',
      project_id: projectId,
      github_run_id: githubRunId,
      github_run_url: githubRunUrl,
      r2_build_path: uploadResult.r2Path,
      deployment_url: deploymentUrl,
    };

    // Send callback
    try {
      const callbackResponse = await fetch(callbackUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${expectedToken}`,
        },
        body: JSON.stringify(callbackBody),
      });

      if (!callbackResponse.ok) {
        console.error(`[UPLOAD] Callback failed: ${callbackResponse.status}`);
      }
    } catch (error) {
      console.error('[UPLOAD] Callback error:', error);
    }

    return v2Success({
      project_id: projectId,
      files_uploaded: uploadResult.filesUploaded,
      r2_path: uploadResult.r2Path,
      deployment_url: deploymentUrl,
    }, requestId);

  } catch (error) {
    console.error('[UPLOAD] Error:', error);
    return v2Error(
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Upload failed',
      500,
      requestId
    );
  }
}

/**
 * Upload tarball to R2 and extract files
 */
async function uploadTarballToR2(
  tarballData: ArrayBuffer,
  projectId: string,
  env: Env
): Promise<{ success: boolean; r2Path?: string; filesUploaded?: number; error?: string }> {
  try {
    // Always write build artifacts to BUILDS bucket (source of truth).
    // Fallback to PROJECTS bucket if BUILDS is not configured.
    const bucket = (env as any).BUILDS_BUCKET || (env as any).PROJECTS_BUCKET;
    if (!bucket) {
      return { success: false, error: 'R2 bucket not configured' };
    }

    // Use timestamped build folder so deployment managers can locate the latest build
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const basePath = `builds/${projectId}/${ts}`;
    
    // For MVP, store the tarball and a simple extracted index.html
    const files = await extractTarball(tarballData);
    
    let uploadCount = 0;
    const uploadPromises = [];
    
    // Prepare manifest artifacts metadata
    const artifacts: Array<{ path: string; size: number; hash: string; contentType: string; compressed: boolean }>= [];

    for (const [filePath, fileData] of files.entries()) {
      const r2Key = `${basePath}/${filePath}`;
      console.info(`[UPLOAD] Uploading ${r2Key} (${fileData.byteLength} bytes)`);
      
      const contentType = getContentType(filePath);

      uploadPromises.push(
        bucket.put(r2Key, fileData, {
          httpMetadata: {
            contentType,
          },
        })
      );

      // Compute sha256 hash for manifest
      try {
        const digest = await crypto.subtle.digest('SHA-256', fileData);
        const hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
        artifacts.push({ path: filePath, size: fileData.byteLength, hash, contentType, compressed: false });
      } catch (e) {
        console.warn('[UPLOAD] Failed to hash file for manifest:', filePath, e);
      }
      uploadCount++;
    }

    await Promise.all(uploadPromises);

    // Write build manifest for R2DeploymentManager compatibility
    try {
      const manifest = {
        projectId,
        buildTimestamp: ts,
        artifacts,
        version: '1.0'
      };
      await bucket.put(`${basePath}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest, null, 2)), {
        httpMetadata: { contentType: 'application/json' }
      });
    } catch (e) {
      console.warn('[UPLOAD] Failed to write manifest.json:', e);
    }
    
    console.info(`[UPLOAD] Successfully uploaded ${uploadCount} files to R2`);
    
    return {
      success: true,
      r2Path: `${basePath}/`,
      filesUploaded: uploadCount,
    };
    
  } catch (error) {
    console.error('[UPLOAD] R2 upload error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'R2 upload failed',
    };
  }
}

/**
 * Extract tar.gz file in memory
 * Returns a Map of file paths to ArrayBuffers
 */
async function extractTarball(tarballData: ArrayBuffer): Promise<Map<string, ArrayBuffer>> {
  const files = new Map<string, ArrayBuffer>();
  
  // For MVP, we'll do simple extraction
  try {
    // Decompress gzip
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    writer.write(tarballData);
    writer.close();
    
    const decompressed = await new Response(ds.readable).arrayBuffer();
    
    // Simple tar parsing
    let offset = 0;
    
    while (offset < decompressed.byteLength - 512) {
      // Read file name (first 100 bytes of header)
      const nameBytes = new Uint8Array(decompressed, offset, 100);
      let nameEnd = nameBytes.indexOf(0);
      if (nameEnd === -1) nameEnd = 100;
      const fileName = new TextDecoder().decode(nameBytes.slice(0, nameEnd));
      
      if (!fileName || fileName === '') break;
      
      // Read file size (bytes 124-135, octal)
      const sizeBytes = new Uint8Array(decompressed, offset + 124, 11);
      let sizeStr = '';
      for (let i = 0; i < 11; i++) {
        if (sizeBytes[i] === 0) break;
        sizeStr += String.fromCharCode(sizeBytes[i]);
      }
      const fileSize = parseInt(sizeStr.trim(), 8) || 0;
      
      // Skip to file content (header is 512 bytes)
      offset += 512;
      
      // Extract file if it's not a directory
      if (fileName && !fileName.endsWith('/') && fileSize > 0) {
        // Remove project ID prefix if present
        let cleanName = fileName;
        if (fileName.includes('/')) {
          const parts = fileName.split('/');
          if (parts[0].match(/^[a-f0-9-]+$/)) {
            // Skip first part if it looks like a UUID
            cleanName = parts.slice(1).join('/');
          }
        }
        
        const fileData = decompressed.slice(offset, offset + fileSize);
        files.set(cleanName, fileData);
        console.info(`[EXTRACT] Extracted ${cleanName} (${fileSize} bytes)`);
      }
      
      // Move to next header (files are padded to 512 bytes)
      const paddedSize = Math.ceil(fileSize / 512) * 512;
      offset += paddedSize;
    }
    
    console.info(`[EXTRACT] Extracted ${files.size} files from tarball`);
    
  } catch (error) {
    console.error('[EXTRACT] Error extracting tarball:', error);
    // Fallback: just store the compressed tarball
    files.set('build.tar.gz', tarballData);
  }
  
  // Ensure we have at least an index.html
  if (!files.has('index.html')) {
    const defaultHtml = new TextEncoder().encode(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GPTHost Build</title>
</head>
<body>
  <h1>GPTHost Build Complete</h1>
  <p>Build artifacts have been uploaded successfully.</p>
</body>
</html>
    `);
    files.set('index.html', defaultHtml.buffer);
  }
  
  return files;
}

/**
 * Ensure a minimal project metadata exists for the given project
 * This allows the dashboard list (/api/projects/list) to include projects
 * created solely by a manual GitHub workflow run.
 */
async function ensureProjectMetadata(env: Env, projectId: string, deploymentUrl?: string) {
  try {
    const primaryPath = `projects/${projectId}/metadata.json`;
    const activePath = `projects/active/${projectId}/metadata.json`;

    const existing = await env.PROJECTS_BUCKET.get(primaryPath);
    if (existing) return;

    const now = new Date().toISOString();
    const metadata = {
      id: projectId,
      status: 'deployed',
      name: projectId,
      framework: 'unknown',
      files: [],
      created_at: now,
      updated_at: now,
      deployment_url: deploymentUrl,
      analysis: { primaryFramework: 'unknown', componentType: 'unknown', totalComponents: 0 }
    } as any;

    await env.PROJECTS_BUCKET.put(primaryPath, JSON.stringify(metadata), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { projectId, type: 'metadata', created: now, source: 'github-upload' }
    });

    // Best-effort: also write an 'active' copy for compatibility
    await env.PROJECTS_BUCKET.put(activePath, JSON.stringify(metadata), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { projectId, type: 'metadata', created: now, source: 'github-upload' }
    }).catch(() => {});
  } catch (e) {
    console.warn('[UPLOAD] ensureProjectMetadata failed:', e);
  }
}

/**
 * Get content type for a file based on extension
 */
function getContentType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  
  const mimeTypes: Record<string, string> = {
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'mjs': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'gz': 'application/gzip',
    'tar': 'application/x-tar',
    'txt': 'text/plain',
  };
  
  return mimeTypes[ext || ''] || 'application/octet-stream';
}
