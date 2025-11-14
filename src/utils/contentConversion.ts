/**
 * Content Conversion Utilities for GPTHost Code Paste Handler
 * Handles intelligent file format conversion based on framework detection
 */

import { FrameworkType } from '../types/api';
import { detectLanguage } from './fileAnalysis';

/**
 * File extension mapping based on framework and language detection
 */
const FRAMEWORK_EXTENSIONS: Record<FrameworkType, Record<string, string>> = {
  'react': {
    'javascript': '.jsx',
    'typescript': '.tsx',
    'unknown': '.jsx'
  },
  'vue': {
    'javascript': '.vue',
    'typescript': '.vue',
    'unknown': '.vue'
  },
  'svelte': {
    'javascript': '.svelte',
    'typescript': '.svelte',
    'unknown': '.svelte'
  },
  'html': {
    'javascript': '.html',
    'typescript': '.html',
    'html': '.html',
    'unknown': '.html'
  },
  'javascript': {
    'javascript': '.js',
    'typescript': '.ts',
    'unknown': '.js'
  },
  'text': {
    'javascript': '.txt',
    'typescript': '.txt',
    'html': '.txt',
    'unknown': '.txt'
  },
  'unknown': {
    'javascript': '.js',
    'typescript': '.ts',
    'html': '.html',
    'unknown': '.txt'
  }
};

/**
 * Base filename mapping for different frameworks
 */
const FRAMEWORK_FILENAMES: Record<FrameworkType, string> = {
  'react': 'component',
  'vue': 'component', 
  'svelte': 'component',
  'html': 'index',
  'javascript': 'script',
  'text': 'document',
  'unknown': 'code'
};

/**
 * MIME type mapping for generated files
 */
const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.jsx': 'text/jsx',
  '.tsx': 'text/tsx',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.vue': 'text/x-vue',
  '.svelte': 'text/x-svelte',
  '.html': 'text/html',
  '.txt': 'text/plain'
};

/**
 * Convert pasted content to appropriate file format
 */
export function convertContentToFile(
  content: string, 
  framework: FrameworkType
): { filename: string; mimeType: string; content: string } {
  
  // Detect language from content for more precise file extension
  // Use a temporary filename that won't interfere with detection
  let language = detectLanguage('temp.txt', content);
  
  // For React framework, default to JavaScript unless there are very strong TypeScript indicators
  if (framework === 'react' && language === 'typescript') {
    // Only use TypeScript for React if there are explicit TypeScript constructs
    const strongTsPatterns = [
      /\binterface\s+[A-Z]/,
      /\btype\s+[A-Z]/,
      /\benum\s+[A-Z]/,
      /:\s*Array<[^>]+>/,
      /function\s+\w+\s*\([^)]*:\s*(string|number|boolean)/
    ];
    
    if (!strongTsPatterns.some(pattern => pattern.test(content))) {
      language = 'javascript';
    }
  }
  
  // Get appropriate extension based on framework and language
  const extensionMap = FRAMEWORK_EXTENSIONS[framework] || FRAMEWORK_EXTENSIONS['unknown'];
  const extension = extensionMap[language] || extensionMap['unknown'];
  
  // Generate filename
  const baseName = FRAMEWORK_FILENAMES[framework] || FRAMEWORK_FILENAMES['unknown'];
  const filename = `${baseName}${extension}`;
  
  // Get MIME type
  const mimeType = EXTENSION_MIME_TYPES[extension] || 'text/plain';
  
  // Preprocess AI-generated JSX patterns for React to avoid build-time syntax errors
  let normalizedContent = content;
  if (framework === 'react') {
    try {
      // 1) Replace double-curly text patterns, but not style objects
      normalizedContent = normalizedContent.replace(/(?<!style\s*=\s*)\{\{([\s\S]*?)\}\}/g, '{$1}');
      // 2) Fix style attributes written as strings: style="{{ ... }}" → style={{ ... }}
      normalizedContent = normalizedContent.replace(/style\s*=\s*["']\{\{([^}]+)\}\}["']/g, 'style={{$1}}');
      // 3) Fix className="{expr}" → className={expr}
      normalizedContent = normalizedContent.replace(/className\s*=\s*["']\{([^}]+)\}["']/g, 'className={$1}');
      // 4) Fix AI placeholder pattern in JSX text: {condition && ...} → {condition && '...'}
      normalizedContent = normalizedContent.replace(/\{([^}]*)&&\s*\.{3}\s*\}/g, '{$1&& "..."}');
    } catch {
      // Best-effort normalization only; on failure, fallback to original content
      normalizedContent = content;
    }
  }
  
  return {
    filename,
    mimeType,
    content: normalizedContent
  };
}

/**
 * Validate pasted content for basic requirements
 */
export function validatePastedContent(content: string): {
  isValid: boolean;
  errorCode?: string;
  message?: string;
  details?: any;
} {
  // Check if content is empty or only whitespace
  if (!content || content.trim().length === 0) {
    return {
      isValid: false,
      errorCode: 'EMPTY_CONTENT',
      message: 'Content cannot be empty',
      details: { contentLength: content?.length || 0 }
    };
  }
  
  // Check content length - reasonable limits for paste operations
  const MAX_PASTE_SIZE = 5 * 1024 * 1024; // 5MB limit for paste (matching env)
  if (content.length > MAX_PASTE_SIZE) {
    return {
      isValid: false,
      errorCode: 'CONTENT_TOO_LARGE',
      message: `Content exceeds maximum size of ${MAX_PASTE_SIZE / (1024 * 1024)}MB`,
      details: { 
        contentSize: content.length,
        maxSize: MAX_PASTE_SIZE
      }
    };
  }
  
  // Check for suspicious content patterns
  const suspiciousPatterns = [
    /<script[^>]*src\s*=\s*["'][^"']*(?:eval|exec|system)[^"']*["']/i,
    /eval\s*\(/i,
    /document\.write\s*\(/i,
    /innerHTML\s*=.*<script/i,
    // Additional security patterns
    /Function\s*\(\s*["'][^"']*["']\s*\)/i, // Function constructor
    /setTimeout\s*\(\s*["'][^"']*["']/i, // setTimeout with string
    /setInterval\s*\(\s*["'][^"']*["']/i, // setInterval with string
    /execScript/i, // IE specific
    /javascript\s*:/i, // Javascript protocol
    /data\s*:\s*text\/html/i, // Data URLs with HTML
    /on[a-z]+\s*=\s*["'][^"']*(?:eval|exec|script|javascript:)[^"']*["']/i // Suspicious inline event handlers
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(content)) {
      return {
        isValid: false,
        errorCode: 'SUSPICIOUS_CONTENT',
        message: 'Content contains potentially unsafe code patterns',
        details: { pattern: pattern.toString() }
      };
    }
  }
  
  return { isValid: true };
}

/**
 * Create a File-like object from pasted content for analysis
 */
export function createFileFromContent(content: string, filename: string, mimeType: string): File {
  const blob = new Blob([content], { type: mimeType });
  
  // Create a File object that's compatible with our existing file analysis
  return new File([blob], filename, {
    type: mimeType,
    lastModified: Date.now()
  });
}

/**
 * Generate confidence feedback for framework detection
 */
export function generateDetectionFeedback(
  framework: FrameworkType,
  filename: string,
  analysis?: any
): string {
  const frameworkNames: Record<FrameworkType, string> = {
    'react': 'React',
    'vue': 'Vue.js',
    'svelte': 'Svelte',
    'html': 'HTML',
    'javascript': 'JavaScript',
    'text': 'Plain Text',
    'unknown': 'Unknown'
  };
  
  const detectedName = frameworkNames[framework] || 'Unknown';
  
  if (framework === 'unknown') {
    return `Could not determine framework type. Saved as ${filename}. You can rename the file extension if needed.`;
  }
  
  if (analysis?.componentNames?.length > 0) {
    const componentCount = analysis.componentNames.length;
    const componentText = componentCount === 1 ? 'component' : 'components';
    return `${detectedName} ${componentText} detected and saved as ${filename}.`;
  }
  
  return `${detectedName} framework detected. Saved as ${filename}.`;
}
