/**
 * GREEN Phase TDD Test: HTML Framework Pipeline
 *
 * Validates HTML paste → scaffolding → listing works end-to-end.
 */

import { describe, it, expect, beforeEach } from 'vitest';

const API_BASE_URL = process.env.GPTHOST_API_URL || 'http://localhost:8787';

// Real HTML content from AI-generated technical report
const HTML_REPORT_CONTENT = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Qashier Technical Analysis Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 {
            color: #333;
            border-bottom: 3px solid #667eea;
            padding-bottom: 10px;
        }
        .metric-card {
            background: #f7f9fc;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .chart-container {
            position: relative;
            height: 400px;
            margin: 30px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Qashier POS System - Technical Analysis</h1>
        
        <div class="metric-card">
            <h2>System Overview</h2>
            <p>Cloud-based point-of-sale system with real-time analytics</p>
            <ul>
                <li>Transaction Processing: 1.2M daily</li>
                <li>Response Time: <200ms average</li>
                <li>Uptime: 99.95% SLA</li>
            </ul>
        </div>

        <div class="metric-card">
            <h2>Performance Metrics</h2>
            <div class="chart-container">
                <canvas id="performanceChart"></canvas>
            </div>
        </div>

        <script>
            // Chart.js initialization
            const ctx = document.getElementById('performanceChart').getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                    datasets: [{
                        label: 'Response Time (ms)',
                        data: [180, 195, 175, 165, 190, 185],
                        borderColor: '#667eea',
                        backgroundColor: 'rgba(102, 126, 234, 0.1)',
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top'
                        }
                    }
                }
            });
        </script>
    </div>
</body>
</html>
`;

describe('HTML Framework Pipeline - Green', () => {
  let projectId: string | null = null;

  beforeEach(() => {
    projectId = null;
  });

  it('uploads HTML via paste, scaffolds, and lists project', async () => {
    const pasteResponse = await fetch(`${API_BASE_URL}/api/paste`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-valid-token-12345'
      },
      body: JSON.stringify({
        content: HTML_REPORT_CONTENT,
        project_name: `qashier-tech-report-${Date.now()}`
      })
    });

    const responseData = await pasteResponse.json();
    expect(pasteResponse.status).toBe(201);
    expect(responseData.data?.project_id).toBeTruthy();
    projectId = responseData.data?.project_id;

    // Step 2: Verify project appears in listing
    const listResponse = await fetch(`${API_BASE_URL}/api/projects`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-valid-token-12345'
      }
    });

    const projects = await listResponse.json();
    const projectsList = projects.data?.projects || [];
    const createdProject = projectsList.find((p: any) => (p.id || p.project_id) === projectId);
    expect(createdProject).toBeDefined();
    expect((createdProject.framework || '').toLowerCase()).toBe('html');
  });

  it('scaffolding succeeds for HTML paste', async () => {
    const scaffoldResponse = await fetch(`${API_BASE_URL}/api/paste`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-valid-token-12345'
      },
      body: JSON.stringify({
        content: HTML_REPORT_CONTENT,
        project_name: `html-scaffolding-test-${Date.now()}`
      })
    });

    const scaffoldResult = await scaffoldResponse.json();
    expect(scaffoldResponse.status).toBe(201);
    expect(scaffoldResult?.data?.project_id).toBeTruthy();
    projectId = scaffoldResult.data.project_id;
  });

  it('multiple HTML uploads appear in listings', async () => {
    const projectIds: string[] = [];
    
    // Upload 3 HTML files
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${API_BASE_URL}/api/paste`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-valid-token-12345'
        },
        body: JSON.stringify({
          content: HTML_REPORT_CONTENT,
          project_name: `html-report-${i}-${Date.now()}`
        })
      });

      const data = await response.json();
      expect(response.status).toBe(201);
      expect(data.data?.project_id).toBeTruthy();
      projectIds.push(data.data.project_id);
    }

    expect(projectIds.length).toBe(3);

    const listResponse = await fetch(`${API_BASE_URL}/api/projects`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-valid-token-12345'
      }
    });
    const projects = await listResponse.json();
    const projectsList = projects.data?.projects || [];
    const foundCount = projectIds.filter(id => 
      projectsList.some((p: any) => (p.id || p.project_id) === id)
    ).length;
    expect(foundCount).toBe(3);
  });
});
