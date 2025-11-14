/**
 * API-First TDD Test Suite: Component Detection System
 * 
 * This test suite defines the contract for framework and component detection.
 * These tests MUST pass for accurate AI component processing.
 * 
 * Success Criteria:
 * - Detect React components (JSX, hooks, imports)
 * - Detect Vue SFCs (template tags, composition API)
 * - Detect Svelte components (reactive statements)
 * - Extract component names accurately
 * - Identify all required dependencies
 * - Distinguish TypeScript from JavaScript
 */

import { describe, it, expect } from 'vitest';
import { 
  detectFramework,
  extractComponentName,
  extractDependenciesArray as extractDependencies,
  detectLanguageFromContent as detectLanguage,
  analyzeComponentStructure 
} from '../../src/utils/fileAnalysis';

describe('Component Detection Unit Tests', () => {
  
  describe('PHASE 1: React Detection', () => {
    it('MUST detect React from JSX syntax', () => {
      // Given: Code with JSX elements
      const jsxCode = `
        const App = () => {
          return <div className="app">Hello World</div>;
        };
      `;

      // When: Detecting framework
      const framework = detectFramework(jsxCode);

      // Then: Should identify as React
      expect(framework).toBe('react');
    });

    it('MUST detect React from useState hook', () => {
      // Given: Code using React hooks
      const hooksCode = `
        import { useState } from 'react';
        
        function Counter() {
          const [count, setCount] = useState(0);
          return count;
        }
      `;

      // When: Analyzing the code
      const framework = detectFramework(hooksCode);

      // Then: Should detect React
      expect(framework).toBe('react');
    });

    it('MUST detect React from useEffect hook', () => {
      // Given: useEffect usage
      const effectCode = `
        import { useEffect } from 'react';
        
        function Component() {
          useEffect(() => {
            console.log('mounted');
          }, []);
        }
      `;

      // When: Detecting framework
      const framework = detectFramework(effectCode);

      // Then: Should identify React
      expect(framework).toBe('react');
    });

    it('MUST detect React from React.Component class', () => {
      // Given: Class component
      const classCode = `
        import React from 'react';
        
        class MyComponent extends React.Component {
          render() {
            return <div>Class Component</div>;
          }
        }
      `;

      // When: Analyzing
      const framework = detectFramework(classCode);

      // Then: Should detect React
      expect(framework).toBe('react');
    });

    it('MUST detect React from Fragment usage', () => {
      // Given: React Fragment
      const fragmentCode = `
        import { Fragment } from 'react';
        
        const List = () => (
          <Fragment>
            <li>Item 1</li>
            <li>Item 2</li>
          </Fragment>
        );
      `;

      // When: Detecting
      const framework = detectFramework(fragmentCode);

      // Then: Should be React
      expect(framework).toBe('react');
    });

    it('MUST handle React with no obvious markers gracefully', () => {
      // Given: Subtle React code
      const subtleCode = `
        import React from 'react';
        export default function() { return null; }
      `;

      // When: Analyzing
      const framework = detectFramework(subtleCode);

      // Then: Should still detect React from import
      expect(framework).toBe('react');
    });
  });

  describe('PHASE 2: Vue Detection', () => {
    it('MUST detect Vue from template tags', () => {
      // Given: Vue SFC with template
      const vueTemplate = `
        <template>
          <div>{{ message }}</div>
        </template>
        <script>
        export default {
          data() {
            return { message: 'Hello' };
          }
        }
        </script>
      `;

      // When: Detecting framework
      const framework = detectFramework(vueTemplate);

      // Then: Should identify Vue
      expect(framework).toBe('vue');
    });

    it('MUST detect Vue from v-directives', () => {
      // Given: Vue directives
      const vueDirectives = `
        <div v-if="show" v-for="item in items" :key="item.id">
          <span v-text="item.name"></span>
        </div>
      `;

      // When: Analyzing
      const framework = detectFramework(vueDirectives);

      // Then: Should detect Vue
      expect(framework).toBe('vue');
    });

    it('MUST detect Vue 3 Composition API', () => {
      // Given: Vue 3 setup syntax
      const vue3Code = `
        <script setup>
        import { ref, computed } from 'vue';
        
        const count = ref(0);
        const doubled = computed(() => count.value * 2);
        </script>
      `;

      // When: Detecting
      const framework = detectFramework(vue3Code);

      // Then: Should identify Vue
      expect(framework).toBe('vue');
    });

    it('MUST detect Vue from style scoped', () => {
      // Given: Vue scoped styles
      const vueScopedStyle = `
        <style scoped>
        .button { color: blue; }
        </style>
      `;

      // When: Analyzing
      const framework = detectFramework(vueScopedStyle);

      // Then: Should detect Vue
      expect(framework).toBe('vue');
    });

    it('MUST detect Vue from double curly braces', () => {
      // Given: Vue interpolation
      const vueInterpolation = `
        <div>
          {{ count }} items
          {{ user.name }}
        </div>
      `;

      // When: Detecting
      const framework = detectFramework(vueInterpolation);

      // Then: Should be Vue
      expect(framework).toBe('vue');
    });
  });

  describe('PHASE 3: Svelte Detection', () => {
    it('MUST detect Svelte from reactive declarations', () => {
      // Given: Svelte reactive statement
      const svelteReactive = `
        <script>
          let count = 0;
          $: doubled = count * 2;
          $: console.log('count is', count);
        </script>
      `;

      // When: Detecting framework
      const framework = detectFramework(svelteReactive);

      // Then: Should identify Svelte
      expect(framework).toBe('svelte');
    });

    it('MUST detect Svelte from on: event handlers', () => {
      // Given: Svelte event syntax
      const svelteEvents = `
        <button on:click={handleClick}>
          Click me
        </button>
        <input on:input={updateValue} />
      `;

      // When: Analyzing
      const framework = detectFramework(svelteEvents);

      // Then: Should detect Svelte
      expect(framework).toBe('svelte');
    });

    it('MUST detect Svelte from bind: directives', () => {
      // Given: Svelte two-way binding
      const svelteBinding = `
        <input bind:value={name} />
        <textarea bind:value={text}></textarea>
      `;

      // When: Detecting
      const framework = detectFramework(svelteBinding);

      // Then: Should be Svelte
      expect(framework).toBe('svelte');
    });

    it('MUST detect Svelte from {#if} blocks', () => {
      // Given: Svelte conditional blocks
      const svelteBlocks = `
        {#if visible}
          <p>Visible content</p>
        {:else}
          <p>Hidden</p>
        {/if}
        
        {#each items as item}
          <li>{item}</li>
        {/each}
      `;

      // When: Analyzing
      const framework = detectFramework(svelteBlocks);

      // Then: Should detect Svelte
      expect(framework).toBe('svelte');
    });

    it('MUST detect Svelte stores', () => {
      // Given: Svelte store usage
      const svelteStore = `
        <script>
          import { writable } from 'svelte/store';
          const count = writable(0);
        </script>
      `;

      // When: Detecting
      const framework = detectFramework(svelteStore);

      // Then: Should identify Svelte
      expect(framework).toBe('svelte');
    });
  });

  describe('PHASE 4: Component Name Extraction', () => {
    it('MUST extract React function component name', () => {
      // Given: Named React component
      const code = `
        function TodoList() {
          return <div>Todo</div>;
        }
        export default TodoList;
      `;

      // When: Extracting name
      const name = extractComponentName(code, 'react');

      // Then: Should get correct name
      expect(name).toBe('TodoList');
    });

    it('MUST extract React arrow function component name', () => {
      // Given: Arrow function component
      const code = `
        const UserProfile = () => {
          return <div>Profile</div>;
        };
      `;

      // When: Extracting
      const name = extractComponentName(code, 'react');

      // Then: Should find name
      expect(name).toBe('UserProfile');
    });

    it('MUST extract Vue component name from export', () => {
      // Given: Vue component with name property
      const code = `
        export default {
          name: 'CounterWidget',
          data() {
            return { count: 0 };
          }
        }
      `;

      // When: Extracting name
      const name = extractComponentName(code, 'vue');

      // Then: Should get Vue name
      expect(name).toBe('CounterWidget');
    });

    it('MUST extract Svelte component name from filename context', () => {
      // Given: Svelte code (names often from filename)
      const code = `
        <script>
          export let name = 'World';
        </script>
        <h1>Hello {name}!</h1>
      `;

      // When: Extracting (with filename hint)
      const name = extractComponentName(code, 'svelte', 'Greeting.svelte');

      // Then: Should use filename
      expect(name).toBe('Greeting');
    });

    it('MUST handle anonymous components gracefully', () => {
      // Given: Anonymous component
      const code = `
        export default () => {
          return <div>Anonymous</div>;
        };
      `;

      // When: Extracting name
      const name = extractComponentName(code, 'react');

      // Then: Should provide default
      expect(name).toMatch(/Component|App|Anonymous/);
    });
  });

  describe('PHASE 5: Dependency Extraction', () => {
    it('MUST extract npm dependencies from imports', () => {
      // Given: Code with various imports
      const code = `
        import React, { useState } from 'react';
        import axios from 'axios';
        import { format } from 'date-fns';
        import './styles.css';
      `;

      // When: Extracting dependencies
      const deps = extractDependencies(code);

      // Then: Should find all npm packages
      expect(deps).toContain('react');
      expect(deps).toContain('axios');
      expect(deps).toContain('date-fns');
      expect(deps).not.toContain('./styles.css'); // Local import
    });

    it('MUST extract Vue ecosystem dependencies', () => {
      // Given: Vue with common libraries
      const code = `
        import { createApp } from 'vue';
        import { createRouter } from 'vue-router';
        import { createPinia } from 'pinia';
        import VueI18n from 'vue-i18n';
      `;

      // When: Extracting
      const deps = extractDependencies(code);

      // Then: Should find Vue packages
      expect(deps).toContain('vue');
      expect(deps).toContain('vue-router');
      expect(deps).toContain('pinia');
      expect(deps).toContain('vue-i18n');
    });

    it('MUST handle require() statements', () => {
      // Given: CommonJS requires
      const code = `
        const express = require('express');
        const path = require('path');
        const { readFile } = require('fs');
      `;

      // When: Extracting
      const deps = extractDependencies(code);

      // Then: Should find required modules
      expect(deps).toContain('express');
      // Note: 'path' and 'fs' are Node built-ins, may be excluded
    });

    it('MUST detect styled-components and CSS-in-JS', () => {
      // Given: Styled components
      const code = `
        import styled from 'styled-components';
        import { css } from '@emotion/react';
        
        const Button = styled.button\`
          color: blue;
        \`;
      `;

      // When: Extracting
      const deps = extractDependencies(code);

      // Then: Should find CSS-in-JS libraries
      expect(deps).toContain('styled-components');
      expect(deps).toContain('@emotion/react');
    });

    it('MUST exclude built-in Node modules', () => {
      // Given: Mix of npm and built-in modules
      const code = `
        import fs from 'fs';
        import path from 'path';
        import express from 'express';
        import crypto from 'crypto';
      `;

      // When: Extracting
      const deps = extractDependencies(code);

      // Then: Should only include npm packages
      expect(deps).toContain('express');
      expect(deps).not.toContain('fs');
      expect(deps).not.toContain('path');
      expect(deps).not.toContain('crypto');
    });
  });

  describe('PHASE 6: Language Detection', () => {
    it('MUST detect TypeScript from type annotations', () => {
      // Given: TypeScript code
      const tsCode = `
        interface User {
          name: string;
          age: number;
        }
        
        const greet = (user: User): string => {
          return \`Hello \${user.name}\`;
        };
      `;

      // When: Detecting language
      const language = detectLanguage(tsCode);

      // Then: Should identify TypeScript
      expect(language).toBe('typescript');
    });

    it('MUST detect TypeScript from interfaces', () => {
      // Given: Interface declaration
      const code = `
        interface Props {
          title: string;
          onClick: () => void;
        }
      `;

      // When: Analyzing
      const language = detectLanguage(code);

      // Then: Should be TypeScript
      expect(language).toBe('typescript');
    });

    it('MUST detect TypeScript from enums', () => {
      // Given: Enum declaration
      const code = `
        enum Status {
          Active = 'ACTIVE',
          Inactive = 'INACTIVE'
        }
      `;

      // When: Detecting
      const language = detectLanguage(code);

      // Then: Should detect TypeScript
      expect(language).toBe('typescript');
    });

    it('MUST detect TypeScript from generic types', () => {
      // Given: Generic type usage
      const code = `
        const items: Array<string> = [];
        const map: Map<string, number> = new Map();
        function identity<T>(arg: T): T { return arg; }
      `;

      // When: Analyzing
      const language = detectLanguage(code);

      // Then: Should be TypeScript
      expect(language).toBe('typescript');
    });

    it('MUST default to JavaScript without TypeScript features', () => {
      // Given: Plain JavaScript
      const jsCode = `
        const add = (a, b) => a + b;
        function multiply(x, y) {
          return x * y;
        }
      `;

      // When: Detecting
      const language = detectLanguage(jsCode);

      // Then: Should be JavaScript
      expect(language).toBe('javascript');
    });
  });

  describe('PHASE 7: Component Structure Analysis', () => {
    it('MUST identify React hooks usage', () => {
      // Given: Component with various hooks
      const code = `
        import { useState, useEffect, useContext, useMemo } from 'react';
        
        function Component() {
          const [state, setState] = useState(0);
          useEffect(() => {}, []);
          const ctx = useContext(MyContext);
          const memo = useMemo(() => state * 2, [state]);
        }
      `;

      // When: Analyzing structure
      const analysis = analyzeComponentStructure(code, 'react');

      // Then: Should detect hooks
      expect(analysis.hasHooks).toBe(true);
      expect(analysis.hooks).toContain('useState');
      expect(analysis.hooks).toContain('useEffect');
      expect(analysis.hooks).toContain('useContext');
      expect(analysis.hooks).toContain('useMemo');
    });

    it('MUST identify component type (functional vs class)', () => {
      // Given: Different component types
      const functionalCode = `
        const Component = () => <div>Functional</div>;
      `;
      const classCode = `
        class Component extends React.Component {
          render() { return <div>Class</div>; }
        }
      `;

      // When: Analyzing each
      const functionalAnalysis = analyzeComponentStructure(functionalCode, 'react');
      const classAnalysis = analyzeComponentStructure(classCode, 'react');

      // Then: Should identify types
      expect(functionalAnalysis.componentType).toBe('functional');
      expect(classAnalysis.componentType).toBe('class');
    });

    it('MUST count components in file', () => {
      // Given: Multiple components
      const code = `
        const Header = () => <header>Header</header>;
        const Footer = () => <footer>Footer</footer>;
        function MainContent() {
          return <main>Content</main>;
        }
      `;

      // When: Analyzing
      const analysis = analyzeComponentStructure(code, 'react');

      // Then: Should count all components
      expect(analysis.componentCount).toBe(3);
      expect(analysis.componentNames).toContain('Header');
      expect(analysis.componentNames).toContain('Footer');
      expect(analysis.componentNames).toContain('MainContent');
    });

    it('MUST detect styled components usage', () => {
      // Given: Styled components
      const code = `
        import styled from 'styled-components';
        
        const Button = styled.button\`
          background: blue;
        \`;
        
        const Container = styled.div\`
          padding: 20px;
        \`;
      `;

      // When: Analyzing
      const analysis = analyzeComponentStructure(code, 'react');

      // Then: Should detect styled components
      expect(analysis.hasStyledComponents).toBe(true);
      expect(analysis.styledComponentCount).toBe(2);
    });

    it('MUST detect API/data fetching patterns', () => {
      // Given: Component with data fetching
      const code = `
        function UserList() {
          useEffect(() => {
            fetch('/api/users')
              .then(res => res.json())
              .then(setUsers);
            
            axios.get('/api/posts');
          }, []);
        }
      `;

      // When: Analyzing
      const analysis = analyzeComponentStructure(code, 'react');

      // Then: Should detect API usage
      expect(analysis.hasApiCalls).toBe(true);
      expect(analysis.apiPatterns).toContain('fetch');
      expect(analysis.apiPatterns).toContain('axios');
    });
  });
});

/**
 * Test Execution Summary
 * 
 * These tests define the complete contract for component detection.
 * When all tests pass, the following guarantees are met:
 * 
 * 1. ✅ React detection (JSX, hooks, classes)
 * 2. ✅ Vue detection (templates, directives, composition API)
 * 3. ✅ Svelte detection (reactive statements, special syntax)
 * 4. ✅ Component name extraction
 * 5. ✅ Dependency identification
 * 6. ✅ TypeScript vs JavaScript detection
 * 7. ✅ Component structure analysis
 * 
 * This ensures 85%+ AI component compatibility as required.
 */