/**
 * Component Wrapper Generator
 * Intelligent component wrapper system that analyzes components and generates
 * appropriate App structures with sample props and provider integration
 */

import {
  ComponentStructure,
  ComponentWrapperAnalysis,
  ComponentWrapperResult,
  WrapperStrategy,
  PropsSampleConfig,
  ProviderConfig,
  AppWrapperOptions,
  FileMetadata,
  ScaffoldedFile,
  FrameworkType,
  ScaffoldingOptions,
  PropSamplePattern
} from '../types/api';

/**
 * Provider detection patterns
 */
const PROVIDER_PATTERNS = {
  router: {
    react: [/react-router/, /Router/, /Route/, /useNavigate/, /useLocation/, /<Router/, /<Route/],
    vue: [/vue-router/, /router/, /<router-/, /useRouter/, /useRoute/],
    svelte: [/svelte-routing/, /Router/, /Route/, /\$page/, /\$app/]
  },
  theme: {
    react: [/ThemeProvider/, /createTheme/, /useTheme/, /@mui\//, /theme/, /styled-components/],
    vue: [/ThemeProvider/, /provide.*theme/, /inject.*theme/],
    svelte: [/theme/, /setContext.*theme/, /getContext.*theme/]
  },
  state: {
    react: [/Provider/, /createContext/, /useContext/, /redux/, /zustand/, /recoil/],
    vue: [/provide/, /inject/, /pinia/, /vuex/],
    svelte: [/setContext/, /getContext/, /writable/, /readable/]
  }
};

/**
 * Sample prop generation patterns with realistic data
 */
const PROP_SAMPLE_PATTERNS: PropSamplePattern[] = [
  // Array patterns (MUST be first to catch string[], number[], etc.)
  {
    typePattern: /\[\]|Array<|Array\(|\w+\[\]/i,
    generator: (name: string, type: string) => {
      if (type.includes('string')) {
        if (name.toLowerCase().includes('tag')) return ['React', 'TypeScript', 'Web Development'];
        if (name.toLowerCase().includes('name')) return ['Alice', 'Bob', 'Charlie'];
        return ['Item 1', 'Item 2', 'Item 3'];
      }
      if (type.includes('number')) return [1, 2, 3, 4, 5];
      return ['Sample', 'Array', 'Items'];
    },
    description: 'Array values with sample data'
  },

  // Function patterns
  {
    typePattern: /\(\) => void|Function|function/i,
    generator: (name: string) => {
      const actionName = name.replace(/^on/, '').toLowerCase();
      return `() => console.info('${actionName} triggered')`;
    },
    description: 'Function props with console logging'
  },
  
  // Event handler patterns
  {
    typePattern: /React\.MouseEventHandler|MouseEvent|Event/i,
    generator: (name: string) => {
      const actionName = name.replace(/^on/, '').toLowerCase();
      return `(event) => console.info('${actionName}:', event)`;
    },
    description: 'Event handler functions'
  },
  
  // Object patterns (before string to catch object types)
  {
    typePattern: /\{|\bobject\b/i,
    generator: (name: string, type: string) => {
      if (name.toLowerCase().includes('user')) {
        return { id: 1, name: 'John Doe', email: 'john@example.com' };
      }
      if (name.toLowerCase().includes('config')) {
        return { theme: 'light', language: 'en' };
      }
      if (name.toLowerCase().includes('data')) {
        return { loading: false, items: [], total: 0 };
      }
      return { sampleProperty: 'Sample Value' };
    },
    description: 'Object values with contextual structure'
  },

  // Date patterns
  {
    typePattern: /Date/i,
    generator: () => new Date().toISOString().split('T')[0], // YYYY-MM-DD format
    description: 'Date values in ISO format'
  },
  
  // Children/ReactNode patterns
  {
    typePattern: /ReactNode|React\.ReactNode|children/i,
    generator: () => '<div>Sample Content</div>',
    description: 'React children with sample content'
  },

  // String patterns (moved after more specific patterns)
  {
    typePattern: /string/i,
    generator: (name: string) => {
      if (name.toLowerCase().includes('name')) return 'John Doe';
      if (name.toLowerCase().includes('title')) return 'Sample Title';
      if (name.toLowerCase().includes('email')) return 'user@example.com';
      if (name.toLowerCase().includes('url')) return 'https://example.com';
      if (name.toLowerCase().includes('id')) return 'sample-id-123';
      if (name.toLowerCase().includes('text')) return 'Sample text content';
      if (name.toLowerCase().includes('message')) return 'Hello, World!';
      return 'Sample Value';
    },
    description: 'String values with contextual defaults'
  },
  
  // Number patterns
  {
    typePattern: /number/i,
    generator: (name: string) => {
      if (name.toLowerCase().includes('count')) return 5;
      if (name.toLowerCase().includes('index')) return 0;
      if (name.toLowerCase().includes('id')) return 123;
      if (name.toLowerCase().includes('age')) return 25;
      if (name.toLowerCase().includes('price')) return 99.99;
      if (name.toLowerCase().includes('width')) return 300;
      if (name.toLowerCase().includes('height')) return 200;
      return 42;
    },
    description: 'Numeric values with contextual defaults'
  },
  
  // Boolean patterns
  {
    typePattern: /boolean/i,
    generator: (name: string) => {
      if (name.toLowerCase().includes('disabled')) return false;
      if (name.toLowerCase().includes('loading')) return false;
      if (name.toLowerCase().includes('visible')) return true;
      if (name.toLowerCase().includes('open')) return true;
      if (name.toLowerCase().includes('active')) return true;
      return false;
    },
    description: 'Boolean values with contextual defaults'
  }
];

/**
 * Analyze component structure to determine wrapper requirements
 */
export function analyzeComponentWrapper(
  componentStructure: ComponentStructure,
  originalFiles: FileMetadata[],
  framework: FrameworkType
): ComponentWrapperAnalysis {
  // Extract component information
  const mainComponent = componentStructure.detection.mainComponent || 'Component';
  const hasProps = componentStructure.props !== undefined;
  
  let requiredProps: string[] = [];
  let optionalProps: string[] = [];
  let propsInterface: string | undefined;
  
  // Analyze props if available
  if (componentStructure.props) {
    propsInterface = componentStructure.props.interfaceName;
    requiredProps = componentStructure.props.properties
      .filter(prop => prop.isRequired)
      .map(prop => prop.name);
    optionalProps = componentStructure.props.properties
      .filter(prop => !prop.isRequired)
      .map(prop => prop.name);
  }
  
  // Detect needed providers
  const needsProviders = detectNeededProviders(componentStructure, framework);
  
  // Determine export type
  const exportType = componentStructure.exports.default ? 'default' : 'named';
  
  // Determine wrapper strategy
  let wrapperStrategy: WrapperStrategy;
  if (needsProviders.length > 0 && requiredProps.length > 0) {
    wrapperStrategy = 'complex';
  } else if (needsProviders.length > 0) {
    wrapperStrategy = 'provider-needed';
  } else if (requiredProps.length > 0) {
    wrapperStrategy = 'props-required';
  } else if (optionalProps.length > 0) {
    wrapperStrategy = 'props-optional';
  } else {
    wrapperStrategy = 'simple';
  }
  
  // Generate sample props if needed
  let sampleProps: Record<string, any> | undefined;
  if (hasProps && componentStructure.props) {
    sampleProps = generateSampleProps(componentStructure.props.properties, true);
  }
  
  return {
    hasProps,
    propsInterface,
    requiredProps,
    optionalProps,
    needsProviders,
    exportType,
    componentName: mainComponent,
    wrapperStrategy,
    sampleProps
  };
}

/**
 * Detect needed providers based on component structure
 */
function detectNeededProviders(
  componentStructure: ComponentStructure,
  framework: FrameworkType
): string[] {
  const providers: string[] = [];
  
  // Get all import statements and component content
  const allImports = componentStructure.detection.components
    .map(comp => comp.name)
    .join(' ');
    
  // Check for router needs
  if (PROVIDER_PATTERNS.router[framework]?.some(pattern => pattern.test(allImports))) {
    providers.push('Router');
  }
  
  // Check for theme needs
  if (PROVIDER_PATTERNS.theme[framework]?.some(pattern => pattern.test(allImports))) {
    providers.push('ThemeProvider');
  }
  
  // Check for state management needs
  if (PROVIDER_PATTERNS.state[framework]?.some(pattern => pattern.test(allImports))) {
    providers.push('StateProvider');
  }
  
  return providers;
}

/**
 * Generate realistic sample props based on TypeScript interfaces
 */
export function generateSampleProps(properties: any[], includeOptional: boolean = true): Record<string, any> {
  const sampleProps: Record<string, any> = {};
  
  for (const prop of properties) {
    const { name, type, isRequired, defaultValue } = prop;
    
    // Use default value if available
    if (defaultValue !== undefined) {
      try {
        sampleProps[name] = JSON.parse(defaultValue);
        continue;
      } catch {
        sampleProps[name] = defaultValue;
        continue;
      }
    }
    
    // Generate sample value based on type patterns
    let sampleValue: any = 'Sample Value';
    
    for (const pattern of PROP_SAMPLE_PATTERNS) {
      if (pattern.typePattern.test(type)) {
        sampleValue = pattern.generator(name, type);
        break;
      }
    }
    
    // Include all required props and optionally include optional props
    if (isRequired || (includeOptional && !isRequired)) {
      sampleProps[name] = sampleValue;
    }
  }
  
  return sampleProps;
}

/**
 * Generate provider configurations
 */
export function generateProviderConfigs(
  providers: string[],
  framework: FrameworkType,
  hasTypeScript: boolean
): ProviderConfig[] {
  const configs: ProviderConfig[] = [];
  
  for (const provider of providers) {
    switch (provider) {
      case 'Router':
        if (framework === 'react') {
          configs.push({
            name: 'BrowserRouter',
            import: "import { BrowserRouter } from 'react-router-dom';",
            wrapperCode: '<BrowserRouter>\n      {children}\n    </BrowserRouter>',
            dependencies: ['react-router-dom']
          });
        }
        break;
        
      case 'ThemeProvider':
        if (framework === 'react') {
          configs.push({
            name: 'ThemeProvider',
            import: "import { ThemeProvider, createTheme } from '@mui/material/styles';\n\nconst theme = createTheme();",
            wrapperCode: '<ThemeProvider theme={theme}>\n      {children}\n    </ThemeProvider>',
            setupCode: 'const theme = createTheme();',
            dependencies: ['@mui/material']
          });
        }
        break;
        
      case 'StateProvider':
        if (framework === 'react') {
          configs.push({
            name: 'Provider',
            import: "// Add your state provider imports here\n// Example: import { Provider } from 'react-redux';",
            wrapperCode: '{/* Add your state provider wrapper here */}\n      {children}',
            dependencies: []
          });
        }
        break;
    }
  }
  
  return configs;
}

/**
 * Generate enhanced App wrapper component
 */
export function generateEnhancedAppWrapper(
  options: AppWrapperOptions
): ComponentWrapperResult {
  const { 
    componentName, 
    componentPath, 
    hasProps, 
    sampleProps, 
    providers, 
    framework, 
    hasTypeScript 
  } = options;
  
  // Generate the App component
  const appComponent = generateAppComponentWithWrapper(options);
  
  // Generate sample props configuration
  const samplePropsConfig = hasProps && sampleProps ? 
    Object.entries(sampleProps).map(([propName, sampleValue]): PropsSampleConfig => ({
      propName,
      propType: typeof sampleValue === 'object' ? 'object' : typeof sampleValue,
      isRequired: true, // Simplified for now
      sampleValue,
      description: `Sample ${propName} for demonstration`
    })) : undefined;
  
  // Extract imports needed
  const imports = [
    ...providers.map(p => p.import),
    `import ${componentName} from '${componentPath}';`
  ].filter(Boolean);
  
  const analysis: ComponentWrapperAnalysis = {
    hasProps,
    requiredProps: hasProps && sampleProps ? Object.keys(sampleProps) : [],
    optionalProps: [],
    needsProviders: providers.map(p => p.name),
    exportType: 'default',
    componentName,
    wrapperStrategy: providers.length > 0 && hasProps ? 'complex' : 
                     providers.length > 0 ? 'provider-needed' :
                     hasProps ? 'props-required' : 'simple',
    sampleProps
  };
  
  return {
    appComponent,
    sampleProps: samplePropsConfig,
    providers,
    imports,
    analysis
  };
}

/**
 * Generate the actual App component with intelligent wrapping
 */
function generateAppComponentWithWrapper(options: AppWrapperOptions): ScaffoldedFile {
  const { 
    componentName, 
    componentPath, 
    hasProps, 
    sampleProps, 
    providers, 
    framework, 
    hasTypeScript 
  } = options;
  
  const extension = hasTypeScript ? 'tsx' : 'jsx';
  
  // Generate imports
  const imports = [
    framework === 'react' ? "import React from 'react';" : '',
    ...providers.map(p => p.import),
    `import ${componentName} from '${componentPath}';`,
    "import './index.css'"
  ].filter(Boolean);
  
  // Generate setup code (theme creation, etc.)
  const setupCode = providers
    .map(p => p.setupCode)
    .filter(Boolean)
    .join('\n\n');
  
  // Generate sample props code
  const propsCode = hasProps && sampleProps ? `
// Sample props generated based on component interface
const sampleProps = ${JSON.stringify(sampleProps, null, 2)};` : '';
  
  // Generate component usage
  const componentUsage = hasProps && sampleProps 
    ? `<${componentName} {...sampleProps} />`
    : `<${componentName} />`;
  
  // Generate provider wrappers
  let wrappedComponent = `      <header className="App-header">
        ${componentUsage}
      </header>`;
  
  // Wrap in providers (innermost to outermost)
  for (let i = providers.length - 1; i >= 0; i--) {
    const provider = providers[i];
    const wrappedContent = wrappedComponent.replace('{children}', wrappedComponent);
    wrappedComponent = `      ${provider.wrapperCode.replace('{children}', wrappedComponent)}`;
  }
  
  // Generate the complete App component
  const content = `${imports.join('\n')}
${setupCode ? '\n' + setupCode + '\n' : ''}${propsCode}

function App() {
  return (
    <div className="App">
${wrappedComponent}
    </div>
  );
}

export default App;`;

  return {
    path: `src/App.${extension}`,
    content,
    type: 'component',
    isGenerated: true,
    template: 'enhanced-app-wrapper'
  };
}

/**
 * Enhanced scaffolding App component generation (replaces the basic version)
 */
export function generateEnhancedReactAppComponent(
  componentStructure: ComponentStructure,
  originalFiles: FileMetadata[],
  hasTypeScript: boolean
): ScaffoldedFile {
  // Check for multiple components (TASK-014 fix)
  const hasMultipleComponents = componentStructure.detection.hasMultipleComponents;
  
  // If multiple components, use the original simple approach that includes the proper comments
  if (hasMultipleComponents) {
    const extension = hasTypeScript ? 'tsx' : 'jsx';
    const componentName = componentStructure.detection.mainComponent || 'Component';
    
    // Find the original component file
    const originalComponent = originalFiles.find(f => 
      f.name.endsWith('.jsx') || f.name.endsWith('.tsx')
    );
    
    const componentImport = originalComponent 
      ? `import ${componentName} from './components/${originalComponent.name.replace(/\.(jsx|tsx)$/, '')}'`
      : `// Import your component here
// import ${componentName} from './components/${componentName}'`;

    const componentUsage = `      {/* Add your components here */}
      <${componentName} />
      {/* You can add more components as needed */}`;

    const content = `${componentImport}
import './index.css'

function App() {
  return (
    <div className="App">
      <header className="App-header">
${componentUsage}
      </header>
    </div>
  )
}

export default App`;

    return {
      path: `src/App.${extension}`,
      content,
      type: 'component',
      isGenerated: true,
      template: 'react-app-multiple'
    };
  }
  
  // For single components, use enhanced wrapper approach
  const analysis = analyzeComponentWrapper(componentStructure, originalFiles, 'react');
  
  // Find the original component file
  const originalComponent = originalFiles.find(f => 
    f.name.endsWith('.jsx') || f.name.endsWith('.tsx')
  );
  
  // If no original component exists, generate a self-contained App component
  // that defines a local placeholder instead of importing a missing file.
  if (!originalComponent) {
    const extension = hasTypeScript ? 'tsx' : 'jsx';
    const componentName = analysis.componentName || 'Component';

    // Local placeholder keeps build green and makes intent obvious to users.
    const content = `import './index.css'

// Placeholder component. Replace with your own in src/components/.
const ${componentName} = () => (
  <div style={{ padding: 20, textAlign: 'center', fontFamily: 'system-ui' }}>
    <h2>Scaffolded App</h2>
    <p>Provide your component under <code>src/components/</code> and update App accordingly.</p>
  </div>
);

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <${componentName} />
      </header>
    </div>
  );
}

export default App;`;

    return {
      path: `src/App.${extension}`,
      content,
      type: 'component',
      isGenerated: true,
      template: 'enhanced-app-wrapper-fallback'
    };
  }

  // Otherwise, generate wrapper that imports the detected component path
  const componentPath = `./components/${originalComponent.name.replace(/\.(jsx|tsx)$/, '')}`;
  
  // Generate provider configurations
  const providers = generateProviderConfigs(analysis.needsProviders, 'react', hasTypeScript);
  
  // Create options for wrapper generation
  const options: AppWrapperOptions = {
    componentName: analysis.componentName,
    componentPath,
    hasProps: analysis.hasProps,
    sampleProps: analysis.sampleProps,
    providers,
    framework: 'react',
    hasTypeScript
  };
  
  // Generate enhanced wrapper
  const result = generateEnhancedAppWrapper(options);
  return result.appComponent;
}

/**
 * Enhanced scaffolding Vue App component generation
 */
export function generateEnhancedVueAppComponent(
  componentStructure: ComponentStructure,
  originalFiles: FileMetadata[],
  hasTypeScript: boolean
): ScaffoldedFile {
  const analysis = analyzeComponentWrapper(componentStructure, originalFiles, 'vue');
  const componentName = analysis.componentName;
  
  const originalComponent = originalFiles.find(f => f.name.endsWith('.vue'));
  const componentImport = originalComponent 
    ? `import ${componentName} from './components/${originalComponent.name}';`
    : `// Import your component here`;
  
  const scriptLang = hasTypeScript ? ' lang="ts"' : '';
  
  // Generate sample props for Vue
  let templateProps = '';
  if (analysis.hasProps && analysis.sampleProps) {
    const propsData = Object.entries(analysis.sampleProps)
      .map(([key, value]) => `${key}="${typeof value === 'string' ? value : JSON.stringify(value)}"`)
      .join(' ');
    templateProps = ` ${propsData}`;
  }
  
  const content = `<template>
  <div id="app">
    <header>
      <${componentName}${templateProps} />
    </header>
  </div>
</template>

<script${scriptLang}>
${componentImport}

export default {
  name: 'App',
  components: {
    ${componentName}
  },
  data() {
    return {
      // Sample data for component props
      ${analysis.sampleProps ? Object.entries(analysis.sampleProps)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(',\n      ') : ''}
    };
  }
};
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>`;

  return {
    path: 'src/App.vue',
    content,
    type: 'component',
    isGenerated: true,
    template: 'enhanced-vue-app-wrapper'
  };
}

/**
 * Enhanced scaffolding Svelte App component generation
 */
export function generateEnhancedSvelteAppComponent(
  componentStructure: ComponentStructure,
  originalFiles: FileMetadata[],
  hasTypeScript: boolean
): ScaffoldedFile {
  const analysis = analyzeComponentWrapper(componentStructure, originalFiles, 'svelte');
  const componentName = analysis.componentName;
  
  const originalComponent = originalFiles.find(f => f.name.endsWith('.svelte'));
  const componentImport = originalComponent 
    ? `  import ${componentName} from './lib/${originalComponent.name}';`
    : `  // Import your component here`;
  
  const scriptLang = hasTypeScript ? ' lang="ts"' : '';
  
  // Generate sample props for Svelte
  const samplePropsCode = analysis.hasProps && analysis.sampleProps 
    ? Object.entries(analysis.sampleProps)
        .map(([key, value]) => `  let ${key} = ${JSON.stringify(value)};`)
        .join('\n') 
    : '';
  
  const componentProps = analysis.hasProps && analysis.sampleProps
    ? Object.keys(analysis.sampleProps).map(key => `{${key}}`).join(' ')
    : '';
  
  const content = `<script${scriptLang}>
${componentImport}
  
  // Sample props for component
${samplePropsCode}
</script>

<main>
  <div>
    <${componentName} ${componentProps} />
  </div>
</main>

<style>
  main {
    text-align: center;
    padding: 1em;
    max-width: 240px;
    margin: 0 auto;
  }

  @media (min-width: 640px) {
    main {
      max-width: none;
    }
  }
</style>`;

  return {
    path: 'src/App.svelte',
    content,
    type: 'component',
    isGenerated: true,
    template: 'enhanced-svelte-app-wrapper'
  };
}
