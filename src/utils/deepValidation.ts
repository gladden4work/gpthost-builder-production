/**
 * TASK-034: Deep Validation Utility
 * 
 * Comprehensive validation for nested objects, build configurations,
 * environment variables, and complex data structures in project metadata.
 * 
 * Features:
 * - Deep validation of nested objects
 * - Build configuration validation
 * - Environment variable validation
 * - Security headers validation
 * - Custom field validation with type checking
 * - Performance and resource limit validation
 */

import { EnhancedProjectMetadata, ProjectBuildConfig, ExtendedProjectStatus } from '../types/api';

/**
 * Validation error details
 */
interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
  value?: any;
  suggestion?: string;
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Validation rule definition
 */
interface ValidationRule {
  field: string;
  type: 'required' | 'type' | 'format' | 'enum' | 'range' | 'length' | 'custom';
  rule: any;
  message: string;
  severity: 'error' | 'warning';
  condition?: (obj: any) => boolean;
}

/**
 * Build configuration validation rules
 */
const BUILD_CONFIG_RULES: ValidationRule[] = [
  // Environment variables validation
  {
    field: 'build_config.environment_variables',
    type: 'type',
    rule: 'object',
    message: 'Environment variables must be an object',
    severity: 'error'
  },
  {
    field: 'build_config.environment_variables',
    type: 'custom',
    rule: (envVars: Record<string, string>) => {
      if (!envVars) return true;
      return Object.keys(envVars).length <= 50;
    },
    message: 'Too many environment variables (maximum 50 allowed)',
    severity: 'warning'
  },

  // Build commands validation
  {
    field: 'build_config.build_commands.install',
    type: 'format',
    rule: /^[a-zA-Z0-9\s\-_./:@&=]*$/,
    message: 'Install command contains potentially dangerous characters',
    severity: 'error',
    condition: (obj) => obj.build_config?.build_commands?.install
  },
  {
    field: 'build_config.build_commands.build',
    type: 'format',
    rule: /^[a-zA-Z0-9\s\-_./:@&=]*$/,
    message: 'Build command contains potentially dangerous characters',
    severity: 'error',
    condition: (obj) => obj.build_config?.build_commands?.build
  },
  {
    field: 'build_config.build_commands.test',
    type: 'format',
    rule: /^[a-zA-Z0-9\s\-_./:@&=]*$/,
    message: 'Test command contains potentially dangerous characters',
    severity: 'error',
    condition: (obj) => obj.build_config?.build_commands?.test
  },

  // Optimization settings validation
  {
    field: 'build_config.optimization_settings.minification',
    type: 'type',
    rule: 'boolean',
    message: 'Minification setting must be a boolean',
    severity: 'error',
    condition: (obj) => obj.build_config?.optimization_settings?.minification !== undefined
  },
  {
    field: 'build_config.optimization_settings.tree_shaking',
    type: 'type',
    rule: 'boolean',
    message: 'Tree shaking setting must be a boolean',
    severity: 'error',
    condition: (obj) => obj.build_config?.optimization_settings?.tree_shaking !== undefined
  },

  // Target environment validation
  {
    field: 'build_config.target_environment.node_version',
    type: 'format',
    rule: /^(1[2-9]|2[0-9]|30)(\.\d+)*$/,
    message: 'Node version must be 12.0 or higher',
    severity: 'warning',
    condition: (obj) => obj.build_config?.target_environment?.node_version
  },
  {
    field: 'build_config.target_environment.browser_targets',
    type: 'type',
    rule: 'array',
    message: 'Browser targets must be an array',
    severity: 'error',
    condition: (obj) => obj.build_config?.target_environment?.browser_targets
  },
  {
    field: 'build_config.target_environment.module_format',
    type: 'enum',
    rule: ['commonjs', 'esm', 'umd', 'amd', 'iife'],
    message: 'Module format must be one of: commonjs, esm, umd, amd, iife',
    severity: 'error',
    condition: (obj) => obj.build_config?.target_environment?.module_format
  }
];

