/**
 * Shared type definitions for GPTHost API
 */

/**
 * Project status during the build and deployment process
 */
export type ProjectStatus =
  | 'pending'     // Just uploaded, not processed yet
  | 'analyzing'   // Analyzing uploaded files
  | 'scaffolding' // Generating project scaffolding
  | 'scaffolded'  // Scaffolding completed
  | 'queueing'    // Alias for scaffolding while build is pending
  | 'building'    // Building the project
  | 'deploying'   // Deploying to R2
  | 'deployed'    // Successfully deployed
  | 'failed';     // Build or deployment failed

/**
 * Project metadata stored in R2
 */
export interface ProjectMetadata {
  id: string;
  status: ProjectStatus;
  name?: string;
  description?: string;
  framework?: FrameworkType;
  files: FileMetadata[];
  created_at: string;
  updated_at: string;
  build_logs?: string[];
  deployment_url?: string;
  error_message?: string;
  analysis?: ProjectAnalysis;
  build_metadata?: any; // Build tracking metadata (defined in projectMetadataManager.ts)
}

/**
 * Framework types supported by GPTHost
 */
export type FrameworkType = 'react' | 'vue' | 'svelte' | 'html' | 'javascript' | 'text' | 'unknown';

/**
 * Component type classification
 */
export type ComponentType = 'single-component' | 'full-application' | 'unknown';

/**
 * Styling approach detection
 */
export type StylingApproach = 'css-modules' | 'styled-components' | 'tailwind' | 'css-in-js' | 'vanilla-css' | 'scss' | 'none' | 'unknown';

/**
 * High-level CSS pattern detection categories
 */
export type CssPatternCategory =
  | 'utility-first'
  | 'component-based'
  | 'css-in-js'
  | 'preprocessor';

/**
 * Import type classification
 */
export type ImportType = 
  | 'es6-default'     // import React from 'react'
  | 'es6-named'       // import { useState } from 'react'
  | 'es6-namespace'   // import * as React from 'react'
  | 'es6-mixed'       // import React, { useState } from 'react'
  | 'commonjs'        // const fs = require('fs')
  | 'dynamic'         // import('react').then(...)
  | 'type-only'       // import type { Props } from './types'
  | 'css'             // import './styles.css'
  | 'asset'           // import logo from './logo.png'
  | 're-export';      // export { Button } from './Button'

/**
 * Dependency classification
 */
export type DependencyType = 
  | 'npm-package'     // react, lodash
  | 'scoped-package'  // @types/react, @mui/material  
  | 'local-relative'  // ./component, ../utils
  | 'local-absolute'  // /src/types
  | 'node-builtin'    // fs, path, crypto
  | 'unknown';

/**
 * Individual import statement analysis
 */
export interface ImportStatement {
  raw: string;              // Full import statement
  type: ImportType;         // Type of import syntax
  source: string;           // Module being imported from
  dependencyType: DependencyType;  // Classification of the dependency
  specifiers: string[];     // What's being imported (default, named, etc.)
  isTypeOnly: boolean;      // TypeScript type-only import
  lineNumber?: number;      // Line number in source file
}

/**
 * Comprehensive dependency analysis
 */
export interface DependencyAnalysis {
  external: string[];       // NPM packages (react, lodash)
  local: string[];          // Local/relative imports  
  nodeBuiltins: string[];   // Node.js built-in modules
  scoped: string[];         // Scoped packages (@types/react)
  assets: string[];         // CSS, images, other assets
  dynamicImports: string[]; // Dynamic import() statements
  typeOnlyImports: string[]; // TypeScript type imports
  allUnique: string[];      // All unique dependencies
}

/**
 * Enhanced import analysis results
 */
export interface ImportAnalysis {
  statements: ImportStatement[];      // Individual import statements
  dependencies: DependencyAnalysis;   // Categorized dependencies
  hasCircularImports: boolean;        // Warning flag
  unusedImports: string[];           // Potentially unused imports
  importCount: {
    total: number;
    es6: number;
    commonjs: number;
    dynamic: number;
    typeOnly: number;
    assets: number;
  };
}

/**
 * Component complexity classification
 */
export type ComponentComplexity = 'simple' | 'moderate' | 'complex' | 'very-complex' | 'unknown';

/**
 * Hook information with dependencies
 */
export interface HookAnalysis {
  name: string;                  // Hook name (useState, useEffect, custom hook)
  type: 'builtin' | 'custom';    // Built-in React hook or custom hook
  usageCount: number;            // Number of times used in component
  dependencies?: string[];       // Effect dependencies for useEffect/useMemo/useCallback
  isOptimized?: boolean;         // Has proper dependency array
}

/**
 * Props/interface analysis for components
 */
export interface PropsAnalysis {
  interfaceName?: string;        // TypeScript interface name
  propTypes?: string;            // PropTypes definition name
  properties: PropProperty[];    // Individual prop definitions
  isRequired: boolean;           // Has required props
  hasDefaults: boolean;          // Has default values
  complexity: 'simple' | 'moderate' | 'complex'; // Complexity based on prop count and types
}

/**
 * Individual prop property information
 */
export interface PropProperty {
  name: string;                  // Property name
  type: string;                  // TypeScript type or PropTypes type
  isRequired: boolean;           // Required property
  defaultValue?: string;         // Default value if specified
  description?: string;          // JSDoc comment if present
}

/**
 * Export analysis with categorization
 */
export interface ExportAnalysis {
  default?: ComponentExport;     // Default export information
  named: ComponentExport[];      // Named exports
  reExports: ComponentExport[];  // Re-exports from other modules
  totalExports: number;          // Total number of exports
  hasMultipleComponents: boolean;// Multiple components in one file
}

/**
 * Individual export information
 */
