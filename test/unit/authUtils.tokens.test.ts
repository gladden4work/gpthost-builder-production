import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';

import { validateToken, type AuthSuccessContext } from '../../src/utils/authUtils';
import { validateV2Auth, authMiddleware, type V2AuthResult } from '../../src/middleware/auth';

const SUPABASE_TEST_SECRET = 'supabase-test-secret';
const LEGACY_TOKEN = 'legacy-access-token';

function createSupabaseJwt(payload: Record<string, any>, secret = SUPABASE_TEST_SECRET): string {
	const header = {
		alg: 'HS256',
		typ: 'JWT'
	};

	const base64UrlEncode = (obj: Record<string, any>) => Buffer
		.from(JSON.stringify(obj))
		.toString('base64')
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');

	const encodedHeader = base64UrlEncode(header);
	const encodedPayload = base64UrlEncode(payload);
	const signingInput = `${encodedHeader}.${encodedPayload}`;

	const signature = crypto
		.createHmac('sha256', secret)
		.update(signingInput)
		.digest('base64')
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');

	return `${signingInput}.${signature}`;
}

function buildEnv(overrides: Partial<Env> = {}): Env {
	return {
		ENVIRONMENT: 'staging',
		MAX_FILE_SIZE: '104857600',
		SUPPORTED_EXTENSIONS: '.html,.jsx,.tsx,.vue,.svelte',
		PROJECTS_BUCKET: {} as unknown as R2Bucket,
		BUILDS_BUCKET: {} as unknown as R2Bucket,
		DEPLOYMENTS_BUCKET: {} as unknown as R2Bucket,
		BUILD_QUEUE: {} as unknown as Queue,
		MVP_ACCESS_TOKEN: LEGACY_TOKEN,
		SUPABASE_JWT_SECRET: SUPABASE_TEST_SECRET,
		...overrides
	} as Env;
}

describe('validateToken — Supabase integration', () => {
	it('accepts a valid Supabase JWT and returns user context', async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = createSupabaseJwt({
			sub: '6b9c8626-6d09-4bdb-8dfd-9ab3d3baefaa',
			email: 'user@example.com',
			role: 'authenticated',
			aud: 'authenticated',
			exp: now + 3600,
			iss: 'supabase',
			session_id: 'session-123'
		});

		const result = await validateToken(`Bearer ${token}`, buildEnv());

		expect(result.isValid).toBe(true);
		expect(result.authType).toBe('supabase-jwt');
		expect(result.user).toBeDefined();
		expect(result.user?.id).toBe('6b9c8626-6d09-4bdb-8dfd-9ab3d3baefaa');
		expect(result.user?.email).toBe('user@example.com');
		expect(result.user?.role).toBe('authenticated');
		expect(result.rawPayload?.session_id).toBe('session-123');
	});

	it('rejects Supabase JWTs with invalid signatures', async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = createSupabaseJwt({
			sub: 'user-1',
			role: 'authenticated',
			aud: 'authenticated',
			exp: now + 3600
		}, 'wrong-secret');

		const result = await validateToken(`Bearer ${token}`, buildEnv());

		expect(result.isValid).toBe(false);
		expect(result.authType).toBeUndefined();
		expect(result.error).toContain('Supabase JWT');
	});

	it('rejects expired Supabase JWTs even if signature is valid', async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = createSupabaseJwt({
			sub: 'user-2',
			role: 'authenticated',
			aud: 'authenticated',
			exp: now - 10
		});

		const result = await validateToken(`Bearer ${token}`, buildEnv());

		expect(result.isValid).toBe(false);
		expect(result.error).toContain('expired');
	});

	it('falls back to legacy token when Supabase verification fails', async () => {
		const legacyHeader = `Bearer ${LEGACY_TOKEN}`;
		const result = await validateToken(legacyHeader, buildEnv());

		expect(result.isValid).toBe(true);
		expect(result.authType).toBe('legacy-token');
		expect(result.user).toBeUndefined();
	});

	it('returns explicit error when Authorization header is missing', async () => {
		const result = await validateToken(null, buildEnv());

		expect(result.isValid).toBe(false);
		expect(result.error).toContain('Authorization');
	});
});

