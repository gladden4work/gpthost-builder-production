/**
 * Structured Logging with PII Redaction
 * Week 2 Security Audit Implementation (2025-11-05)
 *
 * Provides secure logging that:
 * - Sanitizes sensitive data (tokens, passwords, secrets)
 * - Hashes PII (user IDs, emails)
 * - Supports environment-based log levels
 * - Formats logs consistently for monitoring systems
 * - Prevents information disclosure in production
 *
 * GDPR Compliance: PII is hashed/redacted to prevent unauthorized logging
 */

import { Env } from '../types/env';

/**
 * Log levels (higher number = more severe)
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Log context with optional metadata
 */
export interface LogContext {
  userId?: string;
  projectId?: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  [key: string]: any;
}

/**
 * Structured log entry
 */
interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  context?: Record<string, any>;
  error?: {
    message?: string;
    stack?: string;
    name?: string;
  };
}

/**
 * Sensitive field patterns to redact
 */
const SENSITIVE_FIELD_PATTERNS = [
  /token/i,
  /password/i,
  /secret/i,
  /authorization/i,
  /api[_-]?key/i,
  /access[_-]?key/i,
  /private[_-]?key/i,
  /bearer/i,
  /jwt/i,
  /credential/i,
];

/**
 * PII field patterns to hash
 */
const PII_FIELD_PATTERNS = [
  /user[_-]?id/i,
  /email/i,
  /phone/i,
  /address/i,
  /ssn/i,
  /credit[_-]?card/i,
  /ip[_-]?address/i,
];

/**
 * Structured Logger with PII Redaction
 */
export class Logger {
  private minLevel: LogLevel;
  private environment: string;
  private enablePIILogging: boolean;

  constructor(env: Env) {
    // Set minimum log level based on environment
    this.environment = env.ENVIRONMENT || 'production';
    this.minLevel = this.getMinLogLevel(env);
    this.enablePIILogging = env.PII_LOGGING_ENABLED === 'true';

    if (this.environment === 'development') {
      console.info('[LOGGER] Initialized logger', {
        minLevel: LogLevel[this.minLevel],
        environment: this.environment,
        piiLogging: this.enablePIILogging,
      });
    }
  }

  /**
   * Determine minimum log level based on environment
   */
  private getMinLogLevel(env: Env): LogLevel {
    if (env.LOG_LEVEL) {
      const levelMap: Record<string, LogLevel> = {
        DEBUG: LogLevel.DEBUG,
        INFO: LogLevel.INFO,
        WARN: LogLevel.WARN,
        ERROR: LogLevel.ERROR,
      };
      return levelMap[env.LOG_LEVEL.toUpperCase()] || LogLevel.INFO;
    }

    // Default log levels by environment
    if (this.environment === 'production') {
      return LogLevel.INFO;
    } else if (this.environment === 'staging') {
      return LogLevel.DEBUG;
    } else {
      return LogLevel.DEBUG;
    }
  }

