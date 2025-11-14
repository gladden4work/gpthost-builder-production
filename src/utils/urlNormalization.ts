/**
 * URL Normalization Utility
 *
 * Scans project metadata and replaces any R2-based deployment/public URLs
 * with the correct Worker URL so clients always get routable links.
 */

export interface UrlNormalizationResult {
  success: boolean;
  projects_scanned: number;
  projects_updated: number;
  projects_unchanged: number;
  errors: Array<{ project_id: string; error: string }>;
}

function deriveWorkersBase(env: Env): string {
  try {
    const cb = env.GITHUB_BUILD_CALLBACK_URL as string | undefined;
    if (cb && cb.includes('workers.dev')) {
      const u = new URL(cb);
      return `${u.protocol}//${u.host}`;
    }
    const envName = (env.ENVIRONMENT as string) || 'staging';
    if (envName === 'production') return 'https://gpthost-builder.gladden4work.workers.dev';
    if (envName === 'staging') return 'https://gpthost-builder-staging.gladden4work.workers.dev';
    return 'http://localhost:8787';
  } catch {
    return 'http://localhost:8787';
  }
}

export async function normalizeDeploymentUrls(env: Env): Promise<UrlNormalizationResult> {
  const projectsBucket = env.PROJECTS_BUCKET;
  const workersBase = deriveWorkersBase(env);
  const result: UrlNormalizationResult = {
    success: true,
    projects_scanned: 0,
    projects_updated: 0,
    projects_unchanged: 0,
    errors: []
  };

  try {
    const list = await projectsBucket.list({ prefix: 'projects/', include: ['customMetadata'] });
    const metadataKeys = list.objects
      .map(o => o.key)
      .filter(k => k.endsWith('/metadata.json') && !k.includes('/active/'));

    for (const key of metadataKeys) {
      result.projects_scanned++;
      const projectId = key.split('/')[1];
      try {
        const obj = await projectsBucket.get(key);
        if (!obj) continue;
        const meta = JSON.parse(await obj.text());

        let changed = false;
        const workerUrl = `${workersBase}/sites/${projectId}/`;

        const isR2 = (url: any) => typeof url === 'string' && url.includes('.r2.dev/');

        if (isR2(meta.deployment_url)) {
          meta.deployment_url = workerUrl;
          changed = true;
        }

        if (meta.last_build && isR2(meta.last_build.public_url_base)) {
          meta.last_build.public_url_base = workerUrl;
          changed = true;
        }

        if (meta.deployment_info && isR2(meta.deployment_info.public_url_base)) {
          meta.deployment_info.public_url_base = workerUrl;
          changed = true;
        }

        if (!changed) {
          result.projects_unchanged++;
          continue;
        }

        meta.updated_at = new Date().toISOString();

        const content = JSON.stringify(meta, null, 2);
        await projectsBucket.put(key, content, { 
          httpMetadata: { contentType: 'application/json' },
          customMetadata: { project_id: projectId, normalized_urls: 'true' }
        });

        // If active path exists, update it too for consistency
        const activeKey = `projects/active/${projectId}/metadata.json`;
        const activeObj = await projectsBucket.get(activeKey);
        if (activeObj) {
          await projectsBucket.put(activeKey, content, { 
            httpMetadata: { contentType: 'application/json' },
            customMetadata: { project_id: projectId, normalized_urls: 'true' }
          });
        }

        result.projects_updated++;
      } catch (e) {
        result.errors.push({ project_id: projectId, error: e instanceof Error ? e.message : String(e) });
        result.success = false;
      }
    }

  } catch (e) {
    result.success = false;
    result.errors.push({ project_id: 'LIST', error: e instanceof Error ? e.message : String(e) });
  }

  return result;
}

