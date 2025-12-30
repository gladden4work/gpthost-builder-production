/**
 * Environment Validation Middleware
 *
 * Ensures critical environment variables are set correctly per environment.
 * Prevents production from using staging config and vice versa.
 *
 * CRITICAL: This validation prevents the subdomain routing bug where
 * production had SUBDOMAIN_SUFFIX="-staging" instead of "" (empty string).
 */

export interface EnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate environment configuration
 * Throws error if critical misconfigurations are detected
 */
export function validateEnvironment(env: Env): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. ENVIRONMENT variable must be set
  if (!env.ENVIRONMENT) {
    errors.push('ENVIRONMENT not set (expected: "staging" or "production")');
  }

  // 2. SUBDOMAIN_SUFFIX validation (CRITICAL)
  if (env.ENVIRONMENT === 'staging') {
    if (env.SUBDOMAIN_SUFFIX !== '-staging') {
      errors.push(
        `Staging environment must have SUBDOMAIN_SUFFIX="-staging", got: "${env.SUBDOMAIN_SUFFIX}"`
      );
    }
  }

  if (env.ENVIRONMENT === 'production') {
    if (env.SUBDOMAIN_SUFFIX !== '') {
      errors.push(
        `Production environment must have SUBDOMAIN_SUFFIX="" (empty string), got: "${env.SUBDOMAIN_SUFFIX}"`
      );
    }
  }

  // 3. BASE_DOMAIN validation
  if (!env.BASE_DOMAIN) {
    errors.push('BASE_DOMAIN not set (expected: "gpthost.online")');
  } else if (env.BASE_DOMAIN !== 'gpthost.online') {
    warnings.push(`BASE_DOMAIN is set to "${env.BASE_DOMAIN}", expected "gpthost.online"`);
  }

  // 4. WORKER_URL validation
  if (!env.WORKER_URL) {
    errors.push('WORKER_URL not set');
  } else {
    const expectedWorkerPattern = env.ENVIRONMENT === 'production'
      ? /gpthost-builder-production\..*\.workers\.dev/
      : /gpthost-builder-staging\..*\.workers\.dev/;

    if (!expectedWorkerPattern.test(env.WORKER_URL)) {
      errors.push(
        `WORKER_URL mismatch for ${env.ENVIRONMENT} environment: ${env.WORKER_URL}`
      );
    }
  }

  // 5. Debug endpoints should be disabled in production
  if (env.ENVIRONMENT === 'production') {
    if (env.ENABLE_DEBUG_ENDPOINTS === 'true') {
      warnings.push('Debug endpoints are enabled in production (ENABLE_DEBUG_ENDPOINTS=true)');
    }
    if (env.ENABLE_EMERGENCY_ENDPOINTS === 'true') {
      warnings.push('Emergency endpoints are enabled in production (ENABLE_EMERGENCY_ENDPOINTS=true)');
    }
  }

  // 6. Subdomain routing should be enabled
  if (env.ENABLE_SUBDOMAIN_ROUTING !== 'true') {
    warnings.push('ENABLE_SUBDOMAIN_ROUTING is not enabled');
  }

  // 7. Critical bindings validation
  if (!env.SUBDOMAIN_MAPPINGS) {
    errors.push('SUBDOMAIN_MAPPINGS KV namespace not bound');
  }

  if (!env.PROJECTS_BUCKET) {
    errors.push('PROJECTS_BUCKET R2 bucket not bound');
  }

  if (!env.DEPLOYMENTS_BUCKET) {
    errors.push('DEPLOYMENTS_BUCKET R2 bucket not bound');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate and log environment configuration
 * Throws error if validation fails
 */
export function validateAndLog(env: Env): void {
  const result = validateEnvironment(env);

  // Log validation result
  console.info('[ENV-VALIDATION] Environment validation', {
    environment: env.ENVIRONMENT,
    valid: result.valid,
    subdomainSuffix: env.SUBDOMAIN_SUFFIX,
    baseDomain: env.BASE_DOMAIN,
    workerUrl: env.WORKER_URL,
    subdomainRouting: env.ENABLE_SUBDOMAIN_ROUTING,
    errorCount: result.errors.length,
    warningCount: result.warnings.length
  });

  // Log warnings
  if (result.warnings.length > 0) {
    console.warn('[ENV-VALIDATION] Configuration warnings:', result.warnings);
  }

  // Throw error if validation failed
  if (!result.valid) {
    console.error('[ENV-VALIDATION] Configuration errors detected:', result.errors);
    throw new Error(
      `Environment configuration errors (${env.ENVIRONMENT}):\n${result.errors.join('\n')}`
    );
  }

  console.info('[ENV-VALIDATION] ✅ Environment validated successfully');
}