export interface ComponentExport {
  name: string;                  // Export name
  type: 'component' | 'function' | 'constant' | 'type' | 'interface' | 'unknown';
  isComponent: boolean;          // Confirmed component (returns JSX/template)
  componentType?: 'functional' | 'class' | 'forwardRef' | 'memo' | 'hoc'; // React component types
  framework?: FrameworkType;     // Specific framework if applicable
  source?: string;               // Source module for re-exports
}

/**
 * Component structure analysis results
 */
export interface ComponentStructure {
  detection: ComponentDetection; // Component detection and identification
  props?: PropsAnalysis;         // Props/interface analysis
  exports: ExportAnalysis;       // Export analysis
  hooks?: HookAnalysis[];        // React hooks analysis (React only)
  complexity: ComponentComplexityAnalysis; // Complexity metrics
  patterns: AICodePatterns;      // AI-generated code pattern detection
}

/**
 * Component detection and identification
 */
export interface ComponentDetection {
  componentCount: number;        // Number of components found
  mainComponent?: string;        // Primary component name
  components: DetectedComponent[]; // All detected components
  framework: FrameworkType;      // Detected framework
  hasMultipleComponents: boolean; // Multiple components in file
}

/**
 * Individual detected component information
 */
export interface DetectedComponent {
  name: string;                  // Component name
  type: 'functional' | 'class' | 'sfc' | 'unknown'; // Component type
  declarationType: 'function' | 'const' | 'class' | 'export'; // How it's declared
  isMainComponent: boolean;      // Likely the primary component
  isExported: boolean;           // Explicitly exported
  framework: FrameworkType;      // Specific framework
  location?: {                   // Location in source code
    startLine?: number;
    endLine?: number;
  };
}

/**
 * Component complexity analysis metrics
 */
export interface ComponentComplexityAnalysis {
  overall: ComponentComplexity;  // Overall complexity rating
  jsxComplexity?: JSXComplexity; // JSX-specific complexity (React)
  templateComplexity?: TemplateComplexity; // Template complexity (Vue/Svelte)
  stateComplexity: StateComplexity; // State management complexity
  logicComplexity: LogicComplexity; // Business logic complexity
  maintainabilityScore: number;  // 0-100 maintainability score
  performanceFlags: string[];    // Performance optimization flags
}

/**
 * JSX complexity metrics (React)
 */
export interface JSXComplexity {
  nestingDepth: number;          // Maximum JSX nesting depth
  conditionalCount: number;      // Number of conditional renders
  loopCount: number;             // Number of .map/.filter operations
  eventHandlers: number;         // Number of event handlers
  inlineStyles: number;          // Number of inline style objects
  componentReferences: number;   // Number of child components used
}

/**
 * Template complexity metrics (Vue/Svelte)
 */
export interface TemplateComplexity {
  nestingDepth: number;          // Maximum template nesting depth
  directiveCount: number;        // Number of framework directives (v-if, {#if})
  bindingCount: number;          // Number of data bindings
  eventHandlers: number;         // Number of event handlers
  componentReferences: number;   // Number of child components used
}

/**
 * State management complexity analysis
 */
export interface StateComplexity {
  stateVariables: number;        // Number of state variables
  stateUpdatePatterns: string[]; // Types of state updates found
  hasComplexState: boolean;      // Complex state objects/arrays
  hasStateEffects: boolean;      // State changes trigger effects
  stateManagementApproach: 'local' | 'context' | 'external' | 'mixed'; // State approach
}

/**
 * Business logic complexity analysis
 */
export interface LogicComplexity {
  functionCount: number;         // Number of functions/methods
  cyclomaticComplexity: number;  // Cyclomatic complexity score
  hasAsyncOperations: boolean;   // Contains async/await or promises
  hasErrorHandling: boolean;     // Contains try/catch blocks
  hasValidation: boolean;        // Contains validation logic
  computationIntensity: 'low' | 'medium' | 'high'; // Computational complexity
}

/**
 * AI-generated code patterns detection
 */
export interface AICodePatterns {
  likelyAIGenerated: boolean;    // High confidence AI-generated
  aiSource?: 'chatgpt' | 'claude' | 'copilot' | 'other' | 'unknown'; // Likely AI source
  patterns: string[];            // Specific patterns detected
  codeQuality: 'excellent' | 'good' | 'fair' | 'needs-improvement'; // Code quality assessment
  bestPractices: {               // Best practices analysis
    follows: string[];           // Best practices followed
    missing: string[];           // Best practices missing
  };
  commonIssues: string[];        // Common AI code issues found
}

/**
 * File type analysis results
 */
export interface FileAnalysis {
  framework: FrameworkType;
  componentType: ComponentType;
  language: 'javascript' | 'typescript' | 'html' | 'unknown';
  stylingApproach: StylingApproach;
  cssPatterns: CssPatternCategory[];
  imports: string[];              // Raw import statements (legacy)
  exports: string[];
  dependencies: string[];         // Basic dependencies list (legacy)
  importAnalysis?: ImportAnalysis; // Enhanced import analysis (TASK-009)
  componentStructure?: ComponentStructure; // Enhanced component structure analysis (TASK-010)
  hasJSX: boolean;
  hasHooks: boolean;
  hasRouting: boolean;
  componentNames: string[];
  entryPoint: boolean;
  analysisTimestamp: string;
}

/**
 * Project analysis aggregated from all files
 */
export interface ProjectAnalysis {
  primaryFramework: FrameworkType;
  componentType: ComponentType;
  hasMultipleFrameworks: boolean;
  totalComponents: number;
  componentNames: string[];
  entryPoints: string[];
  dependencies: string[];
  stylingApproaches: StylingApproach[];
  language?: 'javascript' | 'typescript' | 'html' | 'unknown';
  warnings?: string[];
  analysisComplete: boolean;
  analysisTimestamp: string;
}

/**
 * Individual file metadata within a project
 */
