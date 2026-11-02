-- Onboarding hire hand-off columns (WP-12 PR-2).
-- The hand-off from hiring to onboarding records who the new hire's manager is, the first-day
-- logistics, when the welcome message went out, and an optional resource link per onboarding task.
-- Later PRs read and write these columns; this migration only adds them.
--
-- Additive and idempotent: safe to re-run (IF NOT EXISTS on every column and the index, the FK is
-- guarded by a pg_constraint check). Every new column is nullable, so code that never names them is
-- unaffected. No RLS change: both tables already carry org-predicate policies.
--
-- Apply by hand via psql BEFORE the PR that adds these fields to the Prisma schema merges
-- (docs/architecture/ddl-governance.md). Rollback:
-- packages/db/prisma/manual/2026-11-02-onboarding-hire-handoff.ROLLBACK.sql

-- 1. Plan-level hand-off data.
ALTER TABLE "onboarding_plans"
  ADD COLUMN IF NOT EXISTS "manager_id" UUID,
  ADD COLUMN IF NOT EXISTS "first_day_info" JSONB,
  ADD COLUMN IF NOT EXISTS "welcome_sent_at" TIMESTAMP(3);

-- 2. Optional resource link on each onboarding task.
ALTER TABLE "onboarding_tasks"
  ADD COLUMN IF NOT EXISTS "resource_url" VARCHAR(2048);

-- 3. Manager FK. A deleted user clears the manager instead of blocking the delete.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_plans_manager_id_fkey') THEN
    ALTER TABLE "onboarding_plans" ADD CONSTRAINT "onboarding_plans_manager_id_fkey"
      FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Index the FK column (CLAUDE.md: index every FK).
CREATE INDEX IF NOT EXISTS "onboarding_plans_manager_id_idx" ON "onboarding_plans"("manager_id");
