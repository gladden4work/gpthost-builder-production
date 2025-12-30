/**
 * Shared Logger Utility - Phase 4: Observability
 *
 * Provides centralized event logging with:
 * - Code snippet truncation (2KB cap)
 * - Hash-based deduplication
 * - Structured event storage in R2/KV
 * - Integration with errorLogStorage and projectTimeline
 */

import { appendTimelineEvent } from './projectTimeline';
import type { Env } from '../types/env';

/**
 * Event types for categorization
 */
export type EventType =
  | 'build_success'
  | 'build_failure'
  | 'code_paste_error'
  | 'unsupported_code'
  | 'parse_error'
  | 'deployment_success'
  | 'deployment_failure'
  | 'user_signup'
  | 'project_created';

/**
 * Event severity levels
 */
export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

/**
 * Structured log event
 */
export interface LogEvent {
  id?: string;
  type: EventType;
  severity: EventSeverity;
  message: string;
  timestamp: string;
  projectId?: string;
  userId?: string;
  metadata?: Record<string, any>;
  codeSnippet?: string;
  codeHash?: string;
}

/**
 * Logger configuration
 */
const CONFIG = {
  MAX_SNIPPET_SIZE: 2048, // 2KB max for code snippets
  TRUNCATION_SUFFIX: '\n... (truncated)',
};

/**
 * Generate hash for code deduplication using Web Crypto
 */
async function generateCodeHash(code: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(code);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return hex.substring(0, 16); // First 16 chars for brevity
}

/**
 * Generate a stable event ID for cross-lookups
 */
function generateEventId(type: EventType): string {
  const randomPart = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().split('-')[0]
    : Math.random().toString(36).substring(2, 10);
  return `${type}-${Date.now()}-${randomPart}`;
}

/**
 * Truncate code snippet to max size
 */
function truncateCode(code: string): string {
  if (code.length <= CONFIG.MAX_SNIPPET_SIZE) {
    return code;
  }

  const truncatedLength = CONFIG.MAX_SNIPPET_SIZE - CONFIG.TRUNCATION_SUFFIX.length;
  return code.substring(0, truncatedLength) + CONFIG.TRUNCATION_SUFFIX;
}

/**
 * Shared logger class
 */
export class SharedLogger {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Log an event to both errorLogStorage (for errors) and projectTimeline (for successes)
   */
  async logEvent(event: Partial<LogEvent> & { type: EventType; severity: EventSeverity; message: string }): Promise<void> {
    try {
      // Build complete event
      const completeEvent: LogEvent = {
        id: event.id ?? generateEventId(event.type),
        ...event,
        timestamp: new Date().toISOString(),
      };

      // Handle code snippets (truncate and hash)
      if (completeEvent.metadata?.code) {
        const originalCode = completeEvent.metadata.code;
        completeEvent.codeSnippet = truncateCode(originalCode);
        completeEvent.codeHash = await generateCodeHash(originalCode);

        // Store full code separately if it exceeds truncation limit
        const needsFullCodeStorage = originalCode.length > CONFIG.MAX_SNIPPET_SIZE;
        if (needsFullCodeStorage) {
          const eventId = completeEvent.id ?? generateEventId(completeEvent.type);
          const fullCodeKey = `global-events/${eventId}-full-code.txt`;
          await this.env.PROJECTS_BUCKET.put(fullCodeKey, originalCode, {
            httpMetadata: { contentType: 'text/plain' },
            customMetadata: {
              event_id: eventId,
              original_length: originalCode.length.toString(),
            },
          });
          completeEvent.metadata.hasFullCode = true;
        }

        // Replace full code with truncated version in metadata
        completeEvent.metadata.code = completeEvent.codeSnippet;
        completeEvent.metadata.codeHash = completeEvent.codeHash;
      }

      // Store event in appropriate location
      if (event.severity === 'error' || event.severity === 'critical') {
        // Store errors in R2 error logs
        await this.storeErrorLog(completeEvent);
      }

      // Also add to project timeline if projectId exists
      if (completeEvent.projectId) {
        await this.addToTimeline(completeEvent);
      }

      // Store in global event log for admin dashboard
      await this.storeGlobalEvent(completeEvent);

      console.info('[SHARED-LOGGER] Event logged', {
        type: event.type,
        severity: event.severity,
        projectId: event.projectId,
        hasCodeSnippet: !!completeEvent.codeSnippet,
      });
    } catch (error) {
      console.error('[SHARED-LOGGER] Failed to log event', {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.type,
      });
      // Don't throw - logging failure shouldn't break the main flow
    }
  }

  /**
   * Store error log in R2
   */
  private async storeErrorLog(event: LogEvent): Promise<void> {
    const errorId = event.id ?? generateEventId(event.type);
    const key = `error-logs/global/${errorId}.json`;

    await this.env.PROJECTS_BUCKET.put(
      key,
      JSON.stringify(event, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          error_id: errorId,
          event_type: event.type,
          severity: event.severity,
          project_id: event.projectId || '',
          user_id: event.userId || '',
          timestamp: event.timestamp,
          has_code: event.codeSnippet ? 'true' : 'false',
          code_hash: event.codeHash || '',
          type: 'global_error_log',
        },
      }
    );
  }

  /**
   * Add event to project timeline
   */
  private async addToTimeline(event: LogEvent): Promise<void> {
    if (!event.projectId) return;

    await appendTimelineEvent(
      event.projectId,
      this.env,
      event.message,
      {
        type: event.type,
        severity: event.severity,
        ...event.metadata,
      }
    );
  }

  /**
   * Store event in global event log (for admin dashboard)
   */
  private async storeGlobalEvent(event: LogEvent): Promise<void> {
    const eventId = event.id ?? generateEventId(event.type);
    const key = `global-events/${eventId}.json`;
    const eventWithId: LogEvent = { ...event, id: eventId };

    await this.env.PROJECTS_BUCKET.put(
      key,
      JSON.stringify(eventWithId, null, 2),
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: {
          event_id: eventId,
          event_type: event.type,
          severity: event.severity,
          project_id: event.projectId || '',
          user_id: event.userId || '',
          timestamp: event.timestamp,
          has_code: event.codeSnippet ? 'true' : 'false',
          code_hash: event.codeHash || '',
          type: 'global_event',
        },
      }
    );
  }

  /**
   * Helper: Log a build success
   */
  async logBuildSuccess(projectId: string, userId: string, metadata?: Record<string, any>): Promise<void> {
    await this.logEvent({
      type: 'build_success',
      severity: 'info',
      message: 'Build completed successfully',
      projectId,
      userId,
      metadata,
    });
  }

  /**
   * Helper: Log a build failure
   */
  async logBuildFailure(
    projectId: string,
    userId: string,
    error: string,
    code?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      type: 'build_failure',
      severity: 'error',
      message: `Build failed: ${error}`,
      projectId,
      userId,
      metadata: {
        ...metadata,
        error,
        code,
      },
    });
  }

  /**
   * Helper: Log unsupported code pattern
   */
  async logUnsupportedCode(
    framework: string,
    error: string,
    code: string,
    projectId?: string,
    userId?: string
  ): Promise<void> {
    await this.logEvent({
      type: 'unsupported_code',
      severity: 'warning',
      message: `Unsupported ${framework} code pattern detected`,
      projectId,
      userId,
      metadata: {
        framework,
        error,
        code,
      },
    });
  }

  /**
   * Helper: Log deployment success
   */
  async logDeploymentSuccess(
    projectId: string,
    userId: string,
    deploymentUrl: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      type: 'deployment_success',
      severity: 'info',
      message: 'Deployment completed successfully',
      projectId,
      userId,
      metadata: {
        ...metadata,
        deploymentUrl,
      },
    });
  }

  /**
   * Helper: Log code paste error
   */
  async logCodePasteError(
    error: string,
    code: string,
    userId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.logEvent({
      type: 'code_paste_error',
      severity: 'warning',
      message: `Code paste failed: ${error}`,
      userId,
      metadata: {
        ...metadata,
        error,
        code,
      },
    });
  }
}

/**
 * Factory function to create a shared logger instance
 */
export function createSharedLogger(env: Env): SharedLogger {
  return new SharedLogger(env);
}
