/**
 * Error Solution Mapper
 * 
 * Comprehensive solution mapping system for GitHub Actions build errors.
 * Provides specific, actionable solutions based on error patterns, context,
 * and historical success rates. Optimized for AI-generated components.
 * 
 * Features:
 * - Contextual solution recommendations based on error analysis
 * - Framework-specific solutions (React, Vue, Svelte)
 * - Automated vs manual solution classification
 * - Success rate tracking for solution effectiveness
 * - Integration with existing error recovery system
 */

import {
  GitHubBuildErrorAnalysis,
  GitHubLogAnalysis
} from './githubErrorHandler';
import {
  ErrorRecoverySuggestion,
  ErrorCategory,
  ErrorSeverity,
  BuildStage,
  FrameworkType
} from '../types/api';

/**
 * Solution effectiveness data
 */
export interface SolutionEffectiveness {
  solution_id: string;
  success_rate: number;        // 0-100 success rate
  usage_count: number;         // How many times this solution was applied
  average_fix_time: number;    // Average time to fix in milliseconds
  last_successful: string;     // Last successful application timestamp
  complexity: 'simple' | 'moderate' | 'complex';
}

/**
 * Enhanced error recovery suggestion with GitHub context
 */
export interface GitHubErrorRecoverySuggestion extends ErrorRecoverySuggestion {
  solution_id: string;
  github_specific: boolean;
  requires_github_secrets: boolean;
  workflow_modification: boolean;
  effectiveness?: SolutionEffectiveness;
  related_links: string[];     // Documentation/help links
}

/**
 * Solution mapping context
 */
export interface SolutionContext {
  errorAnalysis: GitHubBuildErrorAnalysis;
  logAnalysis: GitHubLogAnalysis;
  previousAttempts?: string[]; // Previously tried solutions
  projectComplexity: 'simple' | 'moderate' | 'complex';
  hasTypeScript: boolean;
  hasCustomDependencies: boolean;
}

/**
 * Solution template for different error patterns
 */
interface SolutionTemplate {
  solution_id: string;
  pattern: RegExp;
  category: ErrorCategory;
  severity: ErrorSeverity;
  stage?: BuildStage;
  framework?: FrameworkType;
  title: string;
  description: string;
  type: ErrorRecoverySuggestion['type'];
  priority: ErrorRecoverySuggestion['priority'];
  automated: boolean;
  estimatedFixTime: string;
  command?: string;
  github_specific: boolean;
  requires_github_secrets: boolean;
  workflow_modification: boolean;
  related_links: string[];
  success_factors: string[];   // Conditions that increase success rate
}

/**
 * Comprehensive solution templates for GitHub Actions errors
 */
