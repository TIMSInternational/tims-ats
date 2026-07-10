-- Sprint 1.3 Task 4: nullable columns to persist the AI-generated "social"
-- and "whatsapp" description variants (the vacancy-writer agent now returns
-- formal/social/whatsapp variants from a single Bedrock call) once a user
-- picks "Use this" for that variant in the vacancy-creation wizard. Additive
-- nullable columns, no backfill/data-migration needed.
ALTER TABLE "vacancies" ADD COLUMN IF NOT EXISTS "social_description" TEXT;
ALTER TABLE "vacancies" ADD COLUMN IF NOT EXISTS "whatsapp_description" TEXT;
