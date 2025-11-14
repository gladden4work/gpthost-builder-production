/**
 * Build Warning Parser - TASK-020
 * 
 * Comprehensive warning analysis system that captures non-fatal build issues,
 * provides user guidance, and helps improve code quality for AI-generated components.
 * 
 * Handles:
 * - TypeScript warnings and deprecations
 * - ESLint warnings and style issues
 * - Dependency warnings and version conflicts
 * - Performance warnings and optimization opportunities
 * - Framework-specific warnings and best practices
 */

import {
  FrameworkType,
  BuildStage,
  BuildStageResult
} from '../types/api';

/**
 * Warning categories for classification
 */
export type WarningCategory = 
  | 'typescript'      // TypeScript warnings (deprecated APIs, loose types)
  | 'eslint'          // ESLint warnings (code style, best practices)
  | 'dependency'      // Dependency warnings (outdated packages, peer deps)
  | 'performance'     // Performance warnings (large bundles, optimization)
  | 'security'        // Security warnings (vulnerable packages)
  | 'accessibility'   // A11y warnings (missing ARIA labels, contrast)
  | 'framework'       // Framework-specific warnings (React, Vue, Svelte)
  | 'build'          // Build tool warnings (Vite, webpack configs)
  | 'unknown';       // Unclassified warnings

/**
 * Warning severity levels
 */
export type WarningSeverity = 'info' | 'warning' | 'critical';

/**
 * Warning pattern for recognizing common build warnings
 */
export interface WarningPattern {
  pattern: RegExp;
  category: WarningCategory;
  severity: WarningSeverity;
  messageTemplate: string;
  userMessage: string;
  suggestions: string[];
  framework?: FrameworkType;
  stage?: BuildStage;
  confidence: number; // 0-100 confidence in pattern match
  fixable: boolean;
}

/**
 * Individual warning analysis result
 */
export interface BuildWarningAnalysis {
  category: WarningCategory;
  severity: WarningSeverity;
  stage: BuildStage;
  framework: FrameworkType;
  userMessage: string;
  technicalMessage: string;
  suggestions: string[];
  fixable: boolean;
  autoFixable: boolean;
  debugInfo: {
    file?: string;
    line?: number;
    column?: number;
    context?: string;
    originalWarning: string;
    matchedPattern?: string;
  };
  confidence: number;
  analysisTimestamp: string;
  estimatedImpact: 'low' | 'medium' | 'high';
}

/**
 * Warning resolution suggestion
 */
export interface WarningResolutionSuggestion {
  type: 'config' | 'code' | 'dependency' | 'documentation';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action?: string;
  command?: string;
  automated: boolean;
  estimatedFixTime: string;
}

/**
 * Build warnings summary
 */
export interface BuildWarningsSummary {
  totalWarnings: number;
  criticalWarnings: number;
  warningsByCategory: Record<WarningCategory, number>;
  warningsByStage: Record<BuildStage, number>;
  fixableWarnings: number;
  autoFixableWarnings: number;
  analysisTimestamp: string;
}

/**
 * Comprehensive warning pattern database for AI-generated code
 */
