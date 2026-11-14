START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261110031301_assessment_provider_result_visibility') THEN
    ALTER TABLE assessment_provider_attempts ADD result_visibility_generation integer NOT NULL DEFAULT 0;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261110031301_assessment_provider_result_visibility') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261110031301_assessment_provider_result_visibility', '10.0.4');
    END IF;
END $EF$;
COMMIT;