export interface FileMetadata {
  name: string;
  path: string;
  size: number;
  type: string;
  upload_time: string;
  analysis?: FileAnalysis;
}

/**
 * Upload request payload
 */
export interface UploadRequest {
  files: File[];
  project_name?: string;
  description?: string;
}

/**
 * Upload response payload
 */
export interface UploadResponse {
  project_id: string;
  status: ProjectStatus;
  message: string;
  files_uploaded: number;
  analysis?: ProjectAnalysis;
}

/**
 * Paste request payload
 */
export interface PasteRequest {
  content: string;
  project_name?: string;
  description?: string;
}

/**
 * Paste response payload - same format as upload for consistency
 */
export interface PasteResponse {
  project_id: string;
  status: ProjectStatus;
  message: string;
  detected_framework: FrameworkType;
  generated_filename: string;
  analysis?: ProjectAnalysis;
  build_job_id?: string;
  deployment_url?: string;
}

/**
 * File analysis response payload
 */
export interface FileAnalysisResponse {
  project_id: string;
  files: Array<{
    name: string;
    analysis: FileAnalysis;
  }>;
  project_analysis: ProjectAnalysis;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'healthy';
  timestamp: string;
  version: string;
  environment: string;
  services: {
    r2_buckets: {
      projects: boolean;
      builds: boolean;
    };
  };
}

/**
 * Dependency Resolution System Types
 */

/**
 * Dependency version constraint
 */
export interface DependencyVersion {
  name: string;
  version: string;
  range?: string;              // Semver range (^1.0.0, ~2.1.0, >=3.0.0)
  resolvedVersion?: string;    // Specific resolved version
  source: 'exact' | 'latest' | 'compatible' | 'required' | 'peer' | 'inferred';
  confidence: number;          // 0-100 confidence in this version choice
}

/**
 * Dependency conflict information
 */
export interface DependencyConflict {
  package: string;
  requestedVersions: string[];
  recommendedVersion: string;
  conflictType: 'major' | 'minor' | 'peer' | 'breaking';
  severity: 'critical' | 'high' | 'medium' | 'low';
  resolution: 'use-recommended' | 'manual-review' | 'ignore';
  reason?: string;
}

/**
 * Package.json script configuration
 */
export interface PackageScripts {
  dev: string;
  build: string;
  test?: string;
  lint?: string;
  preview?: string;
  type_check?: string;
  [key: string]: string | undefined;
}

/**
 * Build tool configuration suggestions
 */
export interface BuildConfiguration {
  bundler: 'vite' | 'webpack' | 'parcel' | 'rollup' | 'esbuild';
  configFile?: string;
  plugins?: string[];
  devDependencies: DependencyVersion[];
  buildCommand: string;
  devCommand: string;
  outputDirectory: string;
}

/**
 * Framework-specific dependency templates
 */
export interface FrameworkTemplate {
  framework: FrameworkType;
  version: string;              // Framework version (React 18, Vue 3, etc.)
  baseDependencies: DependencyVersion[];
  devDependencies: DependencyVersion[];
  peerDependencies?: DependencyVersion[];
  scripts: PackageScripts;
  buildConfig: BuildConfiguration;
  tsConfig?: Record<string, any>;
  additionalFiles?: { name: string; content: string }[];
}

/**
 * NPM registry package information
 */
export interface PackageRegistryInfo {
  name: string;
  version: string;
  latestVersion: string;
  versions: string[];
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  deprecated?: boolean;
  license?: string;
  description?: string;
  keywords?: string[];
  lastUpdated: string;
}

/**
 * Dependency classification for production vs development
 */
export interface DependencyClassification {
  production: DependencyVersion[];
  development: DependencyVersion[];
  peer: DependencyVersion[];
  optional: DependencyVersion[];
  bundled?: DependencyVersion[];
}

/**
 * Compatibility matrix for framework ecosystems
 */
export interface CompatibilityMatrix {
  framework: FrameworkType;
  version: string;
  compatiblePackages: Record<string, string[]>; // package -> compatible versions
  incompatiblePackages: Record<string, string>; // package -> reason
  recommendedPackages: Record<string, string>; // use case -> recommended package
}

/**
 * Dependency resolution options
 */
export interface DependencyResolutionOptions {
  strategy: 'conservative' | 'latest' | 'compatible' | 'exact';
  allowPrereleases: boolean;
  lockfileStrategy: 'preserve' | 'update' | 'regenerate';
  conflictResolution: 'interactive' | 'automatic' | 'strict';
  includeDevDependencies: boolean;
  includeOptionalDependencies: boolean;
  registryUrl?: string;
  timeout?: number;
}

/**
 * Complete dependency resolution result
 */
export interface DependencyResolutionResult {
  resolved: DependencyClassification;
  conflicts: DependencyConflict[];
  suggestions: DependencySuggestion[];
  packageJson: GeneratedPackageJson;
  buildConfig: BuildConfiguration;
  warnings: string[];
  resolutionTime: number;
  cacheHit: boolean;
}

/**
 * Dependency suggestions and optimizations
 */