/**
 * Deployment configuration validation rules
 */
const DEPLOYMENT_CONFIG_RULES: ValidationRule[] = [
  {
    field: 'deployment_config.environment',
    type: 'enum',
    rule: ['development', 'staging', 'production'],
    message: 'Environment must be one of: development, staging, production',
    severity: 'error',
    condition: (obj) => obj.deployment_config?.environment
  },
  {
    field: 'deployment_config.ssl_enabled',
    type: 'type',
    rule: 'boolean',
    message: 'SSL enabled must be a boolean',
    severity: 'error',
    condition: (obj) => obj.deployment_config?.ssl_enabled !== undefined
  },
  {
    field: 'deployment_config.security_headers',
    type: 'type',
    rule: 'object',
    message: 'Security headers must be an object',
    severity: 'error',
    condition: (obj) => obj.deployment_config?.security_headers
  }
];

/**
 * Tags validation rules
 */
const TAGS_RULES: ValidationRule[] = [
  {
    field: 'tags',
    type: 'type',
    rule: 'array',
    message: 'Tags must be an array',
    severity: 'error',
    condition: (obj) => obj.tags
  },
  {
    field: 'tags',
    type: 'length',
    rule: { max: 10 },
    message: 'Maximum 10 tags allowed',
    severity: 'warning',
    condition: (obj) => Array.isArray(obj.tags)
  },
  {
    field: 'tags',
    type: 'custom',
    rule: (tags: any[]) => {
      if (!Array.isArray(tags)) return true;
      return tags.every(tag => 
        tag && 
        typeof tag === 'object' && 
        typeof tag.name === 'string' && 
        tag.name.length > 0 && 
        tag.name.length <= 50
      );
    },
    message: 'Each tag must have a valid name (1-50 characters)',
    severity: 'error',
    condition: (obj) => Array.isArray(obj.tags)
  }
];

/**
 * General metadata validation rules
 */
const GENERAL_RULES: ValidationRule[] = [
  {
    field: 'display_name',
    type: 'required',
    rule: true,
    message: 'Display name is required',
    severity: 'error'
  },
  {
    field: 'display_name',
    type: 'length',
    rule: { min: 1, max: 100 },
    message: 'Display name must be 1-100 characters',
    severity: 'error',
    condition: (obj) => obj.display_name
  },
  {
    field: 'description',
    type: 'length',
    rule: { max: 1000 },
    message: 'Description must not exceed 1000 characters',
    severity: 'warning',
    condition: (obj) => obj.description
  },
  {
    field: 'category',
    type: 'enum',
    rule: ['prototype', 'demo', 'production', 'experiment', 'template'],
    message: 'Category must be one of: prototype, demo, production, experiment, template',
    severity: 'error',
    condition: (obj) => obj.category
  },
  {
    field: 'visibility',
    type: 'enum',
    rule: ['private', 'public', 'shared'],
    message: 'Visibility must be one of: private, public, shared',
    severity: 'error',
    condition: (obj) => obj.visibility
  },
  {
    field: 'extended_status',
    type: 'enum',
    rule: ['pending', 'building', 'build_failed', 'deployed', 'active', 'inactive', 'archived', 'suspended', 'deleted'],
    message: 'Extended status has invalid value',
    severity: 'error',
    condition: (obj) => obj.extended_status
  }
];

/**
 * Environment variable validation
 */
