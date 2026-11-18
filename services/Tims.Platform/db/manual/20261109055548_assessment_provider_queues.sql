START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    ALTER TABLE assessment_provider_webhook_inbox ADD lease_owner uuid;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    ALTER TABLE assessment_provider_webhook_inbox ADD lease_until timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    ALTER TABLE assessment_provider_webhook_inbox ADD next_attempt_at timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    ALTER TABLE assessment_provider_attempts ADD create_started_at timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    ALTER TABLE assessment_provider_attempts ADD declined_optional_consents text[] NOT NULL DEFAULT ('{}'::text[]);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    ALTER TABLE assessment_provider_attempts ADD granted_optional_consents text[] NOT NULL DEFAULT ('{}'::text[]);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    ALTER TABLE assessment_provider_attempts ADD withdrawal_lease_owner uuid;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    ALTER TABLE assessment_provider_attempts ADD withdrawal_lease_until timestamp with time zone;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    CREATE INDEX ix_assessment_provider_webhook_inbox_due ON assessment_provider_webhook_inbox (organization_id, next_attempt_at) WHERE next_attempt_at IS NOT NULL;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    ALTER TABLE assessment_provider_webhook_inbox ADD CONSTRAINT ck_assessment_provider_webhook_inbox_lease CHECK ((lease_owner IS NULL) = (lease_until IS NULL));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    ALTER TABLE assessment_provider_attempts ADD CONSTRAINT ck_assessment_provider_attempts_optional_consents CHECK (granted_optional_consents <@ ARRAY['assessment', 'biometric', 'voice', 'ai_scoring']::text[] AND declined_optional_consents <@ ARRAY['assessment', 'biometric', 'voice', 'ai_scoring']::text[] AND NOT (granted_optional_consents && declined_optional_consents));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    ALTER TABLE assessment_provider_attempts ADD CONSTRAINT ck_assessment_provider_attempts_withdrawal_lease CHECK ((withdrawal_lease_owner IS NULL) = (withdrawal_lease_until IS NULL));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    UPDATE assessment_provider_webhook_inbox SET next_attempt_at = received_at WHERE status IN ('received', 'failed') AND next_attempt_at IS NULL;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261109055548_assessment_provider_queues') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261109055548_assessment_provider_queues', '10.0.4');
    END IF;
END $EF$;
COMMIT;