export interface DependencySuggestion {
  type: 'upgrade' | 'downgrade' | 'add' | 'remove' | 'replace';
  package: string;
  currentVersion?: string;
  suggestedVersion?: string;
  replacementPackage?: string;
  reason: string;
  impact: 'breaking' | 'minor' | 'patch' | 'none';
  priority: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Generated package.json structure
 */
export interface GeneratedPackageJson {
  name: string;
  version: string;
  type?: 'module' | 'commonjs';
  scripts: PackageScripts;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  engines?: {
    node?: string;
    npm?: string;
  };
  browserslist?: string[];
  packageManager?: string;
  [key: string]: any;
}

/**
 * Dependency resolution request payload
 */
export interface DependencyResolutionRequest {
  projectId: string;
  importAnalysis: ImportAnalysis;
  componentStructure: ComponentStructure;
  framework: FrameworkType;
  options?: Partial<DependencyResolutionOptions>;
  existingPackageJson?: any;
}

/**
 * Dependency resolution response payload
 */
export interface DependencyResolutionResponse {
  projectId: string;
  status: 'success' | 'partial' | 'failed';
  result?: DependencyResolutionResult;
  error?: string;
  timestamp: string;
}

/**
 * Scaffolding Template Generator Types
 */

/**
 * Generated file structure for scaffolded project
 */
export interface ScaffoldedProject {
  files: ScaffoldedFile[];
  packageJson: GeneratedPackageJson;
  framework: FrameworkType;
  buildConfig: BuildConfiguration;
  projectStructure: ProjectStructure;
  entryPoints: EntryPoint[];
}

/**
 * Individual file in scaffolded project
 */
export interface ScaffoldedFile {
  path: string;           // File path relative to project root
  content: string;        // File content
  type: FileType;         // File type classification
  isGenerated: boolean;   // Whether this file was auto-generated
  template: string;       // Template used to generate this file
}

/**
 * File type classification for scaffolding
 */
export type FileType = 
  | 'entry-point'      // main.tsx, main.js, app.js
  | 'html'            // index.html
  | 'config'          // vite.config.ts, tsconfig.json
  | 'style'           // CSS files
  | 'component'       // React/Vue/Svelte components
  | 'documentation'   // README.md
  | 'package';        // package.json

/**
 * Build optimization settings
 */
export interface BuildOptimization {
  minify: boolean;
  sourceMaps: boolean;
  treeshaking: boolean;
  codeSplitting: boolean;
  cssMinification: boolean;
}

/**
 * Build configuration for framework
 */
export interface BuildConfiguration {
  bundler: string;            // vite, webpack, rollup
  configFile: string;         // Configuration file name
  buildCommand: string;       // Build command
  devCommand: string;         // Development server command
  outputDirectory: string;    // Build output directory
  plugins: string[];          // Required plugins
  optimization: BuildOptimization;
}

/**
 * Project structure information
 */
export interface ProjectStructure {
  rootFiles: string[];        // Files in project root
  srcStructure: string[];     // Files in src/ directory
  publicFiles: string[];      // Files in public/ directory
  configFiles: string[];      // Configuration files
  hasTypeScript: boolean;     // Uses TypeScript
  hasCSS: boolean;           // Has styling files
  hasTesting: boolean;       // Has test setup
}

/**
 * Entry point information
 */
export interface EntryPoint {
  framework: FrameworkType;
  fileName: string;           // main.tsx, main.js, etc.
  mountElement: string;       // Root element ID
  imports: string[];          // Required imports
  renderCode: string;         // Code to render the app
}

/**
 * Scaffolding generation options
 */
export interface ScaffoldingOptions {
  includeTypeScript?: boolean;
  includeTesting?: boolean;
  includeLinting?: boolean;
  includeCSS?: boolean;
  optimizeForProduction?: boolean;
  customTemplates?: TemplateOverrides;
  // TASK-014: Add component structure for framework-specific optimizations
  componentStructure?: ComponentStructure;
}

/**
 * Template override configurations
 */
export interface TemplateOverrides {
  [templateName: string]: string;
}

/**
 * Scaffolding generation request
 */
export interface ScaffoldingRequest {
  project_id: string;
  options?: ScaffoldingOptions;
}

/**
 * Scaffolding generation response
 */
export interface ScaffoldingResponse {
  project_id: string;
  scaffolding: ScaffoldedProject;
  framework: FrameworkType;
  optimization_applied: boolean;
  generation_time_ms: number;
  file_count: number;
  ready_for_build: boolean;
}

/**
 * Component Wrapper Generator Types
 */

/**
 * Component wrapper analysis result
 */
export interface ComponentWrapperAnalysis {
  hasProps: boolean;
  propsInterface?: string;
  requiredProps: string[];
  optionalProps: string[];
  needsProviders: string[];      // ['Router', 'ThemeProvider', etc.]
  exportType: 'default' | 'named';
  componentName: string;
  wrapperStrategy: WrapperStrategy;
  sampleProps?: Record<string, any>;
}

/**
 * Strategy for wrapping components
 */
export type WrapperStrategy = 
  | 'simple'           // No props, simple wrapper
  | 'props-required'   // Has required props, needs sample data
  | 'props-optional'   // Only optional props, minimal wrapper
  | 'provider-needed'  // Needs context providers
  | 'complex';         // Complex props + providers

/**
 * Props sample configuration
 */
export interface PropsSampleConfig {
  propName: string;
  propType: string;
  isRequired: boolean;
  sampleValue: any;
  description?: string;
}

/**
 * Provider configuration for wrapping
 */
export interface ProviderConfig {
  name: string;                  // Provider name (Router, ThemeProvider)
  import: string;                // Import statement
  wrapperCode: string;           // JSX wrapper code
  setupCode?: string;           // Additional setup code
  dependencies: string[];        // Required dependencies
}

/**
 * Enhanced App wrapper generation options
 */
export interface AppWrapperOptions {
  componentName: string;
  componentPath: string;
  hasProps: boolean;
  sampleProps?: Record<string, any>;
  providers: ProviderConfig[];
  framework: FrameworkType;
  hasTypeScript: boolean;
}

/**
 * Component wrapper generation result
 */
export interface ComponentWrapperResult {
  appComponent: ScaffoldedFile;
  sampleProps?: PropsSampleConfig[];
  providers: ProviderConfig[];
  imports: string[];
  analysis: ComponentWrapperAnalysis;
}

/**
 * Sample prop generation patterns
 */
export interface PropSamplePattern {
  typePattern: RegExp;
  generator: (propName: string, propType: string) => any;
  description: string;
}

/**
 * Component wrapper generator request
 */
export interface ComponentWrapperRequest {
  project_id: string;
  component_structure: ComponentStructure;
  original_files: FileMetadata[];
  framework: FrameworkType;
  options?: ScaffoldingOptions;
}

/**
 * Component wrapper generator response
 */
export interface ComponentWrapperResponse {
  project_id: string;
  wrapper_analysis: ComponentWrapperAnalysis;
  generated_wrapper: ComponentWrapperResult;
  providers_detected: ProviderConfig[];
  sample_props_count: number;
  wrapper_strategy: WrapperStrategy;
}

/**
 * Build Queue System Types
 */

/**
 * Build job priority levels
 */
export type BuildPriority = 'low' | 'normal' | 'high';

/**
 * Build status states
 */
export type BuildStatusType = 'queued' | 'processing' | 'completed' | 'failed' | 'timeout' | 'cancelled';

/**
 * Build stage progression
 */
export type BuildStage = 'queued' | 'npm-install' | 'build' | 'optimization' | 'cleanup' | 'deployment';

/**
 * Build optimization levels
 */
export type OptimizationLevel = 'development' | 'production';

/**
 * Core build job structure
 */
export interface BuildJob {
  job_id: string; // Unique job identifier for tracking throughout lifecycle
  project_id: string;
  framework: FrameworkType;
  scaffolding_path: string; // R2 path to scaffolded files
  source_files: Record<string, string>; // Source files for the build (filename -> content)
  priority: BuildPriority;
  timeout_seconds: number; // default 120
  build_config?: {
    framework_specific_options?: any;
    optimization_level: OptimizationLevel;
    enable_source_maps: boolean;
  };
  metadata: {
    queued_at: string;
    started_at?: string;
    completed_at?: string;
    build_duration_ms?: number;
    retry_count?: number;
  };
}

/**
 * Build status tracking information
 */
export interface BuildStatus {
  status: BuildStatusType;
  progress: number; // 0-100
  current_stage: BuildStage;
  logs: string[]; // Recent log messages
  error?: {
    stage: string;
    message: string;
    details: any;
  };
  metadata: {
    job_id?: string; // Job ID for tracking (added in TASK-015 fixes)
    queued_at: string;
    started_at?: string;
    completed_at?: string;
    build_duration_ms?: number;
    retry_count?: number;
  };
}

/**
 * Build job options for queue creation
 */
export interface BuildJobOptions {
  priority?: BuildPriority;
  timeout_seconds?: number;
  optimization_level?: OptimizationLevel;
  enable_source_maps?: boolean;
  framework_specific_options?: any;
}

/**
 * Build queue request payload
 */
export interface BuildQueueRequest {
  project_id: string;
  options?: BuildJobOptions;
}

/**
 * Build queue response payload
 */
export interface BuildQueueResponse {
  project_id: string;
  job_id: string;
  status: BuildStatusType;
  estimated_duration_seconds: number;
  position_in_queue?: number;
  message: string;
}

/**
 * Build status request parameters
 */
export interface BuildStatusRequest {
  project_id: string;
  include_logs?: boolean;
  max_log_lines?: number;
}

/**
 * Build status response payload
 */
export interface BuildStatusResponse {
  project_id: string;
  job_id: string;
  build_status: BuildStatus;
  scaffolding_info: {
    framework: FrameworkType;
    file_count: number;
    has_typescript: boolean;
  };
  build_artifacts?: {
    output_path: string;
    size_bytes: number;
    file_count: number;
  };
}

/**
 * Build logs response payload
 */
export interface BuildLogsResponse {
  project_id: string;
  job_id: string;
  logs: {
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    stage: BuildStage;
    message: string;
  }[];
  total_log_count: number;
  has_more_logs: boolean;
}

/**
 * Build cancellation response
 */
export interface BuildCancelResponse {
  project_id: string;
  job_id: string;
  status: 'cancelled' | 'cannot_cancel';
  reason?: string;
  message: string;
}

/**
 * Build Error Handling System Types
 */

/**
 * Build error categories for classification
 */
export type ErrorCategory = 
  | 'syntax'          // TypeScript, JSX, CSS parsing errors
  | 'dependency'      // Missing packages, version conflicts, install failures
  | 'build'           // Vite compilation, minification, bundling errors
  | 'timeout'         // Build process exceeding limits
  | 'infrastructure'  // R2 storage, queue failures
  | 'configuration'   // Invalid build configs, missing files
  | 'unknown';        // Unclassified errors

/**
 * Error severity levels
 */
export type ErrorSeverity = 'critical' | 'error' | 'warning';

/**
 * Error pattern for recognizing common build failures
 */
export interface ErrorPattern {
  pattern: RegExp;
  category: ErrorCategory;
  severity: ErrorSeverity;
  messageTemplate: string;
  suggestions: string[];
  framework?: FrameworkType;
  stage?: BuildStage;
  confidence: number; // 0-100 confidence in pattern match
}

/**
 * Comprehensive build error analysis result
 */
export interface BuildErrorAnalysis {
  category: ErrorCategory;
  severity: ErrorSeverity;
  stage: BuildStage;
  framework: FrameworkType;
  userMessage: string;
  technicalMessage: string;
  suggestions: string[];
  fixable: boolean;
  debugInfo: {
    file?: string;
    line?: number;
    column?: number;
    context?: string;
    originalError: string;
    matchedPattern?: string;
  };
  confidence: number;
  analysisTimestamp: string;
}

/**
 * Error recovery suggestion with priority
 */
export interface ErrorRecoverySuggestion {
  type: 'dependency' | 'config' | 'code' | 'environment' | 'retry';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action?: string;
  command?: string;
  automated: boolean;
  estimatedFixTime: string;
}

/**
 * Error statistics for monitoring and analytics
 */
export interface ErrorStatistics {
  projectId: string;
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsByStage: Record<BuildStage, number>;
  errorsByFramework: Record<FrameworkType, number>;
  commonPatterns: Array<{
    pattern: string;
    count: number;
    category: ErrorCategory;
    lastSeen: string;
  }>;
  resolutionRate: number; // 0-100 percentage of errors that were resolved
  averageFixTime: number; // in milliseconds
}

/**
 * Enhanced build error response
 */
export interface BuildErrorResponse {
  projectId: string;
  jobId: string;
  analysis: BuildErrorAnalysis;
  suggestions: ErrorRecoverySuggestion[];
  canRetry: boolean;
  retryRecommended: boolean;
  debugUrl?: string;
  supportedActions: string[];
  timestamp: string;
}

/**
 * Error analytics request
 */
export interface ErrorAnalyticsRequest {
  projectId?: string;
  timeRange?: {
    start: string;
    end: string;
  };
  category?: ErrorCategory[];
  framework?: FrameworkType[];
  includeResolved?: boolean;
}

/**
 * Error analytics response  
 */
export interface ErrorAnalyticsResponse {
  statistics: ErrorStatistics;
  trends: Array<{
    date: string;
    errorCount: number;
    category: ErrorCategory;
  }>;
  topIssues: Array<{
    pattern: string;
    count: number;
    category: ErrorCategory;
    severity: ErrorSeverity;
    avgResolutionTime: number;
  }>;
  recommendations: string[];
}

/**
 * Deployment Pipeline System Types
 */

/**
 * Deployment status for projects
 */
export type DeploymentStatusType = 'not_deployed' | 'deploying' | 'deployed' | 'failed';

/**
 * Deployment result from deployment process
 */
export interface DeploymentResult {
  success: boolean;
  url: string;
  deploymentId: string;
  timestamp: string;
  filesDeployed: number;
  totalSize: number;
  buildPath: string;
  deploymentPath: string;
  error?: {
    code: string;
    message: string;
    details: any;
  };
}

/**
 * Deployment status information
 */
export interface DeploymentStatus {
  projectId: string;
  status: DeploymentStatusType;
  url?: string;
  deploymentId?: string;
  deployedAt?: string;
  filesDeployed?: number;
  totalSize?: number;
  lastError?: {
    code: string;
    message: string;
    timestamp: string;
  };
}

/**
 * Deployment request body
 */
export interface DeploymentRequest {
  buildId?: string; // Optional specific build ID, defaults to latest
}

/**
 * Deployment response
 */
export interface DeploymentResponse {
  success: boolean;
  data?: DeploymentResult;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

/**
 * Deployment status response
 */
export interface DeploymentStatusResponse {
  success: boolean;
  data: DeploymentStatus;
  timestamp: string;
}

/**
 * Deployment URL response
 */
export interface DeploymentURLResponse {
  success: boolean;
  data: {
    projectId: string;
    url: string | null;
  };
  timestamp: string;
}

/**
 * Remove deployment response
 */
export interface RemoveDeploymentResponse {
  success: boolean;
  data: {
    projectId: string;
    removed: boolean;
  };
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

/**
 * Project Metadata Storage System Types
 */

/**
 * Enhanced project lifecycle states
 */
export type ExtendedProjectStatus = 
  | ProjectStatus
  | 'initializing'   // Project being set up
  | 'archived'       // Project archived but kept
  | 'suspended'      // Temporarily suspended
  | 'migrating';     // Project being migrated

/**
 * Project tags for categorization
 */
export interface ProjectTag {
  id: string;
  name: string;
  color: string;
  description?: string;
  created_at: string;
  created_by: string;
}

/**
 * Project analytics and metrics
 */
export interface ProjectAnalytics {
  views: number;
  deployments: number;
  builds_success: number;
  builds_failed: number;
  last_activity: string;
  average_build_time_ms: number;
  total_uptime_ms: number;
  error_rate: number; // 0-100 percentage
  performance_score: number; // 0-100
  user_engagement: {
    unique_visitors: number;
    page_views: number;
    bounce_rate: number;
    session_duration_avg_ms: number;
  };
  resource_usage: {
    storage_bytes: number;
    bandwidth_bytes: number;
    compute_time_ms: number;
    api_calls: number;
  };
}

/**
 * Framework detection results with confidence scores
 */
export interface FrameworkDetectionResult {
  framework: FrameworkType;
  confidence: number; // 0-100 confidence score
  version?: string; // Detected framework version
  features: string[]; // Framework features used
  compatibility: {
    browser: string[];
    node: string;
    typescript: boolean;
  };
}

/**
 * Build configuration with versioning
 */
export interface ProjectBuildConfig {
  version: string;
  framework_config: FrameworkDetectionResult;
  build_commands: {
    install: string;
    build: string;
    test?: string;
    lint?: string;
  };
  environment_variables: Record<string, string>;
  optimization_settings: {
    minification: boolean;
    tree_shaking: boolean;
    code_splitting: boolean;
    source_maps: boolean;
  };
  target_environment: {
    node_version: string;
    browser_targets: string[];
    module_format: 'esm' | 'cjs' | 'umd';
  };
  custom_settings: Record<string, any>;
}

/**
 * Project metadata versioning information
 */
export interface MetadataVersion {
  version: number;
  schema_version: string;
  created_at: string;
  created_by: string;
  changes: {
    field: string;
    old_value: any;
    new_value: any;
    reason?: string;
  }[];
  migration_applied?: string;
}

/**
 * Enhanced project metadata with comprehensive information
 */
export interface EnhancedProjectMetadata extends ProjectMetadata {
  // Enhanced status and lifecycle
  extended_status: ExtendedProjectStatus;
  status_history: {
    status: ExtendedProjectStatus;
    timestamp: string;
    reason?: string;
    changed_by?: string;
  }[];
  
