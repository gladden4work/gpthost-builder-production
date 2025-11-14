/**
 * Supabase configuration helpers
 * Week 1-2 foundation: normalize environment variables and expose guardrails
 */

const REQUIRED_KEYS = [
	'SUPABASE_URL',
	'SUPABASE_ANON_KEY',
	'SUPABASE_SERVICE_ROLE_KEY',
	'SUPABASE_JWT_SECRET'
] as const;

type RequiredSupabaseKey = typeof REQUIRED_KEYS[number];

export interface SupabaseConfig {
	url: string;
	anonKey: string;
	serviceRoleKey: string;
	jwtSecret: string;
	/** Optional Postgres password for administrative tasks */
	databasePassword?: string;
}

function readEnvValue(env: Env, key: RequiredSupabaseKey | 'SUPABASE_DB_PASSWORD'): string | undefined {
	const raw = (env as Record<string, unknown>)[key];
	if (typeof raw !== 'string') {
		return undefined;
	}
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function hasSupabaseConfig(env: Env): boolean {
	return REQUIRED_KEYS.every((key) => Boolean(readEnvValue(env, key)));
}

export function getSupabaseConfig(env: Env): SupabaseConfig {
	const missing = REQUIRED_KEYS.filter((key) => !readEnvValue(env, key));
	if (missing.length > 0) {
		throw new Error(`Missing Supabase environment variables: ${missing.join(', ')}`);
	}

	const url = readEnvValue(env, 'SUPABASE_URL')!;
	if (!url.startsWith('https://')) {
		throw new Error('Supabase URL must start with https://');
	}

	return {
		url,
		anonKey: readEnvValue(env, 'SUPABASE_ANON_KEY')!,
		serviceRoleKey: readEnvValue(env, 'SUPABASE_SERVICE_ROLE_KEY')!,
		jwtSecret: readEnvValue(env, 'SUPABASE_JWT_SECRET')!,
		databasePassword: readEnvValue(env, 'SUPABASE_DB_PASSWORD')
	};
}
