/**
 * Input Sanitization and Validation Utilities
 * 
 * Comprehensive security utilities for sanitizing and validating user inputs
 * to prevent XSS, injection attacks, and ensure data integrity.
 * 
 * Features:
 * - HTML tag removal and encoding
 * - String trimming and length validation
 * - Deep sanitization of nested objects
 * - Environment variable validation
 * - SQL injection prevention
 * - Path traversal prevention
 */

/**
 * Configuration for sanitization rules
 */
interface SanitizationOptions {
  allowHtml?: boolean;
  maxLength?: number;
  trim?: boolean;
  allowEmpty?: boolean;
  allowedCharacters?: RegExp;
  stripMultipleSpaces?: boolean;
  normalizeNewlines?: boolean;
}

/**
 * Default sanitization options
 */
const DEFAULT_SANITIZATION_OPTIONS: SanitizationOptions = {
  allowHtml: false,
  maxLength: 10000,
  trim: true,
  allowEmpty: true,
  stripMultipleSpaces: true,
  normalizeNewlines: true
};

/**
 * Field-specific sanitization rules
 */
const FIELD_SANITIZATION_RULES: Record<string, SanitizationOptions> = {
  display_name: {
    allowHtml: false,
    maxLength: 100,
    trim: true,
    allowEmpty: false,
    allowedCharacters: /^[a-zA-Z0-9\s\-_().]+$/,
    stripMultipleSpaces: true
  },
  description: {
    allowHtml: false,
    maxLength: 1000,
    trim: true,
    allowEmpty: true,
    stripMultipleSpaces: true,
    normalizeNewlines: true
  },
  archive_reason: {
    allowHtml: false,
    maxLength: 500,
    trim: true,
    allowEmpty: false,
    stripMultipleSpaces: true
  },
  suspend_reason: {
    allowHtml: false,
    maxLength: 500,
    trim: true,
    allowEmpty: false,
    stripMultipleSpaces: true
  },
  'audit_info.reason': {
    allowHtml: false,
    maxLength: 500,
    trim: true,
    allowEmpty: false,
    stripMultipleSpaces: true
  },
  'audit_info.source': {
    allowHtml: false,
    maxLength: 100,
    trim: true,
    allowEmpty: false,
    allowedCharacters: /^[a-zA-Z0-9\-_]+$/
  },
  'audit_info.changed_by': {
    allowHtml: false,
    maxLength: 100,
    trim: true,
    allowEmpty: false,
    allowedCharacters: /^[a-zA-Z0-9\-_@.]+$/
  },
  'tags.*.name': {
    allowHtml: false,
    maxLength: 50,
    trim: true,
    allowEmpty: false,
    allowedCharacters: /^[a-zA-Z0-9\-_]+$/,
    stripMultipleSpaces: false
  },
  'build_config.environment_variables.*': {
    allowHtml: false,
    maxLength: 1000,
    trim: true,
    allowEmpty: true,
    // Allow common environment variable characters
    allowedCharacters: /^[a-zA-Z0-9\-_./:@?&=\s]*$/
  },
  'build_config.build_commands.*': {
    allowHtml: false,
    maxLength: 500,
    trim: true,
    allowEmpty: false,
    // Basic command validation - no dangerous characters
    allowedCharacters: /^[a-zA-Z0-9\s\-_./:@&=]*$/
  },
  'deployment_config.security_headers.*': {
    allowHtml: false,
    maxLength: 200,
    trim: true,
    allowEmpty: false
  }
};

/**
 * Dangerous patterns that should always be rejected
 */
