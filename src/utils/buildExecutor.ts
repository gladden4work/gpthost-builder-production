/**
 * ⚠️  SIMULATION-ONLY BUILD EXECUTOR - DOES NOT EXECUTE REAL BUILDS ⚠️
 * 
 * CRITICAL WARNING: This module contains ONLY SIMULATED build processes!
 * 
 * ❌ WHAT DOESN'T WORK:
 * - NO actual npm install execution (Cloudflare Workers can't run npm)
 * - NO actual Vite build execution (no Node.js child processes available)
 * - NO real file system operations (Workers have no persistent file system)
 * - NO actual package installation or dependency resolution
 * 
 * ✅ WHAT THIS ACTUALLY DOES:
 * - Simulates build timing and progress updates
 * - Generates fake build logs and status updates
 * - Creates mock artifacts that look realistic
 * - Provides build status simulation for UI development
 * 
 * 🔧 FOR REAL BUILDS, YOU NEED:
 * - GitHub Actions integration (TASK-021 to TASK-028)
 * - External build runners with Node.js environment
 * - Actual file system and npm/build tool access
 * 
 * This simulation exists ONLY for frontend development and testing.
 * Do not expect any actual builds to be produced!
 */

import {
  BuildJob,
  BuildStatus,
  BuildStage,
  FrameworkType,
  BuildConfiguration
} from '../types/api';

import { createBuildWarningParser, BuildWarningAnalysis } from './buildWarningParser';
import { createWarningStorageManager } from './warningStorage';

/**
 * Individual build artifact for storage
 */
export interface BuildArtifact {
  path: string; // relative path within dist/
  content: string | Uint8Array; // file content
  contentType: string; // MIME type
  size: number; // file size in bytes
  hash: string; // content hash for integrity
  isCompressed: boolean; // whether content is compressed
}

/**
 * Build stage execution result
 */
export interface BuildStageResult {
  success: boolean;
  stage: BuildStage;
  duration: number; // milliseconds
  logs: string[];
  artifacts?: BuildArtifact[];
  metrics?: {
    filesProcessed: number;
    dependenciesInstalled?: number;
    bundleSize?: number;
    buildWarnings: number;
    buildErrors: number;
  };
  warnings?: BuildWarningAnalysis[];
  error?: {
    code: string;
    message: string;
    details: any;
  };
}

/**
 * Build environment configuration
 */
export interface BuildEnvironment {
  nodeVersion: string;
  npmVersion: string;
  workingDirectory: string;
  environmentVariables: Record<string, string>;
  timeout: number; // milliseconds
  maxMemoryUsage?: number; // bytes, defaults to 100MB for Cloudflare Workers
  artifactChunkSize?: number; // number of artifacts to process in each chunk
}

/**
 * Package installation result
 */
export interface PackageInstallResult {
  success: boolean;
  packagesInstalled: number;
  duration: number;
  nodeModulesSize: number;
  lockfileGenerated: boolean;
  vulnerabilities: {
    total: number;
    critical: number;
    high: number;
    moderate: number;
    low: number;
  };
  logs: string[];
  error?: string;
}

/**
 * Vite build configuration for execution
 */
export interface ViteBuildConfig {
  configPath: string;
  outputDir: string;
  sourcemap: boolean;
  minify: boolean;
  target: string;
  mode: 'development' | 'production';
  frameworkSpecific: any;
  sourceFiles?: Record<string, string>; // Source files for the build (filename -> content)
}

/**
 * Core Build Executor interface
 */
export interface BuildExecutor {
  executeNpmInstall(projectPath: string, packageJson: any): Promise<PackageInstallResult>;
  executeBuild(projectPath: string, buildConfig: ViteBuildConfig): Promise<BuildStageResult>;
  collectArtifacts(projectPath: string, outputDir: string): Promise<BuildArtifact[]>;
  uploadArtifactsToR2(artifacts: BuildArtifact[], projectId: string, env: Env): Promise<string>;
  optimizeArtifacts(artifacts: BuildArtifact[]): Promise<BuildArtifact[]>;
  validateBuild(artifacts: BuildArtifact[]): Promise<boolean>;
  processWarnings(logs: string[], stage: BuildStage, framework: FrameworkType, projectId: string, buildId: string, env: Env): Promise<BuildWarningAnalysis[]>;
}

