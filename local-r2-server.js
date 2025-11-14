#!/usr/bin/env node
/**
 * Simple local server to serve R2 deployment files for development testing
 * This simulates the public R2 URL access that works in production
 */

const http = require('http');
const fs = require('fs').promises;
const path = require('path');

const PORT = 3001;
const R2_SIMULATION_PATH = path.join(__dirname, '.wrangler/state/v3/r2/gpthost-deployments-staging');

async function serveSite(res, sitePath) {
  try {
    // Try to serve index.html
    const indexPath = path.join(R2_SIMULATION_PATH, sitePath, 'index.html');
    const content = await fs.readFile(indexPath, 'utf8');
    
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=3600'
    });
    res.end(content);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Site not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // Handle /sites/{project-id}/ requests
  const siteMatch = url.pathname.match(/^\/sites\/([a-f0-9\-]+)\/?$/);
  if (siteMatch) {
    const projectId = siteMatch[1];
    await serveSite(res, `sites/${projectId}`);
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🌐 Local R2 simulation server running on http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${R2_SIMULATION_PATH}`);
  console.log(`🔗 Test URLs: http://localhost:${PORT}/sites/{project-id}/`);
});