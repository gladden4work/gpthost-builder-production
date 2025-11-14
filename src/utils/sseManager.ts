/**
 * TASK-025: Server-Sent Events (SSE) Manager
 *
 * This utility manages real-time Server-Sent Events connections for build status updates.
 * Provides a production-ready SSE implementation with connection management,
 * automatic reconnection, and proper error handling.
 *
 * Features:
 * - Multi-client SSE connection management
 * - Build status broadcast to connected clients
 * - Connection lifecycle management (connect, disconnect, cleanup)
 * - Automatic heartbeat and connection validation
 * - Comprehensive error handling and recovery
 * - Memory efficient connection tracking
 *
 * SECURITY FIX (Week 2): SSE CORS uses origin allowlist instead of wildcard
 */

import { EnhancedBuildStatus } from './buildStatusTracker';
import { Env } from '../types/env';

/**
 * Get allowed CORS origins (duplicated from cors.ts to avoid circular dependency)
 */
function getAllowedSSEOrigins(env?: Env): string[] {
  const DEFAULT_PRODUCTION_ORIGINS = [
    'https://app.gpthost.dev',
    'https://gpthost.dev',
    'https://staging0314.gpthost.online',
    'https://gpthost-staging.pages.dev'
  ];

  const DEFAULT_LOCAL_ORIGINS = [
    'http://localhost:8080',
    'http://localhost:5173',
    'http://localhost:3000'
  ];

  const envOrigins = env?.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((origin: string) => origin.trim()).filter(Boolean)
    : [];

  const combined = [...envOrigins, ...DEFAULT_PRODUCTION_ORIGINS, ...DEFAULT_LOCAL_ORIGINS];
  return Array.from(new Set(combined));
}

/**
 * Check if origin is allowed for SSE connections
 */
function isAllowedSSEOrigin(origin: string | null, env?: Env): boolean {
  if (!origin) return false;
  const allowedOrigins = getAllowedSSEOrigins(env);
  return allowedOrigins.includes(origin);
}

/**
 * SSE client connection information
 */
export interface SSEConnection {
  id: string;
  project_id: string;
  created_at: string;
  last_heartbeat: string;
  user_agent?: string;
  ip_address?: string;
}

/**
 * SSE message types for type-safe communication
 */
export type SSEMessageType = 
  | 'status_update'     // Build status changed
  | 'progress_update'   // Build progress changed
  | 'stage_change'      // Build stage changed
  | 'build_complete'    // Build finished (success/failure)
  | 'build_timeout'     // Build exceeded timeout
  | 'error'            // Error occurred
  | 'heartbeat'        // Connection keepalive
  | 'disconnect';      // Connection closing

/**
 * SSE message structure
 */
export interface SSEMessage {
  type: SSEMessageType;
  project_id: string;
  timestamp: string;
  data: any;
  event_id?: string;
}

/**
 * SSE broadcast options
 */
export interface SSEBroadcastOptions {
  project_id?: string;     // Broadcast to specific project only
  message_type?: SSEMessageType;
  exclude_connection?: string; // Exclude specific connection ID
}

/**
 * Connection statistics for monitoring
 */
export interface SSEConnectionStats {
  total_connections: number;
  connections_by_project: Record<string, number>;
  oldest_connection: string;
  newest_connection: string;
  total_messages_sent: number;
  connections_dropped: number;
}

/**
 * Production-ready SSE Manager with comprehensive connection handling
 */
export class SSEManager {
  private connections: Map<string, SSEConnection> = new Map();
  private projectConnections: Map<string, Set<string>> = new Map(); // project_id -> connection_ids
  private messagesSent: number = 0;
  private connectionsDropped: number = 0;
  private heartbeatInterval: number;
  private connectionTimeout: number;
  private maxConnections: number;

  constructor(options?: {
    heartbeatInterval?: number;
    connectionTimeout?: number;
    maxConnections?: number;
  }) {
    this.heartbeatInterval = options?.heartbeatInterval || 30000; // 30 seconds
    this.connectionTimeout = options?.connectionTimeout || 300000; // 5 minutes
    this.maxConnections = options?.maxConnections || 1000;

    console.info('✅ [SSE-MANAGER] Initialized SSE Manager', {
      heartbeat_interval: this.heartbeatInterval,
      connection_timeout: this.connectionTimeout,
      max_connections: this.maxConnections
    });

    // Note: Removed automatic periodic cleanup - now uses request-triggered cleanup
    console.info('✅ [SSE-MANAGER] Using request-triggered connection cleanup for Cloudflare Workers compatibility');
  }

