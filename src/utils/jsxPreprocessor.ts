/**
 * JSX Preprocessor - Fixes common AI-generated JSX patterns that cause build failures
 * 
 * Problem: AI tools (ChatGPT, Claude, etc.) often generate incorrect JSX syntax
 * with double curly braces {{expression}} that Vite's parser strictly rejects.
 * 
 * Solution: State machine-based processor that handles complex multiline patterns
 * correctly, ensuring clean content throughout the entire pipeline.
 * 
 * Implementation: Single-pass state machine with proper brace depth tracking
 * to handle nested JSX structures without breaking style objects.
*/

import * as ts from 'typescript';
import { normalizeTsx } from './tsxNormalizer';
import { injectClaudePolyfill } from './claudeApiPolyfill';

// State machine states for JSX processing
enum JSXState {
  NORMAL = 0,
  IN_JSX_EXPR = 1,
  IN_STYLE_ATTR = 2,
  IN_STRING = 3
}

/**
 * State machine-based JSX preprocessor
 * Handles ALL cases including complex nested multiline patterns
 * 
 * @param content - Raw JSX/TSX content
 * @returns Processed content with fixed JSX patterns
 */
function preprocessJSXStateMachine(content: string): string {
  if (typeof content !== 'string') {
    return content;
  }

  let state = JSXState.NORMAL;
  const result: string[] = [];
  let i = 0;
  let stringDelimiter: string | null = null;
  let braceDepth = 0;
  let styleDepth = 0;
  let inStyleObject = false;
  // Track which depth levels were from double brace conversions
  // This is the key fix: we track WHICH braces were originally double
  const doubleBraceDepths = new Set<number>();
  
  const isStyleAttribute = (pos: number): boolean => {
    // Look back up to 10 chars for 'style='
    const lookback = content.substring(Math.max(0, pos - 10), pos);
    return /style\s*=\s*$/.test(lookback);
  };
  
  const isDangerouslySetInnerHTML = (pos: number): boolean => {
    // Look back up to 30 chars for 'dangerouslySetInnerHTML='
    const lookback = content.substring(Math.max(0, pos - 30), pos);
    return /dangerouslySetInnerHTML\s*=\s*$/.test(lookback);
  };
  
  while (i < content.length) {
    const curr = content[i];
    const next = content[i + 1] || '';
    const prev = i > 0 ? content[i - 1] : '';
    
    switch (state) {
      case JSXState.NORMAL:
        if (curr === '{' && next === '{') {
          if (isStyleAttribute(i) || isDangerouslySetInnerHTML(i)) {
            // This is style={{...}} or dangerouslySetInnerHTML={{...}}, preserve it
            if (isStyleAttribute(i)) {
              state = JSXState.IN_STYLE_ATTR;
              styleDepth = 2;
            } else {
              // For dangerouslySetInnerHTML, just enter normal JSX expression
              state = JSXState.IN_JSX_EXPR;
              braceDepth = 2;
            }
            result.push(curr, next);
            i += 2;
            continue;
          } else {
            // Convert {{ to {
            state = JSXState.IN_JSX_EXPR;
            braceDepth = 1;
            doubleBraceDepths.add(1);
            result.push('{');
            i += 2;  // Skip both braces
            continue;
          }
        }
        result.push(curr);
        break;
      
      case JSXState.IN_JSX_EXPR:
        // Handle string literals to avoid processing their content
        if ((curr === '"' || curr === "'" || curr === '`') && prev !== '\\') {
          if (!stringDelimiter) {
            stringDelimiter = curr;
            state = JSXState.IN_STRING;
          }
          result.push(curr);
        }
        // Check if we're entering a style object or dangerouslySetInnerHTML
        else if (curr === '{' && next === '{' && (isStyleAttribute(i) || isDangerouslySetInnerHTML(i))) {
          // Style object or dangerouslySetInnerHTML inside JSX expression - preserve it
          if (isStyleAttribute(i)) {
            inStyleObject = true;
          }
          result.push(curr, next);
          i += 2;
          continue;
        }
        // Handle closing of style objects
        else if (inStyleObject && curr === '}' && next === '}') {
          // End of style object
          inStyleObject = false;
          result.push(curr, next);
          i += 2;
          continue;
        }
        // Handle nested double braces inside JSX expressions (but not in style objects or dangerouslySetInnerHTML)
        else if (!inStyleObject && curr === '{' && next === '{' && !isDangerouslySetInnerHTML(i)) {
          // This is a nested {{expr}} inside a JSX expression - only convert if NOT dangerouslySetInnerHTML
          braceDepth++;
          doubleBraceDepths.add(braceDepth);
          result.push('{');
          i += 2; // Skip both braces
          continue;
        }
        // Track brace depth
        else if (curr === '{') {
          braceDepth++;
          result.push(curr);
        }
        else if (curr === '}') {
          if (!inStyleObject) {
            // Check if this depth level was from a double brace conversion
            if (doubleBraceDepths.has(braceDepth)) {
              // This level was from {{, so we expect }}
              if (next === '}') {
                // Found }}, convert to single }
                doubleBraceDepths.delete(braceDepth);
                braceDepth--;
                result.push('}');
                i += 2;  // Skip both braces
                
                if (braceDepth === 0) {
                  state = JSXState.NORMAL;
                }
                continue;
              } else {
                // ERROR: Expected }} but found single }
                // This shouldn't happen with valid input, but handle gracefully
                doubleBraceDepths.delete(braceDepth);
                braceDepth--;
                result.push(curr);
                if (braceDepth === 0) {
                  state = JSXState.NORMAL;
                }
              }
            } else {
              // Normal single brace closing
              braceDepth--;
              result.push(curr);
              if (braceDepth === 0) {
                state = JSXState.NORMAL;
              }
            }
          } else {
            // Inside style object, just pass through
            result.push(curr);
          }
        }
        else {
          result.push(curr);
        }
        break;
      
      case JSXState.IN_STRING:
        result.push(curr);
        if (curr === stringDelimiter && prev !== '\\') {
          stringDelimiter = null;
          state = JSXState.IN_JSX_EXPR;
        }
        break;
      
      case JSXState.IN_STYLE_ATTR:
        result.push(curr);
        if (curr === '{') {
          styleDepth++;
        } else if (curr === '}') {
          styleDepth--;
          if (styleDepth === 0) {
            state = JSXState.NORMAL;
          }
        }
        break;
    }
    
    i++;
  }
  
  return result.join('');
}