  // Project organization and discovery
  display_name: string;
  tags: ProjectTag[];
  category: 'prototype' | 'demo' | 'production' | 'experiment' | 'template';
  visibility: 'private' | 'public' | 'shared';
  owner: {
    id: string;
    email?: string;
    username?: string;
  };
  collaborators: string[];
  
  // Enhanced framework and build information
  framework_detection: FrameworkDetectionResult;
  build_config: ProjectBuildConfig;
  dependencies_resolved: DependencyResolutionResult;
  
  // Analytics and performance
  analytics: ProjectAnalytics;
  performance_metrics: {
    last_build_duration_ms: number;
    average_build_duration_ms: number;
    success_rate: number;
    deployment_frequency: number; // deployments per day
    recovery_time_ms: number; // average time to fix failures
  };
  
  // Deployment and infrastructure
  deployment_config: {
    environment: 'development' | 'staging' | 'production';
    custom_domain?: string;
    ssl_enabled: boolean;
    cache_settings: Record<string, any>;
    security_headers: Record<string, string>;
  };
  deployment_history: {
    deployment_id: string;
    url: string;
    deployed_at: string;
    version: string;
    status: 'active' | 'inactive' | 'failed';
    rollback_available: boolean;
  }[];
  
  // Quality and maintenance
  code_quality: {
    complexity_score: number; // 0-100
    maintainability_score: number; // 0-100
    security_score: number; // 0-100
    test_coverage: number; // 0-100 percentage
    documentation_coverage: number; // 0-100 percentage
  };
  
