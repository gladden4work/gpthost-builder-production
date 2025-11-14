/**
 * TASK-009: Comprehensive Import Parser
 * Advanced parsing of JavaScript/TypeScript import statements with classification
 * and dependency analysis for AI-generated code patterns
 */

import {
  ImportStatement,
  ImportType,
  DependencyType,
  DependencyAnalysis,
  ImportAnalysis
} from '../types/api';

/**
 * Node.js built-in modules list (updated for Node.js 18+)
 */
const NODE_BUILTINS = new Set([
  // Core modules
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
  
  // Promises versions
  'fs/promises', 'dns/promises', 'stream/promises', 'timers/promises',
  
  // Web APIs (Node.js 18+)
  'node:assert', 'node:async_hooks', 'node:buffer', 'node:child_process', 
  'node:cluster', 'node:console', 'node:constants', 'node:crypto', 'node:dgram',
  'node:dns', 'node:domain', 'node:events', 'node:fs', 'node:http', 'node:http2',
  'node:https', 'node:inspector', 'node:module', 'node:net', 'node:os', 'node:path',
  'node:perf_hooks', 'node:process', 'node:punycode', 'node:querystring',
  'node:readline', 'node:repl', 'node:stream', 'node:string_decoder', 'node:timers',
  'node:tls', 'node:trace_events', 'node:tty', 'node:url', 'node:util', 'node:v8',
  'node:vm', 'node:worker_threads', 'node:zlib'
]);

/**
 * Common asset file extensions
 */
const ASSET_EXTENSIONS = new Set([
  '.css', '.scss', '.sass', '.less', '.styl', '.stylus',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif',
  '.mp3', '.mp4', '.webm', '.ogg', '.wav',
  '.woff', '.woff2', '.ttf', '.eot',
  '.json', '.xml', '.yaml', '.yml', '.toml'
]);

/**
 * ES6 Import patterns with comprehensive regex support
 */
