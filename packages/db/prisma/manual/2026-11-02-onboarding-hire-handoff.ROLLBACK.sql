-- ============================================================================================
-- ROLLBACK for migrations/20261102120000_onboarding_hire_handoff/migration.sql (WP-12 PR-2).
--
-- Removes the four onboarding hand-off columns, the manager FK and its index. Tables are never
-- dropped. Any manager, first-day info, welcome timestamp or task resource link stored in these
-- columns is LOST: export them first if they matter.
--
-- WHEN TO RUN THIS. Only after the Prisma schema that names these fields has been reverted and
-- deployed. A deployed client that still names the columns returns 500 on onboarding reads and on
-- the hire itself once they are gone.
--
-- IDEMPOTENT: every statement is IF EXISTS, so re-running is a no-op.
--
-- APPLY:
--   psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 -1 -f packages/db/prisma/manual/2026-11-02-onboarding-hire-handoff.ROLLBACK.sql
-- ============================================================================================

DROP INDEX IF EXISTS "onboarding_plans_manager_id_idx";

ALTER TABLE "onboarding_plans" DROP CONSTRAINT IF EXISTS "onboarding_plans_manager_id_fkey";

ALTER TABLE "onboarding_plans"
  DROP COLUMN IF EXISTS "manager_id",
  DROP COLUMN IF EXISTS "first_day_info",
  DROP COLUMN IF EXISTS "welcome_sent_at";

ALTER TABLE "onboarding_tasks"
  DROP COLUMN IF EXISTS "resource_url";
