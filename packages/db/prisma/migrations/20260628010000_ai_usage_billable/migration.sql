-- AI usage logs: frozen per-event billable amount (org-billed; distinct from
-- internal cost_usd). Default 0 so existing rows are unaffected. Additive; no
-- RLS change (ai_agent_usage_logs already carries tenant_isolation). Apply via:
--   npx prisma db execute --file=packages/db/prisma/migrations/20260628010000_ai_usage_billable/migration.sql
DO $$ BEGIN
  ALTER TABLE "ai_agent_usage_logs" ADD COLUMN "billable_usd" DOUBLE PRECISION NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