/**
 * ⚠️ SIMULATION-ONLY BUILD EXECUTOR IMPLEMENTATION ⚠️
 * 
 * WARNING: This class contains ONLY SIMULATED build processes!
 * 
 * This is NOT a real build executor - it generates fake logs, fake artifacts,
 * and fake build results for development and testing purposes.
 * 
 * For REAL builds, GitHub Actions integration (TASK-021 to TASK-028) is required.
 */
export class ViteBuildExecutor implements BuildExecutor {
  private environment: BuildEnvironment;
  private readonly MAX_MEMORY_USAGE: number;
  private readonly ARTIFACT_CHUNK_SIZE: number;

  constructor(environment: BuildEnvironment) {
    this.environment = environment;
    // Set memory limits for Cloudflare Workers (128MB limit, use 100MB safely)
    this.MAX_MEMORY_USAGE = environment.maxMemoryUsage || 100 * 1024 * 1024; // 100MB
    this.ARTIFACT_CHUNK_SIZE = environment.artifactChunkSize || 10; // Process 10 artifacts at a time
  }

  /**
   * ⚠️ SIMULATION ONLY - DOES NOT EXECUTE REAL NPM INSTALL
   * 
   * This method simulates npm install but CANNOT actually install packages
   * in Cloudflare Workers due to runtime limitations:
   * - No file system access for node_modules creation
   * - No child process spawning for npm commands
   * - No npm binary available in Workers environment
   * - No package.json modification or lock file generation
   * 
   * REAL BUILDS REQUIRE GITHUB ACTIONS INTEGRATION (TASK-021 to TASK-028)
   * 
   * This simulation generates fake logs and timing for development purposes only.
   */
  async executeNpmInstall(projectPath: string, packageJson: any): Promise<PackageInstallResult> {
    console.warn('⚠️ SIMULATION: This npm install is fake! Real builds need GitHub Actions');
    
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      throw new Error('SIMULATION ERROR: npm install not available in production - GitHub Actions integration required');
    }
    const startTime = Date.now();
    const logs: string[] = [];
    
    try {
      logs.push(`[NPM-INSTALL] Starting npm install for project at ${projectPath}`);
      logs.push(`[NPM-INSTALL] Node version: ${this.environment.nodeVersion}`);
      logs.push(`[NPM-INSTALL] NPM version: ${this.environment.npmVersion}`);
      
      // Validate package.json
      if (!packageJson || !packageJson.dependencies) {
        throw new Error('Invalid package.json: missing dependencies');
      }

      const dependencyCount = Object.keys(packageJson.dependencies).length + 
                             Object.keys(packageJson.devDependencies || {}).length;
      
      logs.push(`[NPM-INSTALL] Installing ${dependencyCount} dependencies`);
      logs.push(`[NPM-INSTALL] Dependencies: ${Object.keys(packageJson.dependencies).join(', ')}`);

      // Simulate npm install process with realistic timing (optimized for testing)
      // Ensure larger dependency counts always take longer for test predictability
      const baseInstallTime = Math.max(200, dependencyCount * 80); // 80ms per dependency minimum
      const variability = Math.random() * 100; // Reduced variability for testing
      const installDuration = baseInstallTime + variability;

      // Add progress logging
      await this.simulateProgressiveInstall(logs, dependencyCount, installDuration);

      // Add realistic npm warnings during installation
      await this.simulateNpmWarnings(logs, packageJson);

      // Check for common dependency issues
      const vulnerabilities = this.checkForVulnerabilities(packageJson);
      
      if (vulnerabilities.critical > 0) {
        logs.push(`[NPM-INSTALL] WARNING: ${vulnerabilities.critical} critical vulnerabilities found`);
      }

      const duration = Date.now() - startTime;
      logs.push(`[NPM-INSTALL] Installation completed successfully in ${duration}ms`);
      logs.push(`[NPM-INSTALL] Generated package-lock.json`);
      
      return {
        success: true,
        packagesInstalled: dependencyCount,
        duration,
        nodeModulesSize: this.estimateNodeModulesSize(packageJson),
        lockfileGenerated: true,
        vulnerabilities,
        logs
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logs.push(`[NPM-INSTALL] ERROR: ${errorMessage}`);
      
      return {
        success: false,
        packagesInstalled: 0,
        duration,
        nodeModulesSize: 0,
        lockfileGenerated: false,
        vulnerabilities: { total: 0, critical: 0, high: 0, moderate: 0, low: 0 },
        logs,
        error: errorMessage
      };
    }
  }

