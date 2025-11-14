/**
 * LIVE E2E Test – Uses real GitHub Actions + staging Worker
 *
 * Opt-in via environment variable LIVE_E2E=1 and required configuration:
 * - WORKER_URL: e.g. https://gpthost-builder-staging.gladden4work.workers.dev
 * - MVP_ACCESS_TOKEN: Bearer token for API auth on the Worker
 *
 * Optional:
 * - TIMEOUT_MS: overall timeout (default 600000 = 10 min)
 * - POLL_MS: poll interval for build status (default 5000)
 *
 * This test:
 * 1) Creates a project on the real Worker
 * 2) Queues a build (Worker dispatches GitHub workflow in gladden4work/gpthost-build-test)
 * 3) Polls build status until success/failure
 * 4) If success but no auto-deploy, requests /api/v2/deploy
 * 5) Verifies deployed site is reachable from the Worker (/sites/{projectId}/)
 */

import { describe, it, expect } from 'vitest';

// Try to read from process.env first, then fall back to .dev.vars
function readVarsFromDevVars(): Record<string,string> {
  try {
    // Vitest runs from project root (gpthost-builder-staging)
    const text = require('fs').readFileSync('.dev.vars', 'utf-8');
    const out: Record<string,string> = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      // strip surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

const devVars = readVarsFromDevVars();
const WORKER_URL = process.env.WORKER_URL || process.env.STAGING_WORKER_URL || devVars.WORKER_URL;
const MVP_TOKEN = process.env.MVP_ACCESS_TOKEN || devVars.MVP_ACCESS_TOKEN;
// Enable live test automatically when required vars are present
const LIVE = (!!WORKER_URL && !!MVP_TOKEN && (process.env.LIVE_E2E !== '0')) || (process.env.LIVE_E2E === '1' || process.env.LIVE_E2E === 'true');
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '600000'); // 10 minutes
const POLL_MS = parseInt(process.env.POLL_MS || '5000');

function skipReason(): string | null {
  // Run when the required variables are present; allow disabling via LIVE_E2E=0
  if (process.env.LIVE_E2E === '0') return 'LIVE_E2E disabled';
  if (!WORKER_URL) return 'WORKER_URL not set';
  if (!MVP_TOKEN) return 'MVP_ACCESS_TOKEN not set';
  return null;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

describe.skipIf(!!skipReason())('LIVE E2E – GitHub workflow and callback', () => {
  it(
    'queues GitHub build, waits for callback, verifies deployment',
    async () => {
      const headers = { 'Authorization': `Bearer ${MVP_TOKEN}`, 'Content-Type': 'application/json' } as const;

      // 1) Create project with a minimal React app (workflow will scaffold/build)
      const files = [
        { path: 'src/App.tsx', content: 'export default function App(){return <div>Hello Live</div>}' },
        { path: 'index.html', content: '<!doctype html><div id="root"></div>' },
      ];

      const createResp = await fetch(`${WORKER_URL}/api/v2/projects`, {
        method: 'POST', headers, body: JSON.stringify({ name: `live-e2e-${Date.now()}`, framework: 'react', files })
      });
      expect([200,201]).toContain(createResp.status);
      const createJson = await createResp.json();
      expect(createJson.success).toBe(true);
      const projectId: string = createJson.data.id;

      // 2) Queue build (this should dispatch the GitHub workflow)
      const buildResp = await fetch(`${WORKER_URL}/api/v2/build`, {
        method: 'POST', headers, body: JSON.stringify({ project_id: projectId })
      });
      expect([200,202]).toContain(buildResp.status);
      const buildJson = await buildResp.json();
      expect(buildJson.success).toBe(true);
      const buildId: string = buildJson.data.build_id;

      // 3) Poll build status until success/failed (callback updates it)
      const start = Date.now();
      let status = 'queued';
      while (Date.now() - start < TIMEOUT_MS) {
        await sleep(POLL_MS);
        const s = await fetch(`${WORKER_URL}/api/v2/build/${encodeURIComponent(buildId)}`, {
          method: 'GET', headers: { 'Authorization': `Bearer ${MVP_TOKEN}` }
        });
        if (![200,202].includes(s.status)) continue;
        const sj = await s.json();
        if (!sj?.success) continue;
        status = sj.data.status;
        if (status === 'success' || status === 'failed' || status === 'cancelled') break;
      }

      expect(['success','failed','cancelled']).toContain(status);
      if (status !== 'success') {
        throw new Error(`Live E2E build did not succeed. Final status=${status}`);
      }

      // 4) Try to fetch deployment URL from project, else request deploy
      let deploymentUrl: string | undefined;
      {
        const pr = await fetch(`${WORKER_URL}/api/v2/projects/${encodeURIComponent(projectId)}`, {
          method: 'GET', headers: { 'Authorization': `Bearer ${MVP_TOKEN}` }
        });
        if (pr.ok) {
          const pj = await pr.json();
          deploymentUrl = pj?.data?.deployment_url;
        }
      }

      if (!deploymentUrl) {
        const depResp = await fetch(`${WORKER_URL}/api/v2/deploy`, {
          method: 'POST', headers, body: JSON.stringify({ build_id: buildId })
        });
        expect([200,202]).toContain(depResp.status);
        const dj = await depResp.json();
        expect(dj.success).toBe(true);
        deploymentUrl = dj.data.deployment_url;
      }

      expect(deploymentUrl).toBeDefined();

      // 5) Verify the site is reachable (prefer Worker /sites route)
      // If deploymentUrl is public domain, also test Worker /sites path for deterministic validation
      const sitesUrl = `${WORKER_URL}/sites/${encodeURIComponent(projectId)}/`;
      const siteResp = await fetch(sitesUrl);
      expect(siteResp.status).toBe(200);
      const siteHtml = await siteResp.text();
      expect(siteHtml).toMatch(/Hello Live|<html|<div/i);
    },
    TIMEOUT_MS + 120000 // vitest timeout budget
  );
});
