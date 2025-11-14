/**
 * Main router for GPTHost API
 * Handles routing logic and delegates to appropriate handlers
 */

import { healthHandler } from './health';
import { testR2Handler, messageHandler, randomHandler } from './test';
import { uploadHandler } from './upload';
import { pasteHandler } from './paste';
import { debugR2StructureHandler } from './debug';
import { buildQueueHandler } from '../handlers/buildQueue';
import { buildStatusHandler, buildLogsHandler } from '../handlers/buildStatus';
import { deploymentHandler } from '../handlers/deployment';
import { getProjectAnalysisHandler, getProjectsSummaryHandler, reanalyzeProjectHandler, getProjectDependenciesHandler, getProjectComponentsHandler } from './analysis';
import { 
  handleDependencyResolution,
  handleFrameworkTemplate,
  handleConflictAnalysis,
  handlePeerInference,
  handlePackageJsonValidation,
  handleDependencyRecommendations
} from './dependencies';
import {
  generateScaffoldingHandler,
  getScaffoldingStatusHandler,
  getScaffoldingFilesHandler,
  regenerateScaffoldingHandler,
  getScaffoldingPreviewHandler
} from './scaffolding';
import {
  analyzeComponentWrapperHandler,
  generateComponentWrapperHandler,
  generatePropsHandler,
  componentWrapperDemoHandler
} from './componentWrapperHandlers';
import {
  getBuildErrorAnalysis,
  getBuildErrorHistory,
  getBuildErrorAnalytics,
  retryBuildWithErrorAnalysis
} from './buildErrors';
import {
  getProjectWarnings,
  getWarningHistory,
  getWarningAnalytics,
  getBuildWarnings,
  clearWarnings,
  getGlobalWarningAnalytics
} from './buildWarnings';
import {
  deployProjectHandler,
  getDeploymentStatusHandler,
  getDeploymentURLHandler,
  removeDeploymentHandler,
  listProjectBuildsHandler,
  deploymentHealthHandler
} from './deployment';
import { handleSiteRouting, handleSpecialFiles } from './siteRouting';
import { manualBuildHandler } from './manualBuild';
import {
  validateGitHubTokenHandler,
  setupGitHubRepositoryHandler,
  getGitHubRepositoryStatusHandler,
  triggerGitHubTestBuildHandler,
  githubBuildCallbackHandler,
  listGitHubWorkflowsHandler
} from './github';
import {
  getProjectStatusHandler,
  getProjectStatusStreamHandler,
  startProjectStatusTrackingHandler,
  stopProjectStatusTrackingHandler,
  getStatusTrackingStatsHandler,
  triggerProjectStatusPollHandler
} from './buildStatus';
import {
  listProjectsHandler,
  createProjectHandler,
  getProjectStatusHandler as getMultiProjectStatusHandler,
  triggerCleanupHandler,
  getRepositoryHealthHandler,
  backfillProjectOwnerHandler
} from './projects';
import {
  listR2BucketsHandler,
  findBuildArtifactsHandler,
  testR2AccessHandler,
  forceDeployHandler
} from './r2Debug';
import {
  getEnhancedMetadataHandler,
  updateEnhancedMetadataHandler,
  deleteEnhancedMetadataHandler,
  searchEnhancedMetadataHandler,
  batchEnhancedMetadataHandler,
  getMetadataAnalyticsHandler,
  getMetadataVersionHistoryHandler,
  getMetadataHealthHandler,
  handleMetadataOptionsRequest,
  migrateProjectsHandler,
  getMigrationStatsHandler,
  normalizeUrlsHandler
} from './enhancedMetadata';
import {
  projectListHandler,
  projectListOptionsHandler,
  projectBulkHandler,
  projectBulkOptionsHandler
} from './projectsList';
import {
  updateProjectHandler,
  patchProjectHandler,
  bulkUpdateProjectsHandler,
  projectUpdateOptionsHandler,
  bulkUpdateOptionsHandler
} from './projectUpdate';
import {
  deleteProjectHandler as deleteProjectHandlerFromDelete,
  deleteProjectOptionsHandler,
  bulkDeleteProjectsHandler,
  bulkDeleteOptionsHandler,
  recoverProjectHandler,
  recoverProjectOptionsHandler,
  listDeletedProjectsHandler,
  listDeletedProjectsOptionsHandler,
  getDeletionAuditsHandler,
  getDeletionAuditsOptionsHandler
} from './projectDelete';
import { corsResponse, errorResponse, simpleErrorResponse } from '../utils/responses';
import { authMiddleware } from '../middleware/auth';
import { rateLimitMiddleware, addRateLimitHeadersToResponse } from '../middleware/rateLimit';
import { requireJsonContentType } from '../middleware/requestValidation';
import { routeV2Api } from './api/v2';
import { withCors, addCorsHeaders } from '../middleware/cors';
import { ServiceFactory } from '../services/ServiceFactory';
import type { AuthenticatedRequest } from '../utils/authUtils';
// SECURITY FIX (Week 2): Import new security middlewares
import { globalRateLimitMiddleware, addRateLimitHeaders } from '../middleware/globalRateLimit';
import { addSecurityHeaders } from '../middleware/securityHeaders';

export type RouteHandler = (request: Request, env: Env) => Promise<Response>;

interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

/**
 * Route definitions for the GPTHost API
 */
