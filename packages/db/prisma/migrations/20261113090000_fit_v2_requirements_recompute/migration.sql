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
-- when the stored value actually changed. Candidates with no FIT row yet have nothing stale; their first compute
-- reads the new requirements.
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
