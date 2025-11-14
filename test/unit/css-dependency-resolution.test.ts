import { describe, it, expect } from 'vitest';
import { enhancePackageJsonWithFrameworkDeps } from '../../src/utils/scaffoldingGenerator';

const basePackage = { name: 'test', version: '1.0.0', scripts: {}, dependencies: {}, devDependencies: {} } as any;
const baseStructure = { complexity: { overall: 'simple' }, patterns: { stylingApproach: 'none' } } as any;
const tailwindStructure = { complexity: { overall: 'simple' }, patterns: { stylingApproach: 'tailwind' } } as any;
const scssStructure = { complexity: { overall: 'simple' }, patterns: { stylingApproach: 'scss' } } as any;

describe('CSS dependency resolution', () => {
  it('adds base css pipeline dependencies', () => {
    const pkg = enhancePackageJsonWithFrameworkDeps(basePackage, 'react', baseStructure, {});
    expect(pkg.devDependencies.postcss).toBeDefined();
    expect(pkg.devDependencies['postcss-import']).toBeDefined();
    expect(pkg.devDependencies.autoprefixer).toBeDefined();
  });

  it('adds tailwindcss when tailwind detected', () => {
    const pkg = enhancePackageJsonWithFrameworkDeps(basePackage, 'react', tailwindStructure, {});
    expect(pkg.devDependencies.tailwindcss).toBeDefined();
  });

  it('adds sass when scss detected', () => {
    const pkg = enhancePackageJsonWithFrameworkDeps(basePackage, 'react', scssStructure, {});
    expect(pkg.devDependencies.sass).toBeDefined();
  });
});
