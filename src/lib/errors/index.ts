/**
 * Canonical error definitions from steering documents
 * Centralized error handling for all services
 */

// Base error interface for all domain errors
export interface DomainError {
  code: string;
  message: string;
  timestamp: Date;
  context?: ErrorContext;
  cause?: Error;
}

export interface ErrorContext {
  service?: string;
  operation?: string;
  userId?: string;
  projectId?: string;
  requestId?: string;
  [key: string]: unknown;
}

// Base class for domain errors
export abstract class BaseDomainError extends Error implements DomainError {
  abstract readonly code: string;
  readonly timestamp = new Date();
  
  constructor(
    message: string,
    public readonly context?: ErrorContext,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  toJSON(): object {
    return {
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      context: this.context,
      stack: this.stack
    };
  }
}

/**
 * Storage service errors
 */
export class StorageError extends BaseDomainError {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(message, context, cause);
  }
}

export enum StorageErrorCode {
  NOT_FOUND = 'STORAGE_NOT_FOUND',
  ACCESS_DENIED = 'STORAGE_ACCESS_DENIED',
  QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',
  NETWORK_ERROR = 'STORAGE_NETWORK_ERROR',
  INVALID_PATH = 'STORAGE_INVALID_PATH',
  OPERATION_FAILED = 'STORAGE_OPERATION_FAILED'
}

/**
 * Project service errors
 */
export class ProjectError extends BaseDomainError {
  constructor(
    public readonly code: ProjectErrorCode,
    message: string,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(message, context, cause);
  }
}

export enum ProjectErrorCode {
  NOT_FOUND = 'PROJECT_NOT_FOUND',
  ALREADY_EXISTS = 'PROJECT_ALREADY_EXISTS',
  INVALID_INPUT = 'PROJECT_INVALID_INPUT',
  INVALID_STATE = 'PROJECT_INVALID_STATE',
  STORAGE_ERROR = 'PROJECT_STORAGE_ERROR'
}

/**
 * GitHub service errors
 */
export class GitHubError extends BaseDomainError {
  constructor(
    public readonly code: GitHubErrorCode,
    message: string,
    public readonly rateLimitReset?: Date,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(message, context, cause);
  }
}

export enum GitHubErrorCode {
  RATE_LIMIT = 'GITHUB_RATE_LIMIT',
  NOT_FOUND = 'GITHUB_NOT_FOUND',
  UNAUTHORIZED = 'GITHUB_UNAUTHORIZED',
  AUTHENTICATION_FAILED = 'GITHUB_AUTHENTICATION_FAILED',
  WORKFLOW_NOT_FOUND = 'GITHUB_WORKFLOW_NOT_FOUND',
  WORKFLOW_FAILED = 'GITHUB_WORKFLOW_FAILED',
  INVALID_SIGNATURE = 'GITHUB_INVALID_SIGNATURE',
  INVALID_INPUT = 'GITHUB_INVALID_INPUT',
  NETWORK_ERROR = 'GITHUB_NETWORK_ERROR',
  API_ERROR = 'GITHUB_API_ERROR',
  TIMEOUT = 'GITHUB_TIMEOUT'
}

/**
 * Build service errors
 */
export class BuildError extends BaseDomainError {
  constructor(
    public readonly code: BuildErrorCode,
    message: string,
    public readonly buildId?: string,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(message, { ...context, buildId }, cause);
  }
}

export enum BuildErrorCode {
  NOT_FOUND = 'BUILD_NOT_FOUND',
  ALREADY_BUILDING = 'BUILD_ALREADY_BUILDING',
  QUEUE_FULL = 'BUILD_QUEUE_FULL',
  DEPENDENCY_ERROR = 'BUILD_DEPENDENCY_ERROR',
  SYNTAX_ERROR = 'BUILD_SYNTAX_ERROR',
  TIMEOUT = 'BUILD_TIMEOUT',
  CANCELLED = 'BUILD_CANCELLED',
  TRIGGER_FAILED = 'BUILD_TRIGGER_FAILED',
  INVALID_STATE = 'BUILD_INVALID_STATE',
  STORAGE_ERROR = 'BUILD_STORAGE_ERROR',
  MAX_RETRIES_EXCEEDED = 'BUILD_MAX_RETRIES_EXCEEDED',
  PROJECT_NOT_FOUND = 'BUILD_PROJECT_NOT_FOUND'
}

/**
 * Deployment service errors
 */
export class DeploymentError extends BaseDomainError {
  constructor(
    public readonly code: DeploymentErrorCode,
    message: string,
    context?: ErrorContext,
    cause?: Error
  ) {
    super(message, context, cause);
  }
}

export enum DeploymentErrorCode {
  NOT_FOUND = 'DEPLOYMENT_NOT_FOUND',
  BUILD_NOT_READY = 'DEPLOYMENT_BUILD_NOT_READY',
  INVALID_ARTIFACTS = 'DEPLOYMENT_INVALID_ARTIFACTS',
  HEALTH_CHECK_FAILED = 'DEPLOYMENT_HEALTH_CHECK_FAILED',
  ROLLBACK_FAILED = 'DEPLOYMENT_ROLLBACK_FAILED'
}