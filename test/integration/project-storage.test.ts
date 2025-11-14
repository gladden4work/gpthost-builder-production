/**
 * GREEN Phase TDD Test: Project Storage Consistency
 * 
 * Validates that projects created via paste API are retrievable via listing
 * and paths/metadata are consistent.
 */

import { describe, it, expect, beforeEach } from 'vitest';

const API_BASE_URL = process.env.GPTHOST_API_URL || 'http://localhost:8787';

// Test utilities
async function createProject(content: string, projectName: string) {
  const response = await fetch(`${API_BASE_URL}/api/paste`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-valid-token-12345'
    },
    body: JSON.stringify({ content, project_name: projectName })
  });
  return { status: response.status, body: await response.json() };
}

async function listProjects() {
  const response = await fetch(`${API_BASE_URL}/api/projects`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-valid-token-12345'
    }
  });
  return response.json();
}

describe('Project Storage Consistency - Integration Tests', () => {
  
  describe('Storage Path Alignment', () => {
    it('Created project should immediately appear in listing', async () => {
      // Create a project
      const testCode = `
        import React from 'react';
        export default function Test() {
          return <div>Storage Test Component</div>;
        }
      `;
      
      console.log('Creating project via paste API...');
      const createResult = await createProject(testCode, `storage-test-${Date.now()}`);
      expect(createResult.status).toBe(201);
      expect(createResult.body?.data?.project_id).toBeTruthy();
      const projectId = createResult.body.data.project_id;
      console.log('Created project ID:', projectId);
      
      // Immediately list projects
      console.log('Fetching project list...');
      const projectsResp = await listProjects();
      const projects = projectsResp?.data?.projects || [];
      console.log('Projects found:', projects.length);
      
      // Bug #2: Project doesn't appear in listing
      const foundProject = projects.find((p: any) => (p.id || p.project_id) === projectId);
      expect(foundProject).toBeDefined();
      expect((foundProject.id || foundProject.project_id)).toBe(projectId);
    });

    it('Storage paths should be consistent across operations', async () => {
      // This test verifies the storage path structure
      
      const testCode = `<div>Path Test</div>`;
      
      // Create project
      const createResult = await createProject(testCode, `path-test-${Date.now()}`);
      expect(createResult.status).toBe(201);
      const projectId = createResult.body?.data?.project_id as string;
      
      // Listing
      const projectsResp = await listProjects();
      const projects = projectsResp?.data?.projects || [];
      const listedProject = projects.find((p: any) => (p.id || p.project_id) === projectId);
      expect(listedProject).toBeTruthy();
    });

    it('Multiple creates should all appear in listing', async () => {
      // Create multiple projects in sequence
      const projectIds: string[] = [];
      
      for (let i = 0; i < 3; i++) {
        const code = `<div>Project ${i}</div>`;
        const result = await createProject(code, `project-${i}-${Date.now()}`);
        if (result.body?.data?.project_id) {
          projectIds.push(result.body.data.project_id);
          console.log(`Created project ${i}: ${result.body.data.project_id}`);
        }
      }
      
      expect(projectIds.length).toBe(3);
      
      // List all projects
      const projectsResp = await listProjects();
      const projects = projectsResp?.data?.projects || [];
      console.log('Total projects in list:', projects.length);
      
      // Count how many of our projects appear
      const foundCount = projectIds.filter(id => 
        projects.some((p: any) => (p.id || p.project_id) === id)
      ).length;
      expect(foundCount).toBe(3);
    });
  });

  describe('Metadata Storage', () => {
    it('Project metadata should be properly stored and retrievable', async () => {
      // Test that metadata.json is stored correctly
      
      const testCode = `
        function App() {
          return <h1>Metadata Test</h1>;
        }
        export default App;
      `;
      
      const createResult = await createProject(testCode, `metadata-test-${Date.now()}`);
      const projectId = createResult.body?.data?.project_id;
      
      // Wait a moment for storage operations
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Fetch project details
      const projectsResp = await listProjects();
      const projects = projectsResp?.data?.projects || [];
      const listedProject = projects.find((p: any) => (p.id || p.project_id) === projectId);
      expect(listedProject).toBeDefined();
    });

    it('Project indexing should update after creation', async () => {
      // Test that project index is updated
      
      // Get initial project count
      const initialProjectsResp = await listProjects();
      const initialCount = (initialProjectsResp?.data?.projects || []).length;
      console.log('Initial project count:', initialCount);
      
      // Create a new project
      const testCode = `<button>Index Test</button>`;
      const createResult = await createProject(testCode, `index-test-${Date.now()}`);
      expect(createResult.status).toBe(201);
      
      // Get updated project count
      const updatedProjectsResp = await listProjects();
      const updatedCount = (updatedProjectsResp?.data?.projects || []).length;
      console.log('Updated project count:', updatedCount);
      
      expect(updatedCount).toBe(initialCount + 1);
    });
  });

  describe('Storage Directory Structure', () => {
    it('Paste handler and list handler should use same directory structure', async () => {
      // This test validates the directory paths used
      
      const testCode = `
        const Component = () => <div>Directory Test</div>;
        export default Component;
      `;
      
      // Create via paste
      const pasteResult = await createProject(testCode, `dir-test-${Date.now()}`);
      const projectId = pasteResult.body?.data?.project_id;
      
      // The paste handler stores at one path
      console.log('Paste result:', pasteResult);
      
      // Try to find in list
      const projectsResp = await listProjects();
      const projects = projectsResp?.data?.projects || [];
      const inList = projects.find((p: any) => (p.id || p.project_id) === projectId);
      
      // Directory consistency is validated by presence in list
      expect(inList).toBeDefined();
    });

    it('Project files should be stored in consistent location', async () => {
      // Verify file storage consistency
      
      const testCode = `
        export default function App() {
          return <div>File Storage Test</div>;
        }
      `;
      
      const createResult = await createProject(testCode, `storage-${Date.now()}`);
      const projectId = createResult.body?.data?.project_id;
      
      // Check if project files are accessible
      const filesResponse = await fetch(`${API_BASE_URL}/api/scaffolding/${projectId}/files`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-valid-token-12345'
        }
      });
      
      if (filesResponse.ok) {
        const filesPayload = await filesResponse.json();
        const files = Array.isArray(filesPayload) ? filesPayload : (filesPayload.data?.files || filesPayload.files || []);
        expect(Array.isArray(files)).toBe(true);
      }
      
      // Check if metadata exists
      const metadataResponse = await fetch(`${API_BASE_URL}/api/scaffolding/${projectId}/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-valid-token-12345'
        }
      });
      
      if (metadataResponse.ok) {
        const metadataPayload = await metadataResponse.json();
        const metadata = metadataPayload.data || metadataPayload;
        expect(metadata.project_id).toBe(projectId);
      }
      
      // Bug #2: Project should also be in list
      const projectsResp2 = await listProjects();
      const projects2 = projectsResp2?.data?.projects || [];
      const found = projects2.some((p: any) => (p.id || p.project_id) === projectId);
      expect(found).toBe(true);
    });
  });
});
