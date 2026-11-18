START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261108224533_assessment_provider_consent_capture') THEN
    ALTER TABLE assessment_provider_attempts ADD consent_capture_generation integer NOT NULL DEFAULT 0;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261108224533_assessment_provider_consent_capture') THEN
    ALTER TABLE assessment_provider_attempts ADD consent_capture_started_at timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261108224533_assessment_provider_consent_capture') THEN
    ALTER TABLE assessment_provider_attempts ADD consent_captures_in_flight integer NOT NULL DEFAULT 0;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261108224533_assessment_provider_consent_capture') THEN
    ALTER TABLE assessment_provider_attempts ADD CONSTRAINT ck_assessment_provider_attempts_consent_capture CHECK (consent_capture_generation >= 0 AND consent_captures_in_flight >= 0);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261108224533_assessment_provider_consent_capture') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261108224533_assessment_provider_consent_capture', '10.0.4');
    END IF;
END $EF$;
COMMIT;

