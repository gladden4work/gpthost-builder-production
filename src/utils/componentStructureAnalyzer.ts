/**
 * Component Structure Analyzer
 * Comprehensive analysis of component structure, props, hooks, exports and complexity
 * Building upon import parser and existing file analysis infrastructure
 */

import {
  ComponentStructure,
  ComponentDetection,
  DetectedComponent,
  PropsAnalysis,
  PropProperty,
  ExportAnalysis,
  ComponentExport,
  HookAnalysis,
  ComponentComplexityAnalysis,
  JSXComplexity,
  TemplateComplexity,
  StateComplexity,
  LogicComplexity,
  AICodePatterns,
  ComponentComplexity,
  FrameworkType
} from '../types/api';

/**
 * React built-in hooks list for classification
 */
const REACT_BUILTIN_HOOKS = new Set([
  'useState', 'useEffect', 'useContext', 'useReducer', 'useCallback',
  'useMemo', 'useRef', 'useImperativeHandle', 'useLayoutEffect',
  'useDebugValue', 'useDeferredValue', 'useTransition', 'useId',
  'useSyncExternalStore', 'useInsertionEffect',
  // React Router hooks
  'useNavigate', 'useLocation', 'useParams', 'useSearchParams', 'useNavigation'
]);

/**
 * Common AI-generated code patterns with weights
 */
