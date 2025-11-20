-- GPTHost Production Database - Complete Schema Migration
-- This script creates all base tables and applies multi-user RLS policies
-- Safe to run multiple times (uses IF NOT EXISTS and IF EXISTS checks)
--
-- Execute in: Supabase Dashboard → SQL Editor
-- Database: Production Supabase (tqwvtfvxgjzujjktdjba.supabase.co)
-- Date: November 14, 2025

-- ============================================================================
-- STEP 1: Extensions and Dependencies
-- ============================================================================

-- Ensure UUID generation is available (idempotent)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- STEP 2: Base Tables Creation
-- ============================================================================

-- Projects table: Core entity for user uploaded code/components
CREATE TABLE IF NOT EXISTS public.projects (
	id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
	name TEXT NOT NULL,
	description TEXT,
	framework TEXT NOT NULL DEFAULT 'react',  -- 'react', 'vue', 'svelte'
	status TEXT NOT NULL DEFAULT 'pending',   -- 'pending', 'scaffolded', 'building', 'built', 'deployed', 'failed'
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	metadata JSONB DEFAULT '{}'::jsonb,  -- Flexible storage for file metadata
	user_id UUID REFERENCES auth.users(id)  -- Added for multi-user support (nullable initially)
);

-- Builds table: Tracks build executions for projects
CREATE TABLE IF NOT EXISTS public.builds (
	id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
	project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
	status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'building', 'success', 'failed'
	build_number INT NOT NULL,
	github_run_id TEXT,  -- GitHub Actions run ID
	github_workflow_url TEXT,  -- GitHub Actions workflow URL
	started_at TIMESTAMPTZ DEFAULT NOW(),
	completed_at TIMESTAMPTZ,
	logs TEXT,  -- Build logs
	error_message TEXT,  -- Error details if failed
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	metadata JSONB DEFAULT '{}'::jsonb,
	user_id UUID REFERENCES auth.users(id)  -- Added for multi-user support (nullable initially)
);

-- Deployments table: Tracks successful deployments
CREATE TABLE IF NOT EXISTS public.deployments (
	id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
	project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
	build_id UUID REFERENCES public.builds(id) ON DELETE CASCADE,
	status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'active', 'inactive'
	deployment_url TEXT NOT NULL,
	deployed_at TIMESTAMPTZ DEFAULT NOW(),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	metadata JSONB DEFAULT '{}'::jsonb,
	user_id UUID REFERENCES auth.users(id)  -- Added for multi-user support (nullable initially)
);

-- ============================================================================
-- STEP 3: Multi-User Support - Profiles and Quotas
-- ============================================================================

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

-- ============================================================================
-- STEP 4: Performance Indexes
-- ============================================================================

-- Indexes for ownership-based queries (critical for RLS performance)
DO $$
BEGIN
	-- Projects indexes
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_projects_user_id') THEN
		CREATE INDEX idx_projects_user_id ON public.projects(user_id);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_projects_status') THEN
		CREATE INDEX idx_projects_status ON public.projects(status);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_projects_created_at') THEN
		CREATE INDEX idx_projects_created_at ON public.projects(created_at DESC);
	END IF;

	-- Builds indexes
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_builds_user_id') THEN
		CREATE INDEX idx_builds_user_id ON public.builds(user_id);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_builds_project_id') THEN
		CREATE INDEX idx_builds_project_id ON public.builds(project_id);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_builds_status') THEN
		CREATE INDEX idx_builds_status ON public.builds(status);
	END IF;

	-- Deployments indexes
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_deployments_user_id') THEN
		CREATE INDEX idx_deployments_user_id ON public.deployments(user_id);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_deployments_project_id') THEN
		CREATE INDEX idx_deployments_project_id ON public.deployments(project_id);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_deployments_build_id') THEN
		CREATE INDEX idx_deployments_build_id ON public.deployments(build_id);
	END IF;

	-- User quotas index
	IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_user_quotas_user_id') THEN
		CREATE INDEX idx_user_quotas_user_id ON public.user_quotas(user_id);
	END IF;