const SOLUTION_TEMPLATES: SolutionTemplate[] = [
  // NPM Dependency Resolution Errors
  {
    solution_id: 'npm-legacy-peer-deps',
    pattern: /npm ERR!.*ERESOLVE.*unable to resolve dependency tree/i,
    category: 'dependency',
    severity: 'critical',
    stage: 'npm-install',
    title: 'Use Legacy Peer Dependency Resolution',
    description: 'Bypass NPM dependency conflicts using legacy peer dependency resolution mode. This resolves most AI-generated component dependency issues.',
    type: 'dependency',
    priority: 'high',
    automated: true,
    estimatedFixTime: '1-2 minutes',
    command: 'npm ci --legacy-peer-deps',
    github_specific: true,
    requires_github_secrets: false,
    workflow_modification: true,
    related_links: [
      'https://docs.npmjs.com/cli/v7/using-npm/config#legacy-peer-deps',
      'https://github.blog/2021-02-02-npm-7-is-now-generally-available/#peer-dependencies'
    ],
    success_factors: [
      'Error mentions ERESOLVE',
      'Project uses React 18+ with older type packages',
      'AI-generated components with mixed dependency versions'
    ]
  },
  {
    solution_id: 'npm-force-resolution',
    pattern: /npm ERR!.*ERESOLVE/i,
    category: 'dependency',
    severity: 'critical',
    stage: 'npm-install',
    title: 'Force NPM Dependency Resolution',
    description: 'Force NPM to ignore dependency conflicts and proceed with installation. Use when legacy peer deps don\'t work.',
    type: 'dependency',
    priority: 'medium',
    automated: true,
    estimatedFixTime: '1-2 minutes',
    command: 'npm ci --force',
    github_specific: true,
    requires_github_secrets: false,
    workflow_modification: true,
    related_links: [
      'https://docs.npmjs.com/cli/v8/commands/npm-install#force'
    ],
    success_factors: [
      'Legacy peer deps solution failed',
      'Dependencies have minor version conflicts',
      'Project structure is relatively simple'
    ]
  },
  {
    solution_id: 'missing-npm-package',
    pattern: /npm ERR!.*404.*Not Found.*GET/i,
    category: 'dependency',
    severity: 'error',
    stage: 'npm-install',
    title: 'Fix Missing NPM Package',
    description: 'The specified package does not exist in the NPM registry. Check package name spelling and availability.',
    type: 'dependency',
    priority: 'high',
    automated: false,
    estimatedFixTime: '5-10 minutes',
    github_specific: false,
    requires_github_secrets: false,
    workflow_modification: false,
    related_links: [
      'https://www.npmjs.com/search',
      'https://github.com/npm/cli/wiki/404'
    ],
    success_factors: [
      'Package name is misspelled',
      'Using old package name that was renamed',
      'Package was unpublished from NPM'
    ]
  },

  // TypeScript/Syntax Errors
  {
    solution_id: 'typescript-missing-types',
    pattern: /Cannot find name ['"`](\w+)['"`]/i,
    category: 'syntax',
    severity: 'error',
    stage: 'build',
    title: 'Add Missing TypeScript Types',
    description: 'Install missing type definitions or add proper imports for the undefined identifier.',
    type: 'code',
    priority: 'high',
    automated: false,
    estimatedFixTime: '3-7 minutes',
    github_specific: false,
    requires_github_secrets: false,
    workflow_modification: false,
    related_links: [
      'https://www.typescriptlang.org/docs/handbook/2/type-declarations.html',
      'https://github.com/DefinitelyTyped/DefinitelyTyped'
    ],
    success_factors: [
      'Missing React imports (useState, useEffect, etc.)',
      'Missing type definitions for third-party packages',
      'AI-generated components with incomplete imports'
    ]
  },
  {
    solution_id: 'jsx-syntax-fix',
    pattern: /JSX element ['"`](\w+)['"`] has no corresponding closing tag/i,
    category: 'syntax',
    severity: 'error',
    stage: 'build',
    framework: 'react',
    title: 'Fix JSX Syntax Error',
    description: 'Correct JSX element syntax by adding missing closing tags or converting to self-closing elements.',
    type: 'code',
    priority: 'high',
    automated: false,
    estimatedFixTime: '2-5 minutes',
    github_specific: false,
    requires_github_secrets: false,
    workflow_modification: false,
    related_links: [
      'https://react.dev/learn/writing-markup-with-jsx',
      'https://react.dev/reference/react/createElement'
    ],
    success_factors: [
      'Simple JSX syntax error',
      'AI-generated component with malformed tags',
      'Missing self-closing tag syntax'
    ]
  },
  {
    solution_id: 'react-hooks-rules',
    pattern: /React Hook.*is called conditionally/i,
    category: 'syntax',
    severity: 'error',
    stage: 'build',
    framework: 'react',
    title: 'Fix React Hooks Rules Violation',
    description: 'Move React hooks to the top level of your component function. Hooks cannot be called inside loops, conditions, or nested functions.',
    type: 'code',
    priority: 'high',
    automated: false,
    estimatedFixTime: '5-15 minutes',
    github_specific: false,
    requires_github_secrets: false,
    workflow_modification: false,
    related_links: [
      'https://react.dev/reference/rules/rules-of-hooks',
      'https://react.dev/learn/conditional-rendering'
    ],
    success_factors: [
      'Hooks called inside if statements',
      'Hooks called inside loops',
      'AI-generated components with incorrect hook placement'
    ]
  },

  // Build/Vite Errors
  {
    solution_id: 'vite-build-optimization',
    pattern: /\[vite\] build error.*Transform failed/i,
    category: 'build',
    severity: 'error',
    stage: 'build',
    title: 'Optimize Vite Build Configuration',
    description: 'Adjust Vite configuration to handle build transformation issues with your components.',
    type: 'config',
    priority: 'medium',
    automated: true,
    estimatedFixTime: '2-5 minutes',
    github_specific: true,
    requires_github_secrets: false,
    workflow_modification: true,
    related_links: [
      'https://vitejs.dev/config/',
      'https://vitejs.dev/guide/troubleshooting.html'
    ],
    success_factors: [
      'Complex component with advanced JavaScript features',
      'Using newer syntax not supported by default',
      'Large components causing memory issues'
    ]
  },
  {
    solution_id: 'module-resolution-fix',
    pattern: /Module not found.*Can't resolve/i,
    category: 'dependency',
    severity: 'error',
    stage: 'build',
    title: 'Fix Module Resolution',
    description: 'Correct import paths or install missing dependencies to resolve module loading issues.',
    type: 'dependency',
    priority: 'high',
    automated: false,
    estimatedFixTime: '3-10 minutes',
    github_specific: false,
    requires_github_secrets: false,
    workflow_modification: false,
    related_links: [
      'https://vitejs.dev/guide/dep-pre-bundling.html',
      'https://nodejs.org/api/modules.html#modules_all_together'
    ],
    success_factors: [
      'Incorrect relative import paths',
      'Missing package installation',
      'Case sensitivity issues in file names'
    ]
  },

  // Timeout Errors
  {
    solution_id: 'increase-build-timeout',
    pattern: /Error.*operation was canceled|timeout/i,
    category: 'timeout',
    severity: 'critical',
    stage: 'build',
    title: 'Increase Build Timeout',
    description: 'Extend the GitHub Actions workflow timeout to allow more time for complex builds.',
    type: 'environment',
    priority: 'high',
    automated: true,
    estimatedFixTime: '1 minute',
    github_specific: true,
    requires_github_secrets: false,
    workflow_modification: true,
    related_links: [
      'https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idtimeout-minutes'
    ],
    success_factors: [
      'Large project with many dependencies',
      'Complex AI-generated components',
      'First-time build (no cache)'
    ]
  },
  {
    solution_id: 'optimize-bundle-size',
    pattern: /timeout.*build/i,
    category: 'timeout',
    severity: 'error',
    stage: 'build',
    title: 'Optimize Bundle Size',
    description: 'Reduce build time by removing unused dependencies and optimizing component size.',
    type: 'code',
    priority: 'medium',
    automated: false,
    estimatedFixTime: '15-30 minutes',
    github_specific: false,
    requires_github_secrets: false,
    workflow_modification: false,
    related_links: [
      'https://web.dev/reduce-javascript-payloads-with-code-splitting/',
      'https://vitejs.dev/guide/build.html#build-optimizations'
    ],
    success_factors: [
      'Project has many unused dependencies',
      'Large AI-generated components',
      'Importing entire libraries instead of specific functions'
    ]
  },

  // Infrastructure Errors
  {
    solution_id: 'r2-upload-retry',
    pattern: /R2.*upload.*error|aws.*s3.*error/i,
    category: 'infrastructure',
    severity: 'critical',
    stage: 'deployment',
    title: 'Retry R2 Upload',
    description: 'Temporary storage issue. Retry the build to re-attempt uploading artifacts to Cloudflare R2.',
    type: 'retry',
    priority: 'high',
    automated: true,
    estimatedFixTime: '30 seconds',
    github_specific: true,
    requires_github_secrets: false,
    workflow_modification: false,
    related_links: [
      'https://developers.cloudflare.com/r2/',
      'https://community.cloudflare.com/c/developers/r2-object-storage/103'
    ],
    success_factors: [
      'Intermittent network issues',
      'Temporary R2 service disruption',
      'Rate limiting from excessive uploads'
    ]
  },
  {
    solution_id: 'github-secrets-check',
    pattern: /Missing required.*credentials|Error.*CLOUDFLARE_ACCOUNT_ID/i,
    category: 'infrastructure',
    severity: 'critical',
    stage: 'deployment',
    title: 'Check GitHub Repository Secrets',
    description: 'Required environment variables are missing from GitHub repository secrets.',
    type: 'environment',
    priority: 'high',
    automated: false,
    estimatedFixTime: '5-10 minutes',
    github_specific: true,
    requires_github_secrets: true,
    workflow_modification: false,
    related_links: [
      'https://docs.github.com/en/actions/security-guides/encrypted-secrets',
      'https://developers.cloudflare.com/r2/api/s3/tokens/'
    ],
    success_factors: [
      'First-time repository setup',
      'Missing Cloudflare API credentials',
      'Incorrect secret names or values'
    ]
  }
];

/**
 * Main Error Solution Mapper class
 */
export class ErrorSolutionMapper {
  private solutionTemplates: SolutionTemplate[];
  private effectivenessCache: Map<string, SolutionEffectiveness> = new Map();

  constructor() {
    this.solutionTemplates = SOLUTION_TEMPLATES;
    console.info('[ERROR-SOLUTION-MAPPER] Initialized with solution templates', {
      total_solutions: this.solutionTemplates.length,
      categories: [...new Set(this.solutionTemplates.map(s => s.category))],
      automated_solutions: this.solutionTemplates.filter(s => s.automated).length
    });
  }

  /**
   * Generate contextual error recovery suggestions for GitHub Actions failures
   */
  generateSolutions(
    context: SolutionContext
  ): GitHubErrorRecoverySuggestion[] {
    console.info('[ERROR-SOLUTION-MAPPER] Generating solutions for error', {
      category: context.errorAnalysis.category,
      severity: context.errorAnalysis.severity,
      stage: context.errorAnalysis.stage,
      framework: context.errorAnalysis.framework,
      previous_attempts: context.previousAttempts?.length || 0
    });

    const solutions: GitHubErrorRecoverySuggestion[] = [];
    const errorMessage = context.errorAnalysis.technicalMessage;
    const userMessage = context.errorAnalysis.userMessage;

    // 1. Find matching solution templates
    const matchingTemplates = this.findMatchingSolutions(
      errorMessage,
      userMessage,
      context.errorAnalysis,
      context.logAnalysis
    );

    // 2. Convert templates to suggestions with context
    for (const template of matchingTemplates) {
      // Skip if already attempted
      if (context.previousAttempts?.includes(template.solution_id)) {
        continue;
      }

      const suggestion = this.createSuggestionFromTemplate(template, context);
      solutions.push(suggestion);
    }

    // 3. Add fallback generic solutions if no specific matches
    if (solutions.length === 0) {
      const fallbackSolutions = this.getFallbackSolutions(context.errorAnalysis);
      solutions.push(...fallbackSolutions);
    }

    // 4. Sort by priority and effectiveness
    solutions.sort((a, b) => {
      const priorityScore = this.getPriorityScore(a.priority) - this.getPriorityScore(b.priority);
      if (priorityScore !== 0) return priorityScore;

      const effectivenessScore = (b.effectiveness?.success_rate || 50) - (a.effectiveness?.success_rate || 50);
      return effectivenessScore;
    });

    // 5. Limit to top 5 solutions
    const topSolutions = solutions.slice(0, 5);

    console.info('[ERROR-SOLUTION-MAPPER] Solutions generated', {
      total_found: solutions.length,
      returned: topSolutions.length,
      automated: topSolutions.filter(s => s.automated).length,
      high_priority: topSolutions.filter(s => s.priority === 'high').length
    });

    return topSolutions;
  }

  /**
   * Find solution templates that match the error
   */
  private findMatchingSolutions(
    errorMessage: string,
    userMessage: string,
    errorAnalysis: GitHubBuildErrorAnalysis,
    logAnalysis: GitHubLogAnalysis
  ): SolutionTemplate[] {
    const matches: Array<{ template: SolutionTemplate; score: number }> = [];

    for (const template of this.solutionTemplates) {
      let score = 0;

      // Test pattern matching
      const patternMatch = template.pattern.test(errorMessage) || template.pattern.test(userMessage);
      if (!patternMatch) continue;

      score += 50; // Base score for pattern match

      // Category match bonus
      if (template.category === errorAnalysis.category) {
        score += 20;
      }

      // Severity match bonus
      if (template.severity === errorAnalysis.severity) {
        score += 10;
      }

      // Stage match bonus
      if (template.stage === errorAnalysis.stage) {
        score += 15;
      }

      // Framework match bonus
      if (template.framework === errorAnalysis.framework) {
        score += 10;
      }

      // Success factors bonus
      if (this.checkSuccessFactors(template, errorMessage, logAnalysis)) {
        score += 15;
      }

      // Effectiveness bonus
      const effectiveness = this.effectivenessCache.get(template.solution_id);
      if (effectiveness && effectiveness.success_rate > 70) {
        score += Math.floor(effectiveness.success_rate / 10);
      }

      matches.push({ template, score });
    }

    // Sort by score and return templates
    return matches
      .sort((a, b) => b.score - a.score)
      .map(match => match.template);
  }

  /**
   * Check if success factors apply to current error
   */
  private checkSuccessFactors(
    template: SolutionTemplate,
    errorMessage: string,
    logAnalysis: GitHubLogAnalysis
  ): boolean {
    const message = errorMessage.toLowerCase();
    const failedStepNames = logAnalysis.failedSteps.map(s => s.name.toLowerCase());

    for (const factor of template.success_factors) {
      const factorLower = factor.toLowerCase();
      
      // Check in error message
      if (message.includes(factorLower)) return true;
      
      // Check in failed step names
      if (failedStepNames.some(step => step.includes(factorLower))) return true;
      
      // Check specific patterns
      if (factorLower.includes('react') && message.includes('react')) return true;
      if (factorLower.includes('dependency') && message.includes('npm err')) return true;
      if (factorLower.includes('typescript') && message.includes('ts')) return true;
    }

    return false;
  }

  /**
   * Create suggestion from template with context
   */
  private createSuggestionFromTemplate(
    template: SolutionTemplate,
    context: SolutionContext
  ): GitHubErrorRecoverySuggestion {
    // Get effectiveness data
    const effectiveness = this.effectivenessCache.get(template.solution_id);

    // Customize description based on context
    let description = template.description;
    if (context.hasTypeScript && template.solution_id === 'typescript-missing-types') {
      description += ' Your project uses TypeScript, so ensure type definitions are properly installed.';
    }

    if (context.hasCustomDependencies && template.category === 'dependency') {
      description += ' Custom dependencies may require specific version compatibility.';
    }

    // Adjust estimated fix time based on project complexity
    let estimatedFixTime = template.estimatedFixTime;
    if (context.projectComplexity === 'complex') {
      const timeMatch = estimatedFixTime.match(/(\d+)-(\d+)/);
      if (timeMatch) {
        const minTime = parseInt(timeMatch[1]);
        const maxTime = parseInt(timeMatch[2]);
        estimatedFixTime = `${minTime + 2}-${maxTime + 5} minutes`;
      }
    }

    return {
      solution_id: template.solution_id,
      type: template.type,
      priority: template.priority,
      title: template.title,
      description,
      command: template.command,
      automated: template.automated,
      estimatedFixTime,
      github_specific: template.github_specific,
      requires_github_secrets: template.requires_github_secrets,
      workflow_modification: template.workflow_modification,
      effectiveness,
      related_links: template.related_links
    };
  }

  /**
   * Get fallback solutions when no specific matches found
   */
  private getFallbackSolutions(
    errorAnalysis: GitHubBuildErrorAnalysis
  ): GitHubErrorRecoverySuggestion[] {
    const fallbacks: GitHubErrorRecoverySuggestion[] = [];

    // Generic retry solution
    fallbacks.push({
      solution_id: 'generic-retry',
      type: 'retry',
      priority: 'medium',
      title: 'Retry Build',
      description: 'Many build errors are temporary. Try running the build again to see if the issue resolves.',
      automated: true,
      estimatedFixTime: '30 seconds',
      github_specific: true,
      requires_github_secrets: false,
      workflow_modification: false,
      related_links: []
    });

    // Category-specific fallbacks
    if (errorAnalysis.category === 'dependency') {
      fallbacks.push({
        solution_id: 'clean-install',
        type: 'environment',
        priority: 'medium',
        title: 'Clean Package Installation',
        description: 'Clear package cache and reinstall dependencies to resolve potential corruption.',
        command: 'rm -rf node_modules package-lock.json && npm install',
        automated: true,
        estimatedFixTime: '2-3 minutes',
        github_specific: true,
        requires_github_secrets: false,
        workflow_modification: true,
        related_links: ['https://docs.npmjs.com/cli/v7/commands/npm-ci']
      });
    }

    if (errorAnalysis.category === 'syntax') {
      fallbacks.push({
        solution_id: 'code-review',
        type: 'code',
        priority: 'high',
        title: 'Review Component Code',
        description: 'Manually review your component code for syntax errors, missing imports, or incorrect usage patterns.',
        automated: false,
        estimatedFixTime: '10-20 minutes',
        github_specific: false,
        requires_github_secrets: false,
        workflow_modification: false,
        related_links: []
      });
    }

    return fallbacks;
  }

  /**
   * Get priority score for sorting
   */
  private getPriorityScore(priority: GitHubErrorRecoverySuggestion['priority']): number {
    switch (priority) {
      case 'high': return 1;
      case 'medium': return 2;
      case 'low': return 3;
      default: return 4;
    }
  }

  /**
   * Update solution effectiveness based on usage results
   */
  async updateSolutionEffectiveness(
    solutionId: string,
    success: boolean,
    fixTimeMs: number,
    env: Env
  ): Promise<void> {
    try {
      console.info('[ERROR-SOLUTION-MAPPER] Updating solution effectiveness', {
        solution_id: solutionId,
        success,
        fix_time_ms: fixTimeMs
      });

      const effectivenessKey = `solution-effectiveness/${solutionId}.json`;
      
      // Get existing effectiveness or initialize
      let effectiveness: SolutionEffectiveness;
      try {
        const existingData = await env.PROJECTS_BUCKET.get(effectivenessKey);
        if (existingData) {
          effectiveness = await existingData.json() as SolutionEffectiveness;
        } else {
          effectiveness = {
            solution_id: solutionId,
            success_rate: success ? 100 : 0,
            usage_count: 0,
            average_fix_time: fixTimeMs,
            last_successful: success ? new Date().toISOString() : '',
            complexity: 'simple'
          };
        }
      } catch {
        effectiveness = {
          solution_id: solutionId,
          success_rate: success ? 100 : 0,
          usage_count: 0,
          average_fix_time: fixTimeMs,
          last_successful: success ? new Date().toISOString() : '',
          complexity: 'simple'
        };
      }

      // Update statistics
      const totalAttempts = effectiveness.usage_count + 1;
      const successfulAttempts = Math.round((effectiveness.success_rate / 100) * effectiveness.usage_count) + (success ? 1 : 0);
      
      effectiveness.success_rate = Math.round((successfulAttempts / totalAttempts) * 100);
      effectiveness.usage_count = totalAttempts;
      effectiveness.average_fix_time = Math.round(
        (effectiveness.average_fix_time * effectiveness.usage_count + fixTimeMs) / (effectiveness.usage_count + 1)
      );
      
      if (success) {
        effectiveness.last_successful = new Date().toISOString();
      }

      // Update complexity based on fix time
      if (fixTimeMs > 30 * 60 * 1000) { // 30 minutes
        effectiveness.complexity = 'complex';
      } else if (fixTimeMs > 10 * 60 * 1000) { // 10 minutes
        effectiveness.complexity = 'moderate';
      }

      // Store updated effectiveness
      await env.PROJECTS_BUCKET.put(
        effectivenessKey,
        JSON.stringify(effectiveness, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            solution_id: solutionId,
            success_rate: effectiveness.success_rate.toString(),
            usage_count: effectiveness.usage_count.toString(),
            updated_at: new Date().toISOString()
          }
        }
      );

      // Update cache
      this.effectivenessCache.set(solutionId, effectiveness);

      console.info('[ERROR-SOLUTION-MAPPER] Solution effectiveness updated', {
        solution_id: solutionId,
        new_success_rate: effectiveness.success_rate,
        total_usage: effectiveness.usage_count
      });

    } catch (error) {
      console.error('[ERROR-SOLUTION-MAPPER] Failed to update solution effectiveness', {
        solution_id: solutionId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - effectiveness update failure shouldn't break the system
    }
  }

  /**
   * Load solution effectiveness data from storage
   */
  async loadSolutionEffectiveness(env: Env): Promise<void> {
    try {
      console.info('[ERROR-SOLUTION-MAPPER] Loading solution effectiveness data');

      const listResult = await env.PROJECTS_BUCKET.list({
        prefix: 'solution-effectiveness/'
      });

      const loadPromises = listResult.objects.map(async (obj) => {
        try {
          const effectivenessObj = await env.PROJECTS_BUCKET.get(obj.key);
          if (effectivenessObj) {
            const effectiveness = await effectivenessObj.json() as SolutionEffectiveness;
            this.effectivenessCache.set(effectiveness.solution_id, effectiveness);
          }
        } catch (error) {
          console.warn('[ERROR-SOLUTION-MAPPER] Failed to load effectiveness data', {
            key: obj.key,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      });

      await Promise.all(loadPromises);

      console.info('[ERROR-SOLUTION-MAPPER] Solution effectiveness data loaded', {
        loaded_solutions: this.effectivenessCache.size
      });

    } catch (error) {
      console.error('[ERROR-SOLUTION-MAPPER] Failed to load solution effectiveness', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

/**
 * Factory function to create error solution mapper
 */
export function createErrorSolutionMapper(): ErrorSolutionMapper {
  return new ErrorSolutionMapper();
}

/**
 * Utility function to determine project complexity from context
 */
export function determineProjectComplexity(
  errorAnalysis: GitHubBuildErrorAnalysis,
  logAnalysis: GitHubLogAnalysis
): 'simple' | 'moderate' | 'complex' {
  let complexity = 0;

  // Check error factors
  if (errorAnalysis.category === 'dependency' && errorAnalysis.severity === 'critical') complexity += 2;
  if (errorAnalysis.stage === 'build' && logAnalysis.errorEntries.length > 5) complexity += 2;
  if (logAnalysis.failedSteps.length > 3) complexity += 1;
  if (logAnalysis.rawLogSize > 50000) complexity += 1; // Large log files indicate complexity

  // Check for TypeScript
  const hasTypeScript = logAnalysis.errorEntries.some(entry => 
    entry.message.includes('typescript') || entry.message.includes('TS')
  );
  if (hasTypeScript) complexity += 1;

  // Determine final complexity
  if (complexity >= 4) return 'complex';
  if (complexity >= 2) return 'moderate';
  return 'simple';
}