describe('validateToken — Supabase REST fallback', () => {
	it('uses Supabase REST user endpoint when JWT secret is missing', async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = createSupabaseJwt({
			sub: 'a5c0d3aa-808b-4dd8-8d9f-2e582df76e61',
			email: 'fallback@example.com',
			role: 'authenticated',
			aud: 'authenticated',
			exp: now + 3600
		});

		const supabaseUrl = 'https://example.supabase.co';
		const env = buildEnv({
			SUPABASE_JWT_SECRET: undefined,
			SUPABASE_URL: supabaseUrl,
			SUPABASE_ANON_KEY: 'anon-public-key'
		});

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					id: 'a5c0d3aa-808b-4dd8-8d9f-2e582df76e61',
					email: 'fallback@example.com',
					role: 'authenticated',
					aud: 'authenticated'
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			) as Response
		);

		const result = await validateToken(`Bearer ${token}`, env);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(`${supabaseUrl}/auth/v1/user`);
		expect(init?.headers).toMatchObject({
			Authorization: `Bearer ${token}`,
			apikey: 'anon-public-key'
		});
		expect(result.isValid).toBe(true);
		expect(result.authType).toBe('supabase-jwt');
		expect(result.user?.id).toBe('a5c0d3aa-808b-4dd8-8d9f-2e582df76e61');
		expect(result.user?.email).toBe('fallback@example.com');
		fetchSpy.mockRestore();
	});

	it('returns a descriptive error when Supabase REST fallback fails', async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = createSupabaseJwt({
			sub: 'fallback-failure',
			exp: now + 3600
		});

		const env = buildEnv({
			SUPABASE_JWT_SECRET: undefined,
			SUPABASE_URL: 'https://example.supabase.co',
			SUPABASE_ANON_KEY: 'anon-public-key'
		});

		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('Unauthorized', { status: 401 }) as Response
		);

		const result = await validateToken(`Bearer ${token}`, env);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(result.isValid).toBe(false);
		expect(result.error).toContain('Supabase REST');
		fetchSpy.mockRestore();
	});
});

describe('authMiddleware — CORS responses', () => {
	it('returns CORS headers when Authorization header is missing', async () => {
		const request = new Request('https://example.com/api/projects', { method: 'GET' });
		const response = await authMiddleware(request, buildEnv());
		expect(response).toBeInstanceOf(Response);
		expect(response?.status).toBe(401);
		expect(response?.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response?.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
	});

	it('propagates CORS headers on invalid legacy tokens', async () => {
		const request = new Request('https://example.com/api/projects', {
			method: 'GET',
			headers: { Authorization: 'Bearer totally-invalid' }
		});
		const response = await authMiddleware(request, buildEnv());
		expect(response).toBeInstanceOf(Response);
		expect(response?.status).toBe(401);
		expect(response?.headers.get('Access-Control-Allow-Origin')).toBe('*');
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('validateV2Auth — context propagation', () => {
	it('attaches Supabase user context to request on success', async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = createSupabaseJwt({
			sub: 'a4ed7607-2fe0-4fb5-b3af-50d169b65e3c',
			email: 'team@example.com',
			role: 'authenticated',
			aud: 'authenticated',
			exp: now + 3600
		});

		const request = new Request('https://example.com/api/v2/projects', {
			headers: { Authorization: `Bearer ${token}` }
		});

		const result: V2AuthResult = await validateV2Auth(request, buildEnv(), 'req-ctx-1');

		expect(result.response).toBeNull();
		expect(result.context?.authType).toBe('supabase-jwt');
		expect(result.context?.user?.email).toBe('team@example.com');
		expect((request as Request & { authContext?: AuthSuccessContext }).authContext?.user?.id)
			.toBe('a4ed7607-2fe0-4fb5-b3af-50d169b65e3c');
	});

	it('returns a 401 response when Supabase JWT verification fails', async () => {
		const token = createSupabaseJwt({
			sub: 'refuse-me'
		}, 'bad-secret');

		const request = new Request('https://example.com/api/v2/projects', {
			headers: { Authorization: `Bearer ${token}` }
		});

		const result = await validateV2Auth(request, buildEnv(), 'req-ctx-2');

		expect(result.response).toBeInstanceOf(Response);
		expect(result.response?.status).toBe(401);
		const body = await result.response?.json();
		expect(body?.error?.message).toContain('Supabase JWT');
	});
});