const routes: Route[] = [
  // API Routes
  { method: 'GET', path: '/api/health', handler: healthHandler },
  { method: 'POST', path: '/api/upload', handler: uploadHandler },
  { method: 'POST', path: '/api/paste', handler: pasteHandler },
  
  // Analysis Routes
  { method: 'GET', path: '/api/analysis/projects/summary', handler: getProjectsSummaryHandler },
  
  // Test Routes (should be removed in production)
  { method: 'GET', path: '/test-r2', handler: testR2Handler },
  { method: 'GET', path: '/message', handler: messageHandler },
  { method: 'GET', path: '/random', handler: randomHandler },

  // NOTE: Debug routes (/api/debug/*) are registered conditionally in router()
  // based on ENABLE_DEBUG_ENDPOINTS flag for security (see Phase 2.3 implementation)

  // TASK-028: Multi-Project Management Routes
  { method: 'GET', path: '/api/projects', handler: listProjectsHandler },
  { method: 'POST', path: '/api/projects', handler: createProjectHandler },
  { method: 'POST', path: '/api/projects/cleanup', handler: triggerCleanupHandler },
  { method: 'POST', path: '/api/projects/backfill-owner', handler: backfillProjectOwnerHandler },
  { method: 'GET', path: '/api/projects/health', handler: getRepositoryHealthHandler },

  // TASK-032: Enhanced Project List API Routes
  { method: 'GET', path: '/api/projects/list', handler: projectListHandler },
  { method: 'OPTIONS', path: '/api/projects/list', handler: projectListOptionsHandler },
  { method: 'POST', path: '/api/projects/bulk', handler: projectBulkHandler },
  { method: 'OPTIONS', path: '/api/projects/bulk', handler: projectBulkOptionsHandler },

  // TASK-034: Project Update API Routes
  { method: 'POST', path: '/api/projects/bulk-update', handler: bulkUpdateProjectsHandler },
  { method: 'OPTIONS', path: '/api/projects/bulk-update', handler: bulkUpdateOptionsHandler },

  // TASK-035: Project Delete API Routes
  { method: 'DELETE', path: '/api/projects/bulk', handler: bulkDeleteProjectsHandler },
  { method: 'OPTIONS', path: '/api/projects/bulk', handler: bulkDeleteOptionsHandler },
  { method: 'GET', path: '/api/projects/deleted', handler: listDeletedProjectsHandler },
  { method: 'OPTIONS', path: '/api/projects/deleted', handler: listDeletedProjectsOptionsHandler },
  { method: 'GET', path: '/api/projects/deletion-audits', handler: getDeletionAuditsHandler },
  { method: 'OPTIONS', path: '/api/projects/deletion-audits', handler: getDeletionAuditsOptionsHandler },

  // TASK-031: Enhanced Metadata Management Routes
  { method: 'POST', path: '/api/metadata/search', handler: searchEnhancedMetadataHandler },
  { method: 'POST', path: '/api/metadata/batch', handler: batchEnhancedMetadataHandler },
  { method: 'POST', path: '/api/metadata/analytics', handler: getMetadataAnalyticsHandler },
  { method: 'GET', path: '/api/metadata/health', handler: getMetadataHealthHandler },
  { method: 'POST', path: '/api/metadata/migrate', handler: migrateProjectsHandler },
  { method: 'GET', path: '/api/metadata/migration/stats', handler: getMigrationStatsHandler },
  { method: 'POST', path: '/api/metadata/normalize-urls', handler: normalizeUrlsHandler },
  { method: 'OPTIONS', path: '/api/metadata/search', handler: handleMetadataOptionsRequest },
  { method: 'OPTIONS', path: '/api/metadata/batch', handler: handleMetadataOptionsRequest },
  { method: 'OPTIONS', path: '/api/metadata/analytics', handler: handleMetadataOptionsRequest },
  { method: 'OPTIONS', path: '/api/metadata/migrate', handler: handleMetadataOptionsRequest },
  { method: 'OPTIONS', path: '/api/metadata/normalize-urls', handler: handleMetadataOptionsRequest },
];

/**
 * Main router function
 * Matches incoming requests to appropriate handlers
 */
