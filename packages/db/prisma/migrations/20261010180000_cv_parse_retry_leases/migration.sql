-- Durable, bounded CV re-parse claims for the .NET reconciler (#333).
-- Additive: the current post-response TS parser ignores these fields. Apply before
-- deploying code that reads them. Only unparsed rows created after the worker's
-- activation cut-off (CV_RECOVERY_CREATED_AFTER) and older than its two-minute
-- grace period become eligible. RLS policy on candidate_documents is unchanged.
-- Idempotent: safe to re-run (verified by CvParseRetryMigrationTests).
ALTER TABLE "candidate_documents"
  ADD COLUMN IF NOT EXISTS "cv_parse_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cv_parse_next_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cv_parse_lease_token" UUID,
  ADD COLUMN IF NOT EXISTS "cv_parse_lease_until" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cv_parse_failure_code" VARCHAR(32);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidate_documents_cv_parse_attempts_check') THEN
    ALTER TABLE "candidate_documents" ADD CONSTRAINT "candidate_documents_cv_parse_attempts_check"
      CHECK ("cv_parse_attempts" BETWEEN 0 AND 4);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "candidate_documents_cv_retry_due_idx"
  ON "candidate_documents" ("cv_parse_next_at", "created_at", "id")
  WHERE "type" = 'cv' AND "parsed_data" IS NULL AND "cv_parse_attempts" < 4;
