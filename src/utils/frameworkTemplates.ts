/**
 * Framework-Specific Scaffolding Templates
 * Enhanced framework-specific configurations, optimizations, and templates
 */

import {
  ComponentStructure,
  FrameworkType,
  ScaffoldingOptions,
  BuildConfiguration,
  ScaffoldedFile
} from '../types/api';

/**
 * Framework-specific Vite configuration templates with deep optimizations
 */
export interface FrameworkViteConfig {
  imports: string;
  plugins: string;
  resolve?: string;
  define?: string;
  server?: string;
  build?: string;
  css?: string;
  esbuild?: string;
}

/**
 * Generate enhanced React Vite configuration with React 18 optimizations
 */
export function generateEnhancedReactViteConfig(
  buildConfig: BuildConfiguration,
  componentStructure: ComponentStructure,
  options: ScaffoldingOptions
): FrameworkViteConfig {
  const hasTypeScript = options.includeTypeScript ?? 
    (componentStructure.patterns?.language === 'typescript');
  
  const isComplex = componentStructure.complexity.overall === 'complex' ||
    componentStructure.complexity.overall === 'very-complex';
  
  const hasDevTools = componentStructure.patterns?.aiSource === 'claude' || isComplex;

  return {
    imports: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'${hasDevTools ? `
import { visualizer } from 'rollup-plugin-visualizer'` : ''}`,
    
    plugins: `plugins: [
    react({
      // Enable Fast Refresh for development
      fastRefresh: true,
      // Enable React DevTools in development
      include: "**/*.{jsx,tsx}",
      // Optimize JSX transformation
      jsxImportSource: "@emotion/react",
      jsxRuntime: "automatic"
    })${hasDevTools ? `,
    // Bundle analyzer for complex components
    process.env.ANALYZE && visualizer({
      filename: 'dist/stats.html',
      open: true,
      gzipSize: true,
      brotliSize: true
    })` : ''}
  ],`,

    resolve: `resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@components': resolve(__dirname, './src/components'),
      '@hooks': resolve(__dirname, './src/hooks'),
      '@utils': resolve(__dirname, './src/utils')
    }
  },`,

    define: `define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    __REACT_DEVTOOLS_GLOBAL_HOOK__: '({ isDisabled: false })'
  },`,

    server: `server: {
    port: 3000,
    open: true,
    host: true,
    hmr: {
      overlay: true
    }${isComplex ? `,
    // Enable proxy for complex components that might need API calls
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }` : ''}
  },`,

    build: `build: {
    outDir: '${buildConfig.outputDirectory}',
    sourcemap: ${buildConfig.optimization.sourceMaps},
    minify: 'esbuild',
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: ${isComplex ? `{
          vendor: ['react', 'react-dom'],
          utils: ['lodash', 'axios', 'date-fns']
        }` : buildConfig.optimization.codeSplitting ? `{
          vendor: ['react', 'react-dom']
        }` : 'undefined'},
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }${isComplex ? `,
    // Optimize for complex components
    chunkSizeWarningLimit: 1000` : ''}
  },`,

    css: hasTypeScript ? `css: {
    preprocessorOptions: {
      scss: {
        additionalData: \`@import "@/styles/variables.scss";\`
      }
    },
    modules: {
      localsConvention: 'camelCaseOnly'
    }
  },` : undefined,

    esbuild: hasTypeScript ? `esbuild: {
    jsxInject: \`import React from 'react'\`,
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  }` : undefined
  };
}

/**
 * Generate enhanced Vue Vite configuration with Vue 3 optimizations
 */
export function generateEnhancedVueViteConfig(
  buildConfig: BuildConfiguration,
  componentStructure: ComponentStructure,
  options: ScaffoldingOptions
): FrameworkViteConfig {
  const hasTypeScript = options.includeTypeScript ?? 
    (componentStructure.patterns?.language === 'typescript');
  
  const isComplex = componentStructure.complexity.overall === 'complex' ||
    componentStructure.complexity.overall === 'very-complex';

  return {
    imports: `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'${hasTypeScript ? `
import checker from 'vite-plugin-checker'` : ''}${isComplex ? `
import { visualizer } from 'rollup-plugin-visualizer'` : ''}`,

    plugins: `plugins: [
    vue({
      // Enable Vue DevTools
      reactivityTransform: true,
      template: {
        compilerOptions: {
          // Enable optimized mode for production
          hoistStatic: true,
          cacheHandlers: true
        }
      }
    })${hasTypeScript ? `,
    // TypeScript checking
    checker({
      vueTsc: true,
      eslint: {
        lintCommand: 'eslint "./src/**/*.{ts,tsx,vue}"'
      }
    })` : ''}${isComplex ? `,
    // Bundle analyzer for complex components
    process.env.ANALYZE && visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      open: true
    })` : ''}
  ],`,

    resolve: `resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@components': resolve(__dirname, 'src/components'),
      '@composables': resolve(__dirname, 'src/composables'),
      '@stores': resolve(__dirname, 'src/stores'),
      '@utils': resolve(__dirname, 'src/utils')
    }
  },`,

    define: `define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
  },`,

    server: `server: {
    port: 3000,
    open: true,
    host: true,
    hmr: {
      overlay: true
    }
  },`,

    build: `build: {
    outDir: '${buildConfig.outputDirectory}',
    sourcemap: ${buildConfig.optimization.sourceMaps},
    minify: 'esbuild',
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: ${isComplex ? `{
          vue: ['vue'],
          router: ['vue-router'],
          pinia: ['pinia'],
          utils: ['lodash', 'axios']
        }` : buildConfig.optimization.codeSplitting ? `{
          vue: ['vue']
        }` : 'undefined'}
      }
    }
  },`,

    css: `css: {
    preprocessorOptions: {
      scss: {
        additionalData: \`@import "@/styles/variables.scss";\`
      }
    }
  }`
  };
}