export function validateEnvironmentVariables(
  envVars: Record<string, string>
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!envVars || typeof envVars !== 'object') {
    return { valid: true, errors: [], warnings: [] };
  }

  for (const [key, value] of Object.entries(envVars)) {
    // Validate key format
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      errors.push({
        field: `environment_variables.${key}`,
        message: 'Environment variable keys must be uppercase letters, numbers, and underscores',
        severity: 'error',
        value: key,
        suggestion: 'Use UPPER_CASE format for environment variable names'
      });
    }

    // Check key length
    if (key.length > 100) {
      errors.push({
        field: `environment_variables.${key}`,
        message: 'Environment variable key too long (max 100 characters)',
        severity: 'error',
        value: key
      });
    }

    // Validate value
    const stringValue = String(value || '');
    if (stringValue.length > 10000) {
      errors.push({
        field: `environment_variables.${key}`,
        message: 'Environment variable value too long (max 10000 characters)',
        severity: 'error',
        value: stringValue.substring(0, 100) + '...'
      });
    }

    // Check for dangerous patterns in values
    const dangerousPatterns = [
      /\$\(.*\)/g,  // Command substitution
      /`.*`/g,      // Backticks
      /;|\||&/g     // Command chaining
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(stringValue)) {
        warnings.push({
          field: `environment_variables.${key}`,
          message: 'Environment variable value contains potentially dangerous characters',
          severity: 'warning',
          value: key,
          suggestion: 'Avoid command injection patterns in environment variables'
        });
      }
    }

    // Check for common secrets in non-secure context
    const secretPatterns = [/password/i, /secret/i, /token/i, /key/i, /auth/i];
    const isSensitive = secretPatterns.some(pattern => pattern.test(key));
    
    if (isSensitive && stringValue.length > 0 && stringValue.length < 20) {
      warnings.push({
        field: `environment_variables.${key}`,
        message: 'Sensitive environment variable value seems too short',
        severity: 'warning',
        value: key,
        suggestion: 'Ensure sensitive values are properly formatted'
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate security headers
 */
export function validateSecurityHeaders(
  headers: Record<string, string>
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!headers || typeof headers !== 'object') {
    return { valid: true, errors: [], warnings: [] };
  }

  const knownSecurityHeaders = {
    'Content-Security-Policy': {
      required: false,
      pattern: /^[a-zA-Z0-9\s\-'":;./*=()_]+$/,
      maxLength: 2000
    },
    'X-Content-Type-Options': {
      required: true,
      pattern: /^nosniff$/,
      maxLength: 10
    },
    'X-Frame-Options': {
      required: true,
      pattern: /^(DENY|SAMEORIGIN|ALLOW-FROM\s+https?:\/\/.+)$/,
      maxLength: 200
    },
    'X-XSS-Protection': {
      required: true,
      pattern: /^[01](;\s*mode=block)?$/,
      maxLength: 20
    },
    'Strict-Transport-Security': {
      required: false,
      pattern: /^max-age=\d+(\s*;\s*(includeSubDomains|preload))*$/,
      maxLength: 100
    },
    'Referrer-Policy': {
      required: false,
      pattern: /^(no-referrer|no-referrer-when-downgrade|origin|origin-when-cross-origin|same-origin|strict-origin|strict-origin-when-cross-origin|unsafe-url)$/,
      maxLength: 50
    }
  };

  // Validate known headers
  for (const [headerName, config] of Object.entries(knownSecurityHeaders)) {
    const value = headers[headerName];
    
    if (config.required && !value) {
      warnings.push({
        field: `security_headers.${headerName}`,
        message: `Recommended security header '${headerName}' is missing`,
        severity: 'warning',
        suggestion: `Add '${headerName}' for better security`
      });
      continue;
    }

    if (value) {
      if (!config.pattern.test(value)) {
        errors.push({
          field: `security_headers.${headerName}`,
          message: `Invalid format for security header '${headerName}'`,
          severity: 'error',
          value: value
        });
      }

      if (value.length > config.maxLength) {
        errors.push({
          field: `security_headers.${headerName}`,
          message: `Security header '${headerName}' value too long`,
          severity: 'error',
          value: value.substring(0, 50) + '...'
        });
      }
    }
  }

  // Validate unknown headers
  for (const [headerName, value] of Object.entries(headers)) {
    if (!knownSecurityHeaders[headerName]) {
      warnings.push({
        field: `security_headers.${headerName}`,
        message: `Unknown security header '${headerName}'`,
        severity: 'warning',
        value: headerName,
        suggestion: 'Verify this is a valid security header'
      });
    }

    // General validation for all headers
    if (typeof value !== 'string') {
      errors.push({
        field: `security_headers.${headerName}`,
        message: 'Security header values must be strings',
        severity: 'error',
        value: typeof value
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate build configuration
 */
export function validateBuildConfig(
  buildConfig: Partial<ProjectBuildConfig>
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!buildConfig || typeof buildConfig !== 'object') {
    return { valid: true, errors: [], warnings: [] };
  }

  // Validate environment variables
  if (buildConfig.environment_variables) {
    const envResult = validateEnvironmentVariables(buildConfig.environment_variables);
    errors.push(...envResult.errors);
    warnings.push(...envResult.warnings);
  }

  // Validate build commands
  if (buildConfig.build_commands) {
    const commands = buildConfig.build_commands;
    const commandFields = ['install', 'build', 'test'] as const;

    for (const field of commandFields) {
      const command = commands[field];
      if (command && typeof command === 'string') {
        // Check for dangerous command patterns
        const dangerousPatterns = [
          /rm\s+-rf/gi,
          /sudo/gi,
          /curl.*\|.*sh/gi,
          /wget.*\|.*sh/gi,
          /eval/gi,
          /exec/gi,
          /\$\(/g,
          /`.*`/g
        ];

        for (const pattern of dangerousPatterns) {
          if (pattern.test(command)) {
            errors.push({
              field: `build_commands.${field}`,
              message: `Potentially dangerous command detected in ${field}`,
              severity: 'error',
              value: command,
              suggestion: 'Remove potentially harmful command patterns'
            });
          }
        }

        // Check command length
        if (command.length > 500) {
          warnings.push({
            field: `build_commands.${field}`,
            message: `Build command is very long (${command.length} characters)`,
            severity: 'warning',
            value: command.substring(0, 100) + '...'
          });
        }
      }
    }
  }

  // Validate optimization settings
  if (buildConfig.optimization_settings) {
    const settings = buildConfig.optimization_settings;
    const booleanFields = ['minification', 'tree_shaking', 'code_splitting', 'source_maps'] as const;

    for (const field of booleanFields) {
      const value = settings[field];
      if (value !== undefined && typeof value !== 'boolean') {
        errors.push({
          field: `optimization_settings.${field}`,
          message: `${field} must be a boolean value`,
          severity: 'error',
          value: value
        });
      }
    }
  }

  // Validate target environment
  if (buildConfig.target_environment) {
    const target = buildConfig.target_environment;

    if (target.node_version) {
      const nodeVersion = target.node_version;
      if (!/^\d+(\.\d+)*$/.test(nodeVersion)) {
        errors.push({
          field: 'target_environment.node_version',
          message: 'Invalid Node.js version format',
          severity: 'error',
          value: nodeVersion,
          suggestion: 'Use format like "18.0.0" or "18"'
        });
      } else {
        const majorVersion = parseInt(nodeVersion.split('.')[0]);
        if (majorVersion < 12) {
          warnings.push({
            field: 'target_environment.node_version',
            message: 'Node.js version is older than recommended minimum (12.0)',
            severity: 'warning',
            value: nodeVersion,
            suggestion: 'Consider using Node.js 16 or higher'
          });
        }
      }
    }

    if (target.browser_targets && !Array.isArray(target.browser_targets)) {
      errors.push({
        field: 'target_environment.browser_targets',
        message: 'Browser targets must be an array',
        severity: 'error',
        value: typeof target.browser_targets
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Apply validation rule to an object
 */
function applyValidationRule(obj: any, rule: ValidationRule): ValidationError | null {
  // Check condition if specified
  if (rule.condition && !rule.condition(obj)) {
    return null;
  }

  const value = getNestedValue(obj, rule.field);

  switch (rule.type) {
    case 'required':
      if (rule.rule === true && (value === undefined || value === null || value === '')) {
        return {
          field: rule.field,
          message: rule.message,
          severity: rule.severity,
          value
        };
      }
      break;

    case 'type':
      if (value !== undefined && value !== null) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== rule.rule) {
          return {
            field: rule.field,
            message: rule.message,
            severity: rule.severity,
            value: actualType
          };
        }
      }
      break;

    case 'format':
      if (value && typeof value === 'string' && !rule.rule.test(value)) {
        return {
          field: rule.field,
          message: rule.message,
          severity: rule.severity,
          value
        };
      }
      break;

    case 'enum':
      if (value !== undefined && !rule.rule.includes(value)) {
        return {
          field: rule.field,
          message: rule.message,
          severity: rule.severity,
          value
        };
      }
      break;

    case 'range':
      if (typeof value === 'number') {
        if ((rule.rule.min !== undefined && value < rule.rule.min) ||
            (rule.rule.max !== undefined && value > rule.rule.max)) {
          return {
            field: rule.field,
            message: rule.message,
            severity: rule.severity,
            value
          };
        }
      }
      break;

    case 'length':
      if (value && (typeof value === 'string' || Array.isArray(value))) {
        const length = value.length;
        if ((rule.rule.min !== undefined && length < rule.rule.min) ||
            (rule.rule.max !== undefined && length > rule.rule.max)) {
          return {
            field: rule.field,
            message: rule.message,
            severity: rule.severity,
            value: length
          };
        }
      }
      break;

    case 'custom':
      if (typeof rule.rule === 'function' && !rule.rule(value)) {
        return {
          field: rule.field,
          message: rule.message,
          severity: rule.severity,
          value
        };
      }
      break;
  }

  return null;
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Comprehensive deep validation for project metadata
 */
export function validateProjectMetadata(
  metadata: Partial<EnhancedProjectMetadata>
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Apply all validation rules
  const allRules = [
    ...GENERAL_RULES,
    ...BUILD_CONFIG_RULES,
    ...DEPLOYMENT_CONFIG_RULES,
    ...TAGS_RULES
  ];

  for (const rule of allRules) {
    const error = applyValidationRule(metadata, rule);
    if (error) {
      if (error.severity === 'error') {
        errors.push(error);
      } else {
        warnings.push(error);
      }
    }
  }

  // Additional specific validations
  if (metadata.build_config) {
    const buildResult = validateBuildConfig(metadata.build_config);
    errors.push(...buildResult.errors);
    warnings.push(...buildResult.warnings);
  }

  if (metadata.deployment_config?.security_headers) {
    const headerResult = validateSecurityHeaders(metadata.deployment_config.security_headers);
    errors.push(...headerResult.errors);
    warnings.push(...headerResult.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate custom fields with type checking
 */
export function validateCustomFields(
  customFields: Record<string, any>
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!customFields || typeof customFields !== 'object') {
    return { valid: true, errors: [], warnings: [] };
  }

  const maxCustomFields = 20;
  const maxFieldNameLength = 50;
  const maxFieldValueSize = 10000; // 10KB per field

  if (Object.keys(customFields).length > maxCustomFields) {
    errors.push({
      field: 'custom_fields',
      message: `Too many custom fields (maximum ${maxCustomFields} allowed)`,
      severity: 'error',
      value: Object.keys(customFields).length
    });
  }

  for (const [key, value] of Object.entries(customFields)) {
    if (key.length > maxFieldNameLength) {
      errors.push({
        field: `custom_fields.${key}`,
        message: `Custom field name too long (maximum ${maxFieldNameLength} characters)`,
        severity: 'error',
        value: key
      });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
      errors.push({
        field: `custom_fields.${key}`,
        message: 'Custom field names must contain only letters, numbers, hyphens, and underscores',
        severity: 'error',
        value: key
      });
    }

    // Check value size
    const serializedValue = JSON.stringify(value);
    if (serializedValue.length > maxFieldValueSize) {
      errors.push({
        field: `custom_fields.${key}`,
        message: `Custom field value too large (maximum ${maxFieldValueSize} characters)`,
        severity: 'error',
        value: `${serializedValue.length} characters`
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}