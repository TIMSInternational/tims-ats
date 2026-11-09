START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109001134_assessment_provider_attempt_poll') THEN
    ALTER TABLE assessment_provider_attempts ADD last_polled_at timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109001134_assessment_provider_attempt_poll') THEN
    ALTER TABLE assessment_provider_attempts ADD missing_consents text[] NOT NULL DEFAULT ('{}'::text[]);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109001134_assessment_provider_attempt_poll') THEN
    ALTER TABLE assessment_provider_attempts ADD poll_lease_owner uuid;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109001134_assessment_provider_attempt_poll') THEN
    ALTER TABLE assessment_provider_attempts ADD poll_lease_until timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109001134_assessment_provider_attempt_poll') THEN
    CREATE INDEX ix_assessment_provider_attempts_poll ON assessment_provider_attempts (organization_id, last_polled_at) WHERE provider_assignment_id IS NOT NULL AND withdrawal_state IS NULL AND provider_erasure_requested_at IS NULL AND state IN ('created', 'launched', 'in_progress', 'completed', 'result_ready');
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109001134_assessment_provider_attempt_poll') THEN
    ALTER TABLE assessment_provider_attempts ADD CONSTRAINT ck_assessment_provider_attempts_missing_consents CHECK (missing_consents <@ ARRAY['assessment', 'biometric', 'voice', 'ai_scoring']::text[]);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109001134_assessment_provider_attempt_poll') THEN
    ALTER TABLE assessment_provider_attempts ADD CONSTRAINT ck_assessment_provider_attempts_poll_lease CHECK ((poll_lease_owner IS NULL) = (poll_lease_until IS NULL));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109001134_assessment_provider_attempt_poll') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261109001134_assessment_provider_attempt_poll', '10.0.4');
    END IF;
END $EF$;
COMMIT;

