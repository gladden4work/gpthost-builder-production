#!/usr/bin/env node
/*
  Live E2E runner (Node) – drives the deployed Worker + GitHub Actions
  Usage:
    node scripts/run-live-e2e.js \
      --worker-url=https://gpthost-builder-staging.gladden4work.workers.dev \
      --token=<MVP_ACCESS_TOKEN> \
      [--timeout-ms=600000] [--poll-ms=5000]

  If args not supplied, tries to read from .dev.vars in current directory.
*/

const fs = require('fs');

function readDevVars() {
  try {
    const text = fs.readFileSync('.dev.vars', 'utf-8');
    const out = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      out[m[1]] = val;
    }
    return out;
  } catch {
    return {};
  }
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function main(){
  const dev = readDevVars();
  const args = parseArgs(process.argv);
  const WORKER_URL = args['worker-url'] || process.env.WORKER_URL || dev.WORKER_URL;
  const TOKEN = args.token || process.env.MVP_ACCESS_TOKEN || dev.MVP_ACCESS_TOKEN;
  const TIMEOUT = parseInt(args['timeout-ms'] || process.env.TIMEOUT_MS || '600000');
  const POLL = parseInt(args['poll-ms'] || process.env.POLL_MS || '5000');

  if (!WORKER_URL || !TOKEN) {
    console.error('Missing required configuration. Provide --worker-url and --token or set in .dev.vars');
    process.exit(2);
  }

  const headers = { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
  const files = [
    { path: 'src/App.tsx', content: 'export default function App(){return <div>Hello Live</div>}' },
    { path: 'index.html', content: '<!doctype html><div id="root"></div>' },
  ];

  console.log('1) Creating project...');
  const createResp = await fetch(`${WORKER_URL}/api/v2/projects`, {
    method: 'POST', headers, body: JSON.stringify({ name: `live-e2e-${Date.now()}`, framework: 'react', files })
  });
  const createJson = await createResp.json().catch(()=>({}));
  console.log('Create:', createResp.status, createJson);
  if (!createResp.ok || !createJson?.success) {
    process.exit(1);
  }
  const projectId = createJson.data.id;

  console.log('2) Queueing build...');
  const buildResp = await fetch(`${WORKER_URL}/api/v2/build`, {
    method: 'POST', headers, body: JSON.stringify({ project_id: projectId })
  });
  const buildJson = await buildResp.json().catch(()=>({}));
  console.log('Queue:', buildResp.status, buildJson);
  if (!buildResp.ok || !buildJson?.success) process.exit(1);
  const buildId = buildJson.data.build_id;

  console.log('3) Polling build status until terminal...');
  const start = Date.now();
  let status = 'queued';
  while (Date.now() - start < TIMEOUT) {
    await sleep(POLL);
    const s = await fetch(`${WORKER_URL}/api/v2/build/${encodeURIComponent(buildId)}`, {
      method: 'GET', headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const sj = await s.json().catch(()=>({}));
    console.log('Status:', s.status, sj?.data?.status, sj?.data?.currentStep);
    if (sj?.data?.status) status = sj.data.status;
    if (status === 'success' || status === 'failed' || status === 'cancelled') break;
  }
  console.log('Final status:', status);
  if (status !== 'success') process.exit(1);

  console.log('4) Checking deployment URL...');
  let deploymentUrl;
  const pr = await fetch(`${WORKER_URL}/api/v2/projects/${encodeURIComponent(projectId)}`, {
    method: 'GET', headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  if (pr.ok) {
    const pj = await pr.json().catch(()=>({}));
    deploymentUrl = pj?.data?.deployment_url;
    console.log('Project:', pr.status, pj);
  }
  if (!deploymentUrl) {
    console.log('5) Triggering deploy...');
    const depResp = await fetch(`${WORKER_URL}/api/v2/deploy`, {
      method: 'POST', headers, body: JSON.stringify({ build_id: buildId })
    });
    const dj = await depResp.json().catch(()=>({}));
    console.log('Deploy:', depResp.status, dj);
    if (!depResp.ok || !dj?.success) process.exit(1);
    deploymentUrl = dj.data.deployment_url;
  }
  console.log('Deployment URL:', deploymentUrl);

  console.log('6) Verifying site via Worker /sites route...');
  const siteResp = await fetch(`${WORKER_URL}/sites/${encodeURIComponent(projectId)}/`);
  const siteText = await siteResp.text();
  console.log('Site status:', siteResp.status);
  console.log('Site snippet:', siteText.slice(0, 200));
  if (siteResp.status !== 200) process.exit(1);

  console.log('✅ Live E2E completed successfully');
}

main().catch((e)=>{ console.error('Live E2E failed:', e); process.exit(1); });

