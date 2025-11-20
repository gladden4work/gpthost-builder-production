/**
 * Canonical error types and codes for GPTHost services
 * Based on error-handling-strategy.md from steering documents
 */

/**
 * Storage service error codes
 */
export enum StorageErrorCode {
  NOT_FOUND = 'STORAGE_NOT_FOUND',
  INVALID_PATH = 'STORAGE_INVALID_PATH',
  OPERATION_FAILED = 'STORAGE_OPERATION_FAILED'
}

/**
 * Project service error codes
 */
export enum ProjectErrorCode {
  NOT_FOUND = 'PROJECT_NOT_FOUND',
  INVALID_INPUT = 'PROJECT_INVALID_INPUT',
  INVALID_STATE = 'PROJECT_INVALID_STATE',
  STORAGE_ERROR = 'PROJECT_STORAGE_ERROR'
}

/**
 * GitHub service error codes
 */
export enum GitHubErrorCode {
  AUTHENTICATION_FAILED = 'GITHUB_AUTH_FAILED',
  WORKFLOW_NOT_FOUND = 'GITHUB_WORKFLOW_NOT_FOUND',
  INVALID_INPUT = 'GITHUB_INVALID_INPUT',
  API_ERROR = 'GITHUB_API_ERROR',
  NETWORK_ERROR = 'GITHUB_NETWORK_ERROR',
  INVALID_SIGNATURE = 'GITHUB_INVALID_SIGNATURE',
  RATE_LIMIT = 'GITHUB_RATE_LIMITED',
  RATE_LIMIT_EXCEEDED = 'GITHUB_RATE_LIMIT'
}

/**
 * Build service error codes
 */
export enum BuildErrorCode {
  BUILD_NOT_FOUND = 'BUILD_NOT_FOUND',
  TRIGGER_FAILED = 'BUILD_TRIGGER_FAILED',
  MAX_RETRIES_EXCEEDED = 'BUILD_MAX_RETRIES',
  STORAGE_ERROR = 'BUILD_STORAGE_ERROR',
  PROJECT_NOT_FOUND = 'BUILD_PROJECT_NOT_FOUND',
  INVALID_STATE = 'BUILD_INVALID_STATE'
}

/**
 * Subdomain service error codes
 */
export enum SubdomainErrorCode {
  NOT_FOUND = 'SUBDOMAIN_NOT_FOUND',
  ALREADY_EXISTS = 'SUBDOMAIN_ALREADY_EXISTS',
  INVALID_NAME = 'SUBDOMAIN_INVALID_NAME',
  KV_ERROR = 'SUBDOMAIN_KV_ERROR',
  UNAUTHORIZED = 'SUBDOMAIN_UNAUTHORIZED'
}

/**
 * Base error class with structured error information
 */
export abstract class BaseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, any>,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Storage service error
 */
export class StorageError extends BaseError {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
    context?: Record<string, any>,
    cause?: Error
  ) {
    super(code, message, context, cause);
  }
}

/**
 * Project service error
 */
export class ProjectError extends BaseError {
  constructor(
    public readonly code: ProjectErrorCode,
    message: string,
    context?: Record<string, any>,
    cause?: Error
  ) {
    super(code, message, context, cause);
  }
}

/**
 * GitHub service error
 */
export class GitHubError extends BaseError {
  constructor(
    public readonly code: GitHubErrorCode,
    message: string,
    context?: Record<string, any>,
    cause?: Error
  ) {
    super(code, message, context, cause);
  }
}

/**
 * Build service error
 */
export class BuildError extends BaseError {
  constructor(
    public readonly code: BuildErrorCode,
    message: string,
    context?: Record<string, any>,
    cause?: Error
  ) {
    super(code, message, context, cause);
  }
}

/**
 * Subdomain service error
 */
export class SubdomainError extends BaseError {
  constructor(
    public readonly code: SubdomainErrorCode,
    message: string,
    context?: Record<string, any>,
    cause?: Error
  ) {
    super(code, message, context, cause);
  }
}

// Re-export canonical deployment error types so imports from 'lib/errors' include them
export { DeploymentError, DeploymentErrorCode } from './errors/index';
