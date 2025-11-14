/**
 * Build Error Analyzer - TASK-017
 * 
 * Comprehensive error analysis system that transforms technical build failures 
 * into actionable user feedback with categorization, recovery suggestions, and analytics.
 * 
 * Handles:
 * - Error classification (syntax, dependency, build, timeout, infrastructure)
 * - User-friendly error message generation 
 * - Recovery suggestion engine for common AI-generated code issues
 * - Error storage and analytics for debugging and monitoring
 * - Framework-specific error guidance
 */

import {
  ErrorCategory,
  ErrorSeverity, 
  ErrorPattern,
  BuildErrorAnalysis,
  ErrorRecoverySuggestion,
  ErrorStatistics,
  BuildStage,
  FrameworkType,
  BuildStageResult
} from '../types/api';

/**
 * Comprehensive error pattern database for common build failures
 * Optimized for AI-generated code patterns from ChatGPT, Claude, etc.
 */
export const ERROR_PATTERNS: ErrorPattern[] = [
  // Syntax Errors - TypeScript/JSX
  {
    pattern: /Cannot find name '(\w+)'/i,
    category: 'syntax',
    severity: 'error',
    messageTemplate: 'TypeScript cannot find the identifier "{0}". This often happens when an import is missing or a variable is not properly declared.',
    suggestions: [
      'Check if "{0}" needs to be imported from a package or another file',
      'Verify the spelling of "{0}" matches the actual export name',
      'Add the missing import statement at the top of your component',
      'For React components, ensure useState, useEffect, etc. are imported from "react"'
    ],
    framework: 'react',
    stage: 'build',
    confidence: 95
  },
  {
    pattern: /Module ['""]([^'"]+)['""] has no exported member ['""](\w+)['"]/i,
    category: 'syntax',
    severity: 'error',
    messageTemplate: 'The module "{0}" does not export "{1}". This commonly happens when import names don\'t match the actual exports.',
    suggestions: [
      'Check the documentation for "{0}" to see available exports',
      'Verify "{1}" is spelled correctly and matches the export name exactly',
      'Try importing as default: import {1} from "{0}" instead',
      'Check if the package has been updated and exports have changed'
    ],
    confidence: 90
  },
  {
    pattern: /JSX element '(\w+)' has no corresponding closing tag/i,
    category: 'syntax',
    severity: 'error',
    messageTemplate: 'JSX element "{0}" is missing its closing tag. React components must have properly matched opening and closing tags.',
    suggestions: [
      'Add the closing tag: </{0}>',
      'If this is a self-closing element, use: <{0} />',
      'Check for typos in the tag name',
      'Ensure proper nesting of JSX elements'
    ],
    framework: 'react',
    stage: 'build',
    confidence: 95
  },

  // Dependency Errors - NPM Installation
  {
    pattern: /Cannot resolve dependency: (.+)/i,
    category: 'dependency',
    severity: 'error',
    messageTemplate: 'Unable to resolve dependency "{0}". This package may not exist, be misspelled, or require a different version.',
    suggestions: [
      'Check if "{0}" is spelled correctly',
      'Verify the package exists on npm registry',
      'Try installing a specific version: npm install {0}@latest',
      'Check if this is a peer dependency that needs manual installation'
    ],
    confidence: 85
  },
  {
    pattern: /ERESOLVE unable to resolve dependency tree/i,
    category: 'dependency',
    severity: 'critical',
    messageTemplate: 'NPM dependency resolution conflict. Different packages require incompatible versions of the same dependency.',
    suggestions: [
      'Try using --force or --legacy-peer-deps flag',
      'Update packages to compatible versions',
      'Check for peer dependency warnings and install missing packages',
      'Consider using npm audit fix to resolve security issues'
    ],
    confidence: 90
  },
  {
    pattern: /Module not found: Can't resolve '([^']+)'/i,
    category: 'dependency',
    severity: 'error',
    messageTemplate: 'Module "{0}" cannot be found. This usually means the package is not installed or the import path is incorrect.',
    suggestions: [
      'Install the missing package: npm install {0}',
      'Check if the import path is correct (relative vs absolute)',
      'Verify the package name spelling',
      'For local files, check the file path and extension'
    ],
    confidence: 90
  },

  // Build Errors - Vite/Webpack Compilation
  {
    pattern: /Build failed with (\d+) errors?/i,
    category: 'build',
    severity: 'error',
    messageTemplate: 'Build process failed with {0} compilation error(s). Review the detailed error messages below.',
    suggestions: [
      'Check TypeScript errors and fix type issues',
      'Verify all imports are correct and packages are installed',
      'Review console output for specific error details',
      'Try cleaning node_modules and reinstalling: rm -rf node_modules && npm install'
    ],
    confidence: 75
  },
  {
    pattern: /Unexpected token '([^']+)'/i,
    category: 'syntax',
    severity: 'error',
    messageTemplate: 'Unexpected token "{0}" found during parsing. This is usually a syntax error in your code.',
    suggestions: [
      'Check for missing or extra brackets, parentheses, or semicolons',
      'Verify JSX syntax is correct for React components',
      'Ensure template syntax is valid for Vue/Svelte components',
      'Look for unmatched quotes or missing commas in objects/arrays'
    ],
    confidence: 80
  },
  {
    pattern: /Transform failed with (\d+) errors?/i,
    category: 'build',
    severity: 'error',
    messageTemplate: 'Code transformation failed during build. This often happens with TypeScript or JSX processing.',
    suggestions: [
      'Check TypeScript configuration (tsconfig.json)',
      'Verify JSX transform settings in build config',
      'Update @vitejs/plugin-react or equivalent for your framework',
      'Check for unsupported JavaScript/TypeScript syntax'
    ],
    confidence: 75
  },

  // Timeout Errors
  {
    pattern: /Build timeout after (\d+) seconds/i,
    category: 'timeout',
    severity: 'critical',
    messageTemplate: 'Build process timed out after {0} seconds. The build is taking longer than expected.',
    suggestions: [
      'Reduce bundle size by removing unused dependencies',
      'Check for infinite loops or performance issues in code',
      'Consider splitting large components into smaller ones',
      'Increase timeout limit if processing large applications'
    ],
    confidence: 95
  },
  {
    pattern: /npm install.*timed out/i,
    category: 'timeout',
    severity: 'error',
    messageTemplate: 'Package installation timed out. This often happens with slow network connections or large dependency trees.',
    suggestions: [
      'Retry the build - network issues are often temporary',
      'Use a faster package registry or npm mirror',
      'Remove unnecessary dependencies to speed up installation',
      'Check if specific packages are causing delays'
    ],
    confidence: 85
  },

  // Infrastructure Errors
  {
    pattern: /R2 storage error|Failed to upload artifacts/i,
    category: 'infrastructure',
    severity: 'critical',
    messageTemplate: 'Storage system error occurred during build artifact upload. This is a temporary infrastructure issue.',
    suggestions: [
      'Retry the build - storage issues are often temporary',
      'Check if storage quota has been exceeded',
      'Reduce build output size if possible',
      'Contact support if the issue persists'
    ],
    confidence: 90
  },
  {
    pattern: /Queue.*error|Message processing failed/i,
    category: 'infrastructure',
    severity: 'critical',
    messageTemplate: 'Build queue processing error. The build system encountered an internal error.',
    suggestions: [
      'Retry the build - queue issues are usually temporary',
      'Check build queue status and wait for system recovery',
      'Simplify the project if it\'s very large or complex',
      'Contact support if multiple retries fail'
    ],
    confidence: 85
  },

  // AI-Specific Patterns
  {
    pattern: /React Hook .* is called conditionally/i,
    category: 'syntax',
    severity: 'error',
    messageTemplate: 'React Hook is called conditionally. Hooks must be called in the same order every time the component renders.',
    suggestions: [
      'Move hooks to the top level of your component function',
      'Remove hooks from inside loops, conditions, or nested functions',
      'Use the conditional logic inside useEffect or other hooks instead',
      'Check React Rules of Hooks documentation for proper usage'
    ],
    framework: 'react',
    stage: 'build',
    confidence: 95
  },
  {
    pattern: /Invalid hook call|Hooks can only be called inside/i,
    category: 'syntax', 
    severity: 'error',
    messageTemplate: 'Invalid React Hook usage. Hooks can only be called from React function components or custom hooks.',
    suggestions: [
      'Ensure hooks are only called inside React function components',
      'Move hook calls out of regular JavaScript functions',
      'Create custom hooks if you need to share hook logic',
      'Check that component names start with uppercase letters'
    ],
    framework: 'react',
    stage: 'build',
    confidence: 95
  },
  {
    pattern: /failed to resolve import .* from/i,
    category: 'dependency',
    severity: 'error',
    messageTemplate: 'Unable to resolve import path. The imported module or file cannot be found.',
    suggestions: [
      'Check if the import path is correct (relative vs absolute)',
      'Verify the imported file exists at the specified location',
      'Install missing package if importing from node_modules',
      'Check for typos in the import statement'
    ],
    confidence: 85
  }
];

