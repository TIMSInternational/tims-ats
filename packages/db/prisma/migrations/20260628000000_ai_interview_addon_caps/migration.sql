-- AI Voice Interview — paid add-on + per-type duration caps.
-- Additive only (new nullable columns); no RLS change (both tables already carry
-- the tenant_isolation policy). Prod is NOT prisma-migrate-managed; apply via:
--   npx prisma db execute --file=packages/db/prisma/migrations/20260628000000_ai_interview_addon_caps/migration.sql

-- 1) AiAgentOrgConfig: billing + cap columns (only meaningful for the ai-voice-interview agent row).
DO $$ BEGIN
  ALTER TABLE "ai_agent_org_configs" ADD COLUMN "addon_monthly_fee_usd" DOUBLE PRECISION;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_agent_org_configs" ADD COLUMN "billable_usd_per_minute" DOUBLE PRECISION;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_agent_org_configs" ADD COLUMN "ai_interview_default_max_minutes" INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_agent_org_configs" ADD COLUMN "ai_interview_max_minutes_by_type" JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 2) AiInterviewSession: per-session resolved duration cap (seconds).
DO $$ BEGIN
  ALTER TABLE "ai_interview_sessions" ADD COLUMN "max_duration_seconds" INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
