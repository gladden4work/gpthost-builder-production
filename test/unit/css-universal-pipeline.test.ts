import { describe, it, expect } from 'vitest';
import {
  detectCssFrameworksForTest as detectCssFrameworks,
  generatePostCSSConfigForTest as generatePostCSSConfig,
  generateIndexCSSForTest as generateIndexCSS,
} from '../../src/utils/scaffoldingGenerator';

describe('Universal CSS Pipeline - config and index.css generation', () => {
  it('includes tailwind plugin in postcss when tailwind detected', () => {
    const cfg = generatePostCSSConfig(['tailwind']);
    expect(cfg.path).toBe('postcss.config.js');
    expect(cfg.content).toContain("'postcss-import'");
    expect(cfg.content).toContain("'tailwindcss'");
    expect(cfg.content).toContain("'autoprefixer'");
  });

  it('does not include tailwind plugin when only bootstrap detected', () => {
    const cfg = generatePostCSSConfig(['bootstrap']);
    expect(cfg.content).toContain("'postcss-import'");
    expect(cfg.content).not.toContain("'tailwindcss'");
    expect(cfg.content).toContain("'autoprefixer'");
  });

  it('generates index.css with tailwind directives when tailwind detected', () => {
    const file = generateIndexCSS(['tailwind']);
    expect(file.path).toBe('src/index.css');
    expect(file.content).toContain('@tailwind base');
    expect(file.content).toContain('@tailwind components');
    expect(file.content).toContain('@tailwind utilities');
  });

  it('generates index.css that imports bootstrap when bootstrap detected', () => {
    const file = generateIndexCSS(['bootstrap']);
    expect(file.content).toContain("@import 'bootstrap/dist/css/bootstrap.min.css'");
  });

  it('generates index.css that imports bulma when bulma detected', () => {
    const file = generateIndexCSS(['bulma']);
    expect(file.content).toContain("@import 'bulma/css/bulma.min.css'");
  });

  it('defaults to modern-normalize when no framework detected', () => {
    const file = generateIndexCSS([]);
    expect(file.content).toContain("@import 'modern-normalize/modern-normalize.css'");
  });

  it('detects frameworks from package.json deps/devDeps', () => {
    const detected = detectCssFrameworks({
      name: 'x', version: '1.0.0', scripts: {},
      dependencies: { bulma: '^1.0.0' },
      devDependencies: { bootstrap: '^5.3.0' }
    } as any);
    expect(detected).toContain('bulma');
    expect(detected).toContain('bootstrap');
  });
});