const DANGEROUS_PATTERNS = [
  // Script injection attempts
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  /javascript:/gi,
  /vbscript:/gi,
  /onload=/gi,
  /onerror=/gi,
  /onclick=/gi,
  
  // Path traversal attempts
  /\.\.\//g,
  /\.\.\\/g,
  
  // SQL injection patterns
  /union\s+select/gi,
  /drop\s+table/gi,
  /delete\s+from/gi,
  /insert\s+into/gi,
  /update\s+\w+\s+set/gi,
  
  // Command injection
  /;\s*(rm|del|format|shutdown|reboot)/gi,
  /\|\s*(rm|del|format|shutdown|reboot)/gi,
  /&&\s*(rm|del|format|shutdown|reboot)/gi,
  
  // Null bytes and control characters
  /\0/g,
  /[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g
];

/**
 * Sanitize a string value according to the provided options
 */
export function sanitizeString(
  value: string,
  options: SanitizationOptions = DEFAULT_SANITIZATION_OPTIONS
): { sanitized: string; violations: string[] } {
  const violations: string[] = [];
  let sanitized = value;

  // Check for null or undefined
  if (sanitized == null) {
    return { sanitized: '', violations: [] };
  }

  // Convert to string if not already
  sanitized = String(sanitized);

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(sanitized)) {
      violations.push(`Dangerous pattern detected: ${pattern.source}`);
      sanitized = sanitized.replace(pattern, '');
    }
  }

  // Trim whitespace
  if (options.trim !== false) {
    sanitized = sanitized.trim();
  }

  // Check if empty when not allowed
  if (!options.allowEmpty && sanitized === '') {
    violations.push('Empty value not allowed');
    return { sanitized: '', violations };
  }

  // Check maximum length
  if (options.maxLength && sanitized.length > options.maxLength) {
    violations.push(`Length exceeds maximum of ${options.maxLength} characters`);
    sanitized = sanitized.substring(0, options.maxLength).trim();
  }

  // Remove HTML tags if not allowed
  if (!options.allowHtml) {
    const htmlRemoved = sanitized.replace(/<[^>]*>/g, '');
    if (htmlRemoved !== sanitized) {
      violations.push('HTML tags removed');
      sanitized = htmlRemoved;
    }
  }

  // Check allowed characters
  if (options.allowedCharacters && !options.allowedCharacters.test(sanitized)) {
    violations.push('Contains disallowed characters');
    // Remove disallowed characters
    sanitized = sanitized.replace(new RegExp(`[^${options.allowedCharacters.source.slice(2, -2)}]`, 'g'), '');
  }

  // Strip multiple consecutive spaces
  if (options.stripMultipleSpaces) {
    sanitized = sanitized.replace(/\s+/g, ' ');
  }

  // Normalize newlines
  if (options.normalizeNewlines) {
    sanitized = sanitized.replace(/\r\n|\r/g, '\n');
  }

  return { sanitized, violations };
}

/**
 * Sanitize environment variables with special validation
 */
export function sanitizeEnvironmentVariable(
  key: string,
  value: string
): { sanitized: string; violations: string[] } {
  const violations: string[] = [];
  
  // Sanitize key
  const keyResult = sanitizeString(key, {
    allowHtml: false,
    maxLength: 100,
    trim: true,
    allowEmpty: false,
    allowedCharacters: /^[A-Z_][A-Z0-9_]*$/
  });
  
  if (keyResult.violations.length > 0) {
    violations.push(`Environment variable key issues: ${keyResult.violations.join(', ')}`);
  }

  // Sanitize value
  const valueResult = sanitizeString(value, FIELD_SANITIZATION_RULES['build_config.environment_variables.*']);
  violations.push(...valueResult.violations);

  // Additional checks for sensitive environment variables
  const sensitivePatterns = [
    /password/i,
    /secret/i,
    /token/i,
    /key/i,
    /auth/i
  ];

  const isSensitive = sensitivePatterns.some(pattern => pattern.test(key));
  if (isSensitive && value.length > 0) {
    // Don't log sensitive values, just validate structure
    if (!/^[a-zA-Z0-9+/=_-]+$/.test(value)) {
      violations.push('Sensitive environment variable contains invalid characters');
    }
  }

  return { sanitized: valueResult.sanitized, violations };
}

/**
 * Deep sanitize a nested object
 */
export function sanitizeObject(
  obj: any,
  path = '',
  violations: string[] = []
): { sanitized: any; violations: string[] } {
  if (obj === null || obj === undefined) {
    return { sanitized: obj, violations };
  }

  if (typeof obj === 'string') {
    const fieldPath = path;
    const rules = getFieldSanitizationRules(fieldPath);
    const result = sanitizeString(obj, rules);
    if (result.violations.length > 0) {
      violations.push(`${fieldPath}: ${result.violations.join(', ')}`);
    }
    return { sanitized: result.sanitized, violations };
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return { sanitized: obj, violations };
  }

  if (Array.isArray(obj)) {
    const sanitizedArray = obj.map((item, index) => {
      const itemPath = `${path}[${index}]`;
      return sanitizeObject(item, itemPath, violations).sanitized;
    });
    return { sanitized: sanitizedArray, violations };
  }

  if (typeof obj === 'object') {
    const sanitizedObject: any = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Sanitize the key itself
      const keyResult = sanitizeString(key, {
        allowHtml: false,
        maxLength: 100,
        trim: true,
        allowEmpty: false,
        allowedCharacters: /^[a-zA-Z0-9_-]+$/
      });
      
      if (keyResult.violations.length > 0) {
        violations.push(`Object key "${key}": ${keyResult.violations.join(', ')}`);
        continue; // Skip this property if key is invalid
      }

      const sanitizedKey = keyResult.sanitized;
      const valuePath = path ? `${path}.${sanitizedKey}` : sanitizedKey;
      
      // Special handling for environment variables
      if (path === 'build_config.environment_variables' || path.includes('environment_variables')) {
        const envResult = sanitizeEnvironmentVariable(sanitizedKey, String(value || ''));
        if (envResult.violations.length > 0) {
          violations.push(`${valuePath}: ${envResult.violations.join(', ')}`);
        }
        sanitizedObject[sanitizedKey] = envResult.sanitized;
      } else {
        const result = sanitizeObject(value, valuePath, violations);
        sanitizedObject[sanitizedKey] = result.sanitized;
      }
    }
    
    return { sanitized: sanitizedObject, violations };
  }

  return { sanitized: obj, violations };
}

