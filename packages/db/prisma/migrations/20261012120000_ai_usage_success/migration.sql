-- AI usage logs: persist whether the model output passed schema validation, so
-- a malformed (fallback) invocation is distinguishable from a successful parse.
-- Nullable with no default: rows written before this column existed have an
-- unknown outcome and stay NULL. Additive; no RLS change (ai_agent_usage_logs
-- already carries tenant_isolation).
--
-- APPLY BEFORE DEPLOYING the code that writes it: logInvocation swallows write
-- errors, so on a database without this column every usage log would be dropped,
-- and AI budget enforcement reads those logs. Apply via:
--   npx prisma db execute --file=packages/db/prisma/migrations/20261012120000_ai_usage_success/migration.sql
DO $$ BEGIN
  ALTER TABLE "ai_agent_usage_logs" ADD COLUMN "success" BOOLEAN;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
