START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109233537_assessment_provider_round12') THEN
    ALTER TABLE assessment_provider_attempts ADD create_fences timestamp with time zone[] NOT NULL DEFAULT ('{}'::timestamptz[]);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109233537_assessment_provider_round12') THEN
    UPDATE assessment_provider_attempts
       SET create_fences = ARRAY[create_started_at]
     WHERE create_started_at IS NOT NULL AND cardinality(create_fences) = 0;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109233537_assessment_provider_round12') THEN
    CREATE OR REPLACE FUNCTION public.fit_v2_provider_result_changed()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $fn$
    DECLARE
      a record;
      r_attempt uuid;
      r_org uuid;
    BEGIN
      IF to_regprocedure('public.fit_v2_request_recompute(uuid,uuid,uuid)') IS NULL
         OR NOT has_function_privilege('public.fit_v2_request_recompute(uuid,uuid,uuid)', 'execute') THEN
        RETURN NULL;
      END IF;
      IF TG_OP = 'DELETE' THEN
        r_attempt := OLD.attempt_id;
        r_org := OLD.organization_id;
      ELSE
        r_attempt := NEW.attempt_id;
        r_org := NEW.organization_id;
      END IF;
      SELECT x.organization_id, x.candidate_id, x.vacancy_id INTO a
      FROM public.assessment_provider_attempts x
      WHERE x.id = r_attempt AND x.organization_id = r_org;
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
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109233537_assessment_provider_round12') THEN
    DROP TRIGGER IF EXISTS fit_v2_provider_result_changed ON assessment_provider_results;
    CREATE TRIGGER fit_v2_provider_result_changed
      AFTER INSERT OR UPDATE OR DELETE ON assessment_provider_results
      FOR EACH ROW EXECUTE FUNCTION public.fit_v2_provider_result_changed();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109233537_assessment_provider_round12') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261109233537_assessment_provider_round12', '10.0.4');
    END IF;
END $EF$;
COMMIT;

