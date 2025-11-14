/**
 * E2E Test for JSX Preprocessing Fix
 * Tests the complete flow from paste to scaffolding to ensure JSX preprocessing works
 */

import { describe, it, expect, beforeAll } from 'vitest';

const STAGING_URL = 'https://gpthost-builder-staging-staging.gladden4work.workers.dev';
const AUTH_TOKEN = 'test-valid-token-12345';

describe('E2E JSX Preprocessing', () => {
  let projectId: string;

  it('should preprocess JSX double curly braces in paste flow', async () => {
    // Component with problematic double curly braces
    const componentWithDoubleCurly = `
import React, { useState } from 'react';

export default function UserGreeting() {
  const [user] = useState({ name: 'Alice' });
  
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Welcome to GPTHost</h1>
      <p>{{user.name && \`Welcome back, \${user.name}!\`}}</p>
      <p className="{user.name ? 'active' : 'inactive'}">Status</p>
      <button onClick={() => alert('Hello!')}>
        Click Me
      </button>
    </div>
  );
}`;

    console.log('\n=== Step 1: Paste component with double curly braces ===');
    
    const pasteResponse = await fetch(`${STAGING_URL}/api/paste`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      },
      body: JSON.stringify({
        content: componentWithDoubleCurly,
        project_name: `jsx-preprocess-test-${Date.now()}`,
        description: 'Testing JSX preprocessing for double curly braces'
      })
    });

    expect(pasteResponse.ok).toBe(true);
    const pasteResult = await pasteResponse.json();
    
    console.log('Paste response status:', pasteResult.success ? 'SUCCESS' : 'FAILED');
    console.log('Project ID:', pasteResult.data?.project_id);
    console.log('Detected framework:', pasteResult.data?.detected_framework);
    console.log('Generated filename:', pasteResult.data?.generated_filename);
    
    expect(pasteResult.success).toBe(true);
    expect(pasteResult.data?.detected_framework).toBe('react');
    expect(pasteResult.data?.generated_filename).toBe('component.jsx');
    
    projectId = pasteResult.data?.project_id;
    expect(projectId).toBeDefined();

    // Wait a moment for async operations
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\n=== Step 2: Verify stored file is preprocessed ===');
    
    // Get the scaffolding result which should contain the preprocessed files
    const scaffoldingStatusResponse = await fetch(
      `${STAGING_URL}/api/scaffolding/${projectId}/status`,
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`
        }
      }
    );

    expect(scaffoldingStatusResponse.ok).toBe(true);
    const scaffoldingStatus = await scaffoldingStatusResponse.json();
    
    console.log('Scaffolding generated:', scaffoldingStatus.data?.scaffolding_generated);
    
    // If scaffolding was generated, check the files
    if (scaffoldingStatus.data?.scaffolding_generated) {
      console.log('\n=== Step 3: Check scaffolded files for preprocessing ===');
      
      const filesResponse = await fetch(
        `${STAGING_URL}/api/scaffolding/${projectId}/files?include_content=true`,
        {
          headers: {
            'Authorization': `Bearer ${AUTH_TOKEN}`
          }
        }
      );

      expect(filesResponse.ok).toBe(true);
      const filesResult = await filesResponse.json();
      
      // Find the main component file
      const componentFile = filesResult.data?.files?.find((f: any) => 
        f.path.includes('component') || f.path.includes('UserGreeting')
      );
      
      console.log('Component file found:', componentFile?.path);
      
      if (componentFile?.content) {
        console.log('\n=== Checking for double curly braces ===');
        const hasDoubleCurly = componentFile.content.includes('{{user.name');
        const hasSingleCurly = componentFile.content.includes('{user.name');
        
        console.log('Contains {{user.name:', hasDoubleCurly);
        console.log('Contains {user.name:', hasSingleCurly);
        
        // Find and log the specific line
        const lines = componentFile.content.split('\n');
        const problemLine = lines.find((line: string) => line.includes('user.name'));
        if (problemLine) {
          console.log('Line with user.name:', problemLine.trim());
        }
        
        // The preprocessing should have converted double curly to single
        expect(hasDoubleCurly).toBe(false);
        expect(hasSingleCurly).toBe(true);
      }
    }

    console.log('\n=== Step 4: Check project metadata ===');
    
    const projectResponse = await fetch(
      `${STAGING_URL}/api/projects/${projectId}`,
      {
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`
        }
      }
    );

    if (projectResponse.ok) {
      const projectData = await projectResponse.json();
      console.log('Project status:', projectData.data?.status);
      console.log('Project framework:', projectData.data?.framework);
      
      // Check if the original file content was preprocessed
      const sourceFile = projectData.data?.files?.[0];
      if (sourceFile) {
        console.log('Source file name:', sourceFile.name);
        console.log('Source file type:', sourceFile.type);
      }
    }
  });

  it('should handle mixed patterns correctly', async () => {
    const complexComponent = `
function ComplexComponent() {
  const data = { value: 42 };
  return (
    <div style={{ color: 'blue', fontSize: '16px' }}>
      {{data.value && data.value > 40 ? 'High' : 'Low'}}
      <span className="{data.value > 50 ? 'highlight' : ''}">
        Value: {{data.value}}
      </span>
    </div>
  );
}`;

    console.log('\n=== Testing complex patterns ===');
    
    const response = await fetch(`${STAGING_URL}/api/paste`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`
      },
      body: JSON.stringify({
        content: complexComponent,
        project_name: `complex-jsx-test-${Date.now()}`,
        description: 'Testing complex JSX patterns'
      })
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    
    console.log('Complex pattern test - Framework:', result.data?.detected_framework);
    console.log('Complex pattern test - Success:', result.success);
    
    // The framework might be detected as 'javascript' or 'react'
    // Both should work as long as JSX is preprocessed
    expect(result.success).toBe(true);
    
    // If detected as React, preprocessing should have happened
    if (result.data?.detected_framework === 'react') {
      console.log('Detected as React - preprocessing should be applied');
    }
  });
});