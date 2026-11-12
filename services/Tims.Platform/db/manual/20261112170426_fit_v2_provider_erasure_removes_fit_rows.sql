START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261112170426_fit_v2_provider_erasure_removes_fit_rows') THEN
    CREATE OR REPLACE FUNCTION public.fit_v2_provider_attempt_changed()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state
         AND NEW.provider_erasure_requested_at IS NOT DISTINCT FROM OLD.provider_erasure_requested_at THEN
        RETURN NULL;
      END IF;
      -- An erased attempt's data leaves the stored FIT row now, whatever the FIT v2 flag: jsonb_path_exists
      -- in lax mode is false (never an error) on a v1 row or a breakdown without an assessments array.
      IF (NEW.provider_erasure_requested_at IS NOT NULL OR NEW.state = 'erased')
         AND to_regclass('public.fit_scores') IS NOT NULL THEN
        DELETE FROM public.fit_scores f
         WHERE f.organization_id = NEW.organization_id
           AND f.candidate_id = NEW.candidate_id
           AND f.vacancy_id = NEW.vacancy_id
           AND jsonb_path_exists(
                 f.breakdown,
                 '$.assessments[*] ? (@.source == "provider" && @.instrument == $instrument)',
                 jsonb_build_object('instrument', NEW.instrument));
      END IF;
      IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NOT NULL
         AND has_function_privilege('public.fit_v2_request_recompute(uuid,uuid,uuid)', 'execute') THEN
        PERFORM public.fit_v2_request_recompute(NEW.organization_id, NEW.candidate_id, NEW.vacancy_id);
      END IF;
      RETURN NULL;
    END
    $fn$;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261112170426_fit_v2_provider_erasure_removes_fit_rows') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261112170426_fit_v2_provider_erasure_removes_fit_rows', '10.0.4');
    END IF;
END $EF$;
COMMIT;

