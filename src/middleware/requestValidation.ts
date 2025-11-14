/**
 * Request validation helpers for GPTHost API
 */

import { simpleErrorResponse } from '../utils/responses';

/**
 * Validate that a request has a JSON Content-Type
 * Returns a Response if invalid, otherwise null to continue.
 */
export function requireJsonContentType(request: Request): Response | null {
  const contentType = request.headers.get('Content-Type') || request.headers.get('content-type') || '';
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return simpleErrorResponse('Content-Type must be application/json', 400);
  }
  return null;
}

/**
 * Validate that a request has a multipart/form-data Content-Type
 * Returns a Response if invalid, otherwise null to continue.
 */
export function requireMultipartContentType(request: Request): Response | null {
  const contentType = request.headers.get('Content-Type') || request.headers.get('content-type') || '';
  if (!contentType || !contentType.toLowerCase().includes('multipart/form-data')) {
    return simpleErrorResponse('Content-Type must be multipart/form-data', 400);
  }
  return null;
}

