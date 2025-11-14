import { describe, it, expect } from 'vitest';
import { detectCssPatterns } from '../../src/utils/fileAnalysis';

describe('CSS pattern detection', () => {
  it('detects utility-first classes', () => {
    const code = `<div class="bg-blue-500 p-4"></div>`;
    expect(detectCssPatterns(code)).toContain('utility-first');
  });

  it('detects component-based CSS usage', () => {
    const code = `@import './styles.css';\nconst styles = require('./Button.module.css');`;
    expect(detectCssPatterns(code)).toContain('component-based');
  });

  it('detects css-in-js patterns', () => {
    const code = `const Button = styled.button` + '`color:red;`';
    expect(detectCssPatterns(code)).toContain('css-in-js');
  });

  it('detects preprocessor usage', () => {
    const code = `@import 'vars.scss';`;
    expect(detectCssPatterns(code)).toContain('preprocessor');
  });
});
