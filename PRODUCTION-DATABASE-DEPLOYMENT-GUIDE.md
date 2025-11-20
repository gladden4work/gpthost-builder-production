# Production Database Deployment Guide

**Date**: November 14, 2025
**Purpose**: Deploy complete database schema to production Supabase
**Estimated Time**: 15 minutes
**Status**: Ready for execution

---

## Prerequisites

✅ Production Supabase project created
✅ Production Supabase credentials documented
✅ Access to Supabase Dashboard

---

## Step-by-Step Deployment Instructions

### Step 1: Access Production Supabase (2 minutes)

1. **Open browser** and go to: https://supabase.com/dashboard
2. **Sign in** with your account
3. **Select project**: `gpthost-production` (or your production project name)
4. **Navigate to**: SQL Editor (left sidebar)

### Step 2: Load Migration Script (1 minute)

1. **Click**: "New query" button
2. **Open file**: `/Users/gladdenchoi/Documents/gpthost - new/gpthost-builder-production/supabase/migrations/production-complete-schema.sql`
3. **Copy entire contents** of the file
4. **Paste** into the SQL Editor

### Step 3: Execute Migration (5 minutes)

1. **Review the script** briefly (it's safe to run multiple times)
2. **Click**: "Run" button (bottom right of SQL Editor)
3. **Wait**: ~30 seconds for execution
4. **Check for errors**: Should see "Success. No rows returned"

### Step 4: Verify Migration Success (5 minutes)

Run each verification query below in a new SQL Editor tab:

#### Verification Query 1: Check Tables Exist
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('projects', 'builds', 'deployments', 'profiles', 'user_quotas')
ORDER BY table_name;
```
**Expected Result**: 5 rows (builds, deployments, profiles, projects, user_quotas)

#### Verification Query 2: Check Indexes Exist
```sql
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('projects', 'builds', 'deployments', 'user_quotas')
ORDER BY tablename, indexname;
```
**Expected Result**: At least 12 indexes (multiple per table)

#### Verification Query 3: Check RLS Enabled
```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('projects', 'builds', 'deployments', 'profiles', 'user_quotas')
ORDER BY tablename;
```
**Expected Result**: All tables show `rowsecurity = true`

#### Verification Query 4: Check RLS Policies
```sql
SELECT schemaname, tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```
**Expected Result**: At least 5 policies (users_own_data for each table)

### Step 5: Confirm Success (2 minutes)

If all verification queries return expected results:

✅ **Migration succeeded!**

**Next steps**:
1. Notify Claude that database schema is deployed
2. Proceed with database isolation verification tests
3. Continue with Phase 0.5 remaining tasks

---

## What This Migration Created

### Tables (5 total)
- **projects** - Core entity for user uploaded code/components
- **builds** - Tracks build executions for projects
- **deployments** - Tracks successful deployments
- **profiles** - Mirrors Supabase Auth users for fast lookups
- **user_quotas** - Drives per-user limits

### Security Features
- **Row Level Security (RLS)** enabled on all tables
- **Ownership-based access** - users can only see their own data
- **Performance indexes** - optimized for fast queries
- **Automatic timestamps** - updated_at triggers on key tables

### Performance Optimizations
- 12+ indexes for fast lookups
- Cascading deletes for data consistency
- JSONB metadata for flexible storage

---

## Troubleshooting

### Error: "relation already exists"
**Cause**: Tables already created (safe to ignore if using IF NOT EXISTS)
**Solution**: Continue with verification queries

### Error: "permission denied"
**Cause**: User doesn't have sufficient privileges
**Solution**: Ensure you're logged in as project owner

### Error: "syntax error"
**Cause**: Script not copied completely
**Solution**: Re-copy entire script and try again

### No errors but verification fails
**Cause**: Script executed partially
**Solution**: Re-run the entire script (safe to run multiple times)

---

## Rollback (Emergency Only)

If you need to rollback the migration:

```sql
-- WARNING: This deletes all data!
DROP TABLE IF EXISTS public.deployments CASCADE;
DROP TABLE IF EXISTS public.builds CASCADE;
DROP TABLE IF EXISTS public.user_quotas CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.projects CASCADE;
DROP FUNCTION IF EXISTS public.apply_standard_rls CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column CASCADE;
```

**Only use rollback if**:
- Production is not yet live with real users
- Critical bug discovered in schema
- Explicit instruction from engineering

---

## Contact

**Questions or issues?**
- Check verification queries first
- Review error messages carefully
- Contact Claude for troubleshooting assistance

**Document Status**: Ready for execution
**Last Updated**: November 14, 2025 @ 18:45 +08
