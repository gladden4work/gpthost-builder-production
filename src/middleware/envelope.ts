/**
 * V2 API Envelope Middleware
 * Wraps all API responses in a consistent v2 envelope format
 * Based on DAY5-TDD-STRATEGY.md specifications
 */

export interface V2SuccessEnvelope<T = any> {
  success: true;
  data: T;
  metadata: {
    timestamp: string;
    requestId: string;
  };
}

export interface V2ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
  };
  metadata: {
    timestamp: string;
    requestId: string;
  };
}

export type V2Envelope<T = any> = V2SuccessEnvelope<T> | V2ErrorEnvelope;

/**
 * Create a success response with v2 envelope
 */
export function v2Success<T>(data: T, requestId?: string): Response {
  const envelope: V2SuccessEnvelope<T> = {
    success: true,
    data,
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: requestId || crypto.randomUUID()
    }
  };

  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Create an error response with v2 envelope
 */
export function v2Error(
  code: string,
  message: string,
  status: number = 400,
  requestId?: string
): Response {
  const envelope: V2ErrorEnvelope = {
    success: false,
    error: {
      code,
      message
    },
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: requestId || crypto.randomUUID()
    }
  };

  return new Response(JSON.stringify(envelope), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Extract request ID from request headers or generate new one
 */
export function getRequestId(request: Request): string {
  return request.headers.get('X-Request-ID') || crypto.randomUUID();
}

/**
 * Map common HTTP error codes to v2 error responses
 */
export function mapHttpErrorToV2(status: number, requestId?: string): Response {
  const errorMap: Record<number, { code: string; message: string }> = {
    400: { code: 'BAD_REQUEST', message: 'Invalid request parameters' },
    401: { code: 'AUTH_UNAUTHORIZED', message: 'Authentication required' },
    403: { code: 'AUTH_FORBIDDEN', message: 'Insufficient permissions' },
    404: { code: 'NOT_FOUND', message: 'Resource not found' },
    422: { code: 'VALIDATION_FAILED', message: 'Request validation failed' },
    429: { code: 'RATE_LIMITED', message: 'Too many requests' },
    500: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    501: { code: 'NOT_IMPLEMENTED', message: 'Feature not implemented' },
    503: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' }
  };

  const error = errorMap[status] || { code: 'UNKNOWN_ERROR', message: 'An error occurred' };
  return v2Error(error.code, error.message, status, requestId);
}

/**
 * Wrap handler with v2 envelope formatting
 */
export function withV2Envelope<T extends (...args: any[]) => Promise<Response>>(
  handler: T
): T {
  return (async (...args: Parameters<T>) => {
    const request = args[0] as Request;
    const requestId = getRequestId(request);
    
    try {
      const response = await handler(...args);
      
      // If response already has v2 envelope structure, return as-is
      if (response.headers.get('X-V2-Envelope') === 'true') {
        return response;
      }
      
      // If it's an error response, wrap it
      if (!response.ok) {
        return mapHttpErrorToV2(response.status, requestId);
      }
      
      // For success responses, check if body is JSON
      const contentType = response.headers.get('Content-Type');
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        return v2Success(data, requestId);
      }
      
      // For non-JSON responses, return as-is (e.g., HTML for sites)
      return response;
    } catch (error: any) {
      console.error('Error in v2 envelope wrapper:', error);
      return v2Error(
        'INTERNAL_ERROR',
        error.message || 'An unexpected error occurred',
        500,
        requestId
      );
    }
  }) as T;
}