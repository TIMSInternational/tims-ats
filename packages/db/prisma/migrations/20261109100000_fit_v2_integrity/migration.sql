-- FIT v2 integrity (release/assessments-fit-provider). Three flag-on preconditions of FIT v2, all at the database so
-- they hold for every writer (the TS app, the C# service, a hand-run statement):
--
--   1. proctoring_sessions.review_status — the review-completion signal the FIT v2 native-quiz adapter reads.
--   2. A writer that does not know FIT v2 never replaces a FIT v2 fit_scores row.
--   3. A FIT v2 row is recomputed when an assessment it depends on is cancelled, voided, flagged, graded or reviewed:
--      the change enqueues a request in the same transaction, and the C# service drains the queue.
--
-- Additive and idempotent: safe to re-run. It changes no existing row and drops nothing. Apply BEFORE the C# service
-- runs with Platform__FitEngineV2Enabled=true (the FIT v2 adapter reads review_status). Apply via:
--   npx prisma db execute --file=packages/db/prisma/migrations/20261109100000_fit_v2_integrity/migration.sql

-- ── 1. The review-completion signal ──────────────────────────────────────────────────────────────────────────────
-- The same column definitions as the proctoring branch (origin/codex/migration-continuation,
-- 20260924000000_proctoring_signal_events), so whichever migration runs first adds them and the other is a no-op.
-- 'unreviewed' until a person reviews the session; then 'clear' (the session raises no concern: a high or critical
-- severity no longer holds the result), 'concern' or 'inconclusive' (the result stays "needs review" in FIT).
ALTER TABLE "proctoring_sessions"
  ADD COLUMN IF NOT EXISTS "review_status" TEXT NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS "review_notes" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewed_by_id" UUID;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'proctoring_sessions_review_status_check' AND conrelid = '"proctoring_sessions"'::regclass
  ) THEN
    ALTER TABLE "proctoring_sessions" ADD CONSTRAINT "proctoring_sessions_review_status_check"
      CHECK ("review_status" IN ('unreviewed', 'clear', 'concern', 'inconclusive'));
  END IF;
END $$;

