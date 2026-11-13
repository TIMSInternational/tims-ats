-- FIT v2: a requirements edit re-scores the vacancy's FIT rows (Codex ats run 2 [P1], 2026-11-12).
--
-- A FIT v2 row depends on the vacancy's fit_requirements as much as on the candidate's results: which instruments
-- count and how (scored / gate / advisory), each one's minimums and weight, and for PCA the TIMS position code
-- (jobCode) whose job fit is read. 20261109100000_fit_v2_integrity enqueues a recompute when an input on the
-- candidate's side changes, but an edit of the requirements enqueued nothing: every stored row kept the old score (a
-- PCA judged on another position's fit, a gate that no longer exists) until HR ran Compute Rankings.
--
-- This trigger enqueues, in the edit's own transaction, one request for every candidate holding a FIT row for the
-- vacancy, through the same SECURITY DEFINER fit_v2_request_recompute (which enqueues only while the vacancy is
-- configured for FIT v2, and refuses an organization other than the session's tenant). It fires for every writer
-- of fit_requirements (the C# requirements writer, and the TS updateFitRequirements / upsertJobProfile), and only
-- when the stored value actually changed.
--
-- A compute in flight (Codex ats run 3 [P1]): every FIT v2 write reads the vacancy's requirements INSIDE its locked
-- transaction while holding the per-vacancy lock fit_v2_requirements:{org}:{vacancy} SHARED
-- (FitEngineWriteRepository.UpsertFitScoreV2Async). This trigger takes it EXCLUSIVELY before it reads the rows, so a
-- compute that read the old requirements commits its row first (and the row is re-queued here), and one that starts
-- later reads the new ones. A candidate with no row and no compute in flight has nothing stale.
--
-- Leaving FIT v2 (Codex ats run 3 [P1]): an edit that removes the `assessments` key (the C# writer's explicit
-- `assessments: null`) leaves FIT v2 rows built from a configuration that no longer exists, and FIT v1 computes only
-- on demand. Those rows are deleted in the edit's transaction (derived data: HR's next Compute Rankings scores the
-- candidates with v1), under the same exclusive lock, so no v2 write can land after the delete.
--
-- Apply by psql after 20261109100000_fit_v2_integrity (it calls fit_v2_request_recompute). Re-runnable. No table,
-- column or grant change for app_tenant.

CREATE OR REPLACE FUNCTION public.fit_v2_requirements_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.fit_requirements IS NOT DISTINCT FROM OLD.fit_requirements
     AND NEW.vacancy_id = OLD.vacancy_id THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('fit_v2_requirements:' || NEW.organization_id::text || ':' || NEW.vacancy_id::text, 0));
  IF NOT coalesce(jsonb_typeof(NEW.fit_requirements) = 'object' AND NEW.fit_requirements ? 'assessments', false) THEN
    DELETE FROM public.fit_scores f
    WHERE f.organization_id = NEW.organization_id AND f.vacancy_id = NEW.vacancy_id
      AND f.breakdown ->> 'fitVersion' = '2';
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT f.candidate_id
    FROM public.fit_scores f
    WHERE f.organization_id = NEW.organization_id AND f.vacancy_id = NEW.vacancy_id
  LOOP
    PERFORM public.fit_v2_request_recompute(NEW.organization_id, r.candidate_id, NEW.vacancy_id);
  END LOOP;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS "fit_v2_requirements_changed" ON "job_profiles";
CREATE TRIGGER "fit_v2_requirements_changed"
  AFTER INSERT OR UPDATE OF "fit_requirements", "vacancy_id" ON "job_profiles"
  FOR EACH ROW EXECUTE FUNCTION public.fit_v2_requirements_changed();

DO $$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION public.fit_v2_requirements_changed() FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'app_tenant'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.fit_v2_requirements_changed() FROM %I', r);
    END IF;
  END LOOP;
END
$$;