  // Versioning and change tracking
  metadata_version: MetadataVersion;
  version_history: MetadataVersion[];
  
  // Search and indexing
  search_keywords: string[];
  indexed_content: {
    title: string;
    description: string;
    content_hash: string;
    last_indexed: string;
  };
  
  // Extended timestamps and audit
  first_deployed_at?: string;
  last_accessed_at?: string;
  archived_at?: string;
  suspended_at?: string;
  
  // Custom metadata fields
  custom_fields: Record<string, any>;
  
  // System metadata
  system_info: {
    created_by_system: string;
    api_version: string;
    client_version?: string;
    import_source?: 'upload' | 'paste' | 'github' | 'template';
    migration_notes?: string[];
  };
}

/**
 * Metadata search and filtering options
 */
export interface MetadataSearchOptions {
  query?: string; // Full-text search
  framework?: FrameworkType[];
  status?: ExtendedProjectStatus[];
  tags?: string[];
  category?: string[];
  owner?: string[];
  date_range?: {
    field: 'created_at' | 'updated_at' | 'last_deployed_at' | 'last_accessed_at';
    start: string;
    end: string;
  };
  performance_filter?: {
    min_success_rate?: number;
    max_build_time_ms?: number;
    min_quality_score?: number;
  };
  sort_by?: 'created_at' | 'updated_at' | 'name' | 'popularity' | 'performance';
  sort_order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Metadata search results
 */
export interface MetadataSearchResult {
  projects: EnhancedProjectMetadata[];
  total_count: number;
  filtered_count: number;
  facets: {
    frameworks: { framework: FrameworkType; count: number }[];
    statuses: { status: ExtendedProjectStatus; count: number }[];
    tags: { tag: string; count: number }[];
    categories: { category: string; count: number }[];
  };
  search_time_ms: number;
}

/**
 * Metadata validation rules
 */
export interface MetadataValidationRule {
  field: string;
  type: 'required' | 'format' | 'range' | 'enum' | 'custom';
  rule: any;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Metadata validation result
 */
export interface MetadataValidationResult {
  valid: boolean;
  errors: {
    field: string;
    message: string;
    severity: 'error' | 'warning';
    value?: any;
  }[];
  warnings: {
    field: string;
    message: string;
    suggestion?: string;
  }[];
}

/**
 * Metadata update request
 */
export interface MetadataUpdateRequest {
  project_id: string;
  updates: Partial<EnhancedProjectMetadata>;
  reason?: string;
  validate?: boolean;
  create_version?: boolean;
}

/**
 * Metadata update response
 */
export interface MetadataUpdateResponse {
  success: boolean;
  project_id: string;
  updated_fields: string[];
  version: number;
  validation?: MetadataValidationResult;
  error?: {
    type: 'not_found' | 'validation_error' | 'version_conflict' | 'storage_error';
    message: string;
    details?: any;
  };
}

/**
 * Batch metadata operations
 */
export interface BatchMetadataRequest {
  operations: {
    type: 'create' | 'update' | 'delete';
    project_id: string;
    data?: Partial<EnhancedProjectMetadata>;
  }[];
  atomic?: boolean; // All operations succeed or all fail
  validate?: boolean;
}

/**
 * Batch metadata response
 */
export interface BatchMetadataResponse {
  success: boolean;
  results: {
    project_id: string;
    success: boolean;
    error?: string;
  }[];
  total_operations: number;
  successful_operations: number;
  failed_operations: number;
}

/**
 * Project Deletion Types and Interfaces
 */

/**
 * Project deletion types
 */
export type ProjectDeletionType = 'soft' | 'hard';

/**
 * Deletion audit entry
 */
export interface ProjectDeletionAudit {
  deletion_id: string;
  project_id: string;
  project_name: string;
  deletion_type: ProjectDeletionType;
  deletion_reason?: string;
  initiated_by?: string;
  initiated_at: string;
  completed_at?: string;
  recovery_deadline?: string;
  recovery_data?: {
    metadata_backup: EnhancedProjectMetadata;
    storage_locations: string[];
    build_artifacts: string[];
    deployment_urls: string[];
  };
  cleanup_results: {
    metadata_deleted: boolean;
    storage_cleaned: boolean;
    builds_cleaned: boolean;
    deployments_cleaned: boolean;
    search_index_cleaned: boolean;
    total_files_deleted: number;
    total_storage_freed_mb: number;
    cleanup_errors: string[];
  };
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'recovered';
}

/**
 * Project deletion request
 */
export interface ProjectDeletionRequest {
  // Basic deletion parameters
  deletion_type: ProjectDeletionType;
  reason?: string;

