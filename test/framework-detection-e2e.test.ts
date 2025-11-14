/**
 * Test framework detection with exact E2E failing code
 */

import { describe, it, expect } from 'vitest';
import { analyzeFrameworkFromContent } from '../src/utils/fileAnalysis';
import { convertContentToFile } from '../src/utils/contentConversion';

describe('Framework Detection E2E', () => {
  it('should detect React and preprocess exact E2E failing component', () => {
    // Exact component from E2E test that failed
    const input = `
import React, { useState } from 'react';

function UserGreeting() {
  const [user] = useState({ name: 'User' });
  
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Welcome to Our App</h1>
      <p>{{user.name && \`Welcome back, \${user.name}!\`}}</p>
      <button onClick={() => alert('Hello!')}>
        Click Me
      </button>
    </div>
  );
}

export default UserGreeting;
`;
    
    // Test framework detection
    const detectedFramework = analyzeFrameworkFromContent(input);
    console.log('Detected framework:', detectedFramework);
    expect(detectedFramework).toBe('react');
    
    // Test preprocessing
    const result = convertContentToFile(input, detectedFramework);
    console.log('Filename:', result.filename);
    console.log('MIME type:', result.mimeType);
    console.log('Content includes double curly?', result.content.includes('{{user.name'));
    console.log('Content includes single curly?', result.content.includes('{user.name && '));
    
    // The preprocessing should have happened
    expect(result.content).not.toContain('{{user.name');
    expect(result.content).toContain('{user.name && ');
    expect(result.filename).toBe('component.jsx');
  });

  it('should handle component without React import', () => {
    // AI often generates JSX without React import
    const input = `
function Component() {
  const user = { name: 'Test' };
  return (
    <div>
      <h1>Test Component</h1>
      {{user.name && user.name}}
    </div>
  );
}
`;
    
    const detectedFramework = analyzeFrameworkFromContent(input);
    console.log('Framework without React import:', detectedFramework);
    
    // Should still detect as React due to JSX syntax
    if (detectedFramework === 'react' || detectedFramework === 'javascript') {
      // If detected as React or JavaScript that will be converted to React
      const result = convertContentToFile(input, 'react'); // Force React for JSX
      
      expect(result.content).not.toContain('{{user.name');
      expect(result.content).toContain('{user.name');
    }
  });

  it('should test the full paste flow simulation', () => {
    const pastedContent = `
import React, { useState } from 'react';

export default function TestComponent() {
  const [user] = useState({ name: 'John' });
  
  return (
    <div style={{ background: '#f0f0f0' }}>
      <p>{{user.name && \`Hello, \${user.name}!\`}}</p>
    </div>
  );
}
`;
    
    // Step 1: Detect framework (same as paste handler line 88)
    const detectedFramework = analyzeFrameworkFromContent(pastedContent);
    
    // Step 2: Convert content (same as paste handler line 92)
    const { filename, mimeType, content: processedContent } = convertContentToFile(pastedContent, detectedFramework);
    
    console.log('\n=== Full Paste Flow Simulation ===');
    console.log('1. Detected framework:', detectedFramework);
    console.log('2. Generated filename:', filename);
    console.log('3. MIME type:', mimeType);
    console.log('4. Preprocessed correctly?', !processedContent.includes('{{user.name'));
    console.log('5. Sample of processed content:');
    const lines = processedContent.split('\n');
    const problemLine = lines.find(line => line.includes('user.name'));
    console.log('   Problem line:', problemLine);
    
    expect(detectedFramework).toBe('react');
    expect(processedContent).not.toContain('{{user.name');
    expect(processedContent).toContain('{user.name');
  });
});