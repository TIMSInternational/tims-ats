-- Add cover_letter to applications (candidate motivation captured in the
-- multi-step portal application form). Nullable — existing rows are unaffected.
--
-- NOTE: this repo has historically used `prisma db push` for the dev database,
-- so there is no full baseline migration. Before running `prisma migrate deploy`
-- against an existing production database, baseline it first:
--   prisma migrate resolve --applied <baseline>
-- or mark this migration as applied if the column already exists.
-- The statement is written idempotently so it is safe to re-run.

ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "cover_letter" TEXT;