/**
 * Main Build Error Analyzer class
 */
export class BuildErrorAnalyzer {
  private errorStats: Map<string, ErrorStatistics> = new Map();
  private errorPatterns: ErrorPattern[] = ERROR_PATTERNS;

  /**
   * Analyze build error and provide comprehensive feedback
   */
  analyzeError(
    error: Error | string | null | undefined,
    stage: BuildStage,
    framework: FrameworkType,
    buildResult?: BuildStageResult
  ): BuildErrorAnalysis {
    const errorMessage = error?.message ?? (error === null ? 'null' : error === undefined ? 'undefined' : String(error ?? 'Unknown error'));
    const originalError = errorMessage;
    
    // Find matching error pattern
    const matchedPattern = this.findMatchingPattern(errorMessage, stage, framework);
    
    if (matchedPattern) {
      return this.createAnalysisFromPattern(matchedPattern, originalError, stage, framework, buildResult);
    }
    
    // Fallback analysis for unmatched errors
    return this.createFallbackAnalysis(originalError, stage, framework, buildResult);
  }

  /**
   * Find the best matching error pattern
   */
  private findMatchingPattern(
    errorMessage: string, 
    stage: BuildStage, 
    framework: FrameworkType
  ): ErrorPattern | null {
    let bestMatch: ErrorPattern | null = null;
    let bestScore = 0;

    for (const pattern of this.errorPatterns) {
      // Test pattern match
      const match = pattern.pattern.test(errorMessage);
      if (!match) continue;

      // Calculate match score based on specificity
      let score = pattern.confidence;
      
      // Bonus for stage match
      if (pattern.stage === stage) score += 10;
      
      // Bonus for framework match  
      if (pattern.framework === framework) score += 15;
      
      // Bonus for more specific patterns (higher confidence)
      score += pattern.confidence * 0.1;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = pattern;
      }
    }

