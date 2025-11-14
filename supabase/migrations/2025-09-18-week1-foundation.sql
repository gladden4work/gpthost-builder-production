-- GPTHost Multi-user SaaS — Week 1-2 foundation
-- Creates baseline tables, ownership columns, and unified RLS policies

-- Ensure UUID tooling is available (idempotent)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profile table mirrors Supabase Auth users for fast lookups
CREATE TABLE IF NOT EXISTS public.profiles (
	id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
	email TEXT UNIQUE NOT NULL,
	username TEXT,
	avatar_url TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Quota table drives per-user limits (defaults match MVP expectations)
CREATE TABLE IF NOT EXISTS public.user_quotas (
	user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
	max_projects INT NOT NULL DEFAULT 10,
	max_builds_per_day INT NOT NULL DEFAULT 50,
	max_storage_mb INT NOT NULL DEFAULT 500,
	projects_count INT NOT NULL DEFAULT 0,
	builds_today INT NOT NULL DEFAULT 0,
	storage_used_mb NUMERIC NOT NULL DEFAULT 0,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add ownership columns to core workload tables while remaining nullable for migration window
ALTER TABLE IF EXISTS public.projects
	ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

ALTER TABLE IF EXISTS public.builds
	ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

ALTER TABLE IF EXISTS public.deployments
	ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Index ownership columns for low-latency RLS queries (idempotent checks)
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_projects_user_id') THEN
		EXECUTE 'CREATE INDEX idx_projects_user_id ON public.projects(user_id)';
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_builds_user_id') THEN
		EXECUTE 'CREATE INDEX idx_builds_user_id ON public.builds(user_id)';
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_deployments_user_id') THEN
		EXECUTE 'CREATE INDEX idx_deployments_user_id ON public.deployments(user_id)';
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_user_quotas_user_id') THEN
		EXECUTE 'CREATE INDEX idx_user_quotas_user_id ON public.user_quotas(user_id)';
	END IF;
END$$;

-- Unified Row Level Security helper eliminates special cases
CREATE OR REPLACE FUNCTION public.apply_standard_rls(target_table TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
	policy_name TEXT := 'users_own_data';
BEGIN
	EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
	EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);

	IF EXISTS (
		SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = target_table AND policyname = policy_name
	) THEN
		EXECUTE format('DROP POLICY %I ON %I', policy_name, target_table);
	END IF;

	EXECUTE format(
		'CREATE POLICY %I ON %I FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id)',
		policy_name,
		target_table
	);
END;
$$;

-- Apply RLS to every table that now carries ownership metadata
SELECT public.apply_standard_rls('projects');
SELECT public.apply_standard_rls('builds');
SELECT public.apply_standard_rls('deployments');
SELECT public.apply_standard_rls('user_quotas');

-- Basic grants so authenticated users can interact through PostgREST
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.user_quotas TO authenticated;