/**
 * Get sanitization rules for a specific field path
 */
function getFieldSanitizationRules(fieldPath: string): SanitizationOptions {
  // Check for exact match
  if (FIELD_SANITIZATION_RULES[fieldPath]) {
    return { ...DEFAULT_SANITIZATION_OPTIONS, ...FIELD_SANITIZATION_RULES[fieldPath] };
  }

  // Check for wildcard matches
  for (const [pattern, rules] of Object.entries(FIELD_SANITIZATION_RULES)) {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '[^.]*') + '$');
      if (regex.test(fieldPath)) {
        return { ...DEFAULT_SANITIZATION_OPTIONS, ...rules };
      }
    }
  }

  return DEFAULT_SANITIZATION_OPTIONS;
}

/**
 * Sanitize project update request with comprehensive validation
 */
export function sanitizeProjectUpdateRequest(
  request: any
): { sanitized: any; violations: string[]; isValid: boolean } {
  const violations: string[] = [];

  // Deep sanitize the entire request
  const { sanitized, violations: sanitizationViolations } = sanitizeObject(request, '', []);
  violations.push(...sanitizationViolations);

  // Additional validation for specific fields
  if (sanitized.expected_version !== undefined) {
    if (!Number.isInteger(sanitized.expected_version) || sanitized.expected_version < 0) {
      violations.push('expected_version must be a non-negative integer');
      delete sanitized.expected_version;
    }
  }

  // Validate enum fields
  if (sanitized.category && !['prototype', 'demo', 'production', 'experiment', 'template'].includes(sanitized.category)) {
    violations.push('category must be one of: prototype, demo, production, experiment, template');
    delete sanitized.category;
  }

  if (sanitized.visibility && !['private', 'public', 'shared'].includes(sanitized.visibility)) {
    violations.push('visibility must be one of: private, public, shared');
    delete sanitized.visibility;
  }

  if (sanitized.extended_status && !['pending', 'building', 'build_failed', 'deployed', 'active', 'inactive', 'archived', 'suspended', 'deleted'].includes(sanitized.extended_status)) {
    violations.push('extended_status has invalid value');
    delete sanitized.extended_status;
  }

  // Validate tags structure
  if (sanitized.tags) {
    if (!Array.isArray(sanitized.tags)) {
      violations.push('tags must be an array');
      delete sanitized.tags;
    } else {
      sanitized.tags = sanitized.tags.filter((tag: any) => {
        if (!tag || typeof tag !== 'object' || !tag.name) {
          violations.push('Invalid tag structure - must have name property');
          return false;
        }
        return true;
      });

      if (sanitized.tags.length > 10) {
        violations.push('Too many tags - maximum 10 allowed');
        sanitized.tags = sanitized.tags.slice(0, 10);
      }
    }
  }

  // Validate build_config structure
  if (sanitized.build_config) {
    if (typeof sanitized.build_config !== 'object') {
      violations.push('build_config must be an object');
      delete sanitized.build_config;
    } else {
      // Validate environment variables
      if (sanitized.build_config.environment_variables) {
        const envVars = sanitized.build_config.environment_variables;
        if (typeof envVars !== 'object') {
          violations.push('environment_variables must be an object');
          delete sanitized.build_config.environment_variables;
        } else {
          const validatedEnvVars: Record<string, string> = {};
          for (const [key, value] of Object.entries(envVars)) {
            const envResult = sanitizeEnvironmentVariable(key, String(value || ''));
            if (envResult.violations.length === 0) {
              validatedEnvVars[key] = envResult.sanitized;
            } else {
              violations.push(...envResult.violations);
            }
          }
          sanitized.build_config.environment_variables = validatedEnvVars;
        }
      }

      // Validate build commands
      if (sanitized.build_config.build_commands) {
        const commands = sanitized.build_config.build_commands;
        if (typeof commands !== 'object') {
          violations.push('build_commands must be an object');
          delete sanitized.build_config.build_commands;
        }
      }
    }
  }

  const isValid = violations.length === 0;
  
  return {
    sanitized,
    violations,
    isValid
  };
}

/**
 * Sanitize project deletion request with deletion-specific validation
 */