    return bestMatch;
  }

  /**
   * Create error analysis from matched pattern
   */
  private createAnalysisFromPattern(
    pattern: ErrorPattern,
    originalError: string,
    stage: BuildStage,
    framework: FrameworkType,
    buildResult?: BuildStageResult
  ): BuildErrorAnalysis {
    // Extract pattern matches for templating
    const matches = pattern.pattern.exec(originalError) || [];
    
    // Generate user-friendly message
    const userMessage = this.formatMessage(pattern.messageTemplate, matches.slice(1));
    
    // Extract debug information
    const debugInfo = this.extractDebugInfo(originalError, buildResult);
    
    return {
      category: pattern.category,
      severity: pattern.severity,
      stage,
      framework,
      userMessage,
      technicalMessage: originalError,
      suggestions: pattern.suggestions.map(s => this.formatMessage(s, matches.slice(1))),
      fixable: this.isErrorFixable(pattern.category, pattern.severity),
      debugInfo: {
        ...debugInfo,
        originalError,
        matchedPattern: pattern.messageTemplate
      },
      confidence: pattern.confidence,
      analysisTimestamp: new Date().toISOString()
    };
  }

  /**
   * Create fallback analysis for unmatched errors
   */
  private createFallbackAnalysis(
    originalError: string,
    stage: BuildStage,
    framework: FrameworkType,
    buildResult?: BuildStageResult
  ): BuildErrorAnalysis {
    // Classify unknown error based on stage and content
    const category = this.classifyUnknownError(originalError, stage);
    const severity: ErrorSeverity = 'error';
    
    const debugInfo = this.extractDebugInfo(originalError, buildResult);
    
    return {
      category,
      severity,
      stage,
      framework,
      userMessage: this.generateGenericMessage(category, stage, framework),
      technicalMessage: originalError,
      suggestions: this.getGenericSuggestions(category, stage, framework),
      fixable: category !== 'infrastructure',
      debugInfo: {
        ...debugInfo,
        originalError
      },
      confidence: 50, // Lower confidence for unmatched patterns
      analysisTimestamp: new Date().toISOString()
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
   * Extract debug information from error and build result
   */
  private extractDebugInfo(error: string, buildResult?: BuildStageResult): Partial<BuildErrorAnalysis['debugInfo']> {
    const debugInfo: Partial<BuildErrorAnalysis['debugInfo']> = {};
    
    // Extract file path
    const fileMatch = error.match(/([^/\s]+\.(tsx?|jsx?|vue|svelte|css|scss|js))/i);
    if (fileMatch) {
      debugInfo.file = fileMatch[1];
    }
    
    // Extract line/column numbers - support multiple formats
    const locationMatch = error.match(/(?:at line |:)(\d+)(?::(\d+))?/);
    if (locationMatch) {
      debugInfo.line = parseInt(locationMatch[1], 10);
      if (locationMatch[2]) {
        debugInfo.column = parseInt(locationMatch[2], 10);
      }
    }
    
    // Extract context from build result
    if (buildResult?.logs) {
      const relevantLogs = buildResult.logs.filter(log => 
        log.includes('ERROR') || log.includes('Failed') || log.includes('Error')
      ).slice(-3);
      
      if (relevantLogs.length > 0) {
        debugInfo.context = relevantLogs.join('\n');
      }
    }
    
    return debugInfo;
  }

  /**
   * Classify unknown errors based on content analysis
   */
  private classifyUnknownError(error: string, stage: BuildStage): ErrorCategory {
    const lowercaseError = error.toLowerCase();
    
    // Syntax indicators (check first - more specific than dependency)
    if (lowercaseError.includes('syntax') || lowercaseError.includes('parse') || 
        lowercaseError.includes('unexpected') || lowercaseError.includes('token') ||
        lowercaseError.includes('has no exported member') || lowercaseError.includes('cannot find name')) {
      return 'syntax';
    }
    
    // Dependency indicators (after syntax check)
    if (lowercaseError.includes('package') || lowercaseError.includes('npm') || 
        lowercaseError.includes('install') || lowercaseError.includes('resolve dependency')) {
      return 'dependency';
    }
    
    // Build indicators
    if (lowercaseError.includes('build') || lowercaseError.includes('compile') || 
        lowercaseError.includes('transform')) {
      return 'build';
    }
    
    // Timeout indicators
    if (lowercaseError.includes('timeout') || lowercaseError.includes('exceeded')) {
      return 'timeout';
    }
    
    // Infrastructure indicators
    if (lowercaseError.includes('storage') || lowercaseError.includes('r2') || 
        lowercaseError.includes('queue') || lowercaseError.includes('network')) {
      return 'infrastructure';
    }
    
    // Stage-based fallback
    if (stage === 'npm-install') return 'dependency';
    if (stage === 'build') return 'build';
    if (stage === 'optimization') return 'build';
    if (stage === 'cleanup') return 'infrastructure';
    
    return 'unknown';
  }

  /**
   * Determine if error is fixable
   */
  private isErrorFixable(category: ErrorCategory, severity: ErrorSeverity): boolean {
    // Infrastructure errors are usually not user-fixable
    if (category === 'infrastructure') return false;
    
    // Critical timeout errors may not be fixable by user
    if (category === 'timeout' && severity === 'critical') return false;
    
    // Most syntax, dependency, and build errors are fixable
    return true;
  }

  /**
   * Generate generic message for unmatched errors
   */
  private generateGenericMessage(category: ErrorCategory, stage: BuildStage, framework: FrameworkType): string {
    const frameworkName = framework === 'react' ? 'React' : 
                         framework === 'vue' ? 'Vue' : 
                         framework === 'svelte' ? 'Svelte' : framework.toUpperCase();
    
    const stageMap = {
      'npm-install': 'dependency installation',
      'build': 'build compilation',
      'optimization': 'build optimization',
      'cleanup': 'build cleanup'
    };
    
    const categoryMessages = {
      'syntax': `${frameworkName} syntax error during ${stageMap[stage]}. Please check your code for syntax issues.`,
      'dependency': `Package dependency error during ${stageMap[stage]}. A required package may be missing or incompatible.`,
      'build': `Build compilation error during ${stageMap[stage]}. The ${frameworkName} build process encountered an issue.`,
      'timeout': `Build timeout during ${stageMap[stage]}. The process is taking longer than expected.`,
      'infrastructure': `System error during ${stageMap[stage]}. This is likely a temporary infrastructure issue.`,
      'configuration': `Configuration error during ${stageMap[stage]}. Build configuration may be invalid or incomplete.`,
      'unknown': `Unexpected error during ${stageMap[stage]}. Please review the technical details below.`
    };
    
    return categoryMessages[category];
  }

  /**
   * Get generic suggestions for unmatched errors
   */
  private getGenericSuggestions(category: ErrorCategory, stage: BuildStage, framework: FrameworkType): string[] {
    const genericSuggestions = {
      'syntax': [
        'Check your code syntax for typos or missing brackets',
        'Verify imports are correct and properly formatted',
        'Look for unmatched quotes, parentheses, or JSX tags',
        'Try using a code formatter or linter to identify issues'
      ],
      'dependency': [
        'Check if all required packages are installed',
        'Try running: npm install or npm ci',
        'Verify package.json dependencies are correct',
        'Check for version conflicts with npm ls'
      ],
      'build': [
        'Try cleaning and rebuilding: rm -rf node_modules && npm install',
        'Check build configuration files for errors',
        'Verify all source files are properly structured',
        'Update build tools and plugins to latest versions'
      ],
      'timeout': [
        'Retry the build - timeouts are often temporary',
        'Reduce project complexity if possible',
        'Check for infinite loops or performance issues',
        'Consider optimizing large files or dependencies'
      ],
      'infrastructure': [
        'Retry the build - infrastructure issues are usually temporary',
        'Check system status and wait for recovery if needed',
        'Contact support if the issue persists',
        'Try again in a few minutes'
      ],
      'configuration': [
        'Check all configuration files for syntax errors',
        'Verify file paths and references are correct',
        'Compare with working project configurations',
        'Update configuration files to match framework standards'
      ],
      'unknown': [
        'Review the technical error message for specific details',
        'Search for the error message online for solutions',
        'Try simplifying the code to isolate the issue',
        'Contact support with the error details if needed'
      ]
    };
    
    return genericSuggestions[category] || genericSuggestions.unknown;
  }

  /**
   * Generate recovery suggestions based on error analysis
   */
  generateRecoverySuggestions(analysis: BuildErrorAnalysis): ErrorRecoverySuggestion[] {
    const suggestions: ErrorRecoverySuggestion[] = [];
    
    // Category-specific recovery suggestions
    switch (analysis.category) {
      case 'dependency':
        suggestions.push({
          type: 'dependency',
          priority: 'high',
          title: 'Install Missing Dependencies',
          description: 'Run package installation to resolve missing or incompatible dependencies.',
          command: 'npm install',
          automated: true,
          estimatedFixTime: '1-2 minutes'
        });
        
        if (analysis.technicalMessage.includes('ERESOLVE')) {
          suggestions.push({
            type: 'dependency', 
            priority: 'medium',
            title: 'Force Dependency Resolution',
            description: 'Use legacy peer dependency resolution to bypass conflicts.',
            command: 'npm install --legacy-peer-deps',
            automated: true,
            estimatedFixTime: '1-2 minutes'
          });
        }
        break;
        
      case 'syntax':
        suggestions.push({
          type: 'code',
          priority: 'high',
          title: 'Fix Code Syntax',
          description: 'Review and correct the syntax error in your code.',
          automated: false,
          estimatedFixTime: '5-15 minutes'
        });
        
        if (analysis.framework === 'react' && analysis.technicalMessage.includes('Hook')) {
          suggestions.push({
            type: 'code',
            priority: 'high',
            title: 'Fix React Hook Usage',
            description: 'Move hooks to the top level of your component function.',
            automated: false,
            estimatedFixTime: '2-5 minutes'
          });
        }
        break;
        
      case 'build':
        suggestions.push({
          type: 'environment',
          priority: 'medium',
          title: 'Clean and Rebuild',
          description: 'Clear build cache and reinstall dependencies.',
          command: 'rm -rf node_modules && npm install',
          automated: true,
          estimatedFixTime: '2-3 minutes'
        });
        break;
        
      case 'timeout':
        suggestions.push({
          type: 'retry',
          priority: 'high', 
          title: 'Retry Build',
          description: 'Timeout errors are often temporary. Try running the build again.',
          automated: true,
          estimatedFixTime: '30 seconds'
        });
        
        suggestions.push({
          type: 'code',
          priority: 'medium',
          title: 'Optimize Code Size',
          description: 'Reduce bundle size by removing unused dependencies and code.',
          automated: false,
          estimatedFixTime: '15-30 minutes'
        });
        break;
        
      case 'infrastructure':
        suggestions.push({
          type: 'retry',
          priority: 'high',
          title: 'Retry Build',
          description: 'Infrastructure issues are usually temporary. Wait and retry.',
          automated: true,
          estimatedFixTime: '1-2 minutes'
        });
        break;
        
      default:
        suggestions.push({
          type: 'retry',
          priority: 'medium',
          title: 'Retry Build',
          description: 'Try running the build again to see if the issue resolves.',
          automated: true,
          estimatedFixTime: '1-2 minutes'
        });
    }
    
    return suggestions;
  }

  /**
   * Store error analysis for analytics
   */
  async storeErrorAnalysis(
    projectId: string, 
    analysis: BuildErrorAnalysis, 
    env: Env
  ): Promise<void> {
    try {
      const errorKey = `projects/${projectId}/errors/${analysis.analysisTimestamp}.json`;
      
      // Store detailed error analysis
      await env.PROJECTS_BUCKET.put(
        errorKey,
        JSON.stringify(analysis, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            category: analysis.category,
            severity: analysis.severity,
            stage: analysis.stage,
            framework: analysis.framework,
            fixable: analysis.fixable.toString(),
            created_at: analysis.analysisTimestamp
          }
        }
      );
      
      // Update error statistics
      await this.updateErrorStatistics(projectId, analysis, env);
      
    } catch (error) {
      console.error('[ERROR-STORAGE] Failed to store error analysis:', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      // Don't throw - error storage failures shouldn't break build process
    }
  }

  /**
   * Update error statistics for analytics
   */
  private async updateErrorStatistics(
    projectId: string,
    analysis: BuildErrorAnalysis,
    env: Env
  ): Promise<void> {
    try {
      const statsKey = `projects/${projectId}/error-stats.json`;
      let stats: ErrorStatistics;
      
      // Get existing stats or initialize new ones
      try {
        const existingStats = await env.PROJECTS_BUCKET.get(statsKey);
        if (existingStats) {
          stats = await existingStats.json() as ErrorStatistics;
        } else {
          stats = this.initializeErrorStatistics(projectId);
        }
      } catch {
        stats = this.initializeErrorStatistics(projectId);
      }
      
      // Update statistics
      stats.totalErrors++;
      stats.errorsByCategory[analysis.category] = (stats.errorsByCategory[analysis.category] || 0) + 1;
      stats.errorsByStage[analysis.stage] = (stats.errorsByStage[analysis.stage] || 0) + 1;
      stats.errorsByFramework[analysis.framework] = (stats.errorsByFramework[analysis.framework] || 0) + 1;
      
      // Update common patterns
      if (analysis.debugInfo.matchedPattern) {
        const existingPattern = stats.commonPatterns.find(p => p.pattern === analysis.debugInfo.matchedPattern);
        if (existingPattern) {
          existingPattern.count++;
          existingPattern.lastSeen = analysis.analysisTimestamp;
        } else {
          stats.commonPatterns.push({
            pattern: analysis.debugInfo.matchedPattern,
            count: 1,
            category: analysis.category,
            lastSeen: analysis.analysisTimestamp
          });
        }
      }
      
      // Store updated statistics
      await env.PROJECTS_BUCKET.put(
        statsKey,
        JSON.stringify(stats, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            updated_at: new Date().toISOString(),
            total_errors: stats.totalErrors.toString()
          }
        }
      );
      
    } catch (error) {
      console.error('[ERROR-STATS] Failed to update error statistics:', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Initialize error statistics for new project
   */
  private initializeErrorStatistics(projectId: string): ErrorStatistics {
    return {
      projectId,
      totalErrors: 0,
      errorsByCategory: {} as Record<ErrorCategory, number>,
      errorsByStage: {} as Record<BuildStage, number>, 
      errorsByFramework: {} as Record<FrameworkType, number>,
      commonPatterns: [],
      resolutionRate: 0,
      averageFixTime: 0
    };
  }
}

/**
 * Create error analyzer instance
 */
export function createBuildErrorAnalyzer(): BuildErrorAnalyzer {
  return new BuildErrorAnalyzer();
}