/**
 * Generate enhanced Svelte Vite configuration with SvelteKit compatibility
 */
export function generateEnhancedSvelteViteConfig(
  buildConfig: BuildConfiguration,
  componentStructure: ComponentStructure,
  options: ScaffoldingOptions
): FrameworkViteConfig {
  const hasTypeScript = options.includeTypeScript ?? 
    (componentStructure.patterns?.language === 'typescript');
  
  const isComplex = componentStructure.complexity.overall === 'complex' ||
    componentStructure.complexity.overall === 'very-complex';

  return {
    imports: `import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'${hasTypeScript ? `
import sveltePreprocess from 'svelte-preprocess'` : ''}${isComplex ? `
import { visualizer } from 'rollup-plugin-visualizer'` : ''}`,

    plugins: `plugins: [
    svelte({
      ${hasTypeScript ? `preprocess: sveltePreprocess({
        typescript: {
          tsconfigFile: './tsconfig.json'
        },
        scss: {
          includePaths: ['src', 'node_modules']
        },
        postcss: true
      }),` : ''}
      compilerOptions: {
        // Enable development mode features
        dev: process.env.NODE_ENV !== 'production',
        // Enable CSS injection for easier styling
        css: true,
        // Optimize for production
        hydratable: true
      },
      hot: {
        // Enable HMR for Svelte components
        preserveLocalState: true,
        noPreserveStateKey: ['@hmr:reset', '@!hmr']
      }
    })${isComplex ? `,
    // Bundle analyzer for complex components
    process.env.ANALYZE && visualizer({
      filename: 'dist/stats.html',
      template: 'sunburst',
      open: true
    })` : ''}
  ],`,

    resolve: `resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@components': resolve(__dirname, 'src/lib'),
      '@stores': resolve(__dirname, 'src/stores'),
      '@utils': resolve(__dirname, 'src/utils')
    }
  },`,

    server: `server: {
    port: 3000,
    open: true,
    host: true,
    hmr: {
      port: 24678
    }
  },`,

    build: `build: {
    outDir: '${buildConfig.outputDirectory}',
    sourcemap: ${buildConfig.optimization.sourceMaps},
    minify: 'esbuild',
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: ${isComplex ? `{
          svelte: ['svelte', 'svelte/internal'],
          utils: ['lodash']
        }` : buildConfig.optimization.codeSplitting ? `{
          svelte: ['svelte']
        }` : 'undefined'}
      }
    }
  },`,

    css: `css: {
    preprocessorOptions: {
      scss: {
        additionalData: \`@import 'src/app.scss';\`
      }
    }
  }`
  };
}

/**
 * Generate enhanced HTML-only Vite configuration with static optimization
 */
export function generateEnhancedHtmlViteConfig(
  buildConfig: BuildConfiguration,
  componentStructure: ComponentStructure,
  options: ScaffoldingOptions
): FrameworkViteConfig {
  return {
    imports: `import { defineConfig } from 'vite'
import { resolve } from 'path'`,

    plugins: `plugins: [
    // Static HTML optimization
    {
      name: 'html-optimize',
      transformIndexHtml(html) {
        return html.replace(
          /<title>(.*?)<\/title>/,
          '<title>$1</title>\\n    <meta name="description" content="Static HTML application">'
        )
      }
    }
  ],`,

    resolve: `resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@assets': resolve(__dirname, 'src/assets'),
      '@styles': resolve(__dirname, 'src/styles')
    }
  },`,

    server: `server: {
    port: 3000,
    open: true
  },`,

    build: `build: {
    outDir: '${buildConfig.outputDirectory}',
    sourcemap: false,
    minify: 'esbuild',
    target: 'esnext',
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash].[ext]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js'
      }
    }
  },`,

    css: `css: {
    devSourcemap: true,
    preprocessorOptions: {
      scss: {
        additionalData: \`@import "@/styles/variables.scss";\`
      }
    }
  }`
  };
}

