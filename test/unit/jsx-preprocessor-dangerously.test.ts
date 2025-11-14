import { describe, it, expect } from 'vitest';
import { preprocessJSX } from '../../src/utils/jsxPreprocessor';

describe('JSX Preprocessor - dangerouslySetInnerHTML', () => {
  it('preserves double braces for dangerouslySetInnerHTML', () => {
    const input = `
      function View({ html }) {
        return (
          <div>
            <span dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        );
      }
    `;
    const output = preprocessJSX(input);
    expect(output).toContain('dangerouslySetInnerHTML={{ __html: html }}');
    expect(output).not.toContain('dangerouslySetInnerHTML={ __html: html }');
  });
});