  // Advanced deletion options
  options?: {
    preserve_build_logs?: boolean;
    preserve_analytics?: boolean;
    preserve_deployment_history?: boolean;
    schedule_deletion?: string; // ISO date string for scheduled deletion
    recovery_period_days?: number; // Override default recovery period
    force_immediate?: boolean; // Skip soft delete for hard delete
    cleanup_related_data?: boolean; // Clean up shared caches, etc.
  };
  
  // Audit and tracking
  audit_info?: {
    reason_category?: 'user_request' | 'admin_action' | 'maintenance' | 'violation' | 'expiry';
    requested_by?: string;
    approved_by?: string;
    source?: string;
    notes?: string;
  };
}

/**
 * Project deletion response
 */
export interface ProjectDeletionResponse {
  success: boolean;
  project_id: string;
  deletion_id?: string;
  deletion_type: ProjectDeletionType;
  
  // Deletion results
  results?: {
    status: 'deleted' | 'archived' | 'scheduled';
    recovery_deadline?: string;
    cleanup_results: {
      metadata_deleted: boolean;
      storage_cleaned: boolean;
      builds_cleaned: boolean;
      deployments_cleaned: boolean;
      search_index_cleaned: boolean;
      total_files_deleted: number;
      total_storage_freed_mb: number;
    };
  };
  
