-- Assessment Player Slice 5 — local norm scoring.
-- Adds ScoreBand enum + band/norm_sample_size columns to assessment_results.
-- Additive, idempotent (safe to re-run). No RLS change needed — the table
-- already has RLS enabled (assessment_results existed since 20260610200000).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScoreBand') THEN
    CREATE TYPE "ScoreBand" AS ENUM ('below_average', 'average', 'above_average', 'excellent');
  END IF;
END $$;

ALTER TABLE "assessment_results"
  ADD COLUMN IF NOT EXISTS "band" "ScoreBand",
  ADD COLUMN IF NOT EXISTS "norm_sample_size" INTEGER;
