START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261112225624_assessment_provider_attempt_job_code') THEN
    ALTER TABLE assessment_provider_attempts ADD job_code text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261112225624_assessment_provider_attempt_job_code') THEN
    ALTER TABLE assessment_provider_attempts ADD CONSTRAINT ck_assessment_provider_attempts_job_code CHECK (job_code IS NULL OR (instrument = 'pca' AND job_code ~ '^[A-Za-z0-9_-]{2,30}$'));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261112225624_assessment_provider_attempt_job_code') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261112225624_assessment_provider_attempt_job_code', '10.0.4');
    END IF;
END $EF$;
COMMIT;