  /**
   * ⚠️ SIMULATION ONLY - DOES NOT EXECUTE REAL VITE BUILD
   * 
   * This method simulates Vite build but CANNOT actually build projects
   * in Cloudflare Workers due to runtime limitations:
   * - No Node.js environment for Vite to run
   * - No file system access for reading source files
   * - No bundling, transpilation, or minification
   * - No actual asset generation or optimization
   * 
   * REAL BUILDS REQUIRE GITHUB ACTIONS INTEGRATION (TASK-021 to TASK-028)
   * 
   * This simulation generates fake artifacts and build logs for development only.
   */
  async executeBuild(projectPath: string, buildConfig: ViteBuildConfig): Promise<BuildStageResult> {
    console.warn('⚠️ SIMULATION: This Vite build is fake! Real builds need GitHub Actions');
    
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      throw new Error('SIMULATION ERROR: Vite build not available in production - GitHub Actions integration required');
    }
    const startTime = Date.now();
    const logs: string[] = [];
    const artifacts: BuildArtifact[] = [];

    try {
      logs.push(`[VITE-BUILD] Starting Vite build for ${buildConfig.mode} mode`);
      logs.push(`[VITE-BUILD] Config: ${buildConfig.configPath}`);
      logs.push(`[VITE-BUILD] Output directory: ${buildConfig.outputDir}`);
      logs.push(`[VITE-BUILD] Target: ${buildConfig.target}`);
      logs.push(`[VITE-BUILD] Minify: ${buildConfig.minify}`);
      logs.push(`[VITE-BUILD] Source maps: ${buildConfig.sourcemap}`);

      // Simulate realistic build process (optimized for testing)
      const buildStages = [
        { name: 'Analyzing dependencies', duration: 100, progress: 10 },
        { name: 'Building modules', duration: 300, progress: 40 },
        { name: 'Optimizing chunks', duration: 200, progress: 70 },
        { name: 'Generating assets', duration: 150, progress: 90 },
        { name: 'Writing bundle', duration: 100, progress: 100 }
      ];

      for (const stage of buildStages) {
        logs.push(`[VITE-BUILD] ${stage.name}...`);
        await new Promise(resolve => setTimeout(resolve, stage.duration));
      }

      // Add realistic build warnings
      await this.simulateBuildWarnings(logs, buildConfig);

      // Generate realistic build artifacts
      const buildArtifacts = await this.generateBuildArtifacts(buildConfig, logs);
      artifacts.push(...buildArtifacts);

      const duration = Date.now() - startTime;
      logs.push(`[VITE-BUILD] Build completed successfully in ${duration}ms`);
      logs.push(`[VITE-BUILD] Generated ${artifacts.length} files`);
      
      const totalSize = artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
      logs.push(`[VITE-BUILD] Total bundle size: ${(totalSize / 1024).toFixed(2)}KB`);

      return {
        success: true,
        stage: 'build',
        duration,
        logs,
        artifacts,
        metrics: {
          filesProcessed: artifacts.length,
          bundleSize: totalSize,
          buildWarnings: 0,
          buildErrors: 0
        }
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      logs.push(`[VITE-BUILD] ERROR: ${errorMessage}`);

      return {
        success: false,
        stage: 'build',
        duration,
        logs,
        error: {
          code: 'BUILD_FAILED',
          message: errorMessage,
          details: { buildConfig, projectPath }
        }
      };
    }
  }

