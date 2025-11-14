/**
 * Test JSX preprocessing in content conversion
 */

import { describe, it, expect } from 'vitest';
import { convertContentToFile } from '../src/utils/contentConversion';

describe('JSX Preprocessing', () => {
  it('should convert double curly braces to single curly braces', () => {
    const input = `
      function TestComponent() {
        const [user] = useState({ name: 'User' });
        return (
          <div>
            <h1>Test</h1>
            {{user.name && \`Welcome \${user.name}\`}}
          </div>
        );
      }
    `;
    
    const result = convertContentToFile(input, 'react');
    
    expect(result.content).not.toContain('{{user.name');
    expect(result.content).toContain('{user.name');
    expect(result.filename).toBe('component.jsx');
  });

  it('should preserve style objects with double curly braces', () => {
    const input = `
      function Component() {
        return (
          <div style={{ padding: '20px', color: 'red' }}>
            {{message && message}}
          </div>
        );
      }
    `;
    
    const result = convertContentToFile(input, 'react');
    
    // Style should keep double curly braces
    expect(result.content).toContain('style={{ padding');
    // Expression should be single curly brace
    expect(result.content).not.toContain('{{message');
    expect(result.content).toContain('{message');
  });

  it('should handle complex AI-generated patterns', () => {
    const input = `
      function AIComponent() {
        const user = { name: 'Test' };
        return (
          <div style={{ margin: '10px' }}>
            <p>{{user.name && \`Welcome back, \${user.name}!\`}}</p>
            <span className="{active ? 'active' : ''}">Test</span>
          </div>
        );
      }
    `;
    
    const result = convertContentToFile(input, 'react');
    
    // Check double curly is fixed
    expect(result.content).not.toContain('{{user.name');
    expect(result.content).toContain('{user.name');
    
    // Check className is fixed
    expect(result.content).not.toContain('className="{');
    expect(result.content).toContain('className={');
    
    // Style should remain double curly
    expect(result.content).toContain('style={{ margin');
  });

  it('should handle the exact failing case from E2E test', () => {
    const input = `
      <p>{{user.name && \`Welcome back, \${user.name}!\`}}</p>
    `;
    
    const result = convertContentToFile(input, 'react');
    
    console.log('Input:', input);
    console.log('Output:', result.content);
    
    expect(result.content).not.toContain('{{user.name');
    expect(result.content).toContain('{user.name');
  });

  it('should work with non-React frameworks', () => {
    const reactInput = `{{expression}}`;
    const vueInput = `{{expression}}`;
    
    const reactResult = convertContentToFile(reactInput, 'react');
    const vueResult = convertContentToFile(vueInput, 'vue');
    
    // React should preprocess
    expect(reactResult.content).toBe('{expression}');
    
    // Vue should NOT preprocess (Vue uses double curly for interpolation)
    expect(vueResult.content).toBe('{{expression}}');
  });
});