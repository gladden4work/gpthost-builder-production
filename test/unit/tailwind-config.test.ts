import { describe, it, expect } from 'vitest';
import { generateTailwindConfigForTest } from '../../src/utils/scaffoldingGenerator';

describe('tailwind config generation', () => {
  it('includes expected content globs', () => {
    const file = generateTailwindConfigForTest();
    expect(file.content).toContain('./index.html');
    expect(file.content).toContain('./src/**/*.{js,jsx,ts,tsx,mdx}');
    expect(file.content).toContain('./components/**/*.{ts,tsx}');
    expect(file.content).toContain('./usecase/**/*.{js,jsx,ts,tsx}');
  });
});