const AI_PATTERNS = {
  chatgpt: [
    // ChatGPT tends to use these patterns
    { pattern: /export\s+default\s+function\s+[A-Z][a-zA-Z]*\(\)\s*{/, weight: 3 }, // Strong indicator
    { pattern: /const\s+\[.*,\s*set.*\]\s*=\s*useState(?!\s*<)/, weight: 2 }, // Simple useState without generics
    { pattern: /\/\/\s*This\s+(component|function|hook)/i, weight: 2 },
    { pattern: /\/\/\s*TODO:/i, weight: 2 },
    { pattern: /\.map\(\(\w+\)\s*=>\s*\(/, weight: 1 }, // Simple map callback with inline JSX
    { pattern: /style\s*=\s*{{[^}]*}}/, weight: 3 }, // Inline styles - strong ChatGPT indicator
    { pattern: /className\s*=\s*['"`][^'"`]*['"`]/, weight: 1 }
  ],
  claude: [
    // Claude tends to use these patterns (higher weights for distinctive patterns)
    { pattern: /interface\s+[A-Z][a-zA-Z]*Props<[^>]*>/, weight: 4 }, // Generic interfaces are very Claude-like
    { pattern: /:\s*React\.FC<[A-Z][a-zA-Z]*Props<[^>]*>>/, weight: 4 }, // Generic FC types
    { pattern: /const\s+[A-Z][a-zA-Z]*:\s*React\.FC/, weight: 3 },
    { pattern: /\/\*\*[\s\S]*?\*\//, weight: 2 }, // JSDoc comments
    { pattern: /type\s+[A-Z][a-zA-Z]*\s*=\s*{/, weight: 2 },
    { pattern: /React\.memo\(/, weight: 3 }, // Strong Claude indicator
    { pattern: /useCallback\s*\([^,]*,\s*\[[^\]]*\]/, weight: 2 }, // Optimized hooks
    { pattern: /useMemo\s*\([^,]*,\s*\[[^\]]*\]/, weight: 2 }
  ]
};

/**
 * Performance warning patterns
 */
const PERFORMANCE_PATTERNS = {
  inlineObjects: /style\s*=\s*\{\{[^{}]*\}\}/, // Handle inline style objects - removed global flag
  inlineFunctions: /on[A-Z]\w*\s*=\s*\{[^}]*=>[^}]*\}/, // More accurate inline function detection  
  missingKeys: /\.map\s*\([^)]*\)(?![^<]*\bkey\s*=)/, // Back to general pattern with word boundary
  complexConditions: /\{[^{}]*\?\s*[^:{}]+:\s*[^{}]+\}/
};

/**
 * Analyze component detection and naming
 */
export function analyzeComponentDetection(content: string, framework: FrameworkType): ComponentDetection {
  const components = extractAllComponents(content, framework);
  const mainComponent = identifyMainComponent(components, content);
  
  return {
    componentCount: components.length,
    mainComponent: mainComponent?.name,
    components,
    framework,
    hasMultipleComponents: components.length > 1
  };
}

/**
 * Extract all components from content based on framework
 */
function extractAllComponents(content: string, framework: FrameworkType): DetectedComponent[] {
  switch (framework) {
    case 'react':
      return extractReactComponents(content);
    case 'vue':
      return extractVueComponents(content);
    case 'svelte':
      return extractSvelteComponents(content);
    default:
      return [];
  }
}

/**
 * Extract React components with detailed analysis
 */
function extractReactComponents(content: string): DetectedComponent[] {
  const components: DetectedComponent[] = [];
  
  // Simplified patterns that are more reliable
  const patterns = [
    // Function declarations
    /(?:export\s+(?:default\s+)?)?function\s+([A-Z][a-zA-Z0-9]*)/g,
    // Const with arrow functions
    /(?:export\s+(?:default\s+)?)?const\s+([A-Z][a-zA-Z0-9]*)\s*[:=]/g,
    // Class components
    /(?:export\s+(?:default\s+)?)?class\s+([A-Z][a-zA-Z0-9]*)/g
  ];

  for (const pattern of patterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        // Check if this name actually corresponds to a React component
        if (isReactComponent(match[1], content)) {
          const declarationType = content.includes(`function ${match[1]}`) ? 'function' :
                                  content.includes(`class ${match[1]}`) ? 'class' : 'const';
          
          const component = createDetectedComponent(
            match[1], 
            declarationType === 'class' ? 'class' : 'functional',
            declarationType, 
            'react', 
            content, 
            match.index
          );
          components.push(component);
        }
      }
    }
  }

  return deduplicateComponents(components);
}

/**
 * Check if a name represents a React component
 */
function isReactComponent(name: string, content: string): boolean {
  // Must start with uppercase (React convention)
  if (!/^[A-Z]/.test(name)) return false;
  
  // Check if it returns JSX or contains component-like patterns
  const patterns = [
    new RegExp(`function\\s+${name}[^{]*\\{[\\s\\S]*?return[\\s\\S]*?<`),
    new RegExp(`const\\s+${name}[^=]*=[^{]*\\{[\\s\\S]*?return[\\s\\S]*?<`),
    new RegExp(`const\\s+${name}[^=]*=.*=>[\\s\\S]*?<`),
    new RegExp(`class\\s+${name}[^{]*\\{[\\s\\S]*?render[\\s\\S]*?return[\\s\\S]*?<`),
    new RegExp(`const\\s+${name}[^=]*=.*memo\\s*\\(`),
    new RegExp(`const\\s+${name}[^=]*=.*forwardRef`)
  ];
  
  return patterns.some(pattern => pattern.test(content));
}

/**
 * Extract Vue components with priority-based detection to prevent duplicates
 */
function extractVueComponents(content: string): DetectedComponent[] {
  // Priority order: explicit name in defineComponent > name property > default SFC
  
  // First priority: defineComponent with explicit name
  const defineComponentMatch = content.match(/defineComponent\s*\(\s*{\s*name:\s*['"`]([a-zA-Z0-9]+)['"`]/);
  if (defineComponentMatch) {
    return [createDetectedComponent(
      defineComponentMatch[1], 
      'sfc', 
      'function', 
      'vue', 
      content
    )];
  }

  // Second priority: name property in options
  const nameMatch = content.match(/name:\s*['"`]([a-zA-Z0-9]+)['"`]/);
  if (nameMatch) {
    return [createDetectedComponent(
      nameMatch[1], 
      'sfc', 
      'export', 
      'vue', 
      content
    )];
  }

  // Third priority: default component if has template
  if (/<template>/i.test(content)) {
    return [createDetectedComponent(
      'VueComponent', 
      'sfc', 
      'export', 
      'vue', 
      content
    )];
  }

  return [];
}

/**
 * Extract Svelte components
 */
function extractSvelteComponents(content: string): DetectedComponent[] {
  const components: DetectedComponent[] = [];
  
  // Svelte components are typically the entire file
  if (/export\s+let|{#if|{#each|<script/.test(content)) {
    components.push(createDetectedComponent(
      'SvelteComponent', 
      'sfc', 
      'export', 
      'svelte', 
      content
    ));
  }
  
  return components;
}

/**
 * Create a DetectedComponent object
 */
function createDetectedComponent(
  name: string,
  type: 'functional' | 'class' | 'sfc' | 'unknown',
  declarationType: 'function' | 'const' | 'class' | 'export',
  framework: FrameworkType,
  content: string,
  startIndex?: number
): DetectedComponent {
  const isExported = isComponentExported(name, content);
  
  return {
    name,
    type,
    declarationType,
    isMainComponent: false, // Will be set by identifyMainComponent
    isExported,
    framework,
    location: startIndex !== undefined ? {
      startLine: content.substring(0, startIndex).split('\n').length
    } : undefined
  };
}

/**
 * Check if a component is exported (including complex HOC patterns)
 */
function isComponentExported(name: string, content: string): boolean {
  // Simple export patterns
  if (new RegExp(`export\\s+(?:default\\s+)?.*${name}`).test(content)) return true;
  if (new RegExp(`export\\s*{[^}]*${name}[^}]*}`).test(content)) return true;
  
  // HOC patterns: export default connect(...)(withRouter(ComponentName))
  // Match multiline patterns where component name appears in final parentheses
  if (new RegExp(`export\\s+default\\s+[\\s\\S]*\\(\\s*${name}\\s*\\)\\s*;?\\s*$`, 'm').test(content)) return true;
  
  // Additional HOC pattern: Look for component wrapped in multiple HOCs
  // Handle cases like: export default connect(...)(withRouter(ComponentName))
  // The component name might be wrapped in another function call
  if (content.includes(`(${name})`)) {
    // Check if this component usage is preceded by an export default
    const lines = content.split('\n');
    let foundExportDefault = false;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes(`(${name})`)) {
        // Found the component usage, now look backwards for export default (expanded search window)
        for (let j = i; j >= Math.max(0, i - 20); j--) {
          if (/export\s+default/.test(lines[j])) {
            foundExportDefault = true;
            break;
          }
        }
        break;
      }
    }
    if (foundExportDefault) return true;
  }
  
  return false;
}

/**
 * Identify the main component in a file
 */
function identifyMainComponent(components: DetectedComponent[], content: string): DetectedComponent | undefined {
  if (components.length === 0) return undefined;
  if (components.length === 1) {
    components[0].isMainComponent = true;
    return components[0];
  }

  // Look for default export
  for (const component of components) {
    if (new RegExp(`export\\s+default\\s+(?:function\\s+)?${component.name}`).test(content)) {
      component.isMainComponent = true;
      return component;
    }
  }

  // Look for App component
  const appComponent = components.find(c => c.name.toLowerCase().includes('app'));
  if (appComponent) {
    appComponent.isMainComponent = true;
    return appComponent;
  }

  // Use first component as main
  components[0].isMainComponent = true;
  return components[0];
}

/**
 * Remove duplicate components (same name, different patterns)
 */
function deduplicateComponents(components: DetectedComponent[]): DetectedComponent[] {
  const seen = new Set<string>();
  return components.filter(component => {
    if (seen.has(component.name)) return false;
    seen.add(component.name);
    return true;
  });
}

/**
 * Analyze props and interfaces
 */
export function analyzePropsAndInterfaces(content: string, framework: FrameworkType): PropsAnalysis | undefined {
  switch (framework) {
    case 'react':
      return analyzeReactProps(content);
    case 'vue':
      return analyzeVueProps(content);
    case 'svelte':
      return analyzeSvelteProps(content);
    default:
      return undefined;
  }
}

/**
 * Extract interface/type with proper nested brace handling
 */
function extractInterfaceWithBraces(content: string, pattern: RegExp): { name: string; body: string } | null {
  const match = pattern.exec(content);
  if (!match) return null;

  const startIndex = match.index + match[0].length;
  const fullName = match[1];
  
  // Extract base name without generics for interface name
  const baseName = fullName.replace(/<.*>/, '');
  
  // Find the matching closing brace
  let braceCount = 1;
  let currentIndex = startIndex;
  
  while (currentIndex < content.length && braceCount > 0) {
    const char = content[currentIndex];
    if (char === '{') {
      braceCount++;
    } else if (char === '}') {
      braceCount--;
    }
    currentIndex++;
  }
  
  if (braceCount > 0) {
    // Unmatched braces - fallback to simple extraction
    const simpleMatch = content.substring(startIndex).match(/([^}]*)/);
    return simpleMatch ? { name: baseName, body: simpleMatch[1] } : null;
  }
  
  const body = content.substring(startIndex, currentIndex - 1);
  return { name: baseName, body };
}

/**
 * Analyze React props (TypeScript interfaces, PropTypes)
 */
function analyzeReactProps(content: string): PropsAnalysis | undefined {
  // TypeScript interface patterns with generic support
  // Enhanced regex to handle generic types better: DataTableProps<T>
  const interfaceMatch = extractInterfaceWithBraces(content, /interface\s+([A-Z][a-zA-Z0-9]*(?:<[^>]*>)?Props)\s*{/);
  const typeMatch = extractInterfaceWithBraces(content, /type\s+([A-Z][a-zA-Z0-9]*(?:<[^>]*>)?Props)\s*=\s*{/);
  
  // Also try general component props pattern (not just ending in Props)
  const generalInterfaceMatch = !interfaceMatch ? extractInterfaceWithBraces(content, /interface\s+([A-Z][a-zA-Z0-9]*(?:<[^>]*>)?)\s*{/) : null;
  
  let interfaceName: string | undefined;
  let propertiesText: string | undefined;
  
  if (interfaceMatch) {
    interfaceName = interfaceMatch.name;
    propertiesText = interfaceMatch.body;
  } else if (typeMatch) {
    interfaceName = typeMatch.name;
    propertiesText = typeMatch.body;
  } else if (generalInterfaceMatch && generalInterfaceMatch.name.includes('Props')) {
    interfaceName = generalInterfaceMatch.name;
    propertiesText = generalInterfaceMatch.body;
  } else {
    // Fallback: try simple interface detection without brace matching
    const simpleInterfaceMatch = content.match(/interface\s+([A-Z][a-zA-Z0-9]*(?:<[^>]*>)?Props)\s*{([\s\S]*?)^}/m);
    if (simpleInterfaceMatch) {
      const fullName = simpleInterfaceMatch[1];
      interfaceName = fullName.replace(/<.*>/, '');
      propertiesText = simpleInterfaceMatch[2];
    }
  }
  
  if (!interfaceName || !propertiesText) {
    return undefined;
  }

  const properties = parseTypeScriptProps(propertiesText);
  
  return {
    interfaceName,
    properties,
    isRequired: properties.some(p => p.isRequired),
    hasDefaults: properties.some(p => p.defaultValue !== undefined),
    complexity: calculatePropsComplexity(properties)
  };
}

/**
 * Parse TypeScript prop definitions
 */
function parseTypeScriptProps(propertiesText: string): PropProperty[] {
  const properties: PropProperty[] = [];
  
  // Smart parsing that handles nested braces
  let currentProp = '';
  let braceDepth = 0;
  let parenDepth = 0;
  
  // First, split by lines and reassemble respecting braces
  const lines = propertiesText.split('\n');
  const propertyLines: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    currentProp += (currentProp ? ' ' : '') + trimmed;
    
    // Count braces and parentheses
    for (const char of trimmed) {
      if (char === '{') braceDepth++;
      else if (char === '}') braceDepth--;
      else if (char === '(') parenDepth++;
      else if (char === ')') parenDepth--;
    }
    
    // If we're back to depth 0 and line ends with ; or }, this is a complete property
    if (braceDepth === 0 && parenDepth === 0 && (trimmed.endsWith(';') || trimmed.endsWith('}') || trimmed.endsWith('}>;'))) {
      propertyLines.push(currentProp);
      currentProp = '';
    }
  }
  
  // Handle any remaining content
  if (currentProp.trim()) {
    propertyLines.push(currentProp);
  }
  
  // Now parse each complete property line
  for (const line of propertyLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Parse property: name: type or name?: type
    // More robust regex that stops at the first colon after a word boundary
    const propMatch = trimmed.match(/^\s*(\w+)(\??):\s*(.+?)(?:\s*=\s*([^;]+?))?(?:\s*;)?(?:\s*\/\/\s*(.+))?$/);
    if (propMatch) {
      const [, name, optional, type, defaultValue, description] = propMatch;
      // Skip if this looks like a nested property (contains no proper property structure)
      if (name && name.length > 0 && /^[a-zA-Z_]/.test(name)) {
        properties.push({
          name: name.trim(),
          type: type.trim(),
          isRequired: !optional,
          defaultValue: defaultValue?.trim(),
          description: description?.trim()
        });
      }
    }
  }
  
  return properties;
}

/**
 * Analyze Vue props
 */
function analyzeVueProps(content: string): PropsAnalysis | undefined {
  // Vue 3 defineProps
  const definePropsMatch = content.match(/defineProps<\s*{\s*([^}]*)\s*}\s*>/);
  if (definePropsMatch) {
    const properties = parseTypeScriptProps(definePropsMatch[1]);
    return {
      properties,
      isRequired: properties.some(p => p.isRequired),
      hasDefaults: properties.some(p => p.defaultValue !== undefined),
      complexity: calculatePropsComplexity(properties)
    };
  }

  // Vue Options API props with types
  const optionsPropsMatch = content.match(/props:\s*{([\s\S]*?)(?:\},\s*setup|\},?\s*$)/);
  if (optionsPropsMatch) {
    const properties = parseVueOptionsProps(optionsPropsMatch[1]);
    return {
      properties,
      isRequired: properties.some(p => p.isRequired),
      hasDefaults: properties.some(p => p.defaultValue !== undefined),
      complexity: calculatePropsComplexity(properties)
    };
  }

  return undefined;
}

/**
 * Parse Vue Options API props
 */
function parseVueOptionsProps(propsText: string): PropProperty[] {
  const properties: PropProperty[] = [];
  
  // Match prop definitions like: user: { type: Object as () => User, required: true }
  const propMatches = propsText.matchAll(/(\w+):\s*{([^}]*)}/g);
  
  for (const match of propMatches) {
    const propName = match[1];
    const propConfig = match[2];
    
    // Extract type, required, and default
    const typeMatch = propConfig.match(/type:\s*([\w()<>:,\s]*?)(?:,|$)/);
    const requiredMatch = propConfig.match(/required:\s*(true|false)/);
    const defaultMatch = propConfig.match(/default:\s*([^,}]+)/);
    
    properties.push({
      name: propName,
      type: typeMatch ? typeMatch[1].trim() : 'any',
      isRequired: requiredMatch ? requiredMatch[1] === 'true' : false,
      defaultValue: defaultMatch ? defaultMatch[1].trim() : undefined
    });
  }
  
  return properties;
}

/**
 * Analyze Svelte props
 */
function analyzeSvelteProps(content: string): PropsAnalysis | undefined {
  const exportLetMatches = content.matchAll(/export\s+let\s+(\w+)(?:\s*:\s*([^=;]+))?(?:\s*=\s*([^;]+))?/g);
  const properties: PropProperty[] = [];
  
  for (const match of exportLetMatches) {
    const defaultValue = match[3] ? match[3].trim() : undefined;
    properties.push({
      name: match[1],
      type: match[2] ? match[2].trim() : 'any',
      isRequired: !defaultValue, // Has default value = not required
      defaultValue
    });
  }
  
  if (properties.length === 0) return undefined;
  
  return {
    properties,
    isRequired: properties.some(p => p.isRequired),
    hasDefaults: properties.some(p => p.defaultValue !== undefined),
    complexity: calculatePropsComplexity(properties)
  };
}

/**
 * Calculate props complexity
 */
function calculatePropsComplexity(properties: PropProperty[]): 'simple' | 'moderate' | 'complex' {
  if (properties.length <= 3) return 'simple';
  if (properties.length <= 8) return 'moderate';
  return 'complex';
}

/**
 * Analyze exports with categorization
 */
export function analyzeExports(content: string): ExportAnalysis {
  const exports: ComponentExport[] = [];
  let defaultExport: ComponentExport | undefined;
  
  // Default exports with enhanced patterns
  const defaultExportPatterns = [
    // Simple patterns
    /export\s+default\s+(function|class)\s+([A-Z][a-zA-Z0-9]*)/,
    /export\s+default\s+([A-Z][a-zA-Z0-9]*)/,
    /const\s+([A-Z][a-zA-Z0-9]*)[^;]*;\s*export\s+default\s+\1/,
    // HOC patterns: export default connect(...)(withRouter(ComponentName))
    /export\s+default\s+[\s\S]*\(\s*([A-Z][a-zA-Z0-9]*)\s*\)\s*;?\s*$/m
  ];
  
  for (const pattern of defaultExportPatterns) {
    const match = content.match(pattern);
    if (match) {
      const name = match[2] || match[1];
      defaultExport = createComponentExport(name, content, true);
      break;
    }
  }
  
  // If no default export found yet, try to find HOC patterns more aggressively
  if (!defaultExport) {
    // Look for patterns like: export default connect(...)(withRouter(ComponentName));
    // Look for component name in parentheses that comes after export default
    const hocPattern = /\(\s*([A-Z][a-zA-Z0-9]*)\s*\)\s*;?/;
    const hocMatch = content.match(hocPattern);
    if (hocMatch && content.includes('export default')) {
      // Verify this component name appears after export default in the flow
      const exportIndex = content.indexOf('export default');
      const componentIndex = content.indexOf(`(${hocMatch[1]})`);
      if (componentIndex > exportIndex) {
        defaultExport = createComponentExport(hocMatch[1], content, true);
      }
    }
  }
  
  // Named exports
  const namedExportMatches = content.matchAll(/export\s+(?:const|function|class)\s+([A-Z][a-zA-Z0-9]*)/g);
  for (const match of namedExportMatches) {
    exports.push(createComponentExport(match[1], content, false));
  }
  
  // Export lists: export { Component1, Component2 }
  const exportListMatches = content.matchAll(/export\s*{\s*([^}]+)\s*}/g);
  for (const match of exportListMatches) {
    const exportNames = match[1].split(',').map(name => name.trim());
    for (const name of exportNames) {
      if (/^[A-Z]/.test(name)) {
        exports.push(createComponentExport(name, content, false));
      }
    }
  }
  
  // Re-exports
  const reExports: ComponentExport[] = [];
  const reExportMatches = content.matchAll(/export\s*{\s*([^}]+)\s*}\s*from\s*['"`]([^'"`]+)['"`]/g);
  for (const match of reExportMatches) {
    const exportNames = match[1].split(',').map(name => name.trim());
    const source = match[2];
    for (const name of exportNames) {
      reExports.push({
        name,
        type: 'unknown',
        isComponent: /^[A-Z]/.test(name),
        source
      });
    }
  }
  
  const allExports = [defaultExport, ...exports].filter(Boolean) as ComponentExport[];
  
  return {
    default: defaultExport,
    named: exports,
    reExports,
    totalExports: allExports.length + reExports.length,
    hasMultipleComponents: allExports.filter(e => e.isComponent).length > 1
  };
}

/**
 * Create a ComponentExport object
 */
function createComponentExport(name: string, content: string, isDefault: boolean): ComponentExport {
  const isComponent = isLikelyComponent(name, content);
  let componentType: 'functional' | 'class' | 'forwardRef' | 'memo' | 'hoc' | undefined;
  
  if (isComponent) {
    if (new RegExp(`class\\s+${name}\\s+extends`).test(content)) {
      componentType = 'class';
    } else if (new RegExp(`${name}\\s*=\\s*(?:React\\.)?forwardRef`).test(content)) {
      componentType = 'forwardRef';
    } else if (new RegExp(`${name}\\s*=\\s*(?:React\\.)?memo`).test(content)) {
      componentType = 'memo';
    } else if (new RegExp(`${name}\\s*=\\s*with[A-Z]`).test(content)) {
      componentType = 'hoc';
    } else {
      componentType = 'functional';
    }
  }
  
  return {
    name,
    type: isComponent ? 'component' : determineExportType(name, content),
    isComponent,
    componentType
  };
}

/**
 * Check if an export is likely a component
 */
function isLikelyComponent(name: string, content: string): boolean {
  // Must start with uppercase
  if (!/^[A-Z]/.test(name)) return false;
  
  // Check if it returns JSX or has component patterns
  const componentPatterns = [
    new RegExp(`(?:function|const)\\s+${name}[^{]*\\{[\\s\\S]*?return\\s*\\(?[\\s\\S]*?<`),
    new RegExp(`${name}\\s*=.*=>\\s*(?:\\{[\\s\\S]*?return\\s*)?\\(?[\\s\\S]*?<`),
    new RegExp(`class\\s+${name}\\s+extends\\s+(?:React\\.)?(?:Component|PureComponent)`)
  ];
  
  return componentPatterns.some(pattern => pattern.test(content));
}

/**
 * Determine export type for non-components
 */
function determineExportType(name: string, content: string): 'function' | 'constant' | 'type' | 'interface' | 'unknown' {
  if (new RegExp(`interface\\s+${name}`).test(content)) return 'interface';
  if (new RegExp(`type\\s+${name}`).test(content)) return 'type';
  if (new RegExp(`function\\s+${name}`).test(content)) return 'function';
  if (new RegExp(`const\\s+${name}\\s*=`).test(content)) return 'constant';
  return 'unknown';
}

/**
 * Analyze React hooks usage
 */
export function analyzeReactHooks(content: string): HookAnalysis[] {
  const hooks: Map<string, HookAnalysis> = new Map();
  
  // Find all hook usages - account for TypeScript generics like useRef<HTMLInputElement>
  const hookMatches = content.matchAll(/\b(use[A-Z][a-zA-Z0-9]*)\s*(?:<[^>]*>)?\s*\(/g);
  
  
  for (const match of hookMatches) {
    const hookName = match[1];
    const isBuiltIn = REACT_BUILTIN_HOOKS.has(hookName);
    
    if (!hooks.has(hookName)) {
      hooks.set(hookName, {
        name: hookName,
        type: isBuiltIn ? 'builtin' : 'custom',
        usageCount: 0,
        dependencies: [],
        isOptimized: true
      });
    }
    
    const hook = hooks.get(hookName)!;
    hook.usageCount++;
    
    // Analyze hook dependencies for useEffect, useMemo, useCallback
    if (['useEffect', 'useMemo', 'useCallback'].includes(hookName)) {
      const deps = extractHookDependencies(content, match.index!);
      if (deps) {
        hook.dependencies = deps;
        hook.isOptimized = deps.length > 0 || deps.length === 0; // Empty array is optimized
      }
    }
  }
  
  return Array.from(hooks.values());
}

/**
 * Extract hook dependencies from dependency array
 */
function extractHookDependencies(content: string, hookIndex: number): string[] | undefined {
  // Look for dependency array after the hook
  const afterHook = content.substring(hookIndex);
  const depArrayMatch = afterHook.match(/\[\s*([^\]]*)\s*\]/);
  
  if (!depArrayMatch) return undefined;
  
  const depsString = depArrayMatch[1].trim();
  if (!depsString) return []; // Empty dependency array
  
  return depsString.split(',').map(dep => dep.trim());
}

/**
 * Analyze component complexity
 */
export function analyzeComplexity(content: string, framework: FrameworkType, components: DetectedComponent[]): ComponentComplexityAnalysis {
  const jsxComplexity = framework === 'react' ? analyzeJSXComplexity(content) : undefined;
  const templateComplexity = ['vue', 'svelte'].includes(framework) ? analyzeTemplateComplexity(content, framework) : undefined;
  const stateComplexity = analyzeStateComplexity(content, framework);
  const logicComplexity = analyzeLogicComplexity(content);
  
  // Calculate overall complexity
  let complexityScore = 0;
  if (jsxComplexity) {
    complexityScore += jsxComplexity.nestingDepth * 2;
    complexityScore += jsxComplexity.conditionalCount;
    complexityScore += jsxComplexity.loopCount * 2;
  }
  if (templateComplexity) {
    complexityScore += templateComplexity.nestingDepth * 2;
    complexityScore += templateComplexity.directiveCount;
  }
  complexityScore += stateComplexity.stateVariables * 2;
  complexityScore += logicComplexity.functionCount;
  complexityScore += logicComplexity.cyclomaticComplexity;
  
  const overall: ComponentComplexity = 
    complexityScore < 15 ? 'simple' :
    complexityScore < 30 ? 'moderate' :
    complexityScore < 60 ? 'complex' : 'very-complex';
  
  // Performance flags
  const performanceFlags = detectPerformanceIssues(content);
  
  // Maintainability score (0-100)
  const maintainabilityScore = Math.max(0, Math.min(100, 100 - complexityScore));
  
  return {
    overall,
    jsxComplexity,
    templateComplexity,
    stateComplexity,
    logicComplexity,
    maintainabilityScore,
    performanceFlags
  };
}

/**
 * Analyze JSX complexity for React
 */
function analyzeJSXComplexity(content: string): JSXComplexity {
  const jsxBlocks = content.match(/<[^>]*>[\s\S]*?<\/[^>]*>/g) || [];
  
  let maxNesting = 0;
  let conditionalCount = 0;
  let loopCount = 0;
  let eventHandlers = 0;
  let inlineStyles = 0;
  let componentReferences = 0;
  
  for (const block of jsxBlocks) {
    // Calculate nesting depth
    const nesting = calculateJSXNesting(block);
    maxNesting = Math.max(maxNesting, nesting);
    
    // Count patterns
    conditionalCount += (block.match(/{[^}]*\?[^}]*:[^}]*}/g) || []).length;
    loopCount += (block.match(/\.map\s*\(/g) || []).length;
    eventHandlers += (block.match(/on[A-Z][a-zA-Z]*\s*=/g) || []).length;
    inlineStyles += (block.match(/style\s*=\s*{{/g) || []).length;
    componentReferences += (block.match(/<[A-Z][a-zA-Z0-9]*/g) || []).length;
  }
  
  return {
    nestingDepth: maxNesting,
    conditionalCount,
    loopCount,
    eventHandlers,
    inlineStyles,
    componentReferences
  };
}

/**
 * Calculate JSX nesting depth
 */
function calculateJSXNesting(jsxContent: string): number {
  let maxDepth = 0;
  let currentDepth = 0;
  
  // Simplified nesting calculation
  for (let i = 0; i < jsxContent.length; i++) {
    if (jsxContent[i] === '<' && jsxContent[i + 1] !== '/') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (jsxContent[i] === '<' && jsxContent[i + 1] === '/') {
      currentDepth--;
    }
  }
  
  return maxDepth;
}

/**
 * Analyze template complexity for Vue/Svelte
 */
function analyzeTemplateComplexity(content: string, framework: FrameworkType): TemplateComplexity {
  let nestingDepth = 0;
  let directiveCount = 0;
  let bindingCount = 0;
  let eventHandlers = 0;
  let componentReferences = 0;
  
  if (framework === 'vue') {
    directiveCount = (content.match(/v-\w+/g) || []).length;
    bindingCount = (content.match(/:[\w-]+=/g) || []).length + (content.match(/{{[^}]+}}/g) || []).length;
    eventHandlers = (content.match(/@\w+/g) || []).length;
  } else if (framework === 'svelte') {
    directiveCount = (content.match(/{#\w+/g) || []).length;
    bindingCount = (content.match(/{\w+}/g) || []).length;
    eventHandlers = (content.match(/on:\w+/g) || []).length;
  }
  
  // Simplified nesting calculation for templates
  const templateContent = framework === 'vue' ? 
    (content.match(/<template>([\s\S]*?)<\/template>/)?.[1] || '') :
    content;
  
  nestingDepth = calculateTemplateNesting(templateContent);
  componentReferences = (templateContent.match(/<[A-Z][a-zA-Z0-9]*/g) || []).length;
  
  return {
    nestingDepth,
    directiveCount,
    bindingCount,
    eventHandlers,
    componentReferences
  };
}

/**
 * Calculate template nesting depth
 */
function calculateTemplateNesting(templateContent: string): number {
  let maxDepth = 0;
  let currentDepth = 0;
  
  for (let i = 0; i < templateContent.length; i++) {
    if (templateContent[i] === '<' && templateContent[i + 1] !== '/') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (templateContent[i] === '<' && templateContent[i + 1] === '/') {
      currentDepth--;
    }
  }
  
  return maxDepth;
}

/**
 * Analyze state complexity
 */
function analyzeStateComplexity(content: string, framework: FrameworkType): StateComplexity {
  let stateVariables = 0;
  let stateUpdatePatterns: string[] = [];
  let hasComplexState = false;
  let hasStateEffects = false;
  let stateManagementApproach: 'local' | 'context' | 'external' | 'mixed' = 'local';
  
  if (framework === 'react') {
    // Count useState calls (including generic types)
    const useStateMatches = content.matchAll(/useState(?:<[^>]*>)?\s*\(/g);
    stateVariables = Array.from(useStateMatches).length;
    
    // Detect state update patterns
    if (content.includes('setState')) stateUpdatePatterns.push('setState');
    if (content.includes('useReducer')) {
      stateUpdatePatterns.push('useReducer');
      const useReducerMatches = content.matchAll(/useReducer\s*\(/g);
      stateVariables += Array.from(useReducerMatches).length;
    }
    
    // Check for complex state (objects/arrays)
    hasComplexState = /useState(?:<[^>]*>)?\s*\(\s*[{\[]/.test(content);
    
    // Check for state effects
    hasStateEffects = /useEffect\s*\([^,]*,\s*\[.*\]/.test(content);
    
    // Check state management approach
    if (content.includes('useContext')) stateManagementApproach = 'context';
    if (content.includes('redux') || content.includes('zustand')) stateManagementApproach = 'external';
  }
  
  return {
    stateVariables,
    stateUpdatePatterns,
    hasComplexState,
    hasStateEffects,
    stateManagementApproach
  };
}

/**
 * Analyze business logic complexity
 */
function analyzeLogicComplexity(content: string): LogicComplexity {
  const functionCount = (content.match(/function\s+\w+|const\s+\w+\s*=\s*(?:\([^)]*\)\s*)?=>/g) || []).length;
  
  // Simplified cyclomatic complexity (count decision points)
  const cyclomaticComplexity = 1 + // Base complexity
    (content.match(/if\s*\(/g) || []).length +
    (content.match(/else\s+if\s*\(/g) || []).length +
    (content.match(/for\s*\(/g) || []).length +
    (content.match(/while\s*\(/g) || []).length +
    (content.match(/switch\s*\(/g) || []).length +
    (content.match(/case\s+/g) || []).length +
    (content.match(/catch\s*\(/g) || []).length +
    (content.match(/\?\s*[^:]+\s*:/g) || []).length; // Ternary operators
  
  const hasAsyncOperations = /async\s+|await\s+|Promise\s*\.|\.then\s*\(/.test(content);
  const hasErrorHandling = /try\s*{|catch\s*\(/.test(content);
  const hasValidation = /validate|valid|invalid|error|required/i.test(content);
  
  // Estimate computation intensity
  const computationIntensity: 'low' | 'medium' | 'high' = 
    cyclomaticComplexity < 5 ? 'low' :
    cyclomaticComplexity < 15 ? 'medium' : 'high';
  
  return {
    functionCount,
    cyclomaticComplexity,
    hasAsyncOperations,
    hasErrorHandling,
    hasValidation,
    computationIntensity
  };
}

/**
 * Detect performance issues
 */
function detectPerformanceIssues(content: string): string[] {
  const issues: string[] = [];
  
  if (PERFORMANCE_PATTERNS.inlineObjects.test(content)) {
    issues.push('inline-objects');
  }
  if (PERFORMANCE_PATTERNS.inlineFunctions.test(content)) {
    issues.push('inline-functions');
  }
  if (PERFORMANCE_PATTERNS.missingKeys.test(content)) {
    issues.push('missing-keys');
  }
  if (PERFORMANCE_PATTERNS.complexConditions.test(content)) {
    issues.push('complex-conditions');
  }
  
  return issues;
}

/**
 * Analyze AI-generated code patterns
 */
export function analyzeAIPatterns(content: string): AICodePatterns {
  let chatgptScore = 0;
  let claudeScore = 0;
  const patterns: string[] = [];
  
  // Check ChatGPT patterns with weights
  for (const { pattern, weight } of AI_PATTERNS.chatgpt) {
    if (pattern.test(content)) {
      chatgptScore += weight;
    }
  }
  
  // Check Claude patterns with weights
  for (const { pattern, weight } of AI_PATTERNS.claude) {
    if (pattern.test(content)) {
      claudeScore += weight;
    }
  }
  
  // Determine AI source based on weighted patterns
  if (chatgptScore > 0) patterns.push('chatgpt-style');
  if (claudeScore > 0) patterns.push('claude-style');
  
  // More sophisticated AI detection with weighted scoring
  const likelyAIGenerated = chatgptScore > 0 || claudeScore > 0;
  const aiSource = claudeScore > chatgptScore ? 'claude' : 
                  chatgptScore > claudeScore ? 'chatgpt' : 
                  (chatgptScore === claudeScore && chatgptScore > 0) ? 'claude' : 'unknown';
  
  // Assess code quality
  const codeQuality = assessCodeQuality(content);
  const bestPractices = analyzeBestPractices(content);
  const commonIssues = detectCommonAIIssues(content);
  
  return {
    likelyAIGenerated,
    aiSource: likelyAIGenerated ? aiSource : undefined,
    patterns: [...new Set(patterns)],
    codeQuality,
    bestPractices,
    commonIssues
  };
}

/**
 * Assess overall code quality
 */
function assessCodeQuality(content: string): 'excellent' | 'good' | 'fair' | 'needs-improvement' {
  let score = 0;
  
  // Positive indicators (enhanced scoring)
  if (/\/\*\*[\s\S]*?\*\//.test(content)) score += 2; // JSDoc comments
  if (/interface\s+\w+Props(?:<[^>]*>)?/.test(content)) score += 2; // TypeScript interfaces (including generics)
  if (/React\.FC</.test(content)) score += 2; // TypeScript React components (increased weight)
  if (/const\s+\w+:\s*React\.FC/.test(content)) score += 2; // Type annotations (increased weight)
  if (/export\s+default/.test(content)) score += 1; // Proper exports
  if (/React\.memo\(/.test(content)) score += 2; // Performance optimization
  if (/useCallback|useMemo/.test(content)) score += 1; // Hook optimization
  if (/<[A-Z]/.test(content) && /key\s*=/.test(content)) score += 1; // Proper key usage
  
  // Negative indicators
  if (/any/.test(content)) score -= 2; // Any types
  if (/console\.log/.test(content)) score -= 1; // Debug statements
  if (/TODO/i.test(content)) score -= 1; // TODOs
  
  if (score >= 6) return 'excellent'; // Raised threshold for excellent
  if (score >= 3) return 'good';
  if (score >= 0) return 'fair';
  return 'needs-improvement';
}

/**
 * Analyze best practices
 */
function analyzeBestPractices(content: string): { follows: string[], missing: string[] } {
  const follows: string[] = [];
  const missing: string[] = [];
  
  // Check for best practices
  if (/interface\s+\w+Props/.test(content)) {
    follows.push('typescript-interfaces');
  } else if (/React\.FC/.test(content)) {
    missing.push('typescript-interfaces');
  }
  
  if (/React\.memo\(/.test(content)) {
    follows.push('memoization');
  }
  
  if (/useCallback\(/.test(content) || /useMemo\(/.test(content)) {
    follows.push('performance-optimization');
  }
  
  if (/key\s*=/.test(content)) {
    follows.push('list-keys');
  } else if (/\.map\s*\(/.test(content)) {
    missing.push('list-keys');
  }
  
  return { follows, missing };
}

/**
 * Detect common AI code issues
 */
function detectCommonAIIssues(content: string): string[] {
  const issues: string[] = [];
  
  if (/import\s+.*\s+from\s+['"`][^'"`]+['"`][\s\S]*?\/\/\s*unused/i.test(content)) {
    issues.push('unused-imports');
  }
  
  if (/style\s*=\s*{{/.test(content)) {
    issues.push('inline-styles');
  }
  
  if (/console\.log/.test(content)) {
    issues.push('debug-statements');
  }
  
  if (/TODO|FIXME/i.test(content)) {
    issues.push('incomplete-implementation');
  }
  
  return issues;
}

/**
 * Main function to analyze component structure
 */
export function analyzeComponentStructure(content: string, framework: FrameworkType): ComponentStructure {
  const detection = analyzeComponentDetection(content, framework);
  const props = analyzePropsAndInterfaces(content, framework);
  const exports = analyzeExports(content);
  const hooks = framework === 'react' ? analyzeReactHooks(content) : undefined;
  const complexity = analyzeComplexity(content, framework, detection.components);
  const patterns = analyzeAIPatterns(content);
  
  return {
    detection,
    props,
    exports,
    hooks,
    complexity,
    patterns
  };
}