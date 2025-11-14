/**
 * Mock Response Helper for Tests
 * Provides complete Response-like objects for GitHub API mocking
 */

/**
 * Options for creating a mock response
 */
export interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: any;
  text?: string;
}

/**
 * Create a mock Response object with all required methods
 * This ensures test mocks match the Response interface expected by production code
 */
export function createMockResponse(options: MockResponseOptions = {}): Response {
  const {
    ok = true,
    status = 200,
    statusText = 'OK',
    headers = {},
    body = {},
    text = null
  } = options;

  // Ensure we have proper default headers
  const defaultHeaders = {
    'content-type': 'application/json',
    'X-RateLimit-Limit': '5000',
    'X-RateLimit-Remaining': '4999',
    'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600),
    ...headers
  };

  // Convert body to text if not provided
  const responseText = text !== null ? text : JSON.stringify(body);

  // Create a mock Response object with all required methods
  const mockResponse = {
    ok,
    status,
    statusText,
    headers: new Headers(defaultHeaders),
    url: 'https://api.github.com/test',
    redirected: false,
    type: 'basic' as ResponseType,
    bodyUsed: false,
    
    // Required methods
    json: async () => {
      if (!defaultHeaders['content-type']?.includes('application/json')) {
        throw new Error('Response is not JSON');
      }
      return body;
    },
    
    text: async () => responseText,
    
    blob: async () => new Blob([responseText]),
    
    arrayBuffer: async () => {
      const encoder = new TextEncoder();
      return encoder.encode(responseText).buffer;
    },
    
    formData: async () => {
      throw new Error('FormData not supported in mock');
    },
    
    clone: () => createMockResponse(options)
  } as Response;

  return mockResponse;
}

/**
 * Create a mock GitHub API response for user endpoint
 */
export function createMockGitHubUserResponse(options: Partial<MockResponseOptions> = {}): Response {
  return createMockResponse({
    ok: true,
    status: 200,
    body: {
      login: 'test-user',
      id: 123456,
      name: 'Test User',
      email: 'test@example.com',
      ...options.body
    },
    headers: {
      'X-OAuth-Scopes': 'repo, workflow',
      'X-RateLimit-Limit': '5000',
      'X-RateLimit-Remaining': '4999',
      ...options.headers
    },
    ...options
  });
}

/**
 * Create a mock GitHub API response for workflow dispatch
 */
export function createMockWorkflowDispatchResponse(options: Partial<MockResponseOptions> = {}): Response {
  return createMockResponse({
    ok: true,
    status: 204,
    body: '',
    text: '',
    headers: {
      'content-type': '',
      ...options.headers
    },
    ...options
  });
}

/**
 * Create a mock GitHub API response for workflow runs
 */
export function createMockWorkflowRunsResponse(options: Partial<MockResponseOptions> = {}): Response {
  return createMockResponse({
    ok: true,
    status: 200,
    body: {
      total_count: 1,
      workflow_runs: [
        {
          id: 12345678,
          name: 'GPTHost Production Deployment',
          status: 'queued',
          conclusion: null,
          html_url: 'https://github.com/test/test/actions/runs/12345678',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          run_number: 1,
          event: 'workflow_dispatch'
        }
      ],
      ...options.body
    },
    ...options
  });
}

/**
 * Create a mock GitHub API rate limit error response
 */
export function createMockRateLimitResponse(options: Partial<MockResponseOptions> = {}): Response {
  const resetTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  
  return createMockResponse({
    ok: false,
    status: 403,
    body: {
      message: 'API rate limit exceeded',
      documentation_url: 'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting'
    },
    headers: {
      'X-RateLimit-Limit': '5000',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(resetTime),
      'Retry-After': '3600',
      ...options.headers
    },
    ...options
  });
}

/**
 * Create a mock queue object with send method
 */
export function createMockQueue() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    sendBatch: vi.fn().mockResolvedValue(undefined)
  };
}