  // Recovery information (for soft deletes)
  recovery_info?: {
    recovery_deadline: string;
    recovery_token: string;
    recovery_endpoint: string;
    recovery_instructions: string;
  };
  
  // Error information
  error?: {
    type: 'not_found' | 'permission_denied' | 'cleanup_failed' | 'storage_error';
    message: string;
    details?: any;
    failed_cleanups?: string[];
  };
  
  // Performance metrics
  metrics?: {
    operation_duration_ms: number;
    cleanup_duration_ms: number;
    files_processed: number;
    parallel_operations: number;
  };
}

/**
 * Bulk project deletion request
 */
export interface BulkProjectDeletionRequest {
  projects: Array<{
    project_id: string;
    deletion_request: ProjectDeletionRequest;
  }>;

  // Bulk operation options
  options?: {
    atomic?: boolean; // All succeed or all fail
    continue_on_error?: boolean; // Continue even if some deletions fail
    max_parallel?: number; // Maximum parallel deletions
    progress_callback?: boolean; // Enable progress tracking
  };
}

/**
 * Bulk project deletion response
 */
export interface BulkProjectDeletionResponse {
  success: boolean;
  batch_id: string;
  
  // Individual results
  results: Array<{
    project_id: string;
    success: boolean;
    deletion_response?: ProjectDeletionResponse;
    error?: string;
  }>;
  
  // Summary statistics
  summary: {
    total_requested: number;
    successful_deletions: number;
    failed_deletions: number;
    total_files_deleted: number;
    total_storage_freed_mb: number;
    operation_duration_ms: number;
  };
  
  // Recovery information for soft deletes
  recovery_summary?: {
    recoverable_projects: number;
    earliest_recovery_deadline: string;
    latest_recovery_deadline: string;
    batch_recovery_token: string;
  };
}

/**
 * Project recovery request
 */
export interface ProjectRecoveryRequest {
  // Recovery identification
  recovery_token: string;
  project_id?: string; // Optional, can be derived from token
  
  // Recovery options
  options?: {
    restore_to_original_location?: boolean;
    restore_with_new_id?: boolean;
    restore_build_history?: boolean;
    restore_deployment_history?: boolean;
    restore_analytics?: boolean;
  };
  
  // Recovery reason and audit
  recovery_reason?: string;
  requested_by?: string;
}

/**
 * Project recovery response
 */
export interface ProjectRecoveryResponse {
  success: boolean;
  project_id: string;
  original_project_id?: string;
  recovery_id: string;
  
  // Recovery results
  results?: {
    metadata_restored: boolean;
    storage_restored: boolean;
    builds_restored: boolean;
    deployments_restored: boolean;
    search_index_restored: boolean;
    total_files_restored: number;
    total_storage_restored_mb: number;
    integrity_verification?: {
      files_verified: number;
      integrity_failures: number;
      verification_enabled: boolean;
    };
  };
  
  // Error information
  error?: {
    type: 'token_invalid' | 'token_expired' | 'project_not_found' | 'recovery_failed' | 'storage_error';
    message: string;
    details?: any;
  };
  
  // Performance metrics
  metrics?: {
    recovery_duration_ms: number;
    files_processed: number;
  };
  
  // Warnings and issues
  warnings?: string[];
}

/**
 * Deletion schedule entry for scheduled deletions
 */
export interface ScheduledDeletion {
  schedule_id: string;
  project_id: string;
  project_name: string;
  deletion_type: ProjectDeletionType;
  scheduled_for: string;
  created_at: string;
  created_by: string;
  reason?: string;
  status: 'scheduled' | 'executing' | 'completed' | 'cancelled' | 'failed';
  cancellation_deadline?: string;
}

/**
 * Metadata analytics request
 */
export interface MetadataAnalyticsRequest {
  project_ids?: string[];
  time_range?: {
    start: string;
    end: string;
  };
  metrics: ('views' | 'builds' | 'deployments' | 'errors' | 'performance')[];
  granularity?: 'hour' | 'day' | 'week' | 'month';
}

/**
 * Metadata analytics response
 */
export interface MetadataAnalyticsResponse {
  success: boolean;
  data: {
    project_id: string;
    metrics: {
      timestamp: string;
      views?: number;
      builds?: number;
      deployments?: number;
      errors?: number;
      performance_score?: number;
    }[];
  }[];
  summary: {
    total_projects: number;
    total_views: number;
    total_builds: number;
    average_performance: number;
  };
}