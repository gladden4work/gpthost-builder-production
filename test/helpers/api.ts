// Lightweight API testing helpers for integration tests (Phase 3 GREEN)

export const API_BASE_URL = process.env.GPTHOST_API_URL || 'http://localhost:8787';

export function createJsonRequest(path: string, method: string, body?: any, headers: Record<string, string> = {}) {
  const url = `${API_BASE_URL}${path}`;
  const init: RequestInit = {
    method,
    headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

export async function assertStandardSuccess(response: Response) {
  const data = await response.json();
  if (!data || typeof data !== 'object') throw new Error('Response is not a JSON object');
  if (data.success !== true) throw new Error('Expected success=true');
  if (!('data' in data)) throw new Error('Success response missing data');
  return data;
}

export async function assertStandardError(response: Response) {
  const data = await response.json();
  if (!data || typeof data !== 'object') throw new Error('Error response is not a JSON object');
  if (data.success !== false) throw new Error('Expected success=false');
  if (!('error' in data)) throw new Error('Error response missing error field');
  return data;
}