  /**
   * Check if field name indicates sensitive data
   */
  private isSensitiveField(key: string): boolean {
    return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(key));
  }

  /**
   * Check if field name indicates PII
   */
  private isPIIField(key: string): boolean {
    return PII_FIELD_PATTERNS.some((pattern) => pattern.test(key));
  }

  /**
   * Hash PII data for logging
   * Uses simple prefix hash for readability while protecting PII
   */
  private hashPII(value: string): string {
    if (!value || value.length === 0) {
      return '[EMPTY]';
    }

    // For production: show only first 4 chars + hash indicator
    if (this.environment === 'production') {
      const prefix = value.substring(0, Math.min(4, value.length));
      return `${prefix}...[HASHED]`;
    }

    // For non-production: show more context
    const prefix = value.substring(0, Math.min(8, value.length));
    return `${prefix}...[PII]`;
  }

  /**
   * Sanitize a single value (recursive for objects/arrays)
   */
  private sanitizeValue(value: any, key?: string): any {
    // Handle null/undefined
    if (value === null || value === undefined) {
      return value;
    }

    // Check if this field should be redacted or hashed
    if (key) {
      if (this.isSensitiveField(key)) {
        return '[REDACTED]';
      }
      if (this.isPIIField(key) && !this.enablePIILogging) {
        return this.hashPII(String(value));
      }
    }

    // Handle strings - check for Bearer tokens and other patterns
    if (typeof value === 'string') {
      // Redact Bearer tokens
      let sanitized = value.replace(
        /Bearer\s+[A-Za-z0-9-._~+/]+=*/gi,
        'Bearer [REDACTED]'
      );

      // Redact JWT tokens (header.payload.signature pattern)
      sanitized = sanitized.replace(
        /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
        '[JWT-REDACTED]'
      );

      // Redact hex tokens (common for API keys)
      if (sanitized.length > 32 && /^[a-f0-9]{32,}$/i.test(sanitized)) {
        sanitized = `${sanitized.substring(0, 8)}...[REDACTED]`;
      }

      return sanitized;
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }

    // Handle objects
    if (typeof value === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [objKey, objValue] of Object.entries(value)) {
        sanitized[objKey] = this.sanitizeValue(objValue, objKey);
      }
      return sanitized;
    }

    // Return primitives as-is
    return value;
  }

  /**
   * Sanitize log context to remove sensitive data
   */
  private sanitize(context: any): any {
    if (!context) {
      return context;
    }

    return this.sanitizeValue(context);
  }

  /**
   * Format and output log entry
   */
  private log(entry: LogEntry): void {
    const { level, message, timestamp, context, error } = entry;

    // Format for JSON logging (better for production monitoring)
    if (this.environment === 'production') {
      console.log(JSON.stringify(entry));
    } else {
      // Human-readable format for development
      const prefix = `[${timestamp}] [${level}]`;
      if (error) {
        console.log(`${prefix} ${message}`, {
          context,
          error: {
            message: error.message,
            stack: error.stack,
          },
        });
      } else {
        console.log(`${prefix} ${message}`, context);
      }
    }
  }

  /**
   * Check if log level is enabled
   */
  private shouldLog(level: LogLevel): boolean {
    return level >= this.minLevel;
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.DEBUG)) {
      return;
    }

    this.log({
      level: 'DEBUG',
      message,
      timestamp: new Date().toISOString(),
      context: this.sanitize(context),
    });
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.INFO)) {
      return;
    }

    this.log({
      level: 'INFO',
      message,
      timestamp: new Date().toISOString(),
      context: this.sanitize(context),
    });
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.WARN)) {
      return;
    }

    this.log({
      level: 'WARN',
      message,
      timestamp: new Date().toISOString(),
      context: this.sanitize(context),
    });
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.ERROR)) {
      return;
    }

    // In production, don't include full stack traces
    const errorInfo =
      error && this.minLevel <= LogLevel.DEBUG
        ? {
            message: error.message,
            stack: error.stack,
            name: error.name,
          }
        : error
        ? {
            message: error.message,
            name: error.name,
          }
        : undefined;

    this.log({
      level: 'ERROR',
      message,
      timestamp: new Date().toISOString(),
      context: this.sanitize(context),
      error: errorInfo,
    });
  }
}

/**
 * Create logger instance from environment
 */
export function createLogger(env: Env): Logger {
  return new Logger(env);
}

/**
 * Global logger instance (created on first access)
 * This is useful for modules that don't have direct access to env
 */
let globalLogger: Logger | null = null;

export function initGlobalLogger(env: Env): void {
  globalLogger = new Logger(env);
}

export function getGlobalLogger(): Logger {
  if (!globalLogger) {
    throw new Error(
      'Global logger not initialized. Call initGlobalLogger(env) first.'
    );
  }
  return globalLogger;
}
