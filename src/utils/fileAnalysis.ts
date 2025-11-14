/**
 * File Analysis Utilities for GPTHost
 * Provides intelligent detection of frameworks, component types, and file metadata
 */

import { 
  FileAnalysis, 
  ProjectAnalysis, 
  FrameworkType, 
  ComponentType, 
  StylingApproach,
  ImportAnalysis,
  ComponentStructure,
  CssPatternCategory
} from '../types/api';
import { analyzeImports, extractBasicDependencies } from './importParser';
import { analyzeComponentStructure as analyzeComponentStructureOriginal } from './componentStructureAnalyzer';

/**
 * Extension-based framework detection
 */
const EXTENSION_FRAMEWORK_MAP: Record<string, FrameworkType> = {
  '.jsx': 'react',
  '.tsx': 'react',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.html': 'html',
  '.htm': 'html'
};

/**
 * Pattern weights for confidence scoring
 */
const PATTERN_WEIGHTS = {
  'import-statements': 10,    // High confidence
  'jsx-syntax': 8,           // High confidence  
  'framework-specific': 12,  // Highest confidence
  'generic-tags': 2,         // Low confidence
  'hooks': 9,                // High confidence for React
  'component-patterns': 7,   // Medium-high confidence
  'file-structure': 6        // Medium confidence
} as const;

/**
 * Weighted React patterns for content-based detection
 */
