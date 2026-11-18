START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109030506_fit_v2_provider_erasure_recompute') THEN
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
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109030506_fit_v2_provider_erasure_recompute') THEN
    DROP TRIGGER IF EXISTS fit_v2_provider_attempt_changed ON assessment_provider_attempts;
    CREATE TRIGGER fit_v2_provider_attempt_changed
      AFTER INSERT OR UPDATE OF state, provider_erasure_requested_at ON assessment_provider_attempts
      FOR EACH ROW EXECUTE FUNCTION public.fit_v2_provider_attempt_changed();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109030506_fit_v2_provider_erasure_recompute') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261109030506_fit_v2_provider_erasure_recompute', '10.0.4');
    END IF;
END $EF$;
COMMIT;

