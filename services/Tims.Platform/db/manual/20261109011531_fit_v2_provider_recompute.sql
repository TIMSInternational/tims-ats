START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109011531_fit_v2_provider_recompute') THEN
    CREATE OR REPLACE FUNCTION public.fit_v2_provider_attempt_changed()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
    AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
        RETURN NULL;
      END IF;
      IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NOT NULL THEN
        PERFORM public.fit_v2_request_recompute(NEW.organization_id, NEW.candidate_id, NEW.vacancy_id);
      END IF;
      RETURN NULL;
    END
    $fn$;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109011531_fit_v2_provider_recompute') THEN
    DROP TRIGGER IF EXISTS fit_v2_provider_attempt_changed ON assessment_provider_attempts;
    CREATE TRIGGER fit_v2_provider_attempt_changed
      AFTER INSERT OR UPDATE OF state ON assessment_provider_attempts
      FOR EACH ROW EXECUTE FUNCTION public.fit_v2_provider_attempt_changed();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109011531_fit_v2_provider_recompute') THEN
    CREATE OR REPLACE FUNCTION public.fit_v2_provider_result_changed()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public
    AS $fn$
    DECLARE
      a record;
    BEGIN
      IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NULL THEN
        RETURN NULL;
      END IF;
      SELECT x.organization_id, x.candidate_id, x.vacancy_id INTO a
      FROM public.assessment_provider_attempts x
      WHERE x.id = NEW.attempt_id AND x.organization_id = NEW.organization_id;
      IF FOUND THEN
        PERFORM public.fit_v2_request_recompute(a.organization_id, a.candidate_id, a.vacancy_id);
      END IF;
      RETURN NULL;
    END
    $fn$;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109011531_fit_v2_provider_recompute') THEN
    DROP TRIGGER IF EXISTS fit_v2_provider_result_changed ON assessment_provider_results;
    CREATE TRIGGER fit_v2_provider_result_changed
      AFTER INSERT OR UPDATE ON assessment_provider_results
      FOR EACH ROW EXECUTE FUNCTION public.fit_v2_provider_result_changed();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109011531_fit_v2_provider_recompute') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261109011531_fit_v2_provider_recompute', '10.0.4');
    END IF;
END $EF$;
COMMIT;

