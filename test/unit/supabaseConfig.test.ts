import { describe, it, expect } from 'vitest';

import { getSupabaseConfig, hasSupabaseConfig } from '../../src/config/supabase';

function buildEnv(overrides: Partial<Env> = {}): Env {
	return {
		ENVIRONMENT: 'staging',
		MAX_FILE_SIZE: '104857600',
		SUPPORTED_EXTENSIONS: '.html,.jsx,.tsx,.vue,.svelte',
		PROJECTS_BUCKET: {} as unknown as R2Bucket,
		BUILDS_BUCKET: {} as unknown as R2Bucket,
		DEPLOYMENTS_BUCKET: {} as unknown as R2Bucket,
		BUILD_QUEUE: {} as unknown as Queue,
		SUPABASE_URL: 'https://project.supabase.co',
		SUPABASE_ANON_KEY: 'anon-key',
		SUPABASE_SERVICE_ROLE_KEY: 'service-role',
		SUPABASE_JWT_SECRET: 'jwt-secret',
		...overrides
	} as Env;
}

describe('supabase config helpers', () => {
	it('detects when full Supabase configuration is present', () => {
		expect(hasSupabaseConfig(buildEnv())).toBe(true);

		expect(hasSupabaseConfig(buildEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined }))).toBe(false);
	});

	it('returns sanitized Supabase configuration when all values exist', () => {
		const env = buildEnv({
			SUPABASE_URL: ' https://team.supabase.co ',
			SUPABASE_ANON_KEY: 'anon ',
			SUPABASE_SERVICE_ROLE_KEY: ' service ',
			SUPABASE_JWT_SECRET: ' secret'
		});

		const config = getSupabaseConfig(env);

		expect(config.url).toBe('https://team.supabase.co');
		expect(config.anonKey).toBe('anon');
		expect(config.serviceRoleKey).toBe('service');
		expect(config.jwtSecret).toBe('secret');
	});

	it('throws descriptive error when required variables are missing', () => {
		const env = buildEnv({
			SUPABASE_URL: undefined,
			SUPABASE_ANON_KEY: undefined
		});

		expect(() => getSupabaseConfig(env)).toThrowError(
			/Missing Supabase environment variables: SUPABASE_URL, SUPABASE_ANON_KEY/i
		);
	});
});
