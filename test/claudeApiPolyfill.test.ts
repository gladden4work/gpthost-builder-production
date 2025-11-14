import { describe, it, expect } from 'vitest';
import { injectClaudePolyfill } from '../src/utils/claudeApiPolyfill';
import { preprocessJSX } from '../src/utils/jsxPreprocessor';

describe('Claude API polyfill', () => {
  it('injects polyfill when window.claude is used', () => {
    const input = `
      import React from 'react';
      export default function Component() {
        window.claude.complete('hi');
        return <div>Hello</div>;
      }
    `;
    const output = injectClaudePolyfill(input, 'Component.tsx');
    expect(output).toMatch(/Claude API Polyfill/);
    const importIndex = output.indexOf('import React');
    const polyfillIndex = output.indexOf('Claude API Polyfill');
    expect(polyfillIndex).toBeGreaterThan(importIndex);
  });

  it('does not inject polyfill when not used', () => {
    const input = `
      import React from 'react';
      export default function Component() {
        return <div>Hello</div>;
      }
    `;
    const output = injectClaudePolyfill(input, 'Component.tsx');
    expect(output).not.toMatch(/Claude API Polyfill/);
  });

  it('preprocessJSX injects polyfill automatically', () => {
    const input = `
      import React from 'react';
      export default function Component() {
        window.claude.complete('hi');
        return <div>Hello</div>;
      }
    `;
    const output = preprocessJSX(input, 'Component.tsx');
    expect(output).toMatch(/Claude API Polyfill/);
  });
});