-- ── 2. A FIT v2 row is never replaced by a writer that does not know FIT v2 ──────────────────────────────────────
-- The live TS writers (fitEngine.computeForVacancy and candidate.screenCandidate, both through computeFitScore) write a
-- v1 breakdown with no lock. Before this trigger, the next TS recompute silently replaced a v2 row (per-instrument
-- entries, review state) with v1's latest-of-any-type number. Now an UPDATE that would replace a v2 breakdown with a
-- non-v2 one keeps the stored score, breakdown, weights, partial flag and calculation time, and takes only a non-null
-- llmJudgment (screenCandidate's narrative-only screening, which no number depends on). The row stays v2 and the
-- statement still succeeds, so the TS caller sees no error.
--
-- The C# fit engine marks its own writes (set_config('tims.fit_writer', 'fit_v2_aware', true), transaction-local):
-- it knows both versions, and its v1 compute is how a vacancy goes back to v1 (the flag turned off, or the vacancy's
-- assessments removed).
CREATE OR REPLACE FUNCTION public.fit_scores_keep_v2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF jsonb_typeof(OLD.breakdown) = 'object'
     AND OLD.breakdown -> 'fitVersion' = '2'::jsonb
     AND NOT (jsonb_typeof(NEW.breakdown) = 'object' AND NEW.breakdown -> 'fitVersion' = '2'::jsonb)
     AND coalesce(current_setting('tims.fit_writer', true), '') <> 'fit_v2_aware'
  THEN
    NEW.overall_score := OLD.overall_score;
    NEW.weights := OLD.weights;
    NEW.is_partial := OLD.is_partial;
    NEW.calculated_at := OLD.calculated_at;
    NEW.breakdown := CASE
      WHEN jsonb_typeof(NEW.breakdown) = 'object' AND jsonb_typeof(NEW.breakdown -> 'llmJudgment') = 'object'
        THEN jsonb_set(OLD.breakdown, '{llmJudgment}', NEW.breakdown -> 'llmJudgment', true)
      ELSE OLD.breakdown
    END;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "fit_scores_keep_v2" ON "fit_scores";
CREATE TRIGGER "fit_scores_keep_v2"
  BEFORE UPDATE ON "fit_scores"
  FOR EACH ROW EXECUTE FUNCTION public.fit_scores_keep_v2();

-- ── 3. Recompute requests ────────────────────────────────────────────────────────────────────────────────────────
-- One row per (candidate, vacancy) whose FIT v2 inputs changed. request_seq counts the changes: the C# worker deletes
-- a row only at the sequence it computed from, so a change that lands while it computes is not lost. Rows carry ids
-- only. No foreign keys: a request for a candidate or vacancy that is gone is dropped by the worker.
CREATE TABLE IF NOT EXISTS "fit_recompute_requests" (
    "candidate_id" UUID NOT NULL,
    "vacancy_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "request_seq" BIGINT NOT NULL DEFAULT 1,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(200),
    CONSTRAINT "fit_recompute_requests_pkey" PRIMARY KEY ("candidate_id", "vacancy_id")
);

CREATE INDEX IF NOT EXISTS "fit_recompute_requests_organization_id_available_at_idx"
  ON "fit_recompute_requests"("organization_id", "available_at");
CREATE INDEX IF NOT EXISTS "fit_recompute_requests_available_at_idx"
  ON "fit_recompute_requests"("available_at");

ALTER TABLE "fit_recompute_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fit_recompute_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "fit_recompute_requests";
CREATE POLICY tenant_isolation ON "fit_recompute_requests"
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Enqueue (or re-arm) the request for one (candidate, vacancy), but only for a vacancy configured for FIT v2 (its job
-- profile carries an `assessments` key). v1 computes only on demand, as before. The fit_scores row is deliberately NOT
-- checked here: a compute still in flight has not committed it, and the worker checks it under the FIT v2 lock.
-- SECURITY DEFINER so a trigger fired by the RLS-bound app_tenant role can reach job_profiles and the queue for the
-- changed row's own organization; it takes its ids from that row only, and nobody but the application roles may call
-- it directly.
CREATE OR REPLACE FUNCTION public.fit_v2_request_recompute(p_organization_id uuid, p_candidate_id uuid, p_vacancy_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_candidate_id IS NULL OR p_vacancy_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.job_profiles jp
    WHERE jp.vacancy_id = p_vacancy_id
      AND jp.organization_id = p_organization_id
      AND jsonb_typeof(jp.fit_requirements) = 'object'
      AND jp.fit_requirements ? 'assessments'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.fit_recompute_requests AS r (candidate_id, vacancy_id, organization_id)
  VALUES (p_candidate_id, p_vacancy_id, p_organization_id)
  ON CONFLICT (candidate_id, vacancy_id) DO UPDATE
    SET request_seq = r.request_seq + 1,
        requested_at = clock_timestamp(),
        available_at = clock_timestamp(),
        attempts = 0,
        last_error = NULL;
END
$$;

-- An assignment's status moved (cancelled, completed, expired, …).
CREATE OR REPLACE FUNCTION public.fit_v2_assignment_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.fit_v2_request_recompute(NEW.organization_id, NEW.candidate_id, NEW.vacancy_id);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS "fit_v2_assignment_changed" ON "assessment_assignments";
CREATE TRIGGER "fit_v2_assignment_changed"
  AFTER UPDATE OF "status" ON "assessment_assignments"
  FOR EACH ROW EXECUTE FUNCTION public.fit_v2_assignment_changed();

-- A result was stored, regraded (an essay graded) or rescored.
CREATE OR REPLACE FUNCTION public.fit_v2_result_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  a record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.normalized_score IS NOT DISTINCT FROM OLD.normalized_score
     AND NEW.breakdown IS NOT DISTINCT FROM OLD.breakdown
     AND NEW.assignment_id = OLD.assignment_id THEN
    RETURN NULL;
  END IF;
  SELECT x.organization_id, x.candidate_id, x.vacancy_id INTO a
  FROM public.assessment_assignments x
  WHERE x.id = NEW.assignment_id AND x.organization_id = NEW.organization_id;
  IF FOUND THEN
    PERFORM public.fit_v2_request_recompute(a.organization_id, a.candidate_id, a.vacancy_id);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS "fit_v2_result_changed" ON "assessment_results";
CREATE TRIGGER "fit_v2_result_changed"
  AFTER INSERT OR UPDATE ON "assessment_results"
  FOR EACH ROW EXECUTE FUNCTION public.fit_v2_result_changed();

-- A proctoring session was opened, flagged (severity) or reviewed (review_status).
CREATE OR REPLACE FUNCTION public.fit_v2_proctoring_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  a record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.severity IS NOT DISTINCT FROM OLD.severity
     AND NEW.review_status IS NOT DISTINCT FROM OLD.review_status
     AND NEW.assignment_id = OLD.assignment_id THEN
    RETURN NULL;
  END IF;
  SELECT x.organization_id, x.candidate_id, x.vacancy_id INTO a
  FROM public.assessment_assignments x
  WHERE x.id = NEW.assignment_id AND x.organization_id = NEW.organization_id;
  IF FOUND THEN
    PERFORM public.fit_v2_request_recompute(a.organization_id, a.candidate_id, a.vacancy_id);
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS "fit_v2_proctoring_changed" ON "proctoring_sessions";
CREATE TRIGGER "fit_v2_proctoring_changed"
  AFTER INSERT OR UPDATE ON "proctoring_sessions"
  FOR EACH ROW EXECUTE FUNCTION public.fit_v2_proctoring_changed();

-- Grants. Production's default privileges give app_tenant DML on every new table; the C# worker needs exactly
-- SELECT/UPDATE/DELETE on the queue (the triggers insert through the SECURITY DEFINER function). Supabase's API roles
-- get nothing, and only the application roles may call the enqueue function.
DO $$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION public.fit_v2_request_recompute(uuid, uuid, uuid) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "fit_recompute_requests" TO app_tenant;
    GRANT EXECUTE ON FUNCTION public.fit_v2_request_recompute(uuid, uuid, uuid) TO app_tenant;
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "fit_recompute_requests" FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION public.fit_v2_request_recompute(uuid, uuid, uuid) FROM %I', r);
    END IF;
  END LOOP;
END
$$;