export function sanitizeProjectDeletionRequest(
  request: any
): { sanitized: any; violations: string[]; isValid: boolean } {
  const violations: string[] = [];

  // Deep sanitize the entire request
  const { sanitized, violations: sanitizationViolations } = sanitizeObject(request, '', []);
  violations.push(...sanitizationViolations);

  // Validate deletion_type (required field)
  if (!sanitized.deletion_type || !['soft', 'hard'].includes(sanitized.deletion_type)) {
    violations.push('deletion_type must be either "soft" or "hard"');
    sanitized.deletion_type = undefined;
  }

  // Confirmation mechanism removed - no additional validation required
  delete sanitized.confirmation;

  // Validate reason field (optional)
  if (sanitized.reason !== undefined) {
    const reasonResult = sanitizeString(sanitized.reason, {
      allowHtml: false,
      maxLength: 500,
      trim: true,
      allowEmpty: true,
      stripMultipleSpaces: true
    });
    if (reasonResult.violations.length > 0) {
      violations.push(`reason: ${reasonResult.violations.join(', ')}`);
    }
    sanitized.reason = reasonResult.sanitized;
  }

  // Validate options object if provided
  if (sanitized.options && typeof sanitized.options === 'object') {
    // Validate recovery_period_days
    if (sanitized.options.recovery_period_days !== undefined) {
      const recoveryPeriod = parseInt(sanitized.options.recovery_period_days);
      if (isNaN(recoveryPeriod) || recoveryPeriod < 1 || recoveryPeriod > 90) {
        violations.push('recovery_period_days must be a number between 1 and 90');
        delete sanitized.options.recovery_period_days;
      } else {
        sanitized.options.recovery_period_days = recoveryPeriod;
      }
    }

    // Validate boolean options
    ['preserve_build_logs', 'preserve_analytics', 'preserve_deployment_history'].forEach(field => {
      if (sanitized.options[field] !== undefined && typeof sanitized.options[field] !== 'boolean') {
        violations.push(`${field} must be a boolean value`);
        delete sanitized.options[field];
      }
    });
  }

  // Validate audit_info if provided
  if (sanitized.audit_info && typeof sanitized.audit_info === 'object') {
    if (sanitized.audit_info.requested_by !== undefined) {
      const requestedByResult = sanitizeString(sanitized.audit_info.requested_by, {
        allowHtml: false,
        maxLength: 100,
        trim: true,
        allowEmpty: false,
        allowedCharacters: /^[a-zA-Z0-9\-_@.]+$/
      });
      if (requestedByResult.violations.length > 0) {
        violations.push(`audit_info.requested_by: ${requestedByResult.violations.join(', ')}`);
      }
      sanitized.audit_info.requested_by = requestedByResult.sanitized;
    }

    if (sanitized.audit_info.source !== undefined) {
      const sourceResult = sanitizeString(sanitized.audit_info.source, {
        allowHtml: false,
        maxLength: 100,
        trim: true,
        allowEmpty: false,
        allowedCharacters: /^[a-zA-Z0-9\-_]+$/
      });
      if (sourceResult.violations.length > 0) {
        violations.push(`audit_info.source: ${sourceResult.violations.join(', ')}`);
      }
      sanitized.audit_info.source = sourceResult.sanitized;
    }
  }

  // Additional security validation for hard deletes
  if (sanitized.deletion_type === 'hard') {
    // Hard deletes should require at least typed confirmation
    if (!sanitized.confirmation || sanitized.confirmation.level === 'basic') {
      violations.push('Hard deletion requires typed or secure confirmation level for safety');
    }
    
    // Warn about permanent data loss
    if (!sanitized.reason || sanitized.reason.trim().length === 0) {
      violations.push('Hard deletion should include a reason for audit purposes');
    }
  }

  const isValid = violations.length === 0;
  
  return {
    sanitized,
    violations,
    isValid
  };
}

/**
 * Create sanitization summary for logging
 */
export function createSanitizationSummary(violations: string[]): {
  hasCriticalIssues: boolean;
  hasWarnings: boolean;
  criticalCount: number;
  warningCount: number;
  summary: string;
} {
  const criticalKeywords = ['dangerous pattern', 'injection', 'script', 'disallowed characters'];
  const criticalViolations = violations.filter(v => 
    criticalKeywords.some(keyword => v.toLowerCase().includes(keyword))
  );
  
  const hasCriticalIssues = criticalViolations.length > 0;
  const hasWarnings = violations.length > 0;
  const criticalCount = criticalViolations.length;
  const warningCount = violations.length - criticalCount;
  
  let summary = '';
  if (hasCriticalIssues) {
    summary += `${criticalCount} critical security issues detected. `;
  }
  if (warningCount > 0) {
    summary += `${warningCount} data validation warnings. `;
  }
  if (!hasWarnings) {
    summary = 'All input validation passed.';
  }

  return {
    hasCriticalIssues,
    hasWarnings,
    criticalCount,
    warningCount,
    summary
  };
}