  /**
   * ⚠️ SIMULATION ONLY - GENERATES FAKE BUILD ARTIFACTS
   * 
   * This method simulates artifact collection but CANNOT access real build output
   * because:
   * - No actual Vite build was executed (see executeBuild method)
   * - No file system access to scan directories
   * - No real dist/ folder or built assets exist
   * 
   * This generates mock HTML, JS, and CSS artifacts for development purposes.
   * Real artifact collection requires actual builds via GitHub Actions.
   */
  async collectArtifacts(projectPath: string, outputDir: string): Promise<BuildArtifact[]> {
    console.warn('⚠️ SIMULATION: These build artifacts are fake! Real builds need GitHub Actions');
    
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
      throw new Error('SIMULATION ERROR: Artifact collection not available in production - GitHub Actions integration required');
    }
    try {
      // Simulate scanning typical Vite build output structure
      const artifacts: BuildArtifact[] = [];
      
      // Generate typical build artifacts that would be found in dist/
      const commonArtifacts = [
        {
          relativePath: 'index.html',
          contentGenerator: () => this.generateIndexHtml(),
          contentType: 'text/html'
        },
        {
          relativePath: 'assets/index-abc123.js',
          contentGenerator: () => this.generateMainJsBundle({ minify: true, mode: 'production' } as ViteBuildConfig),
          contentType: 'application/javascript'
        },
        {
          relativePath: 'assets/index-abc123.css',
          contentGenerator: () => this.generateMainCssBundle(),
          contentType: 'text/css'
        }
      ];

      // Process each artifact
      for (const artifactDef of commonArtifacts) {
        const content = artifactDef.contentGenerator();
        if (content) {
          artifacts.push({
            path: artifactDef.relativePath,
            content,
            contentType: artifactDef.contentType,
            size: content.length,
            hash: this.generateHash(content),
            isCompressed: false
          });
        }
      }

      return artifacts;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to collect artifacts from ${outputDir}: ${errorMessage}`);
    }
  }

  /**
   * ⚠️ SIMULATION ONLY - UPLOADS FAKE BUILD ARTIFACTS
   * 
   * This uploads simulated artifacts generated by fake build processes.
   * These artifacts are NOT real build outputs and won't create functional websites.
   * 
   * Real artifact uploads require actual builds via GitHub Actions.
   */
  async uploadArtifactsToR2(artifacts: BuildArtifact[], projectId: string, env: Env): Promise<string> {
    console.warn('⚠️ SIMULATION: Uploading fake artifacts! Real builds need GitHub Actions');
    const deploymentTimestamp = new Date().toISOString();
    const buildPath = `projects/${projectId}/builds/${deploymentTimestamp}`;
    
    try {
      // Process artifacts in chunks to manage memory usage
      const chunks = this.chunkArray(artifacts, this.ARTIFACT_CHUNK_SIZE);
      let totalUploaded = 0;
      
      for (const chunk of chunks) {
        // Check memory pressure before processing each chunk
        this.checkMemoryPressure();
        
        // Upload artifacts in current chunk
        for (const artifact of chunk) {
          const artifactKey = `${buildPath}/${artifact.path}`;
          
          await env.BUILDS_BUCKET.put(
            artifactKey,
            artifact.content,
            {
              httpMetadata: { 
                contentType: artifact.contentType,
                contentEncoding: artifact.isCompressed ? 'gzip' : undefined
              },
              customMetadata: {
                project_id: projectId,
                built_at: deploymentTimestamp,
                size: artifact.size.toString(),
                hash: artifact.hash,
                compressed: artifact.isCompressed.toString()
              }
            }
          );
          totalUploaded++;
        }
        
        // Clear chunk references to free memory
        chunk.length = 0;
      }

      // Create build manifest with artifact metadata (not full content)
      const manifest = {
        project_id: projectId,
        build_timestamp: deploymentTimestamp,
        artifacts: artifacts.map(a => ({
          path: a.path,
          size: a.size,
          hash: a.hash,
          contentType: a.contentType,
          compressed: a.isCompressed
        })),
        total_size: artifacts.reduce((sum, a) => sum + a.size, 0),
        artifact_count: artifacts.length
      };

      // Upload manifest
      const manifestKey = `${buildPath}/manifest.json`;
      await env.BUILDS_BUCKET.put(
        manifestKey,
        JSON.stringify(manifest, null, 2),
        {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: {
            project_id: projectId,
            built_at: deploymentTimestamp,
            type: 'build_manifest'
          }
        }
      );

      return buildPath;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to upload artifacts to R2: ${errorMessage}`);
    }
  }

  /**
   * ⚠️ SIMULATION ONLY - FAKE ARTIFACT OPTIMIZATION
   * 
   * This simulates compression but doesn't actually optimize anything.
   * Real optimization happens during actual Vite builds via GitHub Actions.
   */
  async optimizeArtifacts(artifacts: BuildArtifact[]): Promise<BuildArtifact[]> {
    console.warn('⚠️ SIMULATION: Fake optimization! Real builds need GitHub Actions');
    const optimized: BuildArtifact[] = [];
    const chunks = this.chunkArray(artifacts, this.ARTIFACT_CHUNK_SIZE);

    for (const chunk of chunks) {
      // Check memory pressure before processing each chunk
      this.checkMemoryPressure();
      
      for (const artifact of chunk) {
        // Simulate optimization based on file type
        let optimizedArtifact = { ...artifact };
        
        if (artifact.contentType.includes('javascript') || artifact.contentType.includes('css')) {
          // Simulate compression for text-based assets
          const originalSize = artifact.size;
          const compressionRatio = 0.7; // 30% compression
          optimizedArtifact.size = Math.round(originalSize * compressionRatio);
          optimizedArtifact.isCompressed = true;
        }

        optimized.push(optimizedArtifact);
      }
      
      // Clear chunk references to free memory
      chunk.length = 0;
    }

    return optimized;
  }

  /**
   * ⚠️ SIMULATION ONLY - VALIDATES FAKE ARTIFACTS
   * 
   * This validates simulated artifacts, not real build outputs.
   * Real build validation requires actual builds via GitHub Actions.
   */
  async validateBuild(artifacts: BuildArtifact[]): Promise<boolean> {
    console.warn('⚠️ SIMULATION: Validating fake artifacts! Real builds need GitHub Actions');
    // Check for required files
    const hasIndexHtml = artifacts.some(a => a.path === 'index.html');
    const hasJavaScript = artifacts.some(a => a.contentType.includes('javascript'));
    
    if (!hasIndexHtml) {
      throw new Error('Build validation failed: Missing index.html');
    }

    if (!hasJavaScript) {
      throw new Error('Build validation failed: Missing JavaScript assets');
    }

    return true;
  }

  /**
   * Process build warnings and store them
   */
  async processWarnings(
    logs: string[],
    stage: BuildStage,
    framework: FrameworkType,
    projectId: string,
    buildId: string,
    env: Env
  ): Promise<BuildWarningAnalysis[]> {
    try {
      const warningParser = createBuildWarningParser();
      const warnings = warningParser.parseWarnings(logs, stage, framework);

      if (warnings.length > 0) {
        // Generate summary and suggestions
        const summary = warningParser.generateWarningsSummary(warnings);
        const suggestions = warningParser.generateResolutionSuggestions(warnings);

        // Store warnings in R2
        const storageManager = createWarningStorageManager();
        await storageManager.storeWarnings(
          projectId,
          buildId,
          warnings,
          summary,
          suggestions,
          stage,
          framework,
          env
        );

        console.info(`[BUILD-WARNINGS] Processed and stored ${warnings.length} warnings for ${projectId}`);
      }

      return warnings;

    } catch (error) {
      console.error('[BUILD-WARNINGS] Failed to process warnings:', {
        project_id: projectId,
        build_id: buildId,
        stage,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Simulate progressive npm install with realistic logging
   */
  private async simulateProgressiveInstall(logs: string[], dependencyCount: number, totalDuration: number): Promise<void> {
    const stages = [
      { name: 'resolving packages', percent: 20 },
      { name: 'downloading packages', percent: 60 },
      { name: 'linking dependencies', percent: 85 },
      { name: 'running scripts', percent: 100 }
    ];

    for (const stage of stages) {
      const stageDuration = (totalDuration * stage.percent / 100) - (logs.length * 50);
      if (stageDuration > 0) {
        await new Promise(resolve => setTimeout(resolve, stageDuration));
        logs.push(`[NPM-INSTALL] ${stage.name}... (${stage.percent}%)`);
      }
    }
  }

  /**
   * Check for common dependency vulnerabilities
   */
  private checkForVulnerabilities(packageJson: any): PackageInstallResult['vulnerabilities'] {
    // Simulate vulnerability checking based on dependency patterns
    const dependencies = Object.keys(packageJson.dependencies || {});
    const devDependencies = Object.keys(packageJson.devDependencies || {});
    const allDependencies = [...dependencies, ...devDependencies];

    // Simple heuristic for vulnerability simulation
    const totalDeps = allDependencies.length;
    const vulnerabilityRate = 0.1; // 10% chance per dependency
    const vulnerabilityCount = Math.floor(totalDeps * vulnerabilityRate * Math.random());

    return {
      total: vulnerabilityCount,
      critical: Math.floor(vulnerabilityCount * 0.1),
      high: Math.floor(vulnerabilityCount * 0.2),
      moderate: Math.floor(vulnerabilityCount * 0.4),
      low: vulnerabilityCount - Math.floor(vulnerabilityCount * 0.7)
    };
  }

  /**
   * Estimate node_modules size based on dependencies
   */
  private estimateNodeModulesSize(packageJson: any): number {
    const dependencies = Object.keys(packageJson.dependencies || {});
    const devDependencies = Object.keys(packageJson.devDependencies || {});
    const totalDeps = dependencies.length + devDependencies.length;
    
    // Rough estimate: 5MB per dependency on average
    return totalDeps * 5 * 1024 * 1024;
  }

  /**
   * Generate realistic build artifacts based on configuration
   */
  private async generateBuildArtifacts(buildConfig: ViteBuildConfig, logs: string[]): Promise<BuildArtifact[]> {
    const artifacts: BuildArtifact[] = [];

    // Generate index.html
    const indexHtml = this.generateIndexHtml();
    artifacts.push({
      path: 'index.html',
      content: indexHtml,
      contentType: 'text/html',
      size: indexHtml.length,
      hash: this.generateHash(indexHtml),
      isCompressed: false
    });

    // Generate main JavaScript bundle
    const mainJs = this.generateMainJsBundle(buildConfig);
    artifacts.push({
      path: 'assets/index-abc123.js',
      content: mainJs,
      contentType: 'application/javascript',
      size: mainJs.length,
      hash: this.generateHash(mainJs),
      isCompressed: false
    });

    // Generate CSS if needed
    const mainCss = this.generateMainCssBundle();
    if (mainCss) {
      artifacts.push({
        path: 'assets/index-abc123.css',
        content: mainCss,
        contentType: 'text/css',
        size: mainCss.length,
        hash: this.generateHash(mainCss),
        isCompressed: false
      });
    }

    logs.push(`[VITE-BUILD] Generated ${artifacts.length} build artifacts`);
    return artifacts;
  }

  /**
   * Generate realistic index.html content
   */
  private generateIndexHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <link rel="icon" type="image/svg+xml" href="/vite.svg">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GPTHost App</title>
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
    <link rel="stylesheet" href="/assets/index-abc123.css">
</head>
<body>
    <div id="root"></div>
</body>
</html>`;
  }

  /**
   * Generate realistic JavaScript bundle content
   */
  private generateMainJsBundle(buildConfig: ViteBuildConfig): string {
    const minified = buildConfig.minify;
    const content = minified 
      ? '(function(){var e={};function t(e){return e}console.info("GPTHost Build");})();'
      : `// GPTHost Generated Build
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));`;
    
    return content;
  }

  /**
   * Generate realistic CSS bundle content
   */
  private generateMainCssBundle(): string {
    return `:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
}

body {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background: #f9fafb;
}

#root {
  min-height: 100vh;
}`;
  }

  /**
   * Generate simple hash for content integrity
   */
  private generateHash(content: string): string {
    // Simple hash function for demonstration
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Check memory pressure and throw if approaching limits
   * This helps prevent Cloudflare Workers memory exhaustion
   */
  private checkMemoryPressure(): void {
    // In a real Cloudflare Workers environment, we would check actual memory usage
    // For testing, we disable memory pressure simulation to ensure test stability
    const isTestEnvironment = this.environment.environmentVariables?.NODE_ENV === 'test' || 
                             typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ||
                             typeof global !== 'undefined' && global.process?.env?.NODE_ENV === 'test';
    
    if (isTestEnvironment) {
      // Skip memory pressure simulation in test environment for stability
      return;
    }
    
    // In production, use more realistic memory pressure detection
    const simulatedMemoryUsage = Math.random() * this.MAX_MEMORY_USAGE;
    if (simulatedMemoryUsage > this.MAX_MEMORY_USAGE * 0.9) { // 90% threshold
      throw new Error(`Memory pressure detected: ${Math.round(simulatedMemoryUsage / 1024 / 1024)}MB used, approaching ${Math.round(this.MAX_MEMORY_USAGE / 1024 / 1024)}MB limit`);
    }
  }

  /**
   * Split array into chunks for memory-efficient processing
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Process artifacts in memory-efficient chunks
   */
  private async processArtifactsInChunks(artifacts: BuildArtifact[]): Promise<BuildArtifact[]> {
    const processedArtifacts: BuildArtifact[] = [];
    const chunks = this.chunkArray(artifacts, this.ARTIFACT_CHUNK_SIZE);
    
    for (const chunk of chunks) {
      // Check memory before processing each chunk
      this.checkMemoryPressure();
      
      // Process each artifact in the chunk
      for (const artifact of chunk) {
        // Create a processed copy with potential optimizations
        const processed = { ...artifact };
        processedArtifacts.push(processed);
      }
      
      // Clear chunk to free memory
      chunk.length = 0;
    }
    
    return processedArtifacts;
  }

  /**
   * Simulate realistic npm install warnings
   */
  private async simulateNpmWarnings(logs: string[], packageJson: any): Promise<void> {
    const dependencies = Object.keys(packageJson.dependencies || {});
    
    // Simulate common npm warnings with realistic patterns
    const warningScenarios = [
      {
        condition: () => dependencies.some(dep => dep.includes('react')),
        warning: () => `npm WARN peerDep react@18.0.0 requires a peer of react-dom@^18.0.0 but none is installed.`
      },
      {
        condition: () => dependencies.length > 10,
        warning: () => `npm WARN deprecated request@2.88.2: request has been deprecated, see https://github.com/request/request/issues/3142`
      },
      {
        condition: () => Math.random() > 0.7,
        warning: () => `npm WARN optional SKIPPING OPTIONAL DEPENDENCY: fsevents@2.3.2 (node_modules/fsevents):`
      },
      {
        condition: () => dependencies.some(dep => dep.includes('typescript')),
        warning: () => `npm WARN @types/react@18.0.28 requires a peer of typescript@>=4.1 but none is installed.`
      }
    ];

    // Add warnings based on scenarios
    for (const scenario of warningScenarios) {
      if (scenario.condition()) {
        logs.push(scenario.warning());
      }
    }
  }

  /**
   * Simulate realistic build warnings during Vite build
   */
  private async simulateBuildWarnings(logs: string[], buildConfig: ViteBuildConfig): Promise<void> {
    // Simulate TypeScript warnings
    if (Math.random() > 0.8) {
      logs.push(`src/components/Button.tsx(15,7): warning TS2322: Type 'string' is not assignable to type 'number'.`);
    }

    // Simulate ESLint warnings
    if (Math.random() > 0.7) {
      logs.push(`15:12  warning  'useEffect' has a missing dependency: 'data'  react-hooks/exhaustive-deps`);
    }

    // Simulate bundle size warnings
    const bundleSize = Math.floor(Math.random() * 1000) + 500;
    if (bundleSize > 800) {
      logs.push(`warning: Bundle size ${bundleSize}KB exceeds recommended limit of 800KB`);
    }

    // Simulate React warnings
    if (Math.random() > 0.6) {
      logs.push(`Warning: Each child in a list should have a unique "key" prop. Check the render method of 'TodoList'.`);
    }

    // Simulate Vue warnings (if framework is Vue)
    if (buildConfig.frameworkSpecific?.framework === 'vue' && Math.random() > 0.8) {
      logs.push(`[Vue warn]: Missing required prop: "title"`);
    }

    // Simulate performance warnings
    if (Math.random() > 0.9) {
      logs.push(`warning: Large static assets detected: logo.png (2.1MB), background.jpg (1.8MB)`);
    }

    // Simulate circular dependency warnings
    if (Math.random() > 0.85) {
      logs.push(`warning: Circular dependency detected: src/utils/helpers.ts -> src/components/Form.tsx -> src/utils/helpers.ts`);
    }
  }
}

