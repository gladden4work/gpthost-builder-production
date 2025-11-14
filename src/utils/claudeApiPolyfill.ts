/**
 * Claude API Polyfill
 * Provides a mock implementation of window.claude for components that depend on it
 */

/**
 * Generate a polyfill script that can be injected into components
 * that use window.claude API
 */
export function generateClaudePolyfill(): string {
  return `
// Claude API Polyfill - Provides mock implementation when window.claude is not available
(function() {
  if (typeof window !== 'undefined' && !window.claude) {
    window.claude = {
      complete: async function(prompt) {
        // Mock implementation that provides reasonable defaults
        console.warn('window.claude.complete() called but Claude API is not available. Using mock response.');
        
        // Provide context-aware mock responses
        if (prompt.includes('Python') && prompt.includes('convert')) {
          // For code conversion tasks
          return '// Converted code (mock - Claude API not available)\\nfunction convertedFunction() {\\n  console.log("This is a mock conversion");\\n  // Add your converted code here\\n}';
        } else if (prompt.includes('evaluate') || prompt.includes('Python code')) {
          // For code evaluation tasks (PyLingo)
          return JSON.stringify({
            isCorrect: Math.random() > 0.5,
            explanation: "This is a mock evaluation. The Claude API is not available in this environment.",
            feedback: "To use the full functionality, please run this application in an environment with Claude API access.",
            outputMatches: Math.random() > 0.5
          });
        } else {
          // Generic response
          return "Mock response: Claude API is not available in this environment.";
        }
      }
    };
    
    console.info('Claude API polyfill loaded. Components will use mock responses.');
  }
})();`;
}

/**
 * Check if content uses window.claude API
 */
export function usesClaudeAPI(content: string): boolean {
  return content.includes('window.claude');
}

/**
 * Inject Claude polyfill into component if needed
 */
export function injectClaudePolyfill(content: string, filename?: string): string {
  if (!usesClaudeAPI(content)) {
    return content;
  }

  if (filename) {
    console.info(`🔧 [CLAUDE-POLYFILL] Injecting Claude API mock for ${filename}`);
  }

  // Find a better injection point - after all imports
  const importRegex = /^((?:import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*\n)+)/m;
  const importMatch = content.match(importRegex);
  
  if (importMatch) {
    const imports = importMatch[0];
    const afterImports = content.slice(imports.length);
    return imports + '\n' + generateClaudePolyfill() + '\n' + afterImports;
  }
  
  // If no imports found, look for the first const/function/class declaration
  const componentStartRegex = /^([\s\S]*?)(\n(?:const|let|var|function|class|export)\s)/m;
  const componentMatch = content.match(componentStartRegex);
  
  if (componentMatch) {
    const beforeComponent = componentMatch[1];
    const componentStart = componentMatch[2];
    const restOfCode = content.slice(beforeComponent.length);
    return beforeComponent + '\n' + generateClaudePolyfill() + restOfCode;
  }
  
  // Last resort: inject at the beginning with a newline separator
  return generateClaudePolyfill() + '\n\n' + content;
}

/**
 * Create a wrapper component that provides Claude API mock
 */
export function createClaudeWrapper(componentCode: string, componentName: string): string {
  return `
import React from 'react';

${generateClaudePolyfill()}

${componentCode}

// Re-export the component
export default ${componentName};
`;
}