export async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  // SECURITY FIX (Week 1 Phase 2.3): Conditionally register debug routes
  // Only register debug endpoints when ENABLE_DEBUG_ENDPOINTS flag is true
  const debugRoutesEnabled = env.ENABLE_DEBUG_ENDPOINTS === 'true';

  if (debugRoutesEnabled) {
    // Debug routes only available when explicitly enabled (staging/dev environments)
    const debugRoutes: Route[] = [
      { method: 'GET', path: '/api/debug/r2-structure', handler: debugR2StructureHandler },
      { method: 'GET', path: '/api/debug/r2/list', handler: listR2BucketsHandler },
      { method: 'POST', path: '/api/debug/r2/test-access', handler: testR2AccessHandler },
    ];

    // Add debug routes to main routes (only if not already present)
    for (const debugRoute of debugRoutes) {
      if (!routes.find(r => r.path === debugRoute.path && r.method === debugRoute.method)) {
        routes.push(debugRoute);
      }
    }

    console.info('[ROUTER] Debug endpoints ENABLED (ENABLE_DEBUG_ENDPOINTS=true)');
  } else {
    console.info('[ROUTER] Debug endpoints DISABLED (production mode)');
  }

  // SECURITY FIX (Week 2): Apply global rate limiting BEFORE authentication
  // This protects public endpoints from abuse and DDoS attacks
  const globalRateLimitResponse = await globalRateLimitMiddleware(request, env);
  if (globalRateLimitResponse) {
    // Add security headers to rate limit response
    return addSecurityHeaders(globalRateLimitResponse, env, request);
  }

  // Handle CORS preflight requests
  if (method === 'OPTIONS') {
    // Special handling for v2 API CORS
    if (path.startsWith('/api/v2/')) {
      const { handleCorsPreflightV2 } = await import('../middleware/cors');
      const preflightResponse = handleCorsPreflightV2(request, env);
      if (preflightResponse) {
        return addSecurityHeaders(preflightResponse, env, request);
      }
    }
    const corsResp = corsResponse();
    return addSecurityHeaders(corsResp, env, request);
  }
  
  // Handle v2 API routes
  if (path.startsWith('/api/v2/')) {
    // Apply CORS wrapper to v2 routes
    const { addCorsHeaders } = await import('../middleware/cors');
    const response = await routeV2Api(request, env, path);
    const corsResponse = addCorsHeaders(response, request, env);
    return addSecurityHeaders(corsResponse, env, request);
  }

  // Enforce Content-Type for common JSON POST endpoints (Phase 2 GREEN)
  // Do this BEFORE auth so validation errors surface consistently
  const isJsonPostEndpoint = () => {
    if (method !== 'POST') return false;
    if (path === '/api/paste') return true;
    if (path === '/api/projects') return true;
    if (/^\/api\/projects\/[^/]+\/build$/.test(path)) return true;
    return false;
  };

  if (isJsonPostEndpoint()) {
    const validation = requireJsonContentType(request);
    if (validation) {
      return validation; // 400: Content-Type must be application/json
    }

    // Minimal pre-auth body validation for key endpoints to surface contract errors
    if (path === '/api/paste') {
      try {
        const body = await request.clone().json();
        const missing: string[] = [];
        if (!body || typeof body !== 'object') {
          return addSecurityHeaders(errorResponse('INVALID_JSON', 'Request body must be valid JSON', 400), env, request);
        }
        if (!body.content || String(body.content).trim().length === 0) missing.push('content');
        if (!body.project_name || String(body.project_name).trim().length === 0) missing.push('project_name');
        if (missing.length > 0) {
          return addSecurityHeaders(
            errorResponse(
              'MISSING_REQUIRED_FIELDS',
              `Missing required field(s): ${missing.join(', ')}`,
              400,
              { missing_fields: missing }
            ),
            env,
            request
          );
        }
      } catch (e) {
        return addSecurityHeaders(errorResponse('INVALID_JSON', 'Request body must be valid JSON', 400, String(e)), env, request);
      }
    }
  }

  // TASK-029: Apply authentication middleware
  // SECURITY FIX (Week 1 Phase 2.4): Removed debug endpoint auth exemption
  // Debug endpoints now require authentication (only registered when ENABLE_DEBUG_ENDPOINTS=true)
  // GitHub callbacks have their own authentication (Bearer token with GITHUB_CALLBACK_TOKEN)
  const isGitHubCallback = path === '/api/github/build-callback' || path === '/api/v2/github/build-callback';
  const isPublicSite = path.startsWith('/sites/');

  // Exempt public site content and GitHub callbacks from API auth
  if (!isGitHubCallback && !isPublicSite) {
    const authResponse = await authMiddleware(request, env);
    if (authResponse) {
      const corsAuthResp = addCorsHeaders(authResponse, request, env);
      return addSecurityHeaders(corsAuthResp, env, request); // Authentication failed, return CORS-safe error with security headers
    }

    // PHASE 1: Apply rate limiting AFTER authentication (need user context)
    // Only applies to authenticated API endpoints
    const rateLimitResponse = await rateLimitMiddleware(
      request as AuthenticatedRequest,
      env,
      path,
      method
    );
    if (rateLimitResponse) {
      const corsRateLimitResp = addCorsHeaders(rateLimitResponse, request, env);
      return addSecurityHeaders(corsRateLimitResp, env, request); // Rate limit exceeded, return CORS-safe 429 with security headers
    }
  }

  // Find matching route (exact match first)
  let route = routes.find(r => r.method === method && r.path === path);
  
  // Handle dynamic R2 debug routes (only if debug endpoints enabled)
  if (debugRoutesEnabled) {
    if (!route && method === 'GET' && path.match(/^\/api\/debug\/r2\/find-artifacts\/[^/]+$/)) {
      route = { method: 'GET', path: '/api/debug/r2/find-artifacts/:project_id', handler: findBuildArtifactsHandler };
    }

    if (!route && method === 'POST' && path.match(/^\/api\/debug\/r2\/force-deploy\/[^/]+$/)) {
      route = { method: 'POST', path: '/api/debug/r2/force-deploy/:project_id', handler: forceDeployHandler };
    }
  }
  
  // Handle dynamic analysis routes if no exact match
  if (!route && method === 'GET' && path.startsWith('/api/analysis/')) {
    const pathSegments = path.split('/');
    // Check for /api/analysis/{project_id} pattern
    if (pathSegments.length === 4 && pathSegments[3] !== 'projects') {
      route = { method: 'GET', path: '/api/analysis/:project_id', handler: getProjectAnalysisHandler };
    }
  }
  
  // Handle reanalyze route
  if (!route && method === 'POST' && path.match(/^\/api\/analysis\/[^/]+\/reanalyze$/)) {
    route = { method: 'POST', path: '/api/analysis/:project_id/reanalyze', handler: reanalyzeProjectHandler };
  }
  
  // TASK-009: Handle dependencies route
  if (!route && method === 'GET' && path.match(/^\/api\/analysis\/[^/]+\/dependencies$/)) {
    route = { method: 'GET', path: '/api/analysis/:project_id/dependencies', handler: getProjectDependenciesHandler };
  }
  
  // TASK-010: Handle components route
  if (!route && method === 'GET' && path.match(/^\/api\/analysis\/[^/]+\/components$/)) {
    route = { method: 'GET', path: '/api/analysis/:project_id/components', handler: getProjectComponentsHandler };
  }
  
  // TASK-011: Handle dependency resolution routes
  if (!route && method === 'POST' && path.match(/^\/api\/dependencies\/[^/]+\/resolve$/)) {
    route = { method: 'POST', path: '/api/dependencies/:project_id/resolve', handler: (req, env) => {
      const projectId = path.split('/')[3];
      return handleDependencyResolution(req, projectId);
    }};
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/dependencies\/templates\/[^/]+$/)) {
    route = { method: 'GET', path: '/api/dependencies/templates/:framework', handler: (req, env) => {
      const framework = path.split('/')[4];
      return handleFrameworkTemplate(req, framework);
    }};
  }
  
  if (!route && method === 'POST' && path === '/api/dependencies/analyze-conflicts') {
    route = { method: 'POST', path: '/api/dependencies/analyze-conflicts', handler: (req, env) => handleConflictAnalysis(req) };
  }
  
  if (!route && method === 'POST' && path === '/api/dependencies/infer-peers') {
    route = { method: 'POST', path: '/api/dependencies/infer-peers', handler: (req, env) => handlePeerInference(req) };
  }
  
  if (!route && method === 'POST' && path === '/api/dependencies/validate') {
    route = { method: 'POST', path: '/api/dependencies/validate', handler: (req, env) => handlePackageJsonValidation(req) };
  }
  
  if (!route && method === 'POST' && path === '/api/dependencies/recommendations') {
    route = { method: 'POST', path: '/api/dependencies/recommendations', handler: (req, env) => handleDependencyRecommendations(req) };
  }
  
  // TASK-012: Handle scaffolding routes
  if (!route && method === 'POST' && path.match(/^\/api\/scaffolding\/[^/]+\/generate$/)) {
    route = { method: 'POST', path: '/api/scaffolding/:project_id/generate', handler: generateScaffoldingHandler };
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/scaffolding\/[^/]+\/status$/)) {
    route = { method: 'GET', path: '/api/scaffolding/:project_id/status', handler: getScaffoldingStatusHandler };
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/scaffolding\/[^/]+\/files$/)) {
    route = { method: 'GET', path: '/api/scaffolding/:project_id/files', handler: getScaffoldingFilesHandler };
  }
  
  if (!route && method === 'POST' && path.match(/^\/api\/scaffolding\/[^/]+\/regenerate$/)) {
    route = { method: 'POST', path: '/api/scaffolding/:project_id/regenerate', handler: regenerateScaffoldingHandler };
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/scaffolding\/[^/]+\/preview$/)) {
    route = { method: 'GET', path: '/api/scaffolding/:project_id/preview', handler: getScaffoldingPreviewHandler };
  }
  
  // TASK-013: Handle component wrapper routes
  if (!route && method === 'POST' && path.match(/^\/api\/component-wrapper\/[^/]+\/analyze$/)) {
    route = { method: 'POST', path: '/api/component-wrapper/:project_id/analyze', handler: analyzeComponentWrapperHandler };
  }
  
  if (!route && method === 'POST' && path.match(/^\/api\/component-wrapper\/[^/]+\/generate$/)) {
    route = { method: 'POST', path: '/api/component-wrapper/:project_id/generate', handler: generateComponentWrapperHandler };
  }
  
  if (!route && method === 'POST' && path === '/api/component-wrapper/generate-props') {
    route = { method: 'POST', path: '/api/component-wrapper/generate-props', handler: generatePropsHandler };
  }
  
  if (!route && method === 'GET' && path === '/api/component-wrapper/demo') {
    route = { method: 'GET', path: '/api/component-wrapper/demo', handler: componentWrapperDemoHandler };
  }
  
  // These build queue routes are removed - using buildQueueHandler from handlers/buildQueue.ts instead
  
  // Manual Build Trigger (bypasses queue system)
  if (!route && method === 'POST' && path.match(/^\/api\/build\/[^/]+$/)) {
    route = { method: 'POST', path: '/api/build/:project_id', handler: manualBuildHandler };
  }

  // PHASE 4: Build Queue and Deployment Pipeline Routes
  if (!route && method === 'POST' && path.match(/^\/api\/projects\/[^/]+\/build$/)) {
    route = { method: 'POST', path: '/api/projects/:project_id/build', handler: buildQueueHandler };
  }

  if (!route && method === 'GET' && path.match(/^\/api\/projects\/[^/]+\/build\/status$/)) {
    route = { method: 'GET', path: '/api/projects/:project_id/build/status', handler: buildStatusHandler };
  }

  if (!route && method === 'GET' && path.match(/^\/api\/projects\/[^/]+\/build\/logs$/)) {
    route = { method: 'GET', path: '/api/projects/:project_id/build/logs', handler: buildLogsHandler };
  }

  if (!route && method === 'POST' && path.match(/^\/api\/projects\/[^/]+\/deploy$/)) {
    route = { method: 'POST', path: '/api/projects/:project_id/deploy', handler: deploymentHandler };
  }
  
  // Manual deployment route for fixing stuck deployments
  if (!route && method === 'POST' && path.match(/^\/api\/projects\/[^/]+\/manual-deploy$/)) {
    const { manualDeployHandler } = await import('./manualDeploy');
    const projectId = path.split('/')[3];
    return manualDeployHandler(request, env, projectId);
  }
  
  // Emergency direct deployment route (bypasses all checks)
  if (!route && method === 'POST' && path.match(/^\/api\/emergency\/deploy\/[^/]+$/)) {
    const { directDeployHandler } = await import('./directDeploy');
    const projectId = path.split('/')[4];
    return directDeployHandler(request, env, projectId);
  }
  
  // Debug deployment route (temporarily auth-free for debugging)
  if (!route && method === 'GET' && path.match(/^\/api\/debug\/deployment\/[^/]+$/)) {
    const { debugDeploymentHandler } = await import('./debugDeployment');
    const projectId = path.split('/')[4];
    // TEMPORARY: Skip auth for debug endpoint
    return debugDeploymentHandler(request, env, projectId);
  }
  
  // Debug bucket listing route
  if (!route && method === 'GET' && path.match(/^\/api\/debug\/bucket\/[^/]+\/[^/]+$/)) {
    const { debugBucketListHandler } = await import('./debugDeployment');
    const parts = path.split('/');
    const bucketName = parts[4];
    const projectId = parts[5];
    return debugBucketListHandler(request, env, bucketName, projectId);
  }
  
  // TASK-017: Build Error Handling Routes
  if (!route && method === 'GET' && path.match(/^\/api\/build\/errors\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 5) {
      route = { method: 'GET', path: '/api/build/errors/:project_id', handler: (req, env) => {
        const projectId = pathSegments[4];
        return getBuildErrorAnalysis(req, env, projectId);
      }};
    }
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/build\/errors\/[^/]+\/history$/)) {
    route = { method: 'GET', path: '/api/build/errors/:project_id/history', handler: (req, env) => {
      const projectId = path.split('/')[4];
      return getBuildErrorHistory(req, env, projectId);
    }};
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/build\/errors\/[^/]+\/analytics$/)) {
    route = { method: 'GET', path: '/api/build/errors/:project_id/analytics', handler: (req, env) => {
      const projectId = path.split('/')[4];
      return getBuildErrorAnalytics(req, env, projectId);
    }};
  }
  
  if (!route && method === 'POST' && path.match(/^\/api\/build\/errors\/[^/]+\/retry$/)) {
    route = { method: 'POST', path: '/api/build/errors/:project_id/retry', handler: (req, env) => {
      const projectId = path.split('/')[4];
      return retryBuildWithErrorAnalysis(req, env, projectId);
    }};
  }
  
  // TASK-020: Build Warning System Routes
  if (!route && method === 'GET' && path.match(/^\/api\/warnings\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 4) {
      route = { method: 'GET', path: '/api/warnings/:project_id', handler: (req, env) => {
        const projectId = pathSegments[3];
        return getProjectWarnings(req, env, projectId);
      }};
    }
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/warnings\/[^/]+\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 5) {
      route = { method: 'GET', path: '/api/warnings/:project_id/:build_id', handler: (req, env) => {
        const projectId = pathSegments[3];
        const buildId = pathSegments[4];
        return getBuildWarnings(req, env, projectId, buildId);
      }};
    }
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/warnings\/[^/]+\/history$/)) {
    route = { method: 'GET', path: '/api/warnings/:project_id/history', handler: (req, env) => {
      const projectId = path.split('/')[3];
      return getWarningHistory(req, env, projectId);
    }};
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/warnings\/[^/]+\/analytics$/)) {
    route = { method: 'GET', path: '/api/warnings/:project_id/analytics', handler: (req, env) => {
      const projectId = path.split('/')[3];
      return getWarningAnalytics(req, env, projectId);
    }};
  }
  
  if (!route && method === 'POST' && path.match(/^\/api\/warnings\/[^/]+\/clear$/)) {
    route = { method: 'POST', path: '/api/warnings/:project_id/clear', handler: (req, env) => {
      const projectId = path.split('/')[3];
      return clearWarnings(req, env, projectId);
    }};
  }
  
  if (!route && method === 'GET' && path === '/api/warnings/analytics') {
    route = { method: 'GET', path: '/api/warnings/analytics', handler: getGlobalWarningAnalytics };
  }

  // DEBUG: manually register project metadata (for manual GitHub runs, only if debug enabled)
  if (debugRoutesEnabled && !route && method === 'POST' && path === '/api/debug/register-project') {
    const { registerProjectHandler } = await import('./r2Debug');
    route = { method: 'POST', path: '/api/debug/register-project', handler: registerProjectHandler } as any;
  }

  // ADMIN: Audit projects for owner ID migration
  if (!route && method === 'GET' && path === '/api/admin/audit-projects') {
    const { handleAuditProjects } = await import('./audit');
    route = { method: 'GET', path: '/api/admin/audit-projects', handler: handleAuditProjects };
  }

  // ADMIN: Migrate owner IDs for legacy projects
  if (!route && method === 'POST' && path === '/api/admin/migrate-owner-ids') {
    const { handleMigrateOwnerIds } = await import('./migrate');
    route = { method: 'POST', path: '/api/admin/migrate-owner-ids', handler: handleMigrateOwnerIds };
  }

  // ADMIN: Detect and fix stuck builds
  if (!route && method === 'POST' && path === '/api/v2/admin/stuck-builds') {
    route = { 
      method: 'POST', 
      path: '/api/v2/admin/stuck-builds', 
      handler: async (request: Request, env: Env) => {
        try {
          // Get timeout from request body or use default
          let timeoutMinutes = 30;
          try {
            const body = await request.json() as { timeout_minutes?: number };
            if (body.timeout_minutes && body.timeout_minutes > 0) {
              timeoutMinutes = body.timeout_minutes;
            }
          } catch {
            // Use default if no body provided
          }

          // Initialize services
          const { ProjectService } = await import('../services/ProjectService');
          const { GitHubService } = await import('../services/GitHubService');
          const { StorageService } = await import('../services/StorageService');
          const { BuildService } = await import('../services/BuildService');
          
          const storageService = new StorageService(env);
          const projectService = new ProjectService(storageService, env);
          const githubService = new GitHubService(env);
          const buildService = new BuildService(projectService, githubService, storageService, env);
          
          // Detect and fix stuck builds
          const result = await buildService.detectStuckBuilds(timeoutMinutes);
          
          if (!result.ok) {
            return new Response(JSON.stringify({ 
              success: false, 
              error: result.error.message 
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          
          return new Response(JSON.stringify({ 
            success: true, 
            fixed_builds: result.value,
            count: result.value.length,
            timeout_minutes: timeoutMinutes
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: error.message || 'Failed to detect stuck builds' 
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    };
  }

  // ADMIN: Get stuck builds without fixing them
  if (!route && method === 'GET' && path === '/api/v2/admin/stuck-builds') {
    route = { 
      method: 'GET', 
      path: '/api/v2/admin/stuck-builds', 
      handler: async (request: Request, env: Env) => {
        try {
          const url = new URL(request.url);
          const timeoutMinutes = parseInt(url.searchParams.get('timeout_minutes') || '30');

          // Initialize services
          const { ProjectService } = await import('../services/ProjectService');
          const { StorageService } = await import('../services/StorageService');
          
          const storageService = new StorageService(env);
          const projectService = new ProjectService(storageService, env);
          
          // List all projects and find stuck builds
          const projectsResult = await projectService.listProjects();
          if (!projectsResult.ok) {
            throw new Error('Failed to list projects');
          }

          const stuckBuilds = [];
          const now = Date.now();
          const timeoutMs = timeoutMinutes * 60 * 1000;

          for (const project of projectsResult.value) {
            if (project.status === 'building' || project.status === 'pending') {
              const createdAt = new Date(project.created_at).getTime();
              const elapsedTime = now - createdAt;
              
              if (elapsedTime > timeoutMs) {
                stuckBuilds.push({
                  project_id: project.id,
                  status: project.status,
                  created_at: project.created_at,
                  elapsed_minutes: Math.round(elapsedTime / 60000)
                });
              }
            }
          }
          
          return new Response(JSON.stringify({ 
            success: true, 
            stuck_builds: stuckBuilds,
            count: stuckBuilds.length,
            timeout_minutes: timeoutMinutes
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error: any) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: error.message || 'Failed to list stuck builds' 
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    };
  }

  // MONITORING: Get current alerts
  if (!route && method === 'GET' && path === '/api/v2/admin/alerts') {
    route = {
      method: 'GET',
      path: '/api/v2/admin/alerts',
      handler: async (request: Request, env: Env) => {
        try {
          const { BuildMetricsService } = await import('../monitoring/BuildMetricsService');
          
          const alerts = BuildMetricsService.checkAlerts();
          const performance = BuildMetricsService.getPerformanceMetrics();
          
          return new Response(JSON.stringify({
            success: true,
            alerts,
            performance,
            timestamp: new Date().toISOString()
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message || 'Failed to get alerts'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    };
  }

  // MONITORING: Get build metrics
  if (!route && method === 'GET' && path === '/api/v2/admin/metrics/builds') {
    route = {
      method: 'GET',
      path: '/api/v2/admin/metrics/builds',
      handler: async (request: Request, env: Env) => {
        try {
          const { BuildMetricsService } = await import('../monitoring/BuildMetricsService');
          
          const metrics = BuildMetricsService.exportMetrics();
          
          return new Response(JSON.stringify({
            success: true,
            ...metrics,
            timestamp: new Date().toISOString()
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message || 'Failed to get build metrics'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    };
  }

  // MONITORING: Update alert thresholds
  if (!route && method === 'POST' && path === '/api/v2/admin/alerts/thresholds') {
    route = {
      method: 'POST',
      path: '/api/v2/admin/alerts/thresholds',
      handler: async (request: Request, env: Env) => {
        try {
          const { BuildMetricsService } = await import('../monitoring/BuildMetricsService');
          
          const body = await request.json() as any;
          BuildMetricsService.setAlertThresholds(body);
          
          return new Response(JSON.stringify({
            success: true,
            thresholds: BuildMetricsService.getAlertThresholds(),
            message: 'Alert thresholds updated successfully'
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message || 'Failed to update alert thresholds'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    };
  }

  // MONITORING: Trigger manual alert check and remediation
  if (!route && method === 'POST' && path === '/api/v2/admin/alerts/check') {
    route = {
      method: 'POST',
      path: '/api/v2/admin/alerts/check',
      handler: async (request: Request, env: Env) => {
        try {
          const { BuildMetricsService } = await import('../monitoring/BuildMetricsService');
          const { BuildService } = await import('../services/BuildService');
          const { ProjectService } = await import('../services/ProjectService');
          const { GitHubService } = await import('../services/GitHubService');
          const { StorageService } = await import('../services/StorageService');
          
          // Check for alerts
          const alerts = BuildMetricsService.checkAlerts();
          const criticalAlerts = alerts.filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH');
          
          let remediationResults = [];
          
          // Auto-remediate stuck builds if critical alert exists
          if (criticalAlerts.some(a => a.type === 'STUCK_BUILDS')) {
            const storageService = new StorageService(env);
            const projectService = new ProjectService(storageService, env);
            const githubService = new GitHubService(env);
            const buildService = new BuildService(projectService, githubService, storageService, env);
            
            const result = await buildService.detectStuckBuilds(30);
            if (result.ok) {
              remediationResults.push({
                action: 'fixed_stuck_builds',
                builds: result.value,
                count: result.value.length
              });
            }
          }
          
          return new Response(JSON.stringify({
            success: true,
            alerts,
            critical_count: criticalAlerts.length,
            remediation: remediationResults,
            timestamp: new Date().toISOString()
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (error: any) {
          return new Response(JSON.stringify({
            success: false,
            error: error.message || 'Failed to check alerts'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    };
  }
  
  // TASK-018: Deployment Pipeline Routes
  if (!route && method === 'POST' && path.match(/^\/api\/deploy\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 4) {
      route = { method: 'POST', path: '/api/deploy/:project_id', handler: deployProjectHandler };
    }
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/deploy\/[^/]+\/status$/)) {
    route = { method: 'GET', path: '/api/deploy/:project_id/status', handler: getDeploymentStatusHandler };
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/deploy\/[^/]+\/url$/)) {
    route = { method: 'GET', path: '/api/deploy/:project_id/url', handler: getDeploymentURLHandler };
  }
  
  if (!route && method === 'DELETE' && path.match(/^\/api\/deploy\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 4) {
      route = { method: 'DELETE', path: '/api/deploy/:project_id', handler: removeDeploymentHandler };
    }
  }
  
  if (!route && method === 'GET' && path.match(/^\/api\/deploy\/[^/]+\/builds$/)) {
    route = { method: 'GET', path: '/api/deploy/:project_id/builds', handler: listProjectBuildsHandler };
  }
  
  if (!route && method === 'GET' && path === '/api/deploy/health') {
    route = { method: 'GET', path: '/api/deploy/health', handler: deploymentHealthHandler };
  }

  // TASK-021: GitHub Repository Setup & Token Management Routes
  if (!route && method === 'POST' && path === '/api/github/validate-token') {
    route = { method: 'POST', path: '/api/github/validate-token', handler: validateGitHubTokenHandler };
  }

  if (!route && method === 'POST' && path === '/api/github/setup-repository') {
    route = { method: 'POST', path: '/api/github/setup-repository', handler: setupGitHubRepositoryHandler };
  }

  if (!route && method === 'GET' && path === '/api/github/repository-status') {
    route = { method: 'GET', path: '/api/github/repository-status', handler: getGitHubRepositoryStatusHandler };
  }

  if (!route && method === 'POST' && path === '/api/github/test-build') {
    route = { method: 'POST', path: '/api/github/test-build', handler: triggerGitHubTestBuildHandler };
  }

  if (!route && method === 'POST' && path === '/api/github/build-callback') {
    route = { method: 'POST', path: '/api/github/build-callback', handler: githubBuildCallbackHandler };
  }

  if (!route && method === 'GET' && path === '/api/github/workflows') {
    route = { method: 'GET', path: '/api/github/workflows', handler: listGitHubWorkflowsHandler };
  }

  // TASK-025: Build Status Polling System Routes
  if (!route && method === 'GET' && path.match(/^\/api\/projects\/[^/]+\/status$/)) {
    route = { method: 'GET', path: '/api/projects/:project_id/status', handler: getProjectStatusHandler };
  }

  if (!route && method === 'GET' && path.match(/^\/api\/projects\/[^/]+\/status-stream$/)) {
    route = { method: 'GET', path: '/api/projects/:project_id/status-stream', handler: getProjectStatusStreamHandler };
  }

  if (!route && method === 'POST' && path.match(/^\/api\/projects\/[^/]+\/status\/poll$/)) {
    route = { method: 'POST', path: '/api/projects/:project_id/status/poll', handler: triggerProjectStatusPollHandler };
  }

  if (!route && method === 'POST' && path.match(/^\/api\/projects\/[^/]+\/status-tracking\/start$/)) {
    route = { method: 'POST', path: '/api/projects/:project_id/status-tracking/start', handler: startProjectStatusTrackingHandler };
  }

  if (!route && method === 'DELETE' && path.match(/^\/api\/projects\/[^/]+\/status-tracking\/stop$/)) {
    route = { method: 'DELETE', path: '/api/projects/:project_id/status-tracking/stop', handler: stopProjectStatusTrackingHandler };
  }

  if (!route && method === 'GET' && path === '/api/status-tracking/stats') {
    route = { method: 'GET', path: '/api/status-tracking/stats', handler: getStatusTrackingStatsHandler };
  }

  // TASK-028: Multi-Project Management Dynamic Routes
  if (!route && method === 'GET' && path.match(/^\/api\/projects\/[^/]+\/info$/)) {
    route = { method: 'GET', path: '/api/projects/:project_id/info', handler: getMultiProjectStatusHandler };
  }

  // TASK-035: Project Delete Routes
  if (!route && method === 'DELETE' && path.match(/^\/api\/projects\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 4) {
      route = { method: 'DELETE', path: '/api/projects/:project_id', handler: deleteProjectHandlerFromDelete };
    }
  }

  if (!route && method === 'POST' && path.match(/^\/api\/projects\/[^/]+\/recover$/)) {
    route = { method: 'POST', path: '/api/projects/:project_id/recover', handler: recoverProjectHandler };
  }

  if (!route && method === 'OPTIONS' && path.match(/^\/api\/projects\/[^/]+\/recover$/)) {
    route = { method: 'OPTIONS', path: '/api/projects/:project_id/recover', handler: recoverProjectOptionsHandler };
  }

  if (!route && method === 'OPTIONS' && path.match(/^\/api\/projects\/[^/]+$/) && !path.includes('/recover')) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 4) {
      route = { method: 'OPTIONS', path: '/api/projects/:project_id', handler: deleteProjectOptionsHandler };
    }
  }

  // TASK-031: Enhanced Metadata Management Dynamic Routes
  if (!route && method === 'GET' && path.match(/^\/api\/metadata\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 4) {
      route = { method: 'GET', path: '/api/metadata/:project_id', handler: getEnhancedMetadataHandler };
    }
  }

  if (!route && method === 'PUT' && path.match(/^\/api\/metadata\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 4) {
      route = { method: 'PUT', path: '/api/metadata/:project_id', handler: updateEnhancedMetadataHandler };
    }
  }

  if (!route && method === 'DELETE' && path.match(/^\/api\/metadata\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 4) {
      route = { method: 'DELETE', path: '/api/metadata/:project_id', handler: deleteEnhancedMetadataHandler };
    }
  }

  if (!route && method === 'GET' && path.match(/^\/api\/metadata\/[^/]+\/versions$/)) {
    route = { method: 'GET', path: '/api/metadata/:project_id/versions', handler: getMetadataVersionHistoryHandler };
  }

  // OPTIONS for individual metadata endpoints
  if (!route && method === 'OPTIONS' && path.match(/^\/api\/metadata\/[^/]+/)) {
    route = { method: 'OPTIONS', path: '/api/metadata/*', handler: handleMetadataOptionsRequest };
  }

  // TASK-034: Project Update Dynamic Routes
  if (!route && method === 'PUT' && path.match(/^\/api\/projects\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 4) {
      route = { method: 'PUT', path: '/api/projects/:project_id', handler: updateProjectHandler };
    }
  }

  if (!route && method === 'PATCH' && path.match(/^\/api\/projects\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 4) {
      route = { method: 'PATCH', path: '/api/projects/:project_id', handler: patchProjectHandler };
    }
  }

  if (!route && method === 'OPTIONS' && path.match(/^\/api\/projects\/[^/]+$/)) {
    const pathSegments = path.split('/');
    if (pathSegments.length === 4) {
      route = { method: 'OPTIONS', path: '/api/projects/:project_id', handler: projectUpdateOptionsHandler };
    }
  }
  
  if (route) {
    try {
      let response = await route.handler(request, env);

      // Add rate limit headers to successful responses
      // Only for authenticated API requests that passed rate limiting
      // (Debug endpoints now require auth after security fix)
      if (!isGitHubCallback && !isPublicSite) {
        response = addRateLimitHeadersToResponse(response, request as AuthenticatedRequest);
      }

      // SECURITY FIX (Week 2): Add global rate limit headers for public endpoints
      response = addRateLimitHeaders(response, request);

      // SECURITY FIX (Week 2): Add security headers to all responses
      return addSecurityHeaders(response, env, request);
    } catch (error) {
      console.error(`Error in route handler for ${method} ${path}:`, error);
      return addSecurityHeaders(
        errorResponse(
          'INTERNAL_SERVER_ERROR',
          'An unexpected error occurred',
          500,
          error instanceof Error ? error.message : String(error)
        ),
        env,
        request
      );
    }
  }

  // TASK-019: Handle special files (favicon.ico, robots.txt, sitemap.xml)
  const specialFileResponse = await handleSpecialFiles(request, env);
  if (specialFileResponse) {
    return specialFileResponse;
  }

  // Handle path-based site serving (/sites/{project}/*)
  if (path.startsWith('/sites/')) {
    const pathParts = path.split('/');
    if (pathParts.length >= 3) {
      const projectId = pathParts[2];
      const sitePath = pathParts.slice(3).join('/') || 'index.html';
      
      // Use DeployService to serve the site content (use static method)
      const deployService = ServiceFactory.getDeployService(env);
      
      const result = await deployService.serveSite(
        projectId,
        sitePath,
        { spa: true }  // Enable SPA fallback
      );
      
      if (result.ok) {
        const content = result.value;
        return addSecurityHeaders(
          new Response(content.body, {
            status: 200,
            headers: content.headers
          }),
          env,
          request
        );
      } else if (result.error.code === 'SERVE_PROJECT_NOT_DEPLOYED') {
        return addSecurityHeaders(errorResponse('NOT_DEPLOYED', `Project ${projectId} is not deployed`, 404), env, request);
      } else if (result.error.code === 'SERVE_FILE_NOT_FOUND') {
        // Try SPA fallback if enabled
        const fallbackResult = await deployService.serveSite(
          projectId,
          'index.html',
          { spa: true }
        );
        if (fallbackResult.ok) {
          const content = fallbackResult.value;
          return addSecurityHeaders(
            new Response(content.body, {
              status: 200,
              headers: content.headers
            }),
            env,
            request
          );
        }
        return addSecurityHeaders(errorResponse('NOT_FOUND', `File not found: ${sitePath}`, 404), env, request);
      }

      return addSecurityHeaders(errorResponse('SERVE_ERROR', result.error.message, 500), env, request);
    }
  }
  
  // TASK-019: Try site routing for non-API requests (deployed websites)
  if (!path.startsWith('/api/')) {
    try {
      const siteResponse = await handleSiteRouting(request, env, { debug: false });
      if (siteResponse !== null) {
        // Return site routing responses (including 404s for valid site requests)
        return siteResponse;
      }
    } catch (error) {
      console.error(`Error in site routing for ${method} ${path}:`, error);
      // Continue to default 404 rather than exposing internal errors
    }
  }

  // No route found - return 404
  return addSecurityHeaders(
    errorResponse(
      'NOT_FOUND',
      `Route not found: ${method} ${path}`,
      404,
      {
        method,
        path,
        available_routes: routes.map(r => `${r.method} ${r.path}`),
      }
    ),
    env,
    request
  );
}

/**
 * Add a new route to the router
 * Useful for testing or adding routes dynamically
 */
export function addRoute(method: string, path: string, handler: RouteHandler): void {
  routes.push({ method, path, handler });
}