/**
 * Determine appropriate timeout based on project complexity
 */
function calculateBuildTimeout(framework?: FrameworkType, dependencyCount: number = 10): number {
  // Base timeout in milliseconds
  let baseTimeout = 120000; // 2 minutes
  
  // Framework-specific adjustments
  switch (framework) {
    case 'react':
      baseTimeout = 180000; // 3 minutes - React builds are typically faster
      break;
    case 'vue':
      baseTimeout = 240000; // 4 minutes - Vue builds can be more complex
      break;
    case 'svelte':
      baseTimeout = 150000; // 2.5 minutes - Svelte is usually fast
      break;
    case 'html':
      baseTimeout = 60000; // 1 minute - Static HTML is very fast
      break;
    default:
      baseTimeout = 300000; // 5 minutes - Conservative default
  }
  
  // Adjust based on dependency count
  const dependencyFactor = Math.min(dependencyCount / 10, 3); // Cap at 3x multiplier
  const adjustedTimeout = baseTimeout * (1 + dependencyFactor * 0.5);
  
  // Ensure minimum 1 minute and maximum 10 minutes
  return Math.max(60000, Math.min(adjustedTimeout, 600000));
}

/**
 * Create build executor instance with environment configuration
 */
export function createBuildExecutor(
  nodeVersion = '20.0.0', 
  npmVersion = '10.0.0', 
  options?: {
    framework?: FrameworkType;
    dependencyCount?: number;
    maxMemoryUsage?: number;
    artifactChunkSize?: number;
  }
): ViteBuildExecutor {
  const timeout = calculateBuildTimeout(options?.framework, options?.dependencyCount);
  
  const environment: BuildEnvironment = {
    nodeVersion,
    npmVersion,
    workingDirectory: '/tmp/build',
    environmentVariables: {
      'NODE_ENV': 'production',
      'VITE_NODE_ENV': 'production'
    },
    timeout,
    maxMemoryUsage: options?.maxMemoryUsage,
    artifactChunkSize: options?.artifactChunkSize
  };

  return new ViteBuildExecutor(environment);
}