const IMPORT_PATTERNS = {
  // ES6 imports - comprehensive patterns
  es6Default: /^import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s+['"`]([^'"`]+)['"`]/,
  es6Named: /^import\s+\{\s*([^}]+)\s*\}\s+from\s+['"`]([^'"`]+)['"`]/,
  es6Namespace: /^import\s+\*\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s+['"`]([^'"`]+)['"`]/,
  es6Mixed: /^import\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*\{\s*([^}]+)\s*\}\s+from\s+['"`]([^'"`]+)['"`]/,
  es6SideEffect: /^import\s+['"`]([^'"`]+)['"`]/,
  
  // TypeScript type-only imports
  typeOnly: /^import\s+type\s+(?:\{\s*([^}]+)\s*\}|([a-zA-Z_$][a-zA-Z0-9_$]*)|(\*\s+as\s+[a-zA-Z_$][a-zA-Z0-9_$]*))\s+from\s+['"`]([^'"`]+)['"`]/,
  
  // CommonJS require patterns
  commonJSDefault: /^(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/,
  commonJSDestructuring: /^(?:const|let|var)\s+\{\s*([^}]+)\s*\}\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/,
  commonJSExpression: /^require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/,
  
  // Dynamic imports
  dynamicImport: /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  
  // Re-exports
  reExport: /^export\s+\{\s*([^}]+)\s*\}\s+from\s+['"`]([^'"`]+)['"`]/,
  reExportAll: /^export\s+\*\s+from\s+['"`]([^'"`]+)['"`]/,
  reExportDefault: /^export\s+\{\s*default(?:\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*))?\s*\}\s+from\s+['"`]([^'"`]+)['"`]/
};

/**
 * Extract all import statements from code content
 */
function extractImportStatements(content: string): string[] {
  const importStatements: string[] = [];
  
  // Remove comments first to avoid false positives
  const cleanContent = content
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\/\/.*$/gm, '');        // Remove line comments
  
  const lines = cleanContent.split('\n');
  
  // Track multi-line imports
  let currentImport = '';
  let inMultiLineImport = false;
  let braceDepth = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) {
      continue;
    }
    
    // Handle multi-line imports
    if (inMultiLineImport) {
      currentImport += ' ' + trimmed;
      
      // Count braces to handle nested objects in imports
      braceDepth += (trimmed.match(/{/g) || []).length;
      braceDepth -= (trimmed.match(/}/g) || []).length;
      
      // End multi-line import when we reach closing brace or semicolon
      if ((braceDepth <= 0 && trimmed.includes('}')) || 
          trimmed.endsWith(';') || 
          trimmed.includes(' from ')) {
        importStatements.push(currentImport.replace(/\s+/g, ' ').trim());
        currentImport = '';
        inMultiLineImport = false;
        braceDepth = 0;
      }
      continue;
    }
    
    // Check for import statements
    if (/^import\s/i.test(trimmed)) {
      // Check if this is a complete import or multi-line
      if (trimmed.includes(' from ') && trimmed.endsWith(';')) {
        // Complete single-line import
        importStatements.push(trimmed);
      } else if (trimmed.includes('{') && !trimmed.includes('}')) {
        // Start of multi-line import
        currentImport = trimmed;
        inMultiLineImport = true;
        braceDepth = (trimmed.match(/{/g) || []).length;
      } else if (!trimmed.includes(' from ')) {
        // Side effect import
        importStatements.push(trimmed);
      } else {
        // Other single-line imports
        importStatements.push(trimmed);
      }
    }
    
    // Check for export...from statements
    if (/^export\s+.*\s+from\s+/i.test(trimmed)) {
      importStatements.push(trimmed);
    }
    
    // Check for require statements
    if (/(?:const|let|var)\s+.*=\s*require\s*\(/i.test(trimmed)) {
      importStatements.push(trimmed);
    }
    
    // Check for dynamic imports within the line
    const dynamicMatches = trimmed.match(/import\s*\(\s*['"`][^'"`]+['"`]\s*\)/g);
    if (dynamicMatches) {
      importStatements.push(...dynamicMatches);
    }
  }
  
  // Handle any remaining multi-line import
  if (currentImport) {
    importStatements.push(currentImport.replace(/\s+/g, ' ').trim());
  }
  
  return importStatements;
}

/**
 * Classify dependency type based on the source path
 */
function classifyDependency(source: string): DependencyType {
  // Local relative paths
  if (source.startsWith('./') || source.startsWith('../')) {
    return 'local-relative';
  }
  
  // Absolute local paths  
  if (source.startsWith('/')) {
    return 'local-absolute';
  }
  
  // Node.js built-ins
  if (NODE_BUILTINS.has(source)) {
    return 'node-builtin';
  }
  
  // Scoped packages
  if (source.startsWith('@')) {
    return 'scoped-package';
  }
  
  // NPM packages (no path separators, not relative)
  if (!source.includes('/') || source.includes('/') && !source.startsWith('.') && !source.startsWith('/')) {
    return 'npm-package';
  }
  
  return 'unknown';
}

/**
 * Determine import type and extract information
 */
function parseImportStatement(statement: string): ImportStatement | null {
  const trimmed = statement.trim().replace(/;$/, ''); // Remove trailing semicolon
  
  // TypeScript type-only imports
  const typeOnlyMatch = trimmed.match(IMPORT_PATTERNS.typeOnly);
  if (typeOnlyMatch) {
    const source = typeOnlyMatch[4];
    const specifiers = typeOnlyMatch[1] ? 
      typeOnlyMatch[1].split(',').map(s => s.trim()) : 
      [typeOnlyMatch[2] || typeOnlyMatch[3] || 'unknown'];
      
    return {
      raw: statement,
      type: 'type-only',
      source,
      dependencyType: classifyDependency(source),
      specifiers,
      isTypeOnly: true
    };
  }
  
  // ES6 Mixed imports (default + named)
  const mixedMatch = trimmed.match(IMPORT_PATTERNS.es6Mixed);
  if (mixedMatch) {
    const defaultImport = mixedMatch[1];
    const namedImports = mixedMatch[2].split(',').map(s => s.trim());
    const source = mixedMatch[3];
    
    return {
      raw: statement,
      type: 'es6-mixed',
      source,
      dependencyType: classifyDependency(source),
      specifiers: [defaultImport, ...namedImports],
      isTypeOnly: false
    };
  }
  
  // ES6 Default imports
  const defaultMatch = trimmed.match(IMPORT_PATTERNS.es6Default);
  if (defaultMatch) {
    const specifier = defaultMatch[1];
    const source = defaultMatch[2];
    
    return {
      raw: statement,
      type: 'es6-default',
      source,
      dependencyType: classifyDependency(source),
      specifiers: [specifier],
      isTypeOnly: false
    };
  }
  
  // ES6 Named imports
  const namedMatch = trimmed.match(IMPORT_PATTERNS.es6Named);
  if (namedMatch) {
    const specifiers = namedMatch[1].split(',').map(s => s.trim().replace(/\s+as\s+\w+/, ''));
    const source = namedMatch[2];
    
    return {
      raw: statement,
      type: 'es6-named',
      source,
      dependencyType: classifyDependency(source),
      specifiers,
      isTypeOnly: false
    };
  }
  
  // ES6 Namespace imports
  const namespaceMatch = trimmed.match(IMPORT_PATTERNS.es6Namespace);
  if (namespaceMatch) {
    const alias = namespaceMatch[1];
    const source = namespaceMatch[2];
    
    return {
      raw: statement,
      type: 'es6-namespace',
      source,
      dependencyType: classifyDependency(source),
      specifiers: [alias],
      isTypeOnly: false
    };
  }
  
  // ES6 Side effect imports (CSS, etc.)
  const sideEffectMatch = trimmed.match(IMPORT_PATTERNS.es6SideEffect);
  if (sideEffectMatch) {
    const source = sideEffectMatch[1];
    const extension = source.includes('.') ? source.substring(source.lastIndexOf('.')) : '';
    const isAsset = extension && ASSET_EXTENSIONS.has(extension);
    
    // Determine if it's CSS/SCSS or other assets
    const isCssFile = /\.(css|scss|sass|less|styl|stylus)$/i.test(source);
    const type: ImportType = isCssFile ? 'css' : (isAsset ? 'asset' : 'css');
    
    return {
      raw: statement,
      type,
      source,
      dependencyType: classifyDependency(source),
      specifiers: [],
      isTypeOnly: false
    };
  }
  
  // CommonJS default require
  const commonJSMatch = trimmed.match(IMPORT_PATTERNS.commonJSDefault);
  if (commonJSMatch) {
    const variable = commonJSMatch[1];
    const source = commonJSMatch[2];
    
    return {
      raw: statement,
      type: 'commonjs',
      source,
      dependencyType: classifyDependency(source),
      specifiers: [variable],
      isTypeOnly: false
    };
  }
  
  // CommonJS destructuring require
  const commonJSDestructMatch = trimmed.match(IMPORT_PATTERNS.commonJSDestructuring);
  if (commonJSDestructMatch) {
    const specifiers = commonJSDestructMatch[1].split(',').map(s => s.trim());
    const source = commonJSDestructMatch[2];
    
    return {
      raw: statement,
      type: 'commonjs',
      source,
      dependencyType: classifyDependency(source),
      specifiers,
      isTypeOnly: false
    };
  }
  
  // Dynamic imports
  const dynamicMatch = trimmed.match(/import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/);
  if (dynamicMatch) {
    const source = dynamicMatch[1];
    
    return {
      raw: statement,
      type: 'dynamic',
      source,
      dependencyType: classifyDependency(source),
      specifiers: [],
      isTypeOnly: false
    };
  }
  
  // Re-exports
  const reExportMatch = trimmed.match(IMPORT_PATTERNS.reExport);
  if (reExportMatch) {
    const specifiers = reExportMatch[1].split(',').map(s => s.trim());
    const source = reExportMatch[2];
    
    return {
      raw: statement,
      type: 're-export',
      source,
      dependencyType: classifyDependency(source),
      specifiers,
      isTypeOnly: false
    };
  }
  
  return null;
}

/**
 * Categorize dependencies into analysis structure
 */
function categorizeDependencies(statements: ImportStatement[]): DependencyAnalysis {
  const analysis: DependencyAnalysis = {
    external: [],
    local: [],
    nodeBuiltins: [],
    scoped: [],
    assets: [],
    dynamicImports: [],
    typeOnlyImports: [],
    allUnique: []
  };
  
  const seen = new Set<string>();
  
  for (const statement of statements) {
    const { source, dependencyType, type, isTypeOnly } = statement;
    
    // Track unique dependencies
    if (!seen.has(source)) {
      seen.add(source);
      analysis.allUnique.push(source);
    }
    
    // Categorize by dependency type
    switch (dependencyType) {
      case 'npm-package':
        if (!analysis.external.includes(source)) {
          analysis.external.push(source);
        }
        break;
      case 'scoped-package':
        if (!analysis.scoped.includes(source)) {
          analysis.scoped.push(source);
        }
        break;
      case 'local-relative':
      case 'local-absolute':
        if (!analysis.local.includes(source)) {
          analysis.local.push(source);
        }
        break;
      case 'node-builtin':
        if (!analysis.nodeBuiltins.includes(source)) {
          analysis.nodeBuiltins.push(source);
        }
        break;
    }
    
    // Categorize by import type
    if (type === 'dynamic' && !analysis.dynamicImports.includes(source)) {
      analysis.dynamicImports.push(source);
    }
    
    if ((type === 'css' || type === 'asset') && !analysis.assets.includes(source)) {
      analysis.assets.push(source);
    }
    
    if (isTypeOnly && !analysis.typeOnlyImports.includes(source)) {
      analysis.typeOnlyImports.push(source);
    }
  }
  
  return analysis;
}

/**
 * Detect potential circular imports (basic implementation)
 */
function detectCircularImports(statements: ImportStatement[], filename: string): boolean {
  // Basic check for imports that might reference back to current file
  const filenameBase = filename.replace(/\.[^.]+$/, ''); // Remove extension
  
  return statements.some(statement => {
    const { source, dependencyType } = statement;
    
    // Check if any local import might reference this file
    if (dependencyType === 'local-relative') {
      // Simple heuristic - check if import path resolves back to current file
      const importBase = source.replace(/^\.\//, '').replace(/\.[^.]+$/, '');
      return importBase === filenameBase || source.includes(filenameBase);
    }
    
    return false;
  });
}

/**
 * Detect potentially unused imports (basic heuristic)
 */
function detectUnusedImports(statements: ImportStatement[], content: string): string[] {
  const unused: string[] = [];
  
  for (const statement of statements) {
    const { specifiers, type, source } = statement;
    
    // Skip side-effect imports (CSS, assets) and dynamic imports
    if (type === 'css' || type === 'asset' || type === 'dynamic' || specifiers.length === 0) {
      continue;
    }
    
    // Check if specifiers are used in the content
    for (const specifier of specifiers) {
      if (!specifier || specifier.trim().length === 0) {
        continue; // Skip empty specifiers
      }
      
      const cleanSpecifier = specifier.replace(/\s+as\s+\w+/, ''); // Remove aliases
      
      try {
        // Special case for React - if there's JSX, React is used
        if (cleanSpecifier === 'React' && /<[a-zA-Z]/g.test(content)) {
          continue; // React is used via JSX
        }
        
        // Escape special regex characters and create safe pattern
        const escapedSpecifier = cleanSpecifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const usagePattern = new RegExp(`\\b${escapedSpecifier}\\b`, 'g');
        const matches = content.match(usagePattern);
        
        // If specifier appears only once (in the import), it might be unused
        if (!matches || matches.length <= 1) {
          unused.push(`${specifier} from '${source}'`);
        }
      } catch (error) {
        // Skip problematic specifiers rather than crash
        console.warn(`Could not check usage for specifier: ${specifier}`);
        continue;
      }
    }
  }
  
  return unused;
}

/**
 * Main function to perform comprehensive import analysis
 */
export function analyzeImports(content: string, filename = 'unknown.js'): ImportAnalysis {
  const importStatements = extractImportStatements(content);
  const parsedStatements: ImportStatement[] = [];
  
  // Parse each import statement
  for (const statement of importStatements) {
    const parsed = parseImportStatement(statement);
    if (parsed) {
      parsedStatements.push(parsed);
    }
  }
  
  // Categorize dependencies
  const dependencies = categorizeDependencies(parsedStatements);
  
  // Detect circular imports
  const hasCircularImports = detectCircularImports(parsedStatements, filename);
  
  // Detect unused imports
  const unusedImports = detectUnusedImports(parsedStatements, content);
  
  // Count imports by type
  const importCount = {
    total: parsedStatements.length,
    es6: parsedStatements.filter(s => 
      s.type.startsWith('es6') || s.type === 'type-only' || s.type === 'css' || s.type === 'asset'
    ).length,
    commonjs: parsedStatements.filter(s => s.type === 'commonjs').length,
    dynamic: parsedStatements.filter(s => s.type === 'dynamic').length,
    typeOnly: parsedStatements.filter(s => s.isTypeOnly).length,
    assets: parsedStatements.filter(s => s.type === 'css' || s.type === 'asset').length
  };
  
  return {
    statements: parsedStatements,
    dependencies,
    hasCircularImports,
    unusedImports,
    importCount
  };
}

/**
 * Legacy compatibility function - extracts basic dependencies list
 * (Maintains backward compatibility with existing extractDependencies function)
 */
export function extractBasicDependencies(content: string): { imports: string[], dependencies: string[] } {
  const analysis = analyzeImports(content);
  
  const imports = analysis.statements.map(s => s.raw);
  const dependencies = [
    ...analysis.dependencies.external,
    ...analysis.dependencies.scoped,
    ...analysis.dependencies.nodeBuiltins
  ];
  
  return { imports, dependencies };
}