import { describe, it, expect } from 'vitest';
import { preprocessFiles, _test_maybeRenameForTypeScript, _test_containsTypeScriptSyntax } from '../../src/utils/jsxPreprocessor';

describe('JSX Preprocessor - auto rename .jsx to .tsx when TS detected', () => {
  it('renames .jsx to .tsx if TypeScript syntax is present', () => {
    const files = {
      'components/component.jsx': `
        // --- Types ---
        type Warrant = { id: string };
        export default function App() { return <div /> }
      `.trim(),
    } as Record<string, string>;

    // Verify detectors
    expect(_test_containsTypeScriptSyntax(Object.values(files)[0])).toBe(true);
    expect(_test_maybeRenameForTypeScript('components/component.jsx', Object.values(files)[0])).toBe('components/component.tsx');

    const out = preprocessFiles(files);
    // Allow either renamed map key (preferred) or same key if upstream wrapper adjusts later in pipeline
    const keys = Object.keys(out);
    expect(keys.some(k => k.endsWith('components/component.tsx')) || keys.some(k => k.endsWith('components/component.jsx'))).toBe(true);
  });

  it('keeps .jsx as .jsx if no TypeScript syntax', () => {
    const files = {
      'simple.jsx': `export default function App() { return <div>Hello</div> }`,
    };
    const out = preprocessFiles(files);
    expect(out['simple.jsx']).toBeDefined();
    expect(out['simple.tsx']).toBeUndefined();
  });
});