/**
 * Validate JSX preprocessing result
 * @param original - Original content
 * @param processed - Processed content
 * @returns True if validation passes
 */
function validateJSXResult(original: string, processed: string): boolean {
  // Count braces to ensure we didn't break anything
  const countBraces = (str: string) => {
    let open = 0, close = 0;
    for (const char of str) {
      if (char === '{') open++;
      if (char === '}') close++;
    }
    return { open, close };
  };
  
  const origCount = countBraces(original);
  const procCount = countBraces(processed);
  
  // We should have fewer braces after processing (or same if no double braces)
  if (procCount.open > origCount.open || procCount.close > origCount.close) {
    console.warn('Preprocessing may have failed - brace count increased');
    return false;
  }
  
  return true;
}

/**
 * Add export statement to component if missing
 * @param content - Component file content
 * @param filename - File name for logging purposes
 * @returns Content with export statement added if needed
 */
function ensureComponentExport(content: string, filename?: string): string {
  // Check if there's already an export statement
  const hasDefaultExport = /export\s+default\s+/m.test(content);
  const hasNamedExport = /export\s+\{[^}]*\}/m.test(content);
  
  if (hasDefaultExport || hasNamedExport) {
    return content; // Already has export
  }
  
  // Find component definitions
  const componentPatterns = [
    // Function components: function ComponentName() { ... }
    /(?:^|\n)\s*function\s+([A-Z][a-zA-Z0-9]*)\s*\([^)]*\)\s*\{/gm,
    // Arrow function components: const ComponentName = () => { ... }
    /(?:^|\n)\s*(?:const|let|var)\s+([A-Z][a-zA-Z0-9]*)\s*=\s*(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>\s*[\({]/gm,
    // Class components: class ComponentName extends React.Component
    /(?:^|\n)\s*class\s+([A-Z][a-zA-Z0-9]*)\s+extends\s+(?:React\.)?(?:Component|PureComponent)/gm
  ];
  
  let componentName: string | null = null;
  
  for (const pattern of componentPatterns) {
    const match = pattern.exec(content);
    if (match && match[1]) {
      componentName = match[1];
      break;
    }
  }
  
  if (componentName) {
    // Add export statement at the end of the file
    const exportStatement = `\nexport default ${componentName};`;
    
    if (filename) {
      console.info(`🔧 [JSX-PREPROCESSOR] Added missing export for ${componentName} in ${filename}`);
    }
    
    return content + exportStatement;
  }
  
  return content;
}

/**
 * Preprocess JSX/TSX content to fix AI-generated patterns
 * Uses state machine for complex patterns with fallback to simple regex
 * @param content - Raw file content
 * @param filename - File name for logging purposes
 * @returns Cleaned content with fixed JSX patterns
 */
export function preprocessJSX(content: string, filename?: string): string {
  if (typeof content !== 'string') {
    return content;
  }

  const originalContent = content;
  let cleanedContent = content;
  
  // Process if content has double braces
  if (content.includes('{{')) {
    try {
      // Use state machine for complex patterns
      cleanedContent = preprocessJSXStateMachine(content);
    
      // Validate the result
      if (!validateJSXResult(originalContent, cleanedContent)) {
        // Fallback to simple replacement for safety
        if (filename) {
          console.warn(`Complex preprocessing failed for ${filename}, using simple fix`);
        }
        cleanedContent = content.replace(/\{\{(\w+)\}\}/g, '{$1}');
      }
    } catch (error) {
      console.error(`Preprocessing error in ${filename || 'unknown file'}:`, error);
      // Return original content rather than breaking
      return content;
    }
  }
  
  // CRITICAL FIX: Convert HTML attributes to React attributes FIRST
  // These are the silent killers - builds succeed but apps are broken
  cleanedContent = cleanedContent.replace(/\bclass=/g, 'className=');
  cleanedContent = cleanedContent.replace(/\bonclick=/gi, 'onClick=');
  cleanedContent = cleanedContent.replace(/\bonchange=/gi, 'onChange=');
  cleanedContent = cleanedContent.replace(/\bonsubmit=/gi, 'onSubmit=');
  cleanedContent = cleanedContent.replace(/\bonblur=/gi, 'onBlur=');
  cleanedContent = cleanedContent.replace(/\bonfocus=/gi, 'onFocus=');
  cleanedContent = cleanedContent.replace(/\bonkeydown=/gi, 'onKeyDown=');
  cleanedContent = cleanedContent.replace(/\bonkeyup=/gi, 'onKeyUp=');
  cleanedContent = cleanedContent.replace(/\bonmouseenter=/gi, 'onMouseEnter=');
  cleanedContent = cleanedContent.replace(/\bonmouseleave=/gi, 'onMouseLeave=');
  cleanedContent = cleanedContent.replace(/\bfor=/g, 'htmlFor=');
  
  // Additional fixes for attribute patterns (always applied)
  // Handle className="{variable}" -> className={variable}
  cleanedContent = cleanedContent.replace(
    /className\s*=\s*['"]\{([^}]+)\}['"]/g,
    'className={$1}'
  );
  
  // Handle event handlers: onClick="{handler}" -> onClick={handler}
  cleanedContent = cleanedContent.replace(
    /on[A-Z][a-zA-Z]*\s*=\s*['"]\{([^}]+)\}['"]/g,
    (match, p1) => {
      const eventName = match.match(/on[A-Z][a-zA-Z]*/)?.[0];
      return `${eventName}={${p1}}`;
    }
  );
  
  // Handle style string literals: style="{{...}}" -> style={{...}}
  cleanedContent = cleanedContent.replace(
    /style\s*=\s*['"]\{\{([^}]+)\}\}['"]/g,
    'style={{$1}}'
  );
  
  // Handle style with single braces: style="{...}" -> style={{...}}
  cleanedContent = cleanedContent.replace(
    /style\s*=\s*['"]\{([^{}][^}]*)\}['"]/g,
    'style={{$1}}'
  );
  
  // CRITICAL FIX: Ensure component has export statement
  cleanedContent = ensureComponentExport(cleanedContent, filename);

  cleanedContent = injectClaudePolyfill(cleanedContent, filename);

  // AST-based normalization with retry to ensure parseable TSX
  try {
    let passes = 0;
    let result = normalizeTsx(cleanedContent, filename || 'input.tsx');
    passes++;
    if (result.diagnostics.length > 0) {
      result = normalizeTsx(result.code, filename || 'input.tsx');
      passes++;
    }
    if (result.diagnostics.length > 0) {
      const diag = result.diagnostics[0];
      const { line, character } = diag.file
        ? ts.getLineAndCharacterOfPosition(diag.file, diag.start ?? 0)
        : { line: 0, character: 0 };
      throw new Error(
        `TSX parse failed at ${filename || 'input.tsx'}:${line + 1}:${character + 1}: ${ts.flattenDiagnosticMessageText(diag.messageText, '\n')}`
      );
    }
    cleanedContent = result.code;
    if (filename) {
      console.info(
        `[TSX-NORMALIZE] ${filename}: ${result.fixes.length} fixes in ${result.timeMs}ms (passes: ${passes})`
      );
    }
  } catch (error) {
    if (filename) {
      console.error(`[TSX-NORMALIZE] ${filename} failed:`, error);
    }
    throw error;
  }
  
  // Log changes if filename is provided
  if (filename && cleanedContent !== originalContent) {
    console.info(`🧹 [JSX-PREPROCESSOR] Fixed JSX syntax in ${filename}`);
    
    // Log specific fixes for debugging
    if (originalContent.includes('{{') && !originalContent.includes('style={{')) {
      console.info(`   - Fixed double curly braces in text content`);
    }
    if (originalContent.includes('style="{')) {
      console.info(`   - Fixed style attribute string literals`);
    }
    if (originalContent.includes('className="{')) {
      console.info(`   - Fixed className attribute string literals`);
    }
    if (/on[A-Z][a-zA-Z]*\s*=\s*['"]/.test(originalContent)) {
      console.info(`   - Fixed event handler string literals`);
    }
  }
  
  return cleanedContent;
}

/**
 * Check if a file should be preprocessed based on extension
 * @param filename - File name to check
 * @returns True if file should be preprocessed
 */
export function shouldPreprocessFile(filename: string): boolean {
  return filename.endsWith('.jsx') || 
         filename.endsWith('.tsx') || 
         filename.endsWith('.js') ||  // Some AI tools use .js for React
         filename.endsWith('.ts');    // Some AI tools use .ts for React
}

/**
 * Detect if content contains React/JSX patterns
 * @param content - File content to analyze
 * @returns True if content appears to be React/JSX
 */
export function isReactContent(content: string): boolean {
  // Check for React imports
  if (/import\s+(?:React|\{[^}]*\})\s+from\s+['"]react['"]/.test(content)) {
    return true;
  }
  
  // Check for JSX syntax
  if (/<[A-Z][a-zA-Z]*[\s/>]/.test(content)) {  // Component tags
    return true;
  }
  
  // Check for JSX fragments
  if (/<>|<\/>/.test(content)) {
    return true;
  }
  
  // Check for JSX expressions
  if (/\{[^}]+\}/.test(content) && /<[^>]+>/.test(content)) {
    return true;
  }
  
  return false;
}

/**
 * Process multiple files, preprocessing JSX content where needed
 * @param files - Map of filename to content
 * @returns Map of filename to cleaned content
 */
export function preprocessFiles(files: Record<string, string>): Record<string, string> {
  const processed: Record<string, string> = {};

  for (const [filename, content] of Object.entries(files)) {
    // Detect if file contains TypeScript syntax but is using a .jsx or .js extension.
    // In that case, auto-rename to .tsx/.ts so esbuild parses it correctly.
    const renamed = maybeRenameForTypeScript(filename, content);
    const targetName = renamed ?? filename;

    if (shouldPreprocessFile(targetName) && isReactContent(content)) {
      processed[targetName] = preprocessJSX(content, targetName);
    } else {
      processed[targetName] = content;
    }
  }

  return processed;
}

/**
 * Heuristic detection of TypeScript syntax within a file and safe auto-renaming.
 * - If a file ends with .jsx and contains TS-only constructs, rename to .tsx
 * - If a file ends with .js and contains TS-only constructs, rename to .ts
 * .tsx/.ts files are left as-is (idempotent and safe).
 */
function maybeRenameForTypeScript(filename: string, content: string): string | null {
  const lower = filename.toLowerCase();

  // Only consider renaming JS/JSX files
  if (!(lower.endsWith('.jsx') || lower.endsWith('.js'))) return null;

  if (!containsTypeScriptSyntax(content)) return null;

  if (lower.endsWith('.jsx')) {
    return filename.replace(/\.jsx$/i, '.tsx');
  }
  if (lower.endsWith('.js')) {
    return filename.replace(/\.js$/i, '.ts');
  }
  return null;
}

/**
 * Very fast heuristic to detect TypeScript-only constructs in React/JS code.
 * This intentionally errs on the side of true to avoid false negatives —
 * compiling .tsx as .tsx is safe even for pure JS.
 */
function containsTypeScriptSyntax(content: string): boolean {
  if (typeof content !== 'string') return false;
  const c = content;

  // Common TS patterns
  if (/\btype\s+[A-Za-z_]/.test(c)) return true;            // type Alias = { ... }
  if (/\binterface\s+[A-Za-z_]/.test(c)) return true;       // interface Foo { ... }
  if (/:\s*[A-Za-z_][A-Za-z0-9_<>?|&\s,\[\]]*/.test(c)) return true; // var/param type annotations
  if (/function\s+\w+\s*\([^)]*:[^)]*\)/.test(c)) return true; // function f(x: T)
  if (/=>\s*\([^)]*:[^)]*\)/.test(c)) return true;          // (x: T) => {}
  if (/use(State|Memo|Ref|Callback|Reducer)\s*<[^>]+>/.test(c)) return true; // useState<T>
  if (/<[A-Za-z0-9_]+\s*,?\s*[A-Za-z0-9_]+>\(/.test(c)) return true; // generic call like fn<T>()

  return false;
}

// Expose helpers for unit tests
export const _test_maybeRenameForTypeScript = maybeRenameForTypeScript;
export const _test_containsTypeScriptSyntax = containsTypeScriptSyntax;