const REACT_PATTERNS = [
  // Import statements (High confidence)
  { pattern: /import\s+.*\s+from\s+['"`]react['"`]/i, weight: PATTERN_WEIGHTS['import-statements'] },
  { pattern: /import\s+React/i, weight: PATTERN_WEIGHTS['import-statements'] },
  { pattern: /from\s+['"`]react['"`]/i, weight: PATTERN_WEIGHTS['import-statements'] },
  
  // React hooks (High confidence)
  { pattern: /useState/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /useEffect/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /useContext/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /useReducer/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /useMemo/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /useCallback/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /useRef/, weight: PATTERN_WEIGHTS['hooks'] },
  
  // Framework-specific patterns (Highest confidence)
  { pattern: /createContext/, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /React\.createElement/, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /React\.Component/, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /extends\s+React\.Component/, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /extends\s+Component/, weight: PATTERN_WEIGHTS['framework-specific'] },
  
  // JSX-specific patterns (High confidence) - More restrictive than HTML
  { pattern: /className\s*=/, weight: PATTERN_WEIGHTS['jsx-syntax'] },
  { pattern: /<[^>]*{[^}]*}[^>]*>/, weight: PATTERN_WEIGHTS['jsx-syntax'] },  // JSX expressions within tags
  { pattern: /<[^>]*\s+[a-zA-Z]+\s*=\s*{/, weight: PATTERN_WEIGHTS['jsx-syntax'] }, // JSX props (must be within tags)
  { pattern: /jsx:/, weight: PATTERN_WEIGHTS['jsx-syntax'] },
  { pattern: /\.jsx\b/, weight: PATTERN_WEIGHTS['file-structure'] }
];

/**
 * Weighted Vue.js patterns for content-based detection
 */
const VUE_PATTERNS = [
  // Vue SFC structure (Highest confidence)
  { pattern: /<template>/i, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /<style\s+scoped>/i, weight: PATTERN_WEIGHTS['framework-specific'] },
  
  // Import statements (High confidence)
  { pattern: /import.*from\s+['"`]vue['"`]/i, weight: PATTERN_WEIGHTS['import-statements'] },
  
  // Vue-specific APIs (High confidence)
  { pattern: /Vue\.component/, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /new Vue/, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /createApp/, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /defineComponent/, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /setup\(\)/, weight: PATTERN_WEIGHTS['framework-specific'] },
  
  // Vue Composition API (High confidence)
  { pattern: /ref\(/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /reactive\(/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /computed\(/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /watch\(/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /onMounted/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /onUnmounted/, weight: PATTERN_WEIGHTS['hooks'] },
  
  // Vue template syntax (Medium-high confidence)
  { pattern: /v-if/, weight: PATTERN_WEIGHTS['component-patterns'] },
  { pattern: /v-for/, weight: PATTERN_WEIGHTS['component-patterns'] },
  { pattern: /v-model/, weight: PATTERN_WEIGHTS['component-patterns'] },
  { pattern: /@click/, weight: PATTERN_WEIGHTS['component-patterns'] },
  { pattern: /\{\{\s*[^}]+\s*\}\}/, weight: PATTERN_WEIGHTS['jsx-syntax'] }, // Higher weight for Vue interpolation
  
  // Generic script tag (Low confidence - could be any framework)
  { pattern: /<script>/i, weight: PATTERN_WEIGHTS['generic-tags'] }
];

/**
 * Weighted Svelte patterns for content-based detection
 */
const SVELTE_PATTERNS = [
  // Import statements (High confidence)
  { pattern: /import.*from\s+['"`]svelte['"`]/i, weight: PATTERN_WEIGHTS['import-statements'] },
  
  // Svelte-specific patterns (Highest confidence)
  { pattern: /\$:/, weight: PATTERN_WEIGHTS['framework-specific'] },  // Svelte reactive statements
  { pattern: /export let/, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /createEventDispatcher/, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /tick\(\)/, weight: PATTERN_WEIGHTS['framework-specific'] },
  
  // Svelte lifecycle (High confidence)
  { pattern: /onMount/, weight: PATTERN_WEIGHTS['hooks'] },
  { pattern: /onDestroy/, weight: PATTERN_WEIGHTS['hooks'] },
  
  // Svelte template syntax (Medium-high confidence)
  { pattern: /{#if/, weight: PATTERN_WEIGHTS['component-patterns'] },
  { pattern: /{#each/, weight: PATTERN_WEIGHTS['component-patterns'] },
  { pattern: /{#await/, weight: PATTERN_WEIGHTS['component-patterns'] },
  { pattern: /on:[a-zA-Z]/, weight: PATTERN_WEIGHTS['component-patterns'] },
  { pattern: /bind:[a-zA-Z]/, weight: PATTERN_WEIGHTS['component-patterns'] },  // Svelte two-way binding
  
  // Svelte store patterns
  { pattern: /import.*from\s+['\"\`]svelte\/store['\"\`]/i, weight: PATTERN_WEIGHTS['import-statements'] },
  { pattern: /writable\s*\(/, weight: PATTERN_WEIGHTS['framework-specific'] },
  
  // Svelte expressions (Medium confidence - more specific than generic)
  { pattern: /{[a-zA-Z$][a-zA-Z0-9_$]*}/, weight: PATTERN_WEIGHTS['file-structure'] },
  
  // Generic tags (Low confidence)
  { pattern: /<script>/i, weight: PATTERN_WEIGHTS['generic-tags'] },
  { pattern: /<style>/i, weight: PATTERN_WEIGHTS['generic-tags'] }
];

/**
 * Weighted HTML patterns for content-based detection
 */
const HTML_PATTERNS = [
  // HTML5 document structure (Highest confidence)
  { pattern: /<!DOCTYPE html>/i, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /<html[^>]*>/i, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /<head>/i, weight: PATTERN_WEIGHTS['framework-specific'] },
  { pattern: /<body>/i, weight: PATTERN_WEIGHTS['framework-specific'] },
  
  // HTML metadata (Medium-high confidence)
  { pattern: /<meta[^>]*>/i, weight: PATTERN_WEIGHTS['component-patterns'] },
  { pattern: /<link[^>]*>/i, weight: PATTERN_WEIGHTS['component-patterns'] },
  
  // Generic script (Low confidence - could be any framework)
  { pattern: /<script[^>]*>/i, weight: PATTERN_WEIGHTS['generic-tags'] }
];

/**
 * React Hook patterns
 */
const REACT_HOOK_PATTERNS = [
  /useState/,
  /useEffect/,
  /useContext/,
  /useReducer/,
  /useMemo/,
  /useCallback/,
  /useRef/,
  /useImperativeHandle/,
  /useLayoutEffect/,
  /useDebugValue/,
  /use[A-Z][a-zA-Z]*/ // Custom hooks
];

/**
 * Routing library patterns
 */
const ROUTING_PATTERNS = [
  /react-router/,
  /vue-router/,
  /svelte-routing/,
  /@reach\/router/,
  /next\/router/,
  /nuxt/,
  /sveltekit/,
  /Router/,
  /Route/,
  /useNavigate/,
  /useParams/,
  /useLocation/,
/\$page/,  // SvelteKit
  /\$app/    // SvelteKit
];

/**
 * Styling approach patterns
 */
const STYLING_PATTERNS = {
  'css-modules': [
    /\.module\.css/,
    /\.module\.scss/,
    /import.*styles.*from.*\.module\.(css|scss)/,
    /styles\.[a-zA-Z]/
  ],
  'styled-components': [
    /styled-components/,
    /import styled/,
    /styled\./,
    /css`/,
    /styled\([a-zA-Z]/
  ],
  'tailwind': [
    /tailwindcss/,
    /tailwind/,
    /class.*=.*['"`][^'"`]*\b(bg-|text-|p-|m-|flex|grid|w-|h-)/,
    /className.*=.*['"`][^'"`]*\b(bg-|text-|p-|m-|flex|grid|w-|h-)/,
    /@apply/
  ],
  'css-in-js': [
    /@emotion/,
    /emotion/,
    /css\s*=/,
    /makeStyles/,
    /withStyles/,
    /createStyles/,
    /sx\s*=/
  ],
  'vanilla-css': [
    /\.css['"`]/,
    /import.*\.css/,
    /link.*stylesheet/
  ],
  'scss': [
    /\.scss['"`]/,
    /import.*\.scss/,
    /\$[a-zA-Z]/,  // SCSS variables
    /@mixin/,
    /@include/
  ]
};

/**
 * Generic CSS pattern detection (framework agnostic)
 */
const CSS_PATTERNS = {
  'utility-first': /\b(class|className)=['"][^'\"]*\b(bg-|text-|p-|m-|flex|grid)/,
  'component-based': /@import.*\.css|\.module\.css/,
  'css-in-js': /styled\.|css`|createGlobalStyle/,
  'preprocessor': /\.(scss|sass|less|styl)/
} as const;

export function detectCssPatterns(content: string): CssPatternCategory[] {
  return Object.entries(CSS_PATTERNS)
    .filter(([, pattern]) => pattern.test(content))
    .map(([name]) => name as CssPatternCategory);
}

/**
 * Entry point detection patterns
 */
const ENTRY_POINT_PATTERNS = [
  /ReactDOM\.render/,
  /createRoot/,
  /new Vue/,
  /createApp/,
  /export default function App/,
  /function App\(/,
  /const App\s*=/,
  /class App extends/,
  /document\.getElementById\s*\(\s*['"`]root['"`]/,
  /document\.getElementById\s*\(\s*['"`]app['"`]/
];

/**
 * Common dependency patterns in imports
 */
const DEPENDENCY_PATTERNS = [
  { pattern: /from\s+['"`]([^'"`]+)['"`]/, groupIndex: 1 },
  { pattern: /import\s+['"`]([^'"`]+)['"`]/, groupIndex: 1 },
  { pattern: /require\s*\(\s*['"`]([^'"`]+)['"`]/, groupIndex: 1 }
];

/**
 * Component name extraction patterns
 */
const COMPONENT_NAME_PATTERNS = [
  /function\s+([A-Z][a-zA-Z0-9]*)\s*\(/,
  /const\s+([A-Z][a-zA-Z0-9]*)\s*=/,
  /class\s+([A-Z][a-zA-Z0-9]*)\s+extends/,
  /export\s+default\s+function\s+([A-Z][a-zA-Z0-9]*)/,
  /export\s+function\s+([A-Z][a-zA-Z0-9]*)/,
  /defineComponent\s*\(\s*{\s*name:\s*['"`]([a-zA-Z0-9]+)['"`]/
];

/**
 * Analyze file extension to determine basic framework type
 */
export function analyzeFileExtension(filename: string): FrameworkType {
  const extension = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  return extension ? EXTENSION_FRAMEWORK_MAP[extension] || 'unknown' : 'unknown';
}

/**
 * Calculate weighted score for framework patterns
 */
function calculateFrameworkScore(patterns: Array<{ pattern: RegExp; weight: number }>, content: string, maxLength = 10000): number {
  // Early termination for large files
  const contentToAnalyze = content.length > maxLength ? content.substring(0, maxLength) : content;
  
  let totalScore = 0;
  const matchedPatterns = new Set<string>();
  
  for (const { pattern, weight } of patterns) {
    const patternKey = pattern.toString();
    
    // Avoid duplicate pattern matching for performance
    if (matchedPatterns.has(patternKey)) {
      continue;
    }
    
    if (pattern.test(contentToAnalyze)) {
      totalScore += weight;
      matchedPatterns.add(patternKey);
    }
  }
  
  return totalScore;
}

/**
 * Analyze file content to detect framework through weighted pattern matching
 */
export function analyzeFrameworkFromContent(content: string): FrameworkType {
  // Calculate weighted scores for each framework
  const reactScore = calculateFrameworkScore(REACT_PATTERNS, content);
  const vueScore = calculateFrameworkScore(VUE_PATTERNS, content);
  const svelteScore = calculateFrameworkScore(SVELTE_PATTERNS, content);
  const htmlScore = calculateFrameworkScore(HTML_PATTERNS, content);

  // Determine framework based on weighted scores
  const scores = [
    { framework: 'react' as FrameworkType, score: reactScore },
    { framework: 'vue' as FrameworkType, score: vueScore },
    { framework: 'svelte' as FrameworkType, score: svelteScore },
    { framework: 'html' as FrameworkType, score: htmlScore }
  ];

  scores.sort((a, b) => b.score - a.score);
  
  // Require minimum confidence threshold (equivalent to 1 high-confidence pattern)
  const MIN_CONFIDENCE_THRESHOLD = PATTERN_WEIGHTS['jsx-syntax'];
  
  if (scores[0].score >= MIN_CONFIDENCE_THRESHOLD) {
    return scores[0].framework;
  }
  
  // If no framework detected, check if it looks like JavaScript/TypeScript
  const javascriptPatterns = [
    /function\s+\w+\s*\(/,
    /const\s+\w+\s*=/,
    /let\s+\w+\s*=/,
    /var\s+\w+\s*=/,
    /console\.log/,
    /document\./,
    /window\./,
    /=>\s*{/,
    /class\s+\w+/,
    /import\s+/,
    /export\s+/
  ];
  
  const hasJavaScriptSyntax = javascriptPatterns.some(pattern => pattern.test(content));
  if (hasJavaScriptSyntax) {
    return 'javascript';
  }
  
  // Check if content looks like binary/encoded data  
  const isBinaryLike = /^[A-Za-z0-9+/]+=*$/.test(content.trim()) && content.length > 10;
  const hasNonPrintableChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(content);
  
  if (isBinaryLike || hasNonPrintableChars) {
    return 'text';
  }
  
  return 'unknown';
}

/**
 * Detect actual components vs utility functions/classes
 */
function detectActualComponents(content: string): string[] {
  const components: string[] = [];
  
  // Patterns to exclude - these are NOT components
  const nonComponentPatterns = [
    // Styled-components
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*styled\./,
    // React contexts
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*createContext/,
    // Theme objects
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*createTheme/,
    // Environment variables
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*process\.env/,
    // Constants (string, number, boolean)
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*['"`]/,
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*\d/,
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*(?:true|false)/,
    // Plain objects (not components)
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*{(?![^}]*(?:render|return\s*<))/,
    // Arrays
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*\[/,
    // React.lazy components
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*React\.lazy/,
    // HOC patterns (but not component definitions)
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*withRouter\s*\(/,
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*connect\s*\(/,
    // State hooks assignments (not components)
    /const\s*\[([A-Z][a-zA-Z0-9]*),\s*set[A-Z][a-zA-Z0-9]*\]\s*=\s*useState/
  ];
  
  // React component patterns (must return JSX or be exported as component)
  const reactComponentPatterns = [
    // Function components that return JSX
    /(?:function|const)\s+([A-Z][a-zA-Z0-9]*)\s*[=\(][^{]*\{[\s\S]*?return\s*\(?[\s\S]*?<[a-zA-Z]/g,
    // Class components extending React.Component
    /class\s+([A-Z][a-zA-Z0-9]*)\s+extends\s+(?:React\.)?Component/g,
    // Arrow function components with JSX
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*\([^)]*\)\s*=>\s*(?:\{[\s\S]*?return\s*)?\(?[\s\S]*?<[a-zA-Z]/g,
    // TypeScript functional components with type annotations (const Component: React.FC = () => ...)
    /const\s+([A-Z][a-zA-Z0-9]*)\s*:\s*React\.FC\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?return[\s\S]*?<[a-zA-Z]/g,
    /const\s+([A-Z][a-zA-Z0-9]*)\s*:\s*(?:React\.)?FunctionComponent\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?return[\s\S]*?<[a-zA-Z]/g,
    // Exported components (likely components if exported and return JSX)
    /export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][a-zA-Z0-9]*)/g
  ];
  
  // Vue component patterns
  const vueComponentPatterns = [
    // defineComponent calls
    /defineComponent\s*\(\s*{\s*name:\s*['"`]([a-zA-Z0-9]+)['"`]/g,
    // Vue Options API with name
    /name:\s*['"`]([a-zA-Z0-9]+)['"`]/g,
    // Export default in .vue files (assume it's a component)
    /export\s+default\s*{/g,
    // Vue SFC pattern - any template with script export default
    /<template>[\s\S]*<\/template>[\s\S]*<script>[\s\S]*export\s+default\s*{/g
  ];
  
  // Svelte component patterns (less specific due to different syntax)
  const svelteComponentPatterns = [
    // Svelte components are typically the default export
    /export\s+let\s+([a-zA-Z0-9_$]+)/g, // Props indicate components
    /{#if|{#each|{#await/g // Template syntax indicates components
  ];
  
  // Apply React patterns
  for (const pattern of reactComponentPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        // Check if it's actually a component (not excluded pattern)
        const isExcluded = nonComponentPatterns.some(excludePattern => {
          const regex = new RegExp(excludePattern.source.replace('([A-Z][a-zA-Z0-9]*)', `(${match[1]})`));
          return regex.test(content);
        });
        
        if (!isExcluded && isActualComponent(match[1], content)) {
          components.push(match[1]);
        }
      } else if (pattern.toString().includes('export\\s+default\\s*{')) {
        components.push('DefaultComponent'); // Vue/Svelte default export
      }
    }
  }
  
  // Apply Vue patterns if it looks like Vue content
  if (/<template>/i.test(content) || /defineComponent/.test(content) || /export\s+default\s*{[\s\S]*name\s*:/.test(content)) {
    for (const pattern of vueComponentPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          components.push(match[1]);
        } else if (pattern.toString().includes('export\\s+default\\s*\\{')) {
          components.push('VueComponent'); // Default Vue component
        }
      }
    }
    
    // If no named components found but it's clearly a Vue SFC, add a default
    if (components.length === 0 && /<template>[\s\S]*<\/template>/.test(content)) {
      components.push('VueComponent');
    }
  }
  
  // Apply Svelte patterns if it looks like Svelte content
  if (/export\s+let|{#if|{#each/.test(content)) {
    components.push('SvelteComponent'); // Svelte components are typically single-file
  }
  
  return [...new Set(components)]; // Remove duplicates
}

/**
 * Check if a name represents an actual component (returns JSX or is exported)
 */
function isActualComponent(name: string, content: string): boolean {
  // More flexible patterns to detect actual components
  const componentPatterns = [
    // Function that returns JSX
    new RegExp(`(?:function|const)\\s+${name}[^{]*\\{[\\s\\S]*?return\\s*\\(?[\\s\\S]*?<`),
    // Arrow function that returns JSX  
    new RegExp(`const\\s+${name}\\s*=.*=>\\s*(?:\\{[\\s\\S]*?return\\s*)?\\(?[\\s\\S]*?<`),
    // TypeScript functional components with type annotations
    new RegExp(`const\\s+${name}\\s*:\\s*React\\.FC\\s*=.*=>\\s*\\{[\\s\\S]*?return[\\s\\S]*?<`),
    new RegExp(`const\\s+${name}\\s*:\\s*(?:React\\.)?FunctionComponent\\s*=.*=>\\s*\\{[\\s\\S]*?return[\\s\\S]*?<`),
    // Exported component (more likely to be a component)
    new RegExp(`export\\s+(?:default\\s+)?(?:function|const|class)\\s+${name}`),
    // Function declaration with JSX
    new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?<`),
    // Class component
    new RegExp(`class\\s+${name}\\s+extends\\s+(?:React\\.)?(?:Component|PureComponent)`)
  ];
  
  return componentPatterns.some(pattern => pattern.test(content));
}

/**
 * Detect component type (single component vs full application)
 */
export function analyzeComponentType(content: string, filename: string): ComponentType {
  // Strong full-application indicators
  const hasRouting = ROUTING_PATTERNS.some(pattern => pattern.test(content));
  const hasEntryPoint = ENTRY_POINT_PATTERNS.some(pattern => pattern.test(content));
  const isIndexFile = /^(index|main|app)\.(jsx?|tsx?|vue|svelte)$/i.test(filename);
  
  // Immediate full-application classification
  if (hasRouting || hasEntryPoint || isIndexFile) {
    return 'full-application';
  }
  
  // Framework-specific defaults
  if (filename.endsWith('.html') || filename.endsWith('.htm')) {
    return 'full-application'; // HTML files are typically complete pages
  }
  
  // Vue and Svelte single-file components are almost always single components
  if (filename.endsWith('.vue') || filename.endsWith('.svelte')) {
    return 'single-component';
  }
  
  // Detect actual components (not utility functions)
  const actualComponents = detectActualComponents(content);
  const hasMultipleComponents = actualComponents.length > 1;
  
  // Multiple actual components suggest full application
  if (hasMultipleComponents) {
    return 'full-application';
  }
  
  // Additional full-application indicators
  const hasMultipleFrameworkImports = (content.match(/import.*from\s+['"`](?:react|vue|svelte|@angular)/g) || []).length > 0;
  const hasMultipleUIImports = (content.match(/import.*from\s+['"`](?:.*\/components\/|.*\/ui\/|.*\/pages\/)/g) || []).length > 2;
  const hasConfigImports = /import.*from\s+['"`](?:.*config|.*constants|.*utils|.*helpers)['"`]/g.test(content);
  
  if (hasMultipleUIImports && hasConfigImports) {
    return 'full-application';
  }
  
  // Single component indicators
  const hasSingleDefaultExport = /export\s+default\s+(function|class|const)/.test(content);
  const componentNames = extractComponentNames(content);
  
  if ((hasSingleDefaultExport && actualComponents.length === 1) || 
      (componentNames.length === 1 && actualComponents.length === 1)) {
    return 'single-component';
  }
  
  // If we have any actual components, assume single component unless proven otherwise
  if (actualComponents.length === 1) {
    return 'single-component';
  }
  
  return 'unknown';
}

/**
 * Detect styling approach used in the file
 */
export function analyzeStylingApproach(content: string): StylingApproach[] {
  const approaches: StylingApproach[] = [];

  for (const [approach, patterns] of Object.entries(STYLING_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(content))) {
      approaches.push(approach as StylingApproach);
    }
  }

  return approaches.length > 0 ? approaches : ['none'];
}

/**
 * Extract import statements and dependencies
 */
export function extractDependencies(content: string): { imports: string[], dependencies: string[] } {
  const imports: string[] = [];
  const dependencies: string[] = [];

  // Extract import statements
  const importMatches = content.match(/import\s+.*?(?:from\s+['"`][^'"`]+['"`]|['"`][^'"`]+['"`])/g) || [];
  imports.push(...importMatches);

  // Extract dependency names using fresh patterns
  const dependencyPatterns = [
    { pattern: /from\s+['"`]([^'"`]+)['"`]/g, groupIndex: 1 },
    { pattern: /import\s+['"`]([^'"`]+)['"`]/g, groupIndex: 1 },
    { pattern: /require\s*\(\s*['"`]([^'"`]+)['"`]/g, groupIndex: 1 }
  ];

  for (const { pattern, groupIndex } of dependencyPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      const dep = match[groupIndex];
      if (dep && !dep.startsWith('.') && !dep.startsWith('/')) {
        // Only external dependencies (not relative imports)
        dependencies.push(dep);
      }
    }
  }

  return { imports: [...new Set(imports)], dependencies: [...new Set(dependencies)] };
}

/**
 * Extract export statements
 */
export function extractExports(content: string): string[] {
  const exportPatterns = [
    /export\s+default\s+(function|class|const)\s+([a-zA-Z0-9_$]+)/g,
    /export\s+(function|const|class)\s+([a-zA-Z0-9_$]+)/g,
    /export\s*{\s*([^}]+)\s*}/g
  ];

  const exports: string[] = [];

  for (const pattern of exportPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[2]) {
        exports.push(match[2]);
      } else if (match[1] && match[0].includes('{')) {
        // Named exports
        const namedExports = match[1].split(',').map(exp => exp.trim());
        exports.push(...namedExports);
      }
    }
  }

  return [...new Set(exports)];
}

/**
 * Extract component names from the content
 */
export function extractComponentNames(content: string): string[] {
  const componentNames: string[] = [];

  // Modern React patterns including arrow functions, forwardRef, HOCs, etc.
  const patterns = [
    // Traditional function components
    /function\s+([A-Z][a-zA-Z0-9]*)\s*\(/g,
    /export\s+default\s+function\s+([A-Z][a-zA-Z0-9]*)/g,
    /export\s+function\s+([A-Z][a-zA-Z0-9]*)/g,
    
    // Arrow function components (const Component = () => ...)
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*\([^)]*\)\s*=>/g,
    
    // TypeScript functional components with type annotations
    /const\s+([A-Z][a-zA-Z0-9]*)\s*:\s*React\.FC\s*=/g,
    /const\s+([A-Z][a-zA-Z0-9]*)\s*:\s*(?:React\.)?FunctionComponent\s*=/g,
    
    // forwardRef components (const Component = forwardRef(...))
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*(?:React\.)?forwardRef/g,
    
    // React.memo components (const Component = React.memo(...))
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*(?:React\.)?memo/g,
    
    // HOC patterns (const Component = withSomething(...))
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*with[A-Z][a-zA-Z0-9]*\(/g,
    
    // Class components
    /class\s+([A-Z][a-zA-Z0-9]*)\s+extends\s+(?:React\.)?(?:Component|PureComponent)/g,
    
    // Generic const declarations with uppercase names (potential components)
    // Only if they appear to return JSX or are exported
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*[^=]*(?:return\s*<|=>.*<)/g,
    
    // Vue component patterns
    /defineComponent\s*\(\s*{\s*name:\s*['"`]([a-zA-Z0-9]+)['"`]/g,
    /name:\s*['"`]([a-zA-Z0-9]+)['"`]/g,  // Vue Options API name property
    
    // Exported component assignments
    /export\s+{\s*([A-Z][a-zA-Z0-9]*)/g,
    /export\s+const\s+([A-Z][a-zA-Z0-9]*)/g
  ];

  // Additional check for components that might be missed by basic patterns
  const potentialComponents = new Set<string>();
  
  for (const pattern of patterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        potentialComponents.add(match[1]);
      }
    }
  }

  // Filter out common non-component patterns - ENHANCED
  const nonComponentPatterns = [
    // Existing patterns
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*['"`]/,  // String constants
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*\d/,     // Numeric constants
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*{(?![^}]*(?:render|return\s*<))/,  // Plain objects (not components)
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*\[/,     // Arrays
    
    // NEW: Styled-components and CSS-in-JS patterns
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*styled\./,         // styled-components
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*styled\s*\(/,      // styled function calls
    
    // NEW: React contexts and themes
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*createContext/,    // React contexts
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*createTheme/,      // Theme objects
    
    // NEW: Environment and configuration
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*process\.env/,     // Environment vars
    
    // NEW: Modern React patterns
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*React\.lazy/,      // React.lazy
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*withRouter\s*\(/,  // HOC patterns
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*connect\s*\(/,     // Redux connect
    /const\s*\[([A-Z][a-zA-Z0-9]*),/,                     // State destructuring
    
    // NEW: Boolean and null constants
    /const\s+([A-Z][a-zA-Z0-9]*)\s*=\s*(?:true|false|null|undefined)/
  ];

  // Check each potential component against non-component patterns
  for (const componentName of potentialComponents) {
    const isLikelyNotComponent = nonComponentPatterns.some(pattern => {
      const regex = new RegExp(pattern.source.replace('([A-Z][a-zA-Z0-9]*)', `(${componentName})`));
      return regex.test(content);
    });

    if (!isLikelyNotComponent) {
      componentNames.push(componentName);
    }
  }

  return [...new Set(componentNames)];
}

/**
 * Detect if content contains actual JSX (React-specific syntax)
 */
export function hasJSXContent(content: string, framework: FrameworkType): boolean {
  if (framework !== 'react') {
    return false;
  }

  // ENHANCED: Must have React component context - handle multiline content
  const hasComponentContext = /(?:export\s+(?:default\s+)?)?(?:function|const)\s+[A-Z][a-zA-Z0-9]*[\s\S]*?return\s*\(?\s*</.test(content) ||
                              /(?:function|const)\s+[A-Z][a-zA-Z0-9]*.*=>\s*(?:\(?\s*)?</.test(content);
  
  // JSX-specific patterns that distinguish from regular HTML
  const jsxPatterns = [
    /className\s*=/,                    // React-specific className attribute
    /<[^>]*{[^}]*}[^>]*>/,             // JSX expressions within tags only
    /<[^>]*\s+[a-zA-Z]+\s*=\s*{/,     // JSX props with expressions (must be within tags)
    /<[A-Z][a-zA-Z0-9]*[^>]*>/,       // Component tags (uppercase)
    /htmlFor\s*=/,                     // React-specific htmlFor
    /onClick\s*=\s*{/,                 // Event handlers in JSX
    /onChange\s*=\s*{/,                // Event handlers in JSX
    /style\s*=\s*{{/,                  // Inline styles in JSX
    /<.*\s+[a-zA-Z]+\s*=\s*{.*}/,     // Any tag with JSX expression attribute
  ];

  // Must have at least one JSX-specific pattern
  const hasJsxSpecificSyntax = jsxPatterns.some(pattern => pattern.test(content));
  
  // ENHANCED: Must have both React context AND JSX syntax
  return hasComponentContext && hasJsxSpecificSyntax;
}

/**
 * Detect if file contains React hooks
 */
export function hasReactHooks(content: string): boolean {
  return REACT_HOOK_PATTERNS.some(pattern => pattern.test(content));
}

/**
 * Detect if file contains routing logic
 */
export function hasRoutingLogic(content: string): boolean {
  return ROUTING_PATTERNS.some(pattern => pattern.test(content));
}

/**
 * Detect if file is an entry point
 */
export function isEntryPoint(content: string, filename: string): boolean {
  const hasEntryPatterns = ENTRY_POINT_PATTERNS.some(pattern => pattern.test(content));
  const isIndexFile = /^(index|main|app)\.(jsx?|tsx?|vue|svelte)$/i.test(filename);
  
  return hasEntryPatterns || isIndexFile;
}

/**
 * Detect language (JavaScript vs TypeScript)
 */
export function detectLanguage(filename: string, content: string): 'javascript' | 'typescript' | 'html' | 'unknown' {
  const extension = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  
  if (extension === '.ts' || extension === '.tsx') return 'typescript';
  if (extension === '.js' || extension === '.jsx') return 'javascript';
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.vue') {
    // Check for TypeScript in Vue file
    if (/<script[^>]+lang\s*=\s*["']ts["']/i.test(content)) return 'typescript';
    return 'javascript';
  }
  if (extension === '.svelte') {
    // Check for TypeScript in Svelte file
    if (/<script[^>]+lang\s*=\s*["']ts["']/i.test(content)) return 'typescript';
    return 'javascript';
  }
  
  // Content-based detection with enhanced patterns
  const typeScriptPatterns = [
    // Type annotations
    /\b(interface|type|enum|namespace|declare)\b/,
    // Type assertions
    /\bas\s+[A-Z][a-zA-Z0-9]*\b/,
    // Function parameter types
    /:\s*[a-zA-Z]+(\[\])?(\s*\|\s*[a-zA-Z]+(\[\])?)*\s*[=;,\)]/,
    // Generic types
    /<[A-Z][a-zA-Z0-9]*>/,
    // React TypeScript patterns
    /React\.FC|FunctionComponent|React\.Component<|ComponentProps|React\.Props/,
    // Property types in objects
    /{\s*[a-zA-Z][a-zA-Z0-9]*:\s*[a-zA-Z]/,
    // Optional properties
    /[a-zA-Z][a-zA-Z0-9]*\?\s*:/,
    // Import types
    /import\s+type|import\s*{[^}]*\btype\b/
  ];
  
  const hasTypeScript = typeScriptPatterns.some(pattern => pattern.test(content));
  if (hasTypeScript) return 'typescript';
  
  const hasJavaScript = /\b(function|const|let|var|=>\s*[{(])/g.test(content);
  if (hasJavaScript) return 'javascript';
  
  return 'unknown';
}

/**
 * Comprehensive file analysis function
 */
export async function analyzeFile(file: File): Promise<FileAnalysis> {
  const content = await file.text();
  const timestamp = new Date().toISOString();

  // Extension-based detection (primary)
  const extensionFramework = analyzeFileExtension(file.name);
  
  // Content-based detection (secondary)
  const contentFramework = analyzeFrameworkFromContent(content);
  
  // Use extension-based if available, otherwise fall back to content-based
  const framework = extensionFramework !== 'unknown' ? extensionFramework : contentFramework;

  const componentType = analyzeComponentType(content, file.name);
  const language = detectLanguage(file.name, content);
  const stylingApproaches = analyzeStylingApproach(content);
  const cssPatterns = detectCssPatterns(content);
  
  // TASK-009: Enhanced import analysis
  const importAnalysis = analyzeImports(content, file.name);
  
  // TASK-010: Enhanced component structure analysis
  let componentStructure: ComponentStructure | undefined;
  if (framework !== 'unknown' && framework !== 'html') {
    try {
      componentStructure = analyzeComponentStructure(content, framework);
    } catch (error) {
      // Gracefully handle analysis errors - log but continue
      console.warn(`Component structure analysis failed for ${file.name}:`, error);
    }
  }
  
  // Legacy compatibility - maintain existing imports and dependencies fields
  const { imports, dependencies } = extractBasicDependencies(content);
  const exports = extractExports(content);
  const componentNames = extractComponentNames(content);
  
  const analysis: FileAnalysis = {
    framework,
    componentType,
    language,
    stylingApproach: stylingApproaches[0] || 'none',
    cssPatterns,
    imports,
    exports,
    dependencies,
    importAnalysis, // TASK-009: Enhanced import analysis
    componentStructure, // TASK-010: Enhanced component structure analysis
    hasJSX: hasJSXContent(content, framework),
    hasHooks: hasReactHooks(content),
    hasRouting: hasRoutingLogic(content),
    componentNames,
    entryPoint: isEntryPoint(content, file.name),
    analysisTimestamp: timestamp
  };

  return analysis;
}

/**
 * Aggregate project analysis from individual file analyses
 */
export function aggregateProjectAnalysis(fileAnalyses: FileAnalysis[]): ProjectAnalysis {
  if (fileAnalyses.length === 0) {
    return {
      primaryFramework: 'unknown',
      componentType: 'unknown',
      hasMultipleFrameworks: false,
      totalComponents: 0,
      componentNames: [],
      entryPoints: [],
      dependencies: [],
      stylingApproaches: [],
      language: 'unknown',
      analysisComplete: false,
      analysisTimestamp: new Date().toISOString()
    };
  }

  // Count framework occurrences
  const frameworkCounts = fileAnalyses.reduce((acc, analysis) => {
    if (analysis.framework !== 'unknown') {
      acc[analysis.framework] = (acc[analysis.framework] || 0) + 1;
    }
    return acc;
  }, {} as Record<FrameworkType, number>);

  // Determine primary framework
  const primaryFramework = Object.entries(frameworkCounts)
    .sort(([,a], [,b]) => b - a)[0]?.[0] as FrameworkType || 'unknown';

  // Check if multiple frameworks are used
  const hasMultipleFrameworks = Object.keys(frameworkCounts).length > 1;

  // Determine project type
  const hasFullApp = fileAnalyses.some(analysis => analysis.componentType === 'full-application');
  const componentType: ComponentType = hasFullApp ? 'full-application' : 
    (fileAnalyses.some(analysis => analysis.componentType === 'single-component') ? 'single-component' : 'unknown');

  // Aggregate data
  const entryPoints = fileAnalyses
    .filter(analysis => analysis.entryPoint)
    .map((analysis, index) => `file-${index}`); // Would need filename mapping

  const allDependencies = fileAnalyses.flatMap(analysis => analysis.dependencies);
  const uniqueDependencies = [...new Set(allDependencies)];

  const allStylingApproaches = fileAnalyses
    .map(analysis => analysis.stylingApproach)
    .filter(approach => approach !== 'none');
  const uniqueStylingApproaches = [...new Set(allStylingApproaches)] as StylingApproach[];

  const totalComponents = fileAnalyses.reduce((sum, analysis) => 
    sum + analysis.componentNames.length, 0);

  // Aggregate component names
  const allComponentNames = fileAnalyses.flatMap(analysis => analysis.componentNames);
  const uniqueComponentNames = [...new Set(allComponentNames)];

  // Determine primary language
  const languageCounts = fileAnalyses.reduce((acc, analysis) => {
    if (analysis.language !== 'unknown') {
      acc[analysis.language] = (acc[analysis.language] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);
  
  const primaryLanguage = Object.entries(languageCounts)
    .sort(([,a], [,b]) => b - a)[0]?.[0] as 'javascript' | 'typescript' | 'html' | 'unknown' || 'unknown';

  return {
    primaryFramework,
    componentType,
    hasMultipleFrameworks,
    totalComponents,
    componentNames: uniqueComponentNames,
    entryPoints,
    dependencies: uniqueDependencies,
    stylingApproaches: uniqueStylingApproaches,
    language: primaryLanguage,
    analysisComplete: true,
    analysisTimestamp: new Date().toISOString()
  };
}

// =============================================================================
// Test Compatibility Layer
// These wrapper functions provide API compatibility for the TDD test suite
// =============================================================================

/**
 * Test-compatible wrapper for framework detection
 * Maps existing analyzeFrameworkFromContent to expected detectFramework API
 */
export function detectFramework(content: string): string {
  return analyzeFrameworkFromContent(content);
}

/**
 * Test-compatible wrapper for component name extraction
 * Returns single component name (first found) instead of array
 */
export function extractComponentName(
  content: string, 
  framework?: string, 
  filename?: string
): string {
  const names = extractComponentNames(content);
  if (names.length > 0) return names[0];
  if (filename) return filename.replace(/\.\w+$/, '');
  return 'Component';
}

/**
 * Test-compatible wrapper for detectLanguage
 * Tests expect a single parameter, but implementation needs two
 */
export function detectLanguageFromContent(content: string): 'javascript' | 'typescript' | 'html' | 'unknown' {
  // Enhanced TypeScript patterns - only strong indicators
  const tsPatterns = [
    /\benum\s+[A-Z][a-zA-Z0-9]*\s*\{/,  // enum declarations
    /\binterface\s+[A-Z][a-zA-Z0-9]*\s*\{/, // interface declarations  
    /:\s*Array<[^>]+>/, // generic types
    /:\s*[A-Z][a-zA-Z0-9]*<[^>]*>/, // generic type annotations
    /\btype\s+[A-Z]/,  // type declarations
    /function\s+\w+\s*\([^)]*:\s*(string|number|boolean)/, // function parameters with types
    /\w+<[A-Z][a-zA-Z0-9]*>/  // generic type parameters (not JSX)
  ];
  
  if (tsPatterns.some(pattern => pattern.test(content))) {
    return 'typescript';
  }
  
  if (content.includes('<!DOCTYPE html>') || content.includes('<html')) {
    return 'html';
  }
  
  if (content.includes('function') || content.includes('const ') || content.includes('let ') || content.includes('var ')) {
    return 'javascript';
  }
  
  return 'unknown';
}

/**
 * Test-compatible wrapper for extractDependencies
 * Tests expect an array, but implementation returns an object
 */
export function extractDependenciesArray(content: string): string[] {
  const result = extractDependencies(content);
  // Filter out Node.js built-ins
  const builtIns = new Set(['fs', 'path', 'crypto', 'os', 'util', 'stream', 'events', 'http', 'https', 'url', 'querystring', 'buffer', 'child_process', 'cluster', 'dgram', 'dns', 'domain', 'net', 'punycode', 'readline', 'repl', 'string_decoder', 'tls', 'tty', 'vm', 'worker_threads', 'zlib']);
  return result.dependencies.filter(dep => !builtIns.has(dep));
}

/**
 * Test-compatible wrapper for analyzeComponentStructure
 * Flattens nested properties to match test expectations
 */
export function analyzeComponentStructure(content: string, framework: string): any {
  const original = analyzeComponentStructureOriginal(content, framework as FrameworkType);
  
  // Detect styled components - count actual component declarations
  const styledComponentPattern = /const\s+[A-Z][a-zA-Z0-9]*\s*=\s*styled\./g;
  const styledMatches = Array.from(content.matchAll(styledComponentPattern));
  const hasStyledComponents = styledMatches.length > 0;
  const styledComponentCount = styledMatches.length;
  
  // Detect API/data fetching patterns
  const apiPatterns = [];
  const fetchPatterns = [
    { pattern: /\bfetch\s*\(/g, name: 'fetch' },
    { pattern: /\baxios\./g, name: 'axios' },
    { pattern: /\baxios\s*\(/g, name: 'axios' },
    { pattern: /\$.get\(/g, name: 'jquery' },
    { pattern: /\$.post\(/g, name: 'jquery' },
    { pattern: /XMLHttpRequest/g, name: 'xhr' }
  ];
  
  for (const { pattern, name } of fetchPatterns) {
    if (pattern.test(content)) {
      apiPatterns.push(name);
    }
  }
  
  const hasApiCalls = apiPatterns.length > 0;
  
  // Flatten structure to match test expectations
  return {
    // From detection
    componentCount: original.detection?.componentCount || 0,
    mainComponent: original.detection?.mainComponent,
    components: original.detection?.components || [],
    componentNames: original.detection?.components?.map(c => c.name) || [],
    
    // From hooks (React only)
    hasHooks: (original.hooks && original.hooks.length > 0) || false,
    hooks: original.hooks?.map(h => h.name) || [],
    
    // Component type (functional vs class)
    componentType: original.detection?.components?.[0]?.type === 'class' ? 'class' : 'functional',
    
    // From props
    hasProps: !!original.props,
    props: original.props,
    
    // From exports
    exports: original.exports,
    
    // From complexity
    complexity: original.complexity,
    
    // From patterns
    patterns: original.patterns,
    
    // From styling (if present in complexity)
    usesStyledComponents: original.complexity?.styling?.approach === 'css-in-js',
    
    // Styled components detection (NEW)
    hasStyledComponents,
    styledComponentCount,
    
    // API calls detection (NEW)
    hasApiCalls,
    apiPatterns: [...new Set(apiPatterns)], // Remove duplicates
    
    // API usage detection
    usesContextAPI: original.hooks?.some(h => h.name === 'useContext') || false,
    
    // Original nested structure (for backward compatibility)
    detection: original.detection,
    originalHooks: original.hooks
  };
}