export const WARNING_PATTERNS: WarningPattern[] = [
  // TypeScript Warnings
  {
    pattern: /Type '(.+)' is deprecated/i,
    category: 'typescript',
    severity: 'warning',
    messageTemplate: 'TypeScript type "{0}" is deprecated and may be removed in future versions.',
    userMessage: 'Using deprecated TypeScript type that may cause future compatibility issues.',
    suggestions: [
      'Update to the recommended replacement type',
      'Check TypeScript documentation for migration guide',
      'Consider updating to a newer version of the package',
      'Add a TODO comment to address this deprecation'
    ],
    confidence: 95,
    fixable: true
  },
  {
    pattern: /Property '(\w+)' does not exist on type '(.+)'\. Did you mean '(\w+)'\?/i,
    category: 'typescript',
    severity: 'warning',
    messageTemplate: 'Property "{0}" does not exist on type "{1}". TypeScript suggests "{2}" instead.',
    userMessage: 'Possible typo in property name that could cause runtime errors.',
    suggestions: [
      'Use suggested property name "{2}"',
      'Check if property name is spelled correctly',
      'Verify the type definition is correct',
      'Add proper type assertions if intentional'
    ],
    framework: 'react',
    confidence: 90,
    fixable: true
  },
  {
    pattern: /Argument of type '.+' is not assignable to parameter of type '.+'/i,
    category: 'typescript',
    severity: 'warning',
    messageTemplate: 'Type mismatch in function parameter - may cause unexpected behavior.',
    userMessage: 'Function is called with incorrect parameter type.',
    suggestions: [
      'Cast the parameter to the correct type',
      'Update the function signature to accept the provided type',
      'Transform the data before passing to the function',
      'Add proper type checking before function call'
    ],
    confidence: 85,
    fixable: true
  },

  // ESLint Warnings
  {
    pattern: /(\d+):(\d+)\s+warning\s+(.+)\s+([\w/-]+)/i,
    category: 'eslint',
    severity: 'warning',
    messageTemplate: 'ESLint warning at line {0}: {2}',
    userMessage: 'Code style or best practice issue detected by linter.',
    suggestions: [
      'Fix the linting issue for better code quality',
      'Configure ESLint rules if this is intentional',
      'Use ESLint auto-fix if available',
      'Review team coding standards'
    ],
    confidence: 90,
    fixable: true
  },
  {
    pattern: /React Hook "(\w+)" has a missing dependency: ['"](.+)['"]|React Hook "(\w+)" has a missing dependency: (.+)/i,
    category: 'eslint',
    severity: 'warning',
    messageTemplate: 'React Hook "{0}" is missing dependency "{1}" in its dependency array.',
    userMessage: 'React Hook dependency issue that could cause stale closures or infinite loops.',
    suggestions: [
      'Add "{1}" to the dependency array',
      'Use ESLint auto-fix to add missing dependencies',
      'Verify if the dependency should be included',
      'Consider using useCallback or useMemo for optimization'
    ],
    framework: 'react',
    confidence: 95,
    fixable: true
  },
  {
    pattern: /(.+) is assigned a value but never used/i,
    category: 'eslint',
    severity: 'info',
    messageTemplate: 'Variable "{0}" is assigned but never used.',
    userMessage: 'Unused variable that adds unnecessary code complexity.',
    suggestions: [
      'Remove the unused variable',
      'Use the variable in your logic',
      'Add underscore prefix if intentionally unused',
      'Consider if this indicates incomplete implementation'
    ],
    confidence: 85,
    fixable: true
  },

  // Dependency Warnings
  {
    pattern: /npm WARN deprecated (.+)@(.+): (.+)/i,
    category: 'dependency',
    severity: 'warning',
    messageTemplate: 'Package "{0}@{1}" is deprecated: {2}',
    userMessage: 'Using deprecated package that may have security or compatibility issues.',
    suggestions: [
      'Update to a supported alternative package',
      'Check if newer version is available',
      'Review migration guide for replacement',
      'Consider removing if not essential'
    ],
    confidence: 95,
    fixable: true
  },
  {
    pattern: /npm WARN peerDep (.+) requires a peer of (.+) but none is installed/i,
    category: 'dependency',
    severity: 'warning',
    messageTemplate: 'Package "{0}" requires peer dependency "{1}" but it\'s not installed.',
    userMessage: 'Missing peer dependency that may cause runtime errors.',
    suggestions: [
      'Install the required peer dependency: npm install {1}',
      'Check if peer dependency is optional',
      'Update package.json with peer dependency',
      'Review package documentation for requirements'
    ],
    confidence: 90,
    fixable: true
  },
  {
    pattern: /(\d+) vulnerabilities \((\d+) low, (\d+) moderate, (\d+) high, (\d+) critical\)/i,
    category: 'security',
    severity: 'critical',
    messageTemplate: 'Found {0} security vulnerabilities: {1} low, {2} moderate, {3} high, {4} critical.',
    userMessage: 'Security vulnerabilities detected in dependencies.',
    suggestions: [
      'Run "npm audit fix" to automatically fix vulnerabilities',
      'Update packages to secure versions',
      'Review vulnerability details with "npm audit"',
      'Consider alternative packages if fixes unavailable'
    ],
    confidence: 100,
    fixable: true
  },

  // Performance Warnings
  {
    pattern: /Bundle size (\d+)KB exceeds recommended limit/i,
    category: 'performance',
    severity: 'warning',
    messageTemplate: 'Bundle size {0}KB is larger than recommended for optimal performance.',
    userMessage: 'Large bundle size may slow down page load times.',
    suggestions: [
      'Enable code splitting for better performance',
      'Remove unused dependencies from bundle',
      'Use dynamic imports for non-critical features',
      'Consider tree-shaking to reduce bundle size'
    ],
    confidence: 80,
    fixable: true
  },
  {
    pattern: /Large static assets detected: (.+)/i,
    category: 'performance',
    severity: 'info',
    messageTemplate: 'Large static assets detected: {0}',
    userMessage: 'Large static assets may impact loading performance.',
    suggestions: [
      'Optimize images and assets before bundling',
      'Use appropriate image formats (WebP, AVIF)',
      'Consider lazy loading for large assets',
      'Implement asset compression in build process'
    ],
    confidence: 75,
    fixable: false
  },

  // Framework-Specific Warnings - React
  {
    pattern: /Warning: (.+) is using deprecated React.(\w+)/i,
    category: 'framework',
    severity: 'warning',
    messageTemplate: 'Component is using deprecated React.{1} API.',
    userMessage: 'Using deprecated React API that may be removed in future versions.',
    suggestions: [
      'Update to modern React patterns (hooks, functional components)',
      'Replace deprecated APIs with current alternatives',
      'Check React migration guide for specific replacements',
      'Update React version if needed'
    ],
    framework: 'react',
    confidence: 95,
    fixable: true
  },
  {
    pattern: /Warning: Each child in a list should have a unique "key" prop/i,
    category: 'framework',
    severity: 'warning',
    messageTemplate: 'React components in lists are missing unique "key" props.',
    userMessage: 'Missing React keys can cause performance issues and bugs.',
    suggestions: [
      'Add unique "key" prop to each list item',
      'Use stable identifiers (id, index) for keys',
      'Avoid using array index as key if list can change',
      'Ensure keys are unique within the same list'
    ],
    framework: 'react',
    confidence: 100,
    fixable: true
  },

  // Framework-Specific Warnings - Vue
  {
    pattern: /\[Vue warn\]: (.+)/i,
    category: 'framework',
    severity: 'warning',
    messageTemplate: 'Vue warning: {0}',
    userMessage: 'Vue.js detected a potential issue in component implementation.',
    suggestions: [
      'Check Vue component implementation for errors',
      'Review Vue documentation for proper usage',
      'Verify data binding and event handling',
      'Check for typos in directive names'
    ],
    framework: 'vue',
    confidence: 85,
    fixable: true
  },

  // Build Tool Warnings
  {
    pattern: /Use of eval is strongly discouraged/i,
    category: 'build',
    severity: 'warning',
    messageTemplate: 'Build tool detected use of eval() which is discouraged for security reasons.',
    userMessage: 'Code contains eval() usage that may have security implications.',
    suggestions: [
      'Remove eval() usage and use safer alternatives',
      'Use JSON.parse() for parsing JSON strings',
      'Use proper function calls instead of eval',
      'Review code for security best practices'
    ],
    confidence: 90,
    fixable: false
  },
  {
    pattern: /Circular dependency detected: (.+)/i,
    category: 'build',
    severity: 'warning',
    messageTemplate: 'Circular dependency detected in: {0}',
    userMessage: 'Circular imports can cause runtime errors and loading issues.',
    suggestions: [
      'Refactor modules to remove circular dependencies',
      'Move shared code to separate utility modules',
      'Use dynamic imports to break circular references',
      'Restructure component hierarchy'
    ],
    confidence: 95,
    fixable: true
  }
];

/**
 * Main Build Warning Parser class
 */
export class BuildWarningParser {
  private warningPatterns: WarningPattern[] = WARNING_PATTERNS;

  /**
   * Parse build logs and extract warnings
   */
  parseWarnings(
    logs: string[],
    stage: BuildStage,
    framework: FrameworkType,
    buildResult?: BuildStageResult
  ): BuildWarningAnalysis[] {
    const warnings: BuildWarningAnalysis[] = [];
    
    for (const log of logs) {
      const logWarnings = this.parseLogForWarnings(log, stage, framework, buildResult);
      warnings.push(...logWarnings);
    }
    
    return warnings;
  }

  /**
   * Parse individual log line for warnings
   */
  private parseLogForWarnings(
    logLine: string,
    stage: BuildStage,
    framework: FrameworkType,
    buildResult?: BuildStageResult
  ): BuildWarningAnalysis[] {
    const warnings: BuildWarningAnalysis[] = [];
    
    // Skip if line doesn't contain warning indicators
    if (!this.containsWarning(logLine)) {
      return warnings;
    }
    
    // Find matching warning patterns
    const matchedPatterns = this.findMatchingPatterns(logLine, stage, framework);
    
    for (const { pattern, matches, calculatedConfidence } of matchedPatterns) {
      const warning = this.createWarningFromPattern(
        pattern,
        matches,
        logLine,
        stage,
        framework,
        buildResult,
        calculatedConfidence
      );
      warnings.push(warning);
    }
    
    // If no patterns matched but line contains warnings, create generic warning
    if (matchedPatterns.length === 0) {
      const genericWarning = this.createGenericWarning(logLine, stage, framework, buildResult);
      warnings.push(genericWarning);
    }
    
    return warnings;
  }

  /**
   * Check if log line contains warning indicators
   */
  private containsWarning(logLine: string): boolean {
    const warningIndicators = [
      /warning/i,
      /warn/i,
      /deprecated/i,
      /\[vue warn\]/i,
      /npm warn/i,
      /vulnerabilities/i,
      /peer dep/i,
      /bundle size/i,
      /large asset/i,
      /circular dependency/i,
      /React Hook.*missing dependency/i,
      /Each child in a list should have.*key/i,
      /Type.*is deprecated/i,
      /Property.*does not exist/i
    ];
    
    return warningIndicators.some(indicator => indicator.test(logLine));
  }

  /**
   * Find all matching warning patterns for a log line
   */
  private findMatchingPatterns(
    logLine: string,
    stage: BuildStage,
    framework: FrameworkType
  ): Array<{ pattern: WarningPattern; matches: RegExpMatchArray; calculatedConfidence: number }> {
    const matchedPatterns: Array<{ pattern: WarningPattern; matches: RegExpMatchArray; calculatedConfidence: number }> = [];
    
    for (const pattern of this.warningPatterns) {
      const matches = logLine.match(pattern.pattern);
      if (matches) {
        // Calculate match score for ranking
        let score = pattern.confidence;
        
        // Bonus for stage match
        if (pattern.stage === stage) score += 10;
        
        // Bonus for framework match (or penalty for mismatch)
        if (pattern.framework === framework) {
          score += 15;
        } else if (pattern.framework && pattern.framework !== framework) {
          score -= 10; // Reduce confidence if framework doesn't match
        }
        
        matchedPatterns.push({ pattern, matches, calculatedConfidence: score });
      }
    }
    
    // Sort by calculated confidence (highest first)
    return matchedPatterns.sort((a, b) => b.calculatedConfidence - a.calculatedConfidence);
  }

  /**
   * Create warning analysis from matched pattern
   */
  private createWarningFromPattern(
    pattern: WarningPattern,
    matches: RegExpMatchArray,
    originalLogLine: string,
    stage: BuildStage,
    framework: FrameworkType,
    buildResult?: BuildStageResult,
    calculatedConfidence?: number
  ): BuildWarningAnalysis {
    // Format message with matched groups
    const userMessage = this.formatMessage(pattern.messageTemplate, matches.slice(1));
    const debugInfo = this.extractDebugInfo(originalLogLine, buildResult);
    
    return {
      category: pattern.category,
      severity: pattern.severity,
      stage,
      framework,
      userMessage,
      technicalMessage: originalLogLine.trim(),
      suggestions: pattern.suggestions.map(s => this.formatMessage(s, matches.slice(1))),
      fixable: pattern.fixable,
      autoFixable: this.isAutoFixable(pattern),
      debugInfo: {
        ...debugInfo,
        originalWarning: originalLogLine.trim(),
        matchedPattern: pattern.messageTemplate
      },
      confidence: calculatedConfidence || pattern.confidence,
      analysisTimestamp: new Date().toISOString(),
      estimatedImpact: this.estimateImpact(pattern)
    };
  }

  /**
   * Create generic warning for unmatched patterns
   */
  private createGenericWarning(
    logLine: string,
    stage: BuildStage,
    framework: FrameworkType,
    buildResult?: BuildStageResult
  ): BuildWarningAnalysis {
    const category = this.classifyGenericWarning(logLine);
    const severity = this.determineSeverity(logLine);
    const debugInfo = this.extractDebugInfo(logLine, buildResult);
    
    return {
      category,
      severity,
      stage,
      framework,
      userMessage: this.generateGenericUserMessage(category, severity),
      technicalMessage: logLine.trim(),
      suggestions: this.getGenericSuggestions(category),
      fixable: category !== 'build',
      autoFixable: false,
      debugInfo: {
        ...debugInfo,
        originalWarning: logLine.trim()
      },
      confidence: 50, // Lower confidence for generic warnings
      analysisTimestamp: new Date().toISOString(),
      estimatedImpact: 'low'
    };
  }

  /**
   * Format message template with captured groups
   */
  private formatMessage(template: string, matches: string[]): string {
    let formatted = template;
    matches.forEach((match, index) => {
      const placeholder = `{${index}}`;
      formatted = formatted.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), match || '');
    });
    return formatted;
  }

  /**
   * Extract debug information from log line
   */
  private extractDebugInfo(
    logLine: string,
    buildResult?: BuildStageResult
  ): Partial<BuildWarningAnalysis['debugInfo']> {
    const debugInfo: Partial<BuildWarningAnalysis['debugInfo']> = {};
    
    // Extract file path
    const fileMatch = logLine.match(/([^/\s]+\.(tsx?|jsx?|vue|svelte|css|scss|js))/i);
    if (fileMatch) {
      debugInfo.file = fileMatch[1];
    }
    
    // Extract line/column numbers - support multiple formats
    const locationMatch = logLine.match(/\((\d+),(\d+)\)|:(\d+):(\d+)|(\d+):(\d+)|at line (\d+)/);
    if (locationMatch) {
      // TypeScript format: (line,col)
      if (locationMatch[1] && locationMatch[2]) {
        debugInfo.line = parseInt(locationMatch[1], 10);
        debugInfo.column = parseInt(locationMatch[2], 10);
      }
      // ESLint format: line:col  
      else if (locationMatch[3] && locationMatch[4]) {
        debugInfo.line = parseInt(locationMatch[3], 10);
        debugInfo.column = parseInt(locationMatch[4], 10);
      }
      // Simple format: line:col
      else if (locationMatch[5] && locationMatch[6]) {
        debugInfo.line = parseInt(locationMatch[5], 10);
        debugInfo.column = parseInt(locationMatch[6], 10);
      }
      // At line format
      else if (locationMatch[7]) {
        debugInfo.line = parseInt(locationMatch[7], 10);
      }
    }
    
    // Extract context from the warning message
    const contextMatch = logLine.match(/(?:warning|warn)\s*:?\s*(.{0,100})/i);
    if (contextMatch) {
      debugInfo.context = contextMatch[1].trim();
    }
    
    return debugInfo;
  }

  /**
   * Classify generic warning by content analysis
   */
  private classifyGenericWarning(logLine: string): WarningCategory {
    const lowercase = logLine.toLowerCase();
    
    if (lowercase.includes('typescript') || lowercase.includes('tsc')) return 'typescript';
    if (lowercase.includes('eslint') || lowercase.includes('lint')) return 'eslint';
    if (lowercase.includes('npm') || lowercase.includes('dependency')) return 'dependency';
    if (lowercase.includes('bundle') || lowercase.includes('performance')) return 'performance';
    if (lowercase.includes('security') || lowercase.includes('vulnerabilit')) return 'security';
    if (lowercase.includes('react') || lowercase.includes('vue') || lowercase.includes('svelte')) return 'framework';
    if (lowercase.includes('build') || lowercase.includes('vite') || lowercase.includes('webpack')) return 'build';
    
    return 'unknown';
  }

  /**
   * Determine severity from log line content
   */
  private determineSeverity(logLine: string): WarningSeverity {
    const lowercase = logLine.toLowerCase();
    
    if (lowercase.includes('critical') || lowercase.includes('severe')) return 'critical';
    if (lowercase.includes('warning') || lowercase.includes('warn')) return 'warning';
    if (lowercase.includes('info') || lowercase.includes('notice')) return 'info';
    
    return 'warning'; // Default to warning
  }

  /**
   * Generate user-friendly message for generic warnings
   */
  private generateGenericUserMessage(category: WarningCategory, severity: WarningSeverity): string {
    const categoryMessages = {
      typescript: 'TypeScript compiler detected a potential issue',
      eslint: 'Code linting detected a style or quality issue',
      dependency: 'Package dependency issue detected',
      performance: 'Performance optimization opportunity identified',
      security: 'Security-related concern detected',
      accessibility: 'Accessibility improvement opportunity found',
      framework: 'Framework-specific issue detected',
      build: 'Build process generated a warning',
      unknown: 'Build process generated a warning'
    };
    
    const severityPrefix = severity === 'critical' ? 'Critical: ' : 
                          severity === 'warning' ? 'Warning: ' : '';
    
    return severityPrefix + categoryMessages[category];
  }

  /**
   * Get generic suggestions for unmatched warnings
   */
  private getGenericSuggestions(category: WarningCategory): string[] {
    const suggestions = {
      typescript: [
        'Check TypeScript compiler configuration',
        'Review type definitions and usage',
        'Update TypeScript version if needed'
      ],
      eslint: [
        'Run ESLint with --fix to auto-correct issues',
        'Review linting rules configuration',
        'Check code style guidelines'
      ],
      dependency: [
        'Review package.json dependencies',
        'Update packages to latest versions',
        'Check for peer dependency requirements'
      ],
      performance: [
        'Review bundle size and optimization settings',
        'Consider code splitting strategies',
        'Optimize assets and resources'
      ],
      security: [
        'Run npm audit for security analysis',
        'Update vulnerable packages',
        'Review security best practices'
      ],
      accessibility: [
        'Review accessibility guidelines',
        'Add proper ARIA labels and roles',
        'Test with accessibility tools'
      ],
      framework: [
        'Check framework documentation',
        'Review component implementation',
        'Update framework version if needed'
      ],
      build: [
        'Review build configuration',
        'Check build tool documentation',
        'Update build dependencies'
      ],
      unknown: [
        'Review the warning message for specific details',
        'Check relevant documentation',
        'Consider updating dependencies'
      ]
    };
    
    return suggestions[category] || suggestions.unknown;
  }

  /**
   * Determine if warning is automatically fixable
   */
  private isAutoFixable(pattern: WarningPattern): boolean {
    // Auto-fixable categories
    const autoFixableCategories: WarningCategory[] = ['eslint', 'typescript'];
    return autoFixableCategories.includes(pattern.category) && pattern.fixable;
  }

  /**
   * Estimate impact of warning
   */
  private estimateImpact(pattern: WarningPattern): 'low' | 'medium' | 'high' {
    if (pattern.severity === 'critical') return 'high';
    if (pattern.category === 'security') return 'high';
    if (pattern.category === 'performance' && pattern.severity === 'warning') return 'medium';
    if (pattern.category === 'framework') return 'medium';
    return 'low';
  }

  /**
   * Generate warnings summary
   */
  generateWarningsSummary(warnings: BuildWarningAnalysis[]): BuildWarningsSummary {
    const summary: BuildWarningsSummary = {
      totalWarnings: warnings.length,
      criticalWarnings: warnings.filter(w => w.severity === 'critical').length,
      warningsByCategory: {} as Record<WarningCategory, number>,
      warningsByStage: {} as Record<BuildStage, number>,
      fixableWarnings: warnings.filter(w => w.fixable).length,
      autoFixableWarnings: warnings.filter(w => w.autoFixable).length,
      analysisTimestamp: new Date().toISOString()
    };

    // Count by category
    warnings.forEach(warning => {
      summary.warningsByCategory[warning.category] = 
        (summary.warningsByCategory[warning.category] || 0) + 1;
      summary.warningsByStage[warning.stage] = 
        (summary.warningsByStage[warning.stage] || 0) + 1;
    });

    return summary;
  }

  /**
   * Generate resolution suggestions for warnings
   */
  generateResolutionSuggestions(warnings: BuildWarningAnalysis[]): WarningResolutionSuggestion[] {
    const suggestions: WarningResolutionSuggestion[] = [];
    
    // Group warnings by category for batch suggestions
    const warningsByCategory = warnings.reduce((acc, warning) => {
      if (!acc[warning.category]) acc[warning.category] = [];
      acc[warning.category].push(warning);
      return acc;
    }, {} as Record<WarningCategory, BuildWarningAnalysis[]>);
    
    // Generate category-specific batch suggestions
    Object.entries(warningsByCategory).forEach(([category, categoryWarnings]) => {
      const categorySuggestions = this.getCategorySuggestions(
        category as WarningCategory, 
        categoryWarnings
      );
      suggestions.push(...categorySuggestions);
    });
    
    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Get batch suggestions for warning category
   */
  private getCategorySuggestions(
    category: WarningCategory,
    warnings: BuildWarningAnalysis[]
  ): WarningResolutionSuggestion[] {
    const suggestions: WarningResolutionSuggestion[] = [];
    const count = warnings.length;
    
    switch (category) {
      case 'eslint':
        suggestions.push({
          type: 'config',
          priority: 'high',
          title: 'Auto-fix ESLint Issues',
          description: `Fix ${count} ESLint warning${count > 1 ? 's' : ''} automatically.`,
          command: 'npx eslint --fix .',
          automated: true,
          estimatedFixTime: '1-2 minutes'
        });
        break;
        
      case 'dependency':
        suggestions.push({
          type: 'dependency',
          priority: 'high',
          title: 'Update Dependencies',
          description: `Address ${count} dependency warning${count > 1 ? 's' : ''}.`,
          command: 'npm audit fix',
          automated: true,
          estimatedFixTime: '2-5 minutes'
        });
        break;
        
      case 'typescript':
        suggestions.push({
          type: 'code',
          priority: 'medium',
          title: 'Fix TypeScript Issues',
          description: `Resolve ${count} TypeScript warning${count > 1 ? 's' : ''}.`,
          automated: false,
          estimatedFixTime: '5-15 minutes'
        });
        break;
        
      case 'performance':
        suggestions.push({
          type: 'config',
          priority: 'medium',
          title: 'Optimize Performance',
          description: `Address ${count} performance warning${count > 1 ? 's' : ''}.`,
          automated: false,
          estimatedFixTime: '10-30 minutes'
        });
        break;
        
      default:
        suggestions.push({
          type: 'documentation',
          priority: 'low',
          title: `Review ${category} Warnings`,
          description: `Review and address ${count} ${category} warning${count > 1 ? 's' : ''}.`,
          automated: false,
          estimatedFixTime: '5-10 minutes'
        });
    }
    
    return suggestions;
  }
}

/**
 * Create warning parser instance
 */
export function createBuildWarningParser(): BuildWarningParser {
  return new BuildWarningParser();
}