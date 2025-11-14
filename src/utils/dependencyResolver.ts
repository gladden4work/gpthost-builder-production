/**
 * TASK-011: Core Dependency Resolution Engine
 * Advanced dependency resolution with version conflict detection,
 * NPM registry integration, and intelligent package.json generation
 */

import {
  ImportAnalysis,
  ComponentStructure,
  FrameworkType,
  DependencyVersion,
  DependencyConflict,
  DependencyClassification,
  DependencyResolutionResult,
  DependencyResolutionOptions,
  DependencyResolutionRequest,
  PackageRegistryInfo,
  FrameworkTemplate,
  BuildConfiguration,
  PackageScripts,
  GeneratedPackageJson,
  DependencySuggestion,
  CompatibilityMatrix
} from '../types/api';

/**
 * Framework version detection patterns
 */
const FRAMEWORK_VERSION_PATTERNS = {
  react: {
    '18': [/React\.createRoot/, /StrictMode/, /startTransition/, /useDeferredValue/, /useTransition/],
    '17': [/React\.render/, /ReactDOM\.render/, /createRoot/],
    '16': [/useState/, /useEffect/, /React\.Component/]
  },
  vue: {
    '3': [/createApp/, /defineComponent/, /ref\(/, /reactive\(/, /computed\(/],
    '2': [/new Vue/, /Vue\.component/, /this\.\$/, /template:/]
  },
  svelte: {
    '4': [/\$state/, /\$derived/, /\$effect/],
    '3': [/{#if/, /{#each/, /export let/, /<script/]
  }
};

/**
 * Framework-specific dependency templates
 */
const FRAMEWORK_TEMPLATES: Record<string, FrameworkTemplate[]> = {
  react: [
    {
      framework: 'react',
      version: '18',
      baseDependencies: [
        { name: 'react', version: '^18.2.0', source: 'required', confidence: 100 },
        { name: 'react-dom', version: '^18.2.0', source: 'required', confidence: 100 }
      ],
      devDependencies: [
        { name: '@types/react', version: '^18.2.0', source: 'inferred', confidence: 90 },
        { name: '@types/react-dom', version: '^18.2.0', source: 'inferred', confidence: 90 },
        { name: '@vitejs/plugin-react', version: '^4.0.0', source: 'required', confidence: 95 },
        { name: 'vite', version: '^4.4.0', source: 'required', confidence: 95 },
        { name: 'typescript', version: '^5.0.0', source: 'inferred', confidence: 85 }
      ],
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        preview: 'vite preview',
        lint: 'eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0'
      },
      buildConfig: {
        bundler: 'vite',
        configFile: 'vite.config.ts',
        plugins: ['@vitejs/plugin-react'],
        devDependencies: [],
        buildCommand: 'tsc && vite build',
        devCommand: 'vite',
        outputDirectory: 'dist'
      },
      tsConfig: {
        compilerOptions: {
          target: 'ES2020',
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true
        },
        include: ['src'],
        references: [{ path: './tsconfig.node.json' }]
      }
    }
  ],
  vue: [
    {
      framework: 'vue',
      version: '3',
      baseDependencies: [
        { name: 'vue', version: '^3.3.0', source: 'required', confidence: 100 }
      ],
      devDependencies: [
        { name: '@vitejs/plugin-vue', version: '^4.2.0', source: 'required', confidence: 95 },
        { name: 'vite', version: '^4.4.0', source: 'required', confidence: 95 },
        { name: 'typescript', version: '^5.0.0', source: 'inferred', confidence: 85 },
        { name: 'vue-tsc', version: '^1.8.0', source: 'inferred', confidence: 80 }
      ],
      scripts: {
        dev: 'vite',
        build: 'vue-tsc && vite build',
        preview: 'vite preview'
      },
      buildConfig: {
        bundler: 'vite',
        configFile: 'vite.config.ts',
        plugins: ['@vitejs/plugin-vue'],
        devDependencies: [],
        buildCommand: 'vue-tsc && vite build',
        devCommand: 'vite',
        outputDirectory: 'dist'
      }
    }
  ],
  svelte: [
    {
      framework: 'svelte',
      version: '4',
      baseDependencies: [
        { name: 'svelte', version: '^4.2.0', source: 'required', confidence: 100 }
      ],
      devDependencies: [
        { name: '@sveltejs/vite-plugin-svelte', version: '^2.4.0', source: 'required', confidence: 95 },
        { name: 'vite', version: '^4.4.0', source: 'required', confidence: 95 },
        { name: 'typescript', version: '^5.0.0', source: 'inferred', confidence: 85 },
        { name: 'svelte-check', version: '^3.4.0', source: 'inferred', confidence: 80 }
      ],
      scripts: {
        dev: 'vite dev',
        build: 'vite build',
        preview: 'vite preview'
      },
      buildConfig: {
        bundler: 'vite',
        configFile: 'vite.config.ts',
        plugins: ['@sveltejs/vite-plugin-svelte'],
        devDependencies: [],
        buildCommand: 'vite build',
        devCommand: 'vite dev',
        outputDirectory: 'dist'
      }
    }
  ]
  ,
  html: [
    {
      framework: 'html',
      version: 'latest',
      baseDependencies: [
        // Static HTML requires no runtime dependencies
      ],
      devDependencies: [
        // Minimal toolchain to serve/build static files
        { name: 'vite', version: '^5.0.0', source: 'required', confidence: 95 }
      ],
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview'
      },
      buildConfig: {
        bundler: 'vite',
        configFile: 'vite.config.ts',
        plugins: [],
        devDependencies: [],
        buildCommand: 'vite build',
        devCommand: 'vite',
        outputDirectory: 'dist'
      }
    }
  ],
  javascript: [
    {
      framework: 'javascript',
      version: 'latest',
      baseDependencies: [
        // Vanilla JavaScript requires no runtime dependencies
      ],
      devDependencies: [
        { name: 'vite', version: '^5.0.0', source: 'required', confidence: 95 }
      ],
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview'
      },
      buildConfig: {
        bundler: 'vite',
        configFile: 'vite.config.js',
        plugins: [],
        devDependencies: [],
        buildCommand: 'vite build',
        devCommand: 'vite',
        outputDirectory: 'dist'
      }
    }
  ],
  text: [
    {
      framework: 'text',
      version: 'latest',
      baseDependencies: [
        // Text/binary files require no runtime dependencies
      ],
      devDependencies: [
        { name: 'vite', version: '^5.0.0', source: 'required', confidence: 95 }
      ],
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview'
      },
      buildConfig: {
        bundler: 'vite',
        configFile: 'vite.config.js',
        plugins: [],
        devDependencies: [],
        buildCommand: 'vite build',
        devCommand: 'vite',
        outputDirectory: 'dist'
      }
    }
  ],
  unknown: [
    {
      framework: 'unknown',
      version: 'latest',
      baseDependencies: [
        // Unknown framework - fallback to minimal setup
      ],
      devDependencies: [
        { name: 'vite', version: '^5.0.0', source: 'required', confidence: 95 }
      ],
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview'
      },
      buildConfig: {
        bundler: 'vite',
        configFile: 'vite.config.js',
        plugins: [],
        devDependencies: [],
        buildCommand: 'vite build',
        devCommand: 'vite',
        outputDirectory: 'dist'
      }
    }
  ]
};

/**
 * Common dependency mappings optimized for AI-generated code patterns
 * Includes ChatGPT, Claude, and other AI tool favorites
 */
const DEPENDENCY_MAPPINGS: Record<string, DependencyVersion[]> = {
  // React ecosystem - Core packages (AI generates these most frequently)
  'react': [{ name: 'react', version: '^18.2.0', source: 'exact', confidence: 100 }],
  'react-dom': [{ name: 'react-dom', version: '^18.2.0', source: 'exact', confidence: 100 }],
  'react-router-dom': [{ name: 'react-router-dom', version: '^6.15.0', source: 'latest', confidence: 95 }],
  '@types/react': [{ name: '@types/react', version: '^18.2.0', source: 'compatible', confidence: 95 }],
  '@types/react-dom': [{ name: '@types/react-dom', version: '^18.2.0', source: 'compatible', confidence: 95 }],
  
  // AI-favorite UI Libraries (ChatGPT/Claude commonly suggest these)
  '@mui/material': [
    { name: '@mui/material', version: '^5.14.0', source: 'latest', confidence: 95 },
    { name: '@emotion/react', version: '^11.11.0', source: 'required', confidence: 90 },
    { name: '@emotion/styled', version: '^11.11.0', source: 'required', confidence: 90 }
  ],
  '@mui/icons-material': [{ name: '@mui/icons-material', version: '^5.14.0', source: 'compatible', confidence: 90 }],
  '@mui/x-data-grid': [{ name: '@mui/x-data-grid', version: '^6.10.0', source: 'latest', confidence: 85 }],
  '@mui/x-date-pickers': [{ name: '@mui/x-date-pickers', version: '^6.10.0', source: 'latest', confidence: 85 }],
  
  // Lucide React (extremely popular in AI-generated code)
  'lucide-react': [{ name: 'lucide-react', version: '^0.279.0', source: 'latest', confidence: 98 }],
  
  // Recharts (AI's favorite for data visualization)
  'recharts': [{ name: 'recharts', version: '^2.8.0', source: 'latest', confidence: 95 }],
  // Spreadsheet / document processing commonly generated by AI components
  'xlsx': [{ name: 'xlsx', version: '^0.18.5', source: 'latest', confidence: 95 }],
  'mammoth': [{ name: 'mammoth', version: '^1.8.0', source: 'latest', confidence: 90 }],
  
  // Form libraries (AI often recommends these)
  'react-hook-form': [{ name: 'react-hook-form', version: '^7.45.0', source: 'latest', confidence: 90 }],
  'formik': [{ name: 'formik', version: '^2.4.0', source: 'latest', confidence: 85 }],
  'yup': [{ name: 'yup', version: '^1.3.0', source: 'latest', confidence: 85 }],
  'zod': [{ name: 'zod', version: '^3.22.0', source: 'latest', confidence: 90 }],
  
  // State management (AI frequently suggests these patterns)
  'redux': [
    { name: 'redux', version: '^4.2.1', source: 'latest', confidence: 85 },
    { name: 'react-redux', version: '^8.1.0', source: 'required', confidence: 85 }
  ],
  '@reduxjs/toolkit': [
    { name: '@reduxjs/toolkit', version: '^1.9.5', source: 'latest', confidence: 95 },
    { name: 'react-redux', version: '^8.1.0', source: 'required', confidence: 90 }
  ],
  'zustand': [{ name: 'zustand', version: '^4.4.0', source: 'latest', confidence: 90 }],
  'jotai': [{ name: 'jotai', version: '^2.4.0', source: 'latest', confidence: 80 }],
  'recoil': [{ name: 'recoil', version: '^0.7.7', source: 'latest', confidence: 75 }],
  
  // UI Component Libraries (AI commonly generates with these)
  'antd': [{ name: 'antd', version: '^5.8.6', source: 'latest', confidence: 85 }],
  'react-bootstrap': [
    { name: 'react-bootstrap', version: '^2.8.0', source: 'latest', confidence: 80 },
    { name: 'bootstrap', version: '^5.3.0', source: 'required', confidence: 80 }
  ],
  'semantic-ui-react': [{ name: 'semantic-ui-react', version: '^2.1.4', source: 'latest', confidence: 75 }],
  'chakra-ui': [
    { name: '@chakra-ui/react', version: '^2.8.0', source: 'latest', confidence: 85 },
    { name: '@emotion/react', version: '^11.11.0', source: 'required', confidence: 85 },
    { name: '@emotion/styled', version: '^11.11.0', source: 'required', confidence: 85 }
  ],
  '@chakra-ui/react': [
    { name: '@chakra-ui/react', version: '^2.8.0', source: 'latest', confidence: 85 },
    { name: '@emotion/react', version: '^11.11.0', source: 'required', confidence: 85 }
  ],
  
  // Styling (AI's most common styling approaches)
  'styled-components': [
    { name: 'styled-components', version: '^6.0.7', source: 'latest', confidence: 85 },
    { name: '@types/styled-components', version: '^5.1.26', source: 'inferred', confidence: 80 }
  ],
  'tailwindcss': [
    { name: 'tailwindcss', version: '^3.3.3', source: 'latest', confidence: 95 },
    { name: 'autoprefixer', version: '^10.4.14', source: 'required', confidence: 85 },
    { name: 'postcss', version: '^8.4.27', source: 'required', confidence: 85 }
  ],
  '@emotion/react': [{ name: '@emotion/react', version: '^11.11.0', source: 'latest', confidence: 85 }],
  '@emotion/styled': [{ name: '@emotion/styled', version: '^11.11.0', source: 'latest', confidence: 85 }],
  'modern-normalize': [{ name: 'modern-normalize', version: '^1.1.0', source: 'latest', confidence: 95 }],
  
  // HTTP clients (AI's preferred patterns)
  'axios': [{ name: 'axios', version: '^1.5.0', source: 'latest', confidence: 95 }],
  'swr': [{ name: 'swr', version: '^2.2.0', source: 'latest', confidence: 85 }],
  'react-query': [{ name: '@tanstack/react-query', version: '^4.32.0', source: 'latest', confidence: 90 }],
  '@tanstack/react-query': [{ name: '@tanstack/react-query', version: '^4.32.0', source: 'latest', confidence: 90 }],
  
  // Utility libraries (AI commonly includes)
  'lodash': [
    { name: 'lodash', version: '^4.17.21', source: 'latest', confidence: 90 },
    { name: '@types/lodash', version: '^4.14.195', source: 'inferred', confidence: 85 }
  ],
  'date-fns': [{ name: 'date-fns', version: '^2.30.0', source: 'latest', confidence: 90 }],
  'moment': [{ name: 'moment', version: '^2.29.4', source: 'latest', confidence: 80 }],
  'dayjs': [{ name: 'dayjs', version: '^1.11.9', source: 'latest', confidence: 85 }],
  'clsx': [{ name: 'clsx', version: '^2.0.0', source: 'latest', confidence: 85 }],
  'classnames': [{ name: 'classnames', version: '^2.3.2', source: 'latest', confidence: 80 }],
  'uuid': [
    { name: 'uuid', version: '^9.0.0', source: 'latest', confidence: 85 },
    { name: '@types/uuid', version: '^9.0.2', source: 'inferred', confidence: 85 }
  ],
  
  // Animation libraries (AI occasionally suggests)
  'framer-motion': [{ name: 'framer-motion', version: '^10.16.0', source: 'latest', confidence: 85 }],
  'react-spring': [{ name: '@react-spring/web', version: '^9.7.0', source: 'latest', confidence: 75 }],
  'lottie-react': [{ name: 'lottie-react', version: '^2.4.0', source: 'latest', confidence: 70 }],
  
  // Testing libraries (AI includes when asked about testing)
  '@testing-library/react': [{ name: '@testing-library/react', version: '^13.4.0', source: 'latest', confidence: 90 }],
  '@testing-library/jest-dom': [{ name: '@testing-library/jest-dom', version: '^5.17.0', source: 'latest', confidence: 85 }],
  'vitest': [{ name: 'vitest', version: '^0.34.0', source: 'latest', confidence: 85 }],
  'jest': [{ name: 'jest', version: '^29.6.0', source: 'latest', confidence: 80 }],
  
  // Vue ecosystem (Vue 3 focus - AI's current preference)
  'vue': [{ name: 'vue', version: '^3.3.4', source: 'exact', confidence: 100 }],
  'vue-router': [{ name: 'vue-router', version: '^4.2.4', source: 'latest', confidence: 95 }],
  'pinia': [{ name: 'pinia', version: '^2.1.6', source: 'latest', confidence: 95 }],
  'vuetify': [{ name: 'vuetify', version: '^3.3.10', source: 'latest', confidence: 85 }],
  '@vueuse/core': [{ name: '@vueuse/core', version: '^10.3.0', source: 'latest', confidence: 85 }],
  
  // Svelte ecosystem
  'svelte': [{ name: 'svelte', version: '^4.2.0', source: 'exact', confidence: 100 }],
  '@sveltejs/kit': [{ name: '@sveltejs/kit', version: '^1.20.4', source: 'latest', confidence: 95 }],
  '@sveltejs/adapter-auto': [{ name: '@sveltejs/adapter-auto', version: '^2.1.0', source: 'latest', confidence: 85 }],
  
  // AI commonly suggests these TypeScript packages
  'typescript': [{ name: 'typescript', version: '^5.2.2', source: 'latest', confidence: 95 }],
  '@types/node': [{ name: '@types/node', version: '^20.5.0', source: 'latest', confidence: 90 }],
  
  // Build tools and dev dependencies (AI includes in scaffolding)
  'vite': [{ name: 'vite', version: '^4.4.9', source: 'latest', confidence: 95 }],
  '@vitejs/plugin-react': [{ name: '@vitejs/plugin-react', version: '^4.0.4', source: 'latest', confidence: 95 }],
  '@vitejs/plugin-vue': [{ name: '@vitejs/plugin-vue', version: '^4.3.4', source: 'latest', confidence: 95 }],
  'eslint': [{ name: 'eslint', version: '^8.47.0', source: 'latest', confidence: 85 }],
  'prettier': [{ name: 'prettier', version: '^3.0.1', source: 'latest', confidence: 85 }],
  
  // Advanced AI patterns (Claude especially suggests these)
  'immer': [{ name: 'immer', version: '^10.0.2', source: 'latest', confidence: 80 }],
  'react-window': [{ name: 'react-window', version: '^1.8.8', source: 'latest', confidence: 75 }],
  'react-virtualized': [{ name: 'react-virtualized', version: '^9.22.5', source: 'latest', confidence: 70 }],
  'react-error-boundary': [{ name: 'react-error-boundary', version: '^4.0.11', source: 'latest', confidence: 80 }]
};

/**
 * Package compatibility matrix
 */
const COMPATIBILITY_MATRICES: CompatibilityMatrix[] = [
  {
    framework: 'react',
    version: '18',
    compatiblePackages: {
      'react-dom': ['^18.0.0'],
      '@types/react': ['^18.0.0'],
      'react-router-dom': ['^6.0.0'],
      '@mui/material': ['^5.0.0']
    },
    incompatiblePackages: {
      'react-dom': 'Version mismatch with React 18',
      '@types/react': 'Type definitions must match React version'
    },
    recommendedPackages: {
      'routing': 'react-router-dom',
      'ui-framework': '@mui/material',
      'state-management': '@reduxjs/toolkit'
    }
  }
];

/**
 * Cache for NPM registry lookups
 */
const REGISTRY_CACHE = new Map<string, PackageRegistryInfo>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Main dependency resolution function
 */
export async function resolveDependencies(
  importAnalysis: ImportAnalysis,
  componentStructure: ComponentStructure,
  framework: FrameworkType,
  options: DependencyResolutionOptions = getDefaultOptions()
): Promise<DependencyResolutionResult> {
  const startTime = Date.now();
  
  try {
    // 1. Detect framework version
    const frameworkVersion = detectFrameworkVersion(componentStructure, framework);
    
    // 2. Get base template for framework
    const template = getFrameworkTemplate(framework, frameworkVersion);
    
    // 3. Extract dependencies from import analysis
    const extractedDependencies = extractDependenciesFromImports(importAnalysis);
    
    // 4. Resolve versions for extracted dependencies
    const resolvedDependencies = await resolveVersionsForDependencies(
      extractedDependencies,
      framework,
      options
    );
    
    // 5. Merge with template dependencies
    const allDependencies = mergeDependencies(template.baseDependencies, resolvedDependencies);
    const allDevDependencies = mergeDependencies(template.devDependencies, []);
    
    // 6. Detect version conflicts
    const conflicts = detectVersionConflicts(allDependencies, allDevDependencies);
    
    // 7. Resolve conflicts
    const resolvedConflicts = resolveConflicts(conflicts, options);
    const finalDependencies = applyConflictResolutions(
      allDependencies,
      allDevDependencies,
      resolvedConflicts
    );
    
    // 8. Optionally augment with peerDependencies (e.g., MUI requires @emotion/*)
    let augmented = finalDependencies;
    if (options.includePeerDependencies !== false) {
      augmented = await includePeerDependencies(finalDependencies, options);
    }

    // 9. Classify dependencies
    const classification = classifyDependencies(
      augmented.production,
      augmented.development,
      template.peerDependencies || []
    );
    
    // 10. Generate package.json
    const packageJson = generatePackageJson(
      classification,
      template.scripts,
      framework,
      frameworkVersion
    );
    
    // 11. Generate suggestions
    const suggestions = generateSuggestions(
      classification,
      componentStructure,
      framework
    );
    
    const resolutionTime = Date.now() - startTime;
    
    return {
      resolved: classification,
      conflicts: resolvedConflicts,
      suggestions,
      packageJson,
      buildConfig: template.buildConfig,
      warnings: [],
      resolutionTime,
      cacheHit: false
    };
  } catch (error) {
    throw new Error(`Dependency resolution failed: ${error.message}`);
  }
}

/**
 * Include peerDependencies for resolved packages when missing.
 * Strategy: for each production dependency, fetch registry info, then add peers
 * that aren't already present, honoring the declared version range.
 */
async function includePeerDependencies(
  deps: { production: DependencyVersion[]; development: DependencyVersion[] },
  options: DependencyResolutionOptions
): Promise<{ production: DependencyVersion[]; development: DependencyVersion[] }> {
  const production = [...deps.production];
  const development = [...deps.development];

  const present = new Set<string>([...production, ...development].map(d => d.name));

  // Limit network cost: cap peers fetched to first 20 deps
  const candidates = production.slice(0, 20);

  for (const dep of candidates) {
    try {
      const info = await getPackageInfo(dep.name, options.registryUrl, Math.min(options.timeout || 5000, 2000));
      const peers = info?.peerDependencies || {};
      for (const [peerName, peerRange] of Object.entries(peers)) {
        if (present.has(peerName)) continue;
        production.push({ name: peerName, version: peerRange, source: 'peer', confidence: 90 });
        present.add(peerName);
      }
    } catch {
      // Best-effort; ignore peer fetch failures
    }
  }

  return { production, development };
}

/**
 * Detect framework version from component structure
 */
function detectFrameworkVersion(
  componentStructure: ComponentStructure,
  framework: FrameworkType
): string {
  if (framework === 'unknown' || !FRAMEWORK_VERSION_PATTERNS[framework]) {
    return 'latest';
  }
  
  const patterns = FRAMEWORK_VERSION_PATTERNS[framework];
  const content = JSON.stringify(componentStructure); // Simple approach - use full structure
  
  // Check versions from newest to oldest
  const versions = Object.keys(patterns).sort().reverse();
  
  for (const version of versions) {
    const versionPatterns = patterns[version];
    if (versionPatterns.some(pattern => pattern.test(content))) {
      return version;
    }
  }
  
  return 'latest';
}

/**
 * Get framework template by framework and version
 */
function getFrameworkTemplate(framework: FrameworkType, version: string): FrameworkTemplate {
  const templates = FRAMEWORK_TEMPLATES[framework];
  if (!templates) {
    throw new Error(`No template available for framework: ${framework}`);
  }
  
  // Find matching version template or use first one
  const template = templates.find(t => t.version === version) || templates[0];
  return { ...template }; // Clone to avoid mutations
}

/**
 * Extract dependencies from import analysis
 */
function extractDependenciesFromImports(importAnalysis: ImportAnalysis): string[] {
  const dependencies = new Set<string>();
  
  // Add external dependencies with validation
  importAnalysis.dependencies.external
    .filter(isValidDependencyName)
    .forEach(dep => dependencies.add(dep));
    
  importAnalysis.dependencies.scoped
    .filter(isValidDependencyName)
    .forEach(dep => dependencies.add(dep));
  
  return Array.from(dependencies);
}

/**
 * Validate dependency name format
 */
function isValidDependencyName(name: any): name is string {
  // Check for null, undefined, empty string
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return false;
  }
  
  const trimmedName = name.trim();
  
  // Check for local file paths (starts with ./ or ../)
  if (trimmedName.startsWith('./') || trimmedName.startsWith('../')) {
    return false;
  }
  
  // Check for absolute paths (starts with /)
  if (trimmedName.startsWith('/')) {
    return false;
  }
  
  // Check for scoped package without name (like @scope/ or @/)
  if (trimmedName.match(/^@[^\/]*\/?$/)) {
    return false;
  }
  
  // Check for invalid characters in package names
  // NPM package names can contain letters, numbers, hyphens, underscores, dots, and slashes for scoped packages
  if (!trimmedName.match(/^(@[a-z0-9-_\.]+\/)?[a-z0-9-_\.]+$/i)) {
    return false;
  }
  
  // Check for common invalid patterns
  const invalidPatterns = [
    /^\.+$/, // Only dots
    /^-+$/, // Only hyphens
    /^_+$/, // Only underscores
  ];
  
  if (invalidPatterns.some(pattern => pattern.test(trimmedName))) {
    return false;
  }
  
  return true;
}

/**
 * Resolve versions for extracted dependencies
 */
async function resolveVersionsForDependencies(
  dependencies: string[],
  framework: FrameworkType,
  options: DependencyResolutionOptions
): Promise<DependencyVersion[]> {
  const resolved: DependencyVersion[] = [];
  
  // Performance optimization: Process dependencies in batches with concurrency limit
  const BATCH_SIZE = 5; // Limit concurrent NPM API calls
  const batches: string[][] = [];
  
  for (let i = 0; i < dependencies.length; i += BATCH_SIZE) {
    batches.push(dependencies.slice(i, i + BATCH_SIZE));
  }
  
  for (const batch of batches) {
    const batchPromises = batch.map(async (depName) => {
      try {
        // Check if we have a known mapping first (faster)
        if (DEPENDENCY_MAPPINGS[depName]) {
          return DEPENDENCY_MAPPINGS[depName];
        }
        
        // Try to resolve from NPM registry with shorter timeout for performance
        const registryInfo = await getPackageInfo(
          depName, 
          options.registryUrl, 
          Math.min(options.timeout || 5000, 3000) // Cap timeout at 3 seconds for performance
        );
        
        if (registryInfo) {
          const version = selectVersionByStrategy(registryInfo, options.strategy);
          return [{
            name: depName,
            version: version,
            source: options.strategy,
            confidence: 75 // Lower confidence for unknown packages
          }];
        } else {
          // Fallback - assume latest
          return [{
            name: depName,
            version: 'latest',
            source: 'latest',
            confidence: 50
          }];
        }
      } catch (error) {
        console.warn(`Failed to resolve dependency ${depName}:`, error.message);
        // Add with low confidence
        return [{
          name: depName,
          version: 'latest',
          source: 'latest',
          confidence: 25
        }];
      }
    });
    
    // Wait for batch to complete
    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(result => resolved.push(...result));
  }
  
  return resolved;
}

/**
 * Get package information from NPM registry
 */
async function getPackageInfo(
  packageName: string,
  registryUrl: string = 'https://registry.npmjs.org',
  timeout: number = 5000
): Promise<PackageRegistryInfo | null> {
  // Check cache first
  const cacheKey = `${packageName}@${registryUrl}`;
  if (REGISTRY_CACHE.has(cacheKey)) {
    const cached = REGISTRY_CACHE.get(cacheKey)!;
    const age = Date.now() - new Date(cached.lastUpdated).getTime();
    if (age < CACHE_TTL) {
      return cached;
    }
  }
  
  try {
    // Make real NPM registry API call with proper timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(`${registryUrl}/${encodeURIComponent(packageName)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'GPTHost-DependencyResolver/1.0.0'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      // Handle common NPM registry errors
      if (response.status === 404) {
        console.warn(`Package ${packageName} not found in registry`);
        return null;
      }
      if (response.status === 429) {
        console.warn(`Rate limited by NPM registry for ${packageName}`);
        return null;
      }
      throw new Error(`NPM registry responded with ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Parse NPM registry response into our format
    const registryInfo: PackageRegistryInfo = {
      name: data.name || packageName,
      version: data.version || data['dist-tags']?.latest || '1.0.0',
      latestVersion: data['dist-tags']?.latest || data.version || '1.0.0',
      versions: data.versions ? Object.keys(data.versions) : ['1.0.0'],
      dependencies: data.dependencies || {},
      peerDependencies: data.peerDependencies || {},
      lastUpdated: data.time?.modified || new Date().toISOString(),
      license: data.license || 'Unknown',
      description: data.description || `Package ${packageName}`,
      keywords: data.keywords || []
    };
    
    // Cache the result
    REGISTRY_CACHE.set(cacheKey, registryInfo);
    return registryInfo;
  } catch (error) {
    // Handle network errors gracefully
    if (error.name === 'AbortError') {
      console.warn(`Request timeout for package ${packageName} after ${timeout}ms`);
    } else if (error.message?.includes('fetch')) {
      console.warn(`Network error fetching ${packageName}:`, error.message);
    } else {
      console.warn(`Failed to fetch package info for ${packageName}:`, error.message);
    }
    
    // Fallback to dependency mappings if registry call fails
    if (DEPENDENCY_MAPPINGS[packageName]) {
      console.info(`Using fallback dependency mapping for ${packageName}`);
      const fallbackDeps = DEPENDENCY_MAPPINGS[packageName];
      const fallbackInfo: PackageRegistryInfo = {
        name: packageName,
        version: fallbackDeps[0].version,
        latestVersion: fallbackDeps[0].version,
        versions: [fallbackDeps[0].version],
        dependencies: {},
        peerDependencies: {},
        lastUpdated: new Date().toISOString(),
        license: 'Unknown',
        description: `Package ${packageName} (fallback)`,
        keywords: []
      };
      
      // Cache fallback with shorter TTL
      const fallbackCacheKey = `${packageName}@fallback`;
      REGISTRY_CACHE.set(fallbackCacheKey, fallbackInfo);
      return fallbackInfo;
    }
    
    return null;
  }
}

/**
 * Select version based on resolution strategy
 */
function selectVersionByStrategy(
  packageInfo: PackageRegistryInfo,
  strategy: DependencyResolutionOptions['strategy']
): string {
  switch (strategy) {
    case 'latest':
      return `^${packageInfo.latestVersion}`;
    case 'exact':
      return packageInfo.latestVersion;
    case 'compatible':
      return `~${packageInfo.latestVersion}`;
    case 'conservative':
      // Use a slightly older stable version
      const versions = packageInfo.versions.filter(v => !v.includes('-'));
      return versions.length > 1 ? `^${versions[versions.length - 2]}` : `^${packageInfo.latestVersion}`;
    default:
      return `^${packageInfo.latestVersion}`;
  }
}

/**
 * Merge dependency arrays, avoiding duplicates
 */
function mergeDependencies(base: DependencyVersion[], additional: DependencyVersion[]): DependencyVersion[] {
  const merged = [...base];
  const names = new Set(base.map(d => d.name));
  
  for (const dep of additional) {
    if (!names.has(dep.name)) {
      merged.push(dep);
      names.add(dep.name);
    }
  }
  
  return merged;
}

/**
 * Detect version conflicts between dependencies
 */
function detectVersionConflicts(
  dependencies: DependencyVersion[],
  devDependencies: DependencyVersion[]
): DependencyConflict[] {
  const conflicts: DependencyConflict[] = [];
  const allDeps = [...dependencies, ...devDependencies];
  const depsByName = new Map<string, DependencyVersion[]>();
  
  // Group dependencies by name
  for (const dep of allDeps) {
    if (!depsByName.has(dep.name)) {
      depsByName.set(dep.name, []);
    }
    depsByName.get(dep.name)!.push(dep);
  }
  
  // Check for conflicts
  for (const [name, versions] of depsByName) {
    if (versions.length > 1) {
      const requestedVersions = versions.map(v => v.version);
      const uniqueVersions = [...new Set(requestedVersions)];
      
      if (uniqueVersions.length > 1) {
        // Conflict detected
        const recommendedVersion = selectBestVersion(versions);
        conflicts.push({
          package: name,
          requestedVersions: uniqueVersions,
          recommendedVersion,
          conflictType: determineSeverity(uniqueVersions),
          severity: determineSeverity(uniqueVersions) === 'major' ? 'high' : 'medium',
          resolution: 'use-recommended',
          reason: `Multiple versions requested: ${uniqueVersions.join(', ')}`
        });
      }
    }
  }
  
  return conflicts;
}

/**
 * Select the best version from conflicting versions
 */
function selectBestVersion(versions: DependencyVersion[]): string {
  // Prefer versions with higher confidence
  const sorted = versions.sort((a, b) => b.confidence - a.confidence);
  return sorted[0].version;
}

/**
 * Determine conflict severity
 */
function determineSeverity(versions: string[]): 'major' | 'minor' | 'peer' | 'breaking' {
  // Simple heuristic - if major versions differ, it's major
  const majorVersions = versions.map(v => {
    const match = v.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  });
  
  const uniqueMajors = [...new Set(majorVersions)];
  return uniqueMajors.length > 1 ? 'major' : 'minor';
}

/**
 * Resolve conflicts based on options
 */
function resolveConflicts(
  conflicts: DependencyConflict[],
  options: DependencyResolutionOptions
): DependencyConflict[] {
  if (options.conflictResolution === 'automatic') {
    return conflicts.map(conflict => ({
      ...conflict,
      resolution: 'use-recommended'
    }));
  }
  
  return conflicts;
}

/**
 * Apply conflict resolutions to dependencies
 */
function applyConflictResolutions(
  production: DependencyVersion[],
  development: DependencyVersion[],
  conflicts: DependencyConflict[]
): { production: DependencyVersion[], development: DependencyVersion[] } {
  const resolutionMap = new Map<string, string>();
  
  for (const conflict of conflicts) {
    if (conflict.resolution === 'use-recommended') {
      resolutionMap.set(conflict.package, conflict.recommendedVersion);
    }
  }
  
  const resolveVersions = (deps: DependencyVersion[]) => {
    return deps.map(dep => {
      if (resolutionMap.has(dep.name)) {
        return { ...dep, version: resolutionMap.get(dep.name)! };
      }
      return dep;
    });
  };
  
  return {
    production: resolveVersions(production),
    development: resolveVersions(development)
  };
}

/**
 * Classify dependencies into production/development/peer
 */
function classifyDependencies(
  production: DependencyVersion[],
  development: DependencyVersion[],
  peer: DependencyVersion[]
): DependencyClassification {
  return {
    production,
    development,
    peer,
    optional: []
  };
}

/**
 * Generate package.json from classified dependencies
 */
function generatePackageJson(
  classification: DependencyClassification,
  scripts: PackageScripts,
  framework: FrameworkType,
  frameworkVersion: string
): GeneratedPackageJson {
  const dependencies = classification.production.reduce((acc, dep) => {
    acc[dep.name] = dep.version;
    return acc;
  }, {} as Record<string, string>);
  
  const devDependencies = classification.development.reduce((acc, dep) => {
    acc[dep.name] = dep.version;
    return acc;
  }, {} as Record<string, string>);
  
  const peerDependencies = classification.peer.length > 0 ? 
    classification.peer.reduce((acc, dep) => {
      acc[dep.name] = dep.version;
      return acc;
    }, {} as Record<string, string>) : undefined;
  
  return {
    name: `gpthost-${framework}-project`,
    version: '0.1.0',
    type: 'module',
    scripts,
    dependencies,
    devDependencies,
    peerDependencies,
    engines: {
      node: '>=16.0.0',
      npm: '>=8.0.0'
    }
  };
}

/**
 * Generate optimization suggestions
 */
function generateSuggestions(
  classification: DependencyClassification,
  componentStructure: ComponentStructure,
  framework: FrameworkType
): DependencySuggestion[] {
  const suggestions: DependencySuggestion[] = [];
  const existing = new Set([
    ...classification.production.map(d => d.name),
    ...classification.development.map(d => d.name)
  ]);
  
  // Suggest TypeScript if not present but components look like they should use it
  const hasTypeScript = existing.has('typescript');
  const looksLikeTypeScript = componentStructure.patterns?.codeQuality === 'excellent';
  
  if (!hasTypeScript && looksLikeTypeScript) {
    suggestions.push({
      type: 'add',
      package: 'typescript',
      suggestedVersion: '^5.0.0',
      reason: 'Component structure suggests TypeScript would be beneficial',
      impact: 'minor',
      priority: 'medium'
    });
  }
  
  // React-specific suggestions
  if (framework === 'react') {
    // Suggest routing if multiple components
    if (componentStructure.detection?.hasMultipleComponents && !existing.has('react-router-dom')) {
      suggestions.push({
        type: 'add',
        package: 'react-router-dom',
        suggestedVersion: '^6.15.0',
        reason: 'Multiple components detected - routing might be beneficial',
        impact: 'minor',
        priority: 'low'
      });
    }
    
    // Suggest state management for complex components
    if (componentStructure.complexity?.overall === 'complex' && 
        !existing.has('@reduxjs/toolkit') && 
        !existing.has('zustand')) {
      suggestions.push({
        type: 'add',
        package: '@reduxjs/toolkit',
        suggestedVersion: '^1.9.0',
        reason: 'Complex component structure could benefit from centralized state management',
        impact: 'minor',
        priority: 'medium'
      });
    }
  }
  
  // Vue-specific suggestions
  if (framework === 'vue') {
    if (componentStructure.complexity?.overall === 'complex' && !existing.has('pinia')) {
      suggestions.push({
        type: 'add',
        package: 'pinia',
        suggestedVersion: '^2.1.0',
        reason: 'Complex components could benefit from Pinia state management',
        impact: 'minor',
        priority: 'medium'
      });
    }
  }
  
  // Universal suggestions
  if (componentStructure.complexity?.stateComplexity?.hasAsyncOperations) {
    if (!existing.has('axios') && !existing.has('fetch')) {
      suggestions.push({
        type: 'add',
        package: 'axios',
        suggestedVersion: '^1.5.0',
        reason: 'Async operations detected - HTTP client recommended',
        impact: 'minor',
        priority: 'low'
      });
    }
  }
  
  return suggestions;
}

/**
 * Get default resolution options
 */
function getDefaultOptions(): DependencyResolutionOptions {
  return {
    strategy: 'compatible',
    allowPrereleases: false,
    lockfileStrategy: 'regenerate',
    conflictResolution: 'automatic',
    includeDevDependencies: true,
    includeOptionalDependencies: false,
    timeout: 5000
  };
}

/**
 * Infer peer dependencies based on framework and dependencies
 */
export function inferPeerDependencies(
  dependencies: DependencyVersion[],
  framework: FrameworkType
): DependencyVersion[] {
  const peers: DependencyVersion[] = [];
  
  // React peer dependencies
  if (framework === 'react') {
    const hasReactRouter = dependencies.some(d => d.name === 'react-router-dom');
    if (hasReactRouter) {
      peers.push({
        name: 'react',
        version: '>=16.8.0',
        source: 'peer',
        confidence: 95
      });
    }
    
    const hasMUI = dependencies.some(d => d.name.startsWith('@mui/'));
    if (hasMUI) {
      peers.push({
        name: 'react',
        version: '>=17.0.0',
        source: 'peer',
        confidence: 95
      });
    }
  }
  
  return peers;
}

/**
 * Detect version conflicts across dependency tree (single array overload)
 */
export function detectVersionConflictsSingle(
  dependencies: DependencyVersion[]
): DependencyConflict[] {
  return detectVersionConflicts(dependencies, []);
}

/**
 * Generate framework-specific package.json templates
 */
export function generateFrameworkPackageJson(
  framework: FrameworkType,
  version: string = 'latest',
  projectName: string = 'gpthost-project'
): GeneratedPackageJson {
  const template = getFrameworkTemplate(framework, version);
  
  return {
    name: projectName,
    version: '0.1.0',
    type: 'module',
    scripts: template.scripts,
    dependencies: template.baseDependencies.reduce((acc, dep) => {
      acc[dep.name] = dep.version;
      return acc;
    }, {} as Record<string, string>),
    devDependencies: template.devDependencies.reduce((acc, dep) => {
      acc[dep.name] = dep.version;
      return acc;
    }, {} as Record<string, string>),
    engines: {
      node: '>=16.0.0',
      npm: '>=8.0.0'
    }
  };
}