/**
 * Generate framework-specific TypeScript configuration with optimal settings
 */
export function generateEnhancedTypeScriptConfig(
  framework: FrameworkType,
  componentStructure: ComponentStructure,
  options: ScaffoldingOptions
): any {
  const isComplex = componentStructure.complexity.overall === 'complex' ||
    componentStructure.complexity.overall === 'very-complex';
  
  const aiSource = componentStructure.patterns?.aiSource;

  const baseConfig = {
    target: 'ES2022',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    skipLibCheck: true,
    
    // Module resolution
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,

    // Path mapping
    baseUrl: '.',
    paths: {
      '@/*': ['./src/*'],
      '@components/*': ['./src/components/*'],
      '@utils/*': ['./src/utils/*']
    },

    // Type checking - enhanced for Claude patterns
    strict: true,
    noUnusedLocals: aiSource === 'claude' || isComplex,
    noUnusedParameters: aiSource === 'claude' || isComplex,
    exactOptionalPropertyTypes: aiSource === 'claude',
    noImplicitReturns: aiSource === 'claude' || isComplex,
    noFallthroughCasesInSwitch: true,
    noUncheckedIndexedAccess: aiSource === 'claude'
  };

  // Framework-specific enhancements
  switch (framework) {
    case 'react':
      return {
        ...baseConfig,
        jsx: 'react-jsx',
        paths: {
          ...baseConfig.paths,
          '@hooks/*': ['./src/hooks/*']
        },
        // React-specific optimizations
        allowSyntheticDefaultImports: true,
        esModuleInterop: true
      };

    case 'vue':
      return {
        ...baseConfig,
        jsx: 'preserve',
        types: ['vite/client', 'vue/ref-macros'],
        paths: {
          ...baseConfig.paths,
          '@composables/*': ['./src/composables/*'],
          '@stores/*': ['./src/stores/*']
        }
      };

    case 'svelte':
      return {
        ...baseConfig,
        jsx: 'preserve',
        types: ['vite/client', 'svelte'],
        paths: {
          ...baseConfig.paths,
          '$lib': ['./src/lib'],
          '$lib/*': ['./src/lib/*']
        },
        // Svelte-specific settings
        allowJs: true,
        checkJs: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true
      };

    default:
      return baseConfig;
  }
}

/**
 * Get framework-specific development dependencies
 */
export function getFrameworkDevDependencies(
  framework: FrameworkType,
  hasTypeScript: boolean,
  isComplex: boolean
): Record<string, string> {
  const baseDeps: Record<string, string> = {
    'vite': '^5.0.0'
  };

  if (hasTypeScript) {
    baseDeps['typescript'] = '^5.0.0';
    baseDeps['@types/node'] = '^20.0.0';
  }

  if (isComplex) {
    baseDeps['rollup-plugin-visualizer'] = '^5.9.0';
  }

  switch (framework) {
    case 'react':
      return {
        ...baseDeps,
        '@vitejs/plugin-react': '^4.0.0',
        ...(hasTypeScript && {
          '@types/react': '^18.0.0',
          '@types/react-dom': '^18.0.0'
        }),
        ...(isComplex && {
          'vite-plugin-checker': '^0.6.0'
        })
      };

    case 'vue':
      return {
        ...baseDeps,
        '@vitejs/plugin-vue': '^4.0.0',
        ...(hasTypeScript && {
          'vue-tsc': '^1.8.0',
          'vite-plugin-checker': '^0.6.0'
        })
      };

    case 'svelte':
      return {
        ...baseDeps,
        '@sveltejs/vite-plugin-svelte': '^3.0.0',
        ...(hasTypeScript && {
          'svelte-preprocess': '^5.0.0',
          'tslib': '^2.6.0'
        })
      };

    default:
      return baseDeps;
  }
}

/**
 * Generate enhanced JavaScript Vite configuration
 * For vanilla JavaScript projects without framework
 */
export function generateEnhancedJavaScriptViteConfig(): string {
  return `import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    minify: true,
    target: 'es2015',
    rollupOptions: {
      input: {
        main: '/index.html'
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});`;
}

/**
 * Generate enhanced Text/Binary Vite configuration
 * For static text files or binary content
 */
export function generateEnhancedTextViteConfig(): string {
  return `import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    copyPublicDir: true,
    assetsInlineLimit: 0, // Don't inline any assets
    rollupOptions: {
      input: {
        main: '/index.html'
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
});`;
}

/**
 * Generate enhanced Unknown framework Vite configuration
 * Fallback for undetectable content - uses HTML config as safe default
 */
export function generateEnhancedUnknownViteConfig(): string {
  return generateEnhancedHtmlViteConfig();
}