  /**
   * Create a new SSE connection for real-time build status updates
   *
   * SECURITY FIX (Week 2): Now accepts env parameter for proper CORS origin checking
   */
  createConnection(
    projectId: string,
    request?: Request,
    env?: Env
  ): { response: Response; connectionId: string } {
    // Check connection limits
    if (this.connections.size >= this.maxConnections) {
      console.warn('[SSE-MANAGER] Connection limit reached, rejecting new connection', {
        current_connections: this.connections.size,
        max_connections: this.maxConnections,
        project_id: projectId
      });

      return {
        response: new Response('Connection limit exceeded', { status: 503 }),
        connectionId: ''
      };
    }

    // Generate unique connection ID
    const connectionId = this.generateConnectionId();
    const now = new Date().toISOString();

    // Create connection metadata
    const connection: SSEConnection = {
      id: connectionId,
      project_id: projectId,
      created_at: now,
      last_heartbeat: now,
      user_agent: request?.headers.get('User-Agent') || undefined,
      ip_address: request?.headers.get('CF-Connecting-IP') || 
                  request?.headers.get('X-Forwarded-For') || 
                  undefined
    };

    // Store connection
    this.connections.set(connectionId, connection);
    
    // Add to project connections map
    if (!this.projectConnections.has(projectId)) {
      this.projectConnections.set(projectId, new Set());
    }
    this.projectConnections.get(projectId)!.add(connectionId);

    console.info('✅ [SSE-MANAGER] New SSE connection established', {
      connection_id: connectionId,
      project_id: projectId,
      total_connections: this.connections.size,
      project_connections: this.projectConnections.get(projectId)?.size || 0,
      user_agent: connection.user_agent
    });

    // Create SSE ReadableStream
    const stream = new ReadableStream({
      start: (controller) => {
        // Send initial connection confirmation
        this.sendMessage(controller, {
          type: 'heartbeat',
          project_id: projectId,
          timestamp: now,
          data: {
            message: 'SSE connection established',
            connection_id: connectionId,
            polling_enabled: true
          }
        });

        // Store controller for future messages
        (connection as any).controller = controller;
      },
      cancel: () => {
        this.removeConnection(connectionId);
      }
    });

    // SECURITY FIX (Week 2): Determine allowed origin for CORS
    const origin = request?.headers.get('Origin');
    const allowedOrigins = getAllowedSSEOrigins(env);
    const isAllowed = isAllowedSSEOrigin(origin, env);

    // Use proper origin instead of wildcard
    const corsOrigin = (isAllowed && origin) ? origin : allowedOrigins[0];

    // Create SSE response with proper headers
    const response = new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': corsOrigin, // SECURITY: No more wildcard
        'Access-Control-Allow-Headers': 'Cache-Control',
        'Access-Control-Expose-Headers': 'Connection-ID',
        'Access-Control-Allow-Credentials': isAllowed ? 'true' : 'false', // Conditional credentials
        'Connection-ID': connectionId,
        // Add security headers for SSE
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin'
      }
    });

    return { response, connectionId };
  }

  /**
   * Broadcast build status update to all relevant connections
   */
  broadcastStatusUpdate(
    status: EnhancedBuildStatus,
    options?: SSEBroadcastOptions
  ): { sent: number; failed: number } {
    const projectId = status.metadata.job_id ? status.metadata.job_id.split('-')[0] : 'unknown';
    const targetProjectId = options?.project_id || projectId;

    console.info('[SSE-MANAGER] Broadcasting status update', {
      project_id: targetProjectId,
      status: status.status,
      progress: status.progress,
      stage: status.current_stage,
      target_connections: this.projectConnections.get(targetProjectId)?.size || 0
    });

    const message: SSEMessage = {
      type: 'status_update',
      project_id: targetProjectId,
      timestamp: new Date().toISOString(),
      data: status,
      event_id: this.generateEventId()
    };

    return this.broadcastMessage(message, options);
  }

  /**
   * Broadcast build completion notification
   */
  broadcastBuildComplete(
    projectId: string,
    status: EnhancedBuildStatus,
    options?: SSEBroadcastOptions
  ): { sent: number; failed: number } {
    console.info('[SSE-MANAGER] Broadcasting build completion', {
      project_id: projectId,
      final_status: status.status,
      duration: status.metadata.build_duration_ms,
      target_connections: this.projectConnections.get(projectId)?.size || 0
    });

    const deploymentUrlFromStatus = (status as any)?.deployment_url 
      || (status as any)?.metadata?.deployment_url 
      || (Array.isArray(status.logs) ? status.logs[0] : undefined);

    const message: SSEMessage = {
      type: 'build_complete',
      project_id: projectId,
      timestamp: new Date().toISOString(),
      data: {
        final_status: status.status,
        build_duration_ms: status.metadata.build_duration_ms,
        deployment_url: status.status === 'completed' ? deploymentUrlFromStatus : undefined,
        error_message: status.error?.message
      },
      event_id: this.generateEventId()
    };

    return this.broadcastMessage(message, options);
  }

  /**
   * Broadcast build timeout notification
   */
  broadcastBuildTimeout(
    projectId: string,
    durationMs: number,
    options?: SSEBroadcastOptions
  ): { sent: number; failed: number } {
    console.info('[SSE-MANAGER] Broadcasting build timeout', {
      project_id: projectId,
      duration_ms: durationMs,
      target_connections: this.projectConnections.get(projectId)?.size || 0
    });

    const message: SSEMessage = {
      type: 'build_timeout',
      project_id: projectId,
      timestamp: new Date().toISOString(),
      data: {
        timeout_duration_ms: durationMs,
        message: 'Build exceeded maximum allowed time'
      },
      event_id: this.generateEventId()
    };

    return this.broadcastMessage(message, options);
  }

  /**
   * Send heartbeat to all connections
   */
  sendHeartbeat(): { sent: number; failed: number } {
    const message: SSEMessage = {
      type: 'heartbeat',
      project_id: '*',
      timestamp: new Date().toISOString(),
      data: {
        server_time: new Date().toISOString(),
        active_connections: this.connections.size
      }
    };

    return this.broadcastMessage(message, { message_type: 'heartbeat' });
  }

  /**
   * Remove a specific connection
   */
  removeConnection(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return false;
    }

    // Remove from project connections map
    const projectConnections = this.projectConnections.get(connection.project_id);
    if (projectConnections) {
      projectConnections.delete(connectionId);
      
      // Clean up empty project connection sets
      if (projectConnections.size === 0) {
        this.projectConnections.delete(connection.project_id);
      }
    }

    // Close the connection if controller exists
    if ((connection as any).controller) {
      try {
        (connection as any).controller.close();
      } catch (error) {
        console.warn('[SSE-MANAGER] Error closing connection controller:', error);
      }
    }

    // Remove from connections map
    this.connections.delete(connectionId);
    this.connectionsDropped++;

    console.info('✅ [SSE-MANAGER] Connection removed', {
      connection_id: connectionId,
      project_id: connection.project_id,
      duration_ms: Date.now() - new Date(connection.created_at).getTime(),
      remaining_connections: this.connections.size
    });

    return true;
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): SSEConnectionStats {
    const connectionsByProject: Record<string, number> = {};
    
    for (const [projectId, connections] of Array.from(this.projectConnections)) {
      connectionsByProject[projectId] = connections.size;
    }

    const connectionTimes = Array.from(this.connections.values())
      .map(c => new Date(c.created_at).getTime());
    
    return {
      total_connections: this.connections.size,
      connections_by_project: connectionsByProject,
      oldest_connection: connectionTimes.length > 0 ? 
        new Date(Math.min(...connectionTimes)).toISOString() : '',
      newest_connection: connectionTimes.length > 0 ? 
        new Date(Math.max(...connectionTimes)).toISOString() : '',
      total_messages_sent: this.messagesSent,
      connections_dropped: this.connectionsDropped
    };
  }

  /**
   * Trigger connection cleanup on-demand (Cloudflare Workers compatible)
   * This replaces the automatic setInterval-based cleanup
   */
  triggerConnectionCleanup(): { cleaned: number; remaining: number } {
    const beforeCount = this.connections.size;
    this.cleanupStaleConnections();
    const afterCount = this.connections.size;
    const cleanedCount = beforeCount - afterCount;
    
    console.info('[SSE-MANAGER] On-demand connection cleanup completed', {
      cleaned_connections: cleanedCount,
      remaining_connections: afterCount,
      cleanup_triggered_at: new Date().toISOString()
    });
    
    return {
      cleaned: cleanedCount,
      remaining: afterCount
    };
  }

  /**
   * Validate all connections health and remove unhealthy ones
   */
  validateConnectionsHealth(): { healthy: number; removed: number } {
    let healthyCount = 0;
    let removedCount = 0;
    const connectionIds = Array.from(this.connections.keys());
    
    console.info('[SSE-MANAGER] Validating connection health', {
      total_connections: connectionIds.length
    });

    for (const connectionId of connectionIds) {
      const connection = this.connections.get(connectionId);
      if (!connection || !(connection as any).controller) {
        this.removeConnection(connectionId);
        removedCount++;
        continue;
      }

      // Check controller health
      if (!this.isControllerHealthy((connection as any).controller)) {
        console.warn('[SSE-MANAGER] Removing unhealthy connection during validation', {
          connection_id: connectionId,
          project_id: connection.project_id,
          connection_age_ms: Date.now() - new Date(connection.created_at).getTime()
        });
        
        this.removeConnection(connectionId);
        removedCount++;
      } else {
        healthyCount++;
      }
    }

    console.info('[SSE-MANAGER] Connection health validation completed', {
      healthy_connections: healthyCount,
      removed_connections: removedCount
    });

    return { healthy: healthyCount, removed: removedCount };
  }

  /**
   * Send ping to all connections to validate connectivity
   */
  sendPingToAllConnections(): { sent: number; failed: number } {
    const message: SSEMessage = {
      type: 'heartbeat',
      project_id: '*',
      timestamp: new Date().toISOString(),
      data: {
        ping: true,
        server_time: new Date().toISOString(),
        active_connections: this.connections.size
      },
      event_id: this.generateEventId()
    };

    const result = this.broadcastMessage(message, { message_type: 'heartbeat' });
    
    console.info('[SSE-MANAGER] Ping sent to all connections', {
      sent: result.sent,
      failed: result.failed,
      total_connections: this.connections.size
    });

    return result;
  }

  /**
   * Remove connections that haven't sent heartbeat in timeout period
   */
  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleConnections: string[] = [];

    for (const [connectionId, connection] of Array.from(this.connections)) {
      const lastHeartbeat = new Date(connection.last_heartbeat).getTime();
      
      if (now - lastHeartbeat > this.connectionTimeout) {
        staleConnections.push(connectionId);
      }
    }

    if (staleConnections.length > 0) {
      console.info('[SSE-MANAGER] Cleaning up stale connections', {
        stale_count: staleConnections.length,
        total_connections: this.connections.size
      });

      staleConnections.forEach(connectionId => {
        this.removeConnection(connectionId);
      });
    }
  }

  /**
   * Broadcast message to connections matching criteria
   */
  private broadcastMessage(
    message: SSEMessage,
    options?: SSEBroadcastOptions
  ): { sent: number; failed: number } {
    let sent = 0;
    let failed = 0;

    // Determine target connections
    let targetConnections: Set<string>;
    
    if (options?.project_id && options.project_id !== '*') {
      targetConnections = this.projectConnections.get(options.project_id) || new Set();
    } else {
      targetConnections = new Set(this.connections.keys());
    }

    // Exclude specific connection if requested
    if (options?.exclude_connection) {
      targetConnections.delete(options.exclude_connection);
    }

    // Send message to all target connections with enhanced health checks
    for (const connectionId of Array.from(targetConnections)) {
      const connection = this.connections.get(connectionId);
      if (!connection || !(connection as any).controller) {
        failed++;
        continue;
      }

      try {
        // Pre-validate connection health before attempting to send
        if (!this.isControllerHealthy((connection as any).controller)) {
          console.warn('[SSE-MANAGER] Connection controller is unhealthy, removing connection', {
            connection_id: connectionId,
            project_id: connection.project_id
          });
          this.removeConnection(connectionId);
          failed++;
          continue;
        }

        // Attempt to send the message
        this.sendMessage((connection as any).controller, message);
        
        // Update heartbeat timestamp only on successful send
        connection.last_heartbeat = new Date().toISOString();
        sent++;

      } catch (error) {
        console.warn('[SSE-MANAGER] Failed to send message to connection', {
          connection_id: connectionId,
          project_id: connection.project_id,
          error: error instanceof Error ? error.message : String(error),
          connection_age_ms: Date.now() - new Date(connection.created_at).getTime()
        });
        
        // Remove failed connection to prevent memory leaks
        this.removeConnection(connectionId);
        failed++;
      }
    }

    this.messagesSent += sent;

    return { sent, failed };
  }

  /**
   * Send SSE formatted message to a specific controller with health validation
   */
  private sendMessage(controller: ReadableStreamDefaultController, message: SSEMessage): void {
    // Validate controller health before sending
    if (!this.isControllerHealthy(controller)) {
      throw new Error('Controller is not in a healthy state for message sending');
    }

    const eventData = `event: ${message.type}\nid: ${message.event_id || ''}\ndata: ${JSON.stringify(message.data)}\n\n`;
    controller.enqueue(new TextEncoder().encode(eventData));
  }

  /**
   * Check if a controller is healthy and can receive messages
   */
  private isControllerHealthy(controller: ReadableStreamDefaultController): boolean {
    try {
      // Check if controller is still available and not closed
      if (!controller) {
        return false;
      }
      
      // Check if the controller's desired size is available (indicates healthy stream)
      const desiredSize = controller.desiredSize;
      if (desiredSize === null) {
        // Stream is closed or closing
        return false;
      }
      
      // Negative desired size indicates backpressure, but stream is still healthy
      // Zero or positive indicates healthy stream ready for more data
      return true;
      
    } catch (error) {
      console.warn('[SSE-MANAGER] Controller health check failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `sse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique event ID for SSE messages
   */
  private generateEventId(): string {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }
}

/**
 * Global SSE Manager instance (singleton pattern for Cloudflare Workers)
 */
let globalSSEManager: SSEManager | null = null;

/**
 * Get or create global SSE Manager instance
 */
export function getSSEManager(): SSEManager {
  if (!globalSSEManager) {
    globalSSEManager = new SSEManager();
  }
  return globalSSEManager;
}

/**
 * Factory function to create SSE Manager with environment configuration
 */
export function createSSEManager(env?: Env): SSEManager {
  return new SSEManager({
    heartbeatInterval: env ? parseInt(env.SSE_HEARTBEAT_INTERVAL_MS || '30000') : 30000,
    connectionTimeout: env ? parseInt(env.SSE_CONNECTION_TIMEOUT_MS || '300000') : 300000,
    maxConnections: env ? parseInt(env.SSE_MAX_CONNECTIONS || '1000') : 1000
  });
}

/**
 * Utility to validate SSE message format
 */
export function isValidSSEMessage(data: any): data is SSEMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof data.type === 'string' &&
    typeof data.project_id === 'string' &&
    typeof data.timestamp === 'string' &&
    data.data !== undefined
  );
}

/**
 * Utility to format SSE response headers
 *
 * SECURITY FIX (Week 2): Now accepts origin and env for proper CORS
 */
export function createSSEHeaders(
  connectionId?: string,
  origin?: string | null,
  env?: Env
): Headers {
  // Determine proper CORS origin
  const allowedOrigins = getAllowedSSEOrigins(env);
  const isAllowed = isAllowedSSEOrigin(origin, env);
  const corsOrigin = (isAllowed && origin) ? origin : allowedOrigins[0];

  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': corsOrigin, // SECURITY: No more wildcard
    'Access-Control-Allow-Headers': 'Cache-Control',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Credentials': isAllowed ? 'true' : 'false',
    // Add security headers for SSE
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });

  if (connectionId) {
    headers.set('Connection-ID', connectionId);
    headers.set('Access-Control-Expose-Headers', 'Connection-ID');
  }

  return headers;
}