END$$;

-- ============================================================================
-- STEP 5: Row Level Security (RLS) Policies
-- ============================================================================

-- Unified RLS helper function (eliminates special cases)
CREATE OR REPLACE FUNCTION public.apply_standard_rls(target_table TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
	policy_name TEXT := 'users_own_data';
BEGIN
	-- Enable RLS on the table
	EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
	EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);

	-- Drop existing policy if it exists
	IF EXISTS (
		SELECT 1 FROM pg_policies
		WHERE schemaname = 'public'
		AND tablename = target_table
		AND policyname = policy_name
	) THEN
		EXECUTE format('DROP POLICY %I ON %I', policy_name, target_table);
	END IF;

	-- Create policy: users can only access their own data
	EXECUTE format(
		'CREATE POLICY %I ON %I FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id)',
		policy_name,
		target_table
	);
END;
$$;

-- Apply RLS to all tables with user ownership
SELECT public.apply_standard_rls('projects');
SELECT public.apply_standard_rls('builds');
SELECT public.apply_standard_rls('deployments');
SELECT public.apply_standard_rls('user_quotas');

-- Profiles table needs special RLS (users can read their own profile)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_profile" ON public.profiles;
CREATE POLICY "users_own_profile" ON public.profiles
	FOR ALL TO authenticated
	USING ((SELECT auth.uid()) = id)
	WITH CHECK ((SELECT auth.uid()) = id);

-- ============================================================================
-- STEP 6: Grants and Permissions
-- ============================================================================

-- Basic grants so authenticated users can interact through PostgREST
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builds TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.user_quotas TO authenticated;

-- ============================================================================
-- STEP 7: Triggers for Auto-updated_at
-- ============================================================================

-- Trigger function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
	NEW.updated_at = NOW();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at
DO $$
BEGIN
	-- Projects
	IF NOT EXISTS (
		SELECT 1 FROM pg_trigger
		WHERE tgname = 'update_projects_updated_at'
	) THEN
		CREATE TRIGGER update_projects_updated_at
			BEFORE UPDATE ON public.projects
			FOR EACH ROW
			EXECUTE FUNCTION public.update_updated_at_column();
	END IF;

	-- Profiles
	IF NOT EXISTS (
		SELECT 1 FROM pg_trigger
		WHERE tgname = 'update_profiles_updated_at'
	) THEN
		CREATE TRIGGER update_profiles_updated_at
			BEFORE UPDATE ON public.profiles
			FOR EACH ROW
			EXECUTE FUNCTION public.update_updated_at_column();
	END IF;

	-- User quotas
	IF NOT EXISTS (
		SELECT 1 FROM pg_trigger
		WHERE tgname = 'update_user_quotas_updated_at'
	) THEN
		CREATE TRIGGER update_user_quotas_updated_at
			BEFORE UPDATE ON public.user_quotas
			FOR EACH ROW
			EXECUTE FUNCTION public.update_updated_at_column();
	END IF;
END$$;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Run these to verify the migration succeeded:

-- 1. Check all tables exist
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- AND table_name IN ('projects', 'builds', 'deployments', 'profiles', 'user_quotas')
-- ORDER BY table_name;

-- 2. Check all indexes exist
-- SELECT tablename, indexname FROM pg_indexes
-- WHERE schemaname = 'public'
-- AND tablename IN ('projects', 'builds', 'deployments', 'user_quotas')
-- ORDER BY tablename, indexname;

-- 3. Check RLS is enabled
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public'
-- AND tablename IN ('projects', 'builds', 'deployments', 'profiles', 'user_quotas');

-- 4. Check RLS policies exist
-- SELECT schemaname, tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- If all verification queries return expected results, the migration succeeded!
-- Next steps:
-- 1. Test Worker can connect to database
-- 2. Verify RLS policies block unauthorized access
-- 3. Create test user and verify data isolation
