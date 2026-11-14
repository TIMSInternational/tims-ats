START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    ALTER TABLE assessment_provider_attempts ADD completed_by text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    ALTER TABLE assessment_provider_attempts ADD proctoring_anti_cheat_consequence text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    ALTER TABLE assessment_provider_attempts ADD proctoring_anti_cheat_threshold integer;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    ALTER TABLE assessment_provider_attempts ADD proctoring_identity_check boolean;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    ALTER TABLE assessment_provider_attempts ADD proctoring_lockdown boolean;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    ALTER TABLE assessment_provider_attempts ADD void_reason text;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    CREATE TABLE assessment_provider_settings (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        proctoring_lockdown boolean NOT NULL DEFAULT FALSE,
        anti_cheat_threshold integer,
        anti_cheat_consequence text,
        identity_check boolean NOT NULL DEFAULT FALSE,
        updated_by_id uuid NOT NULL,
        created_at timestamp with time zone NOT NULL DEFAULT (now()),
        updated_at timestamp with time zone NOT NULL DEFAULT (now()),
        CONSTRAINT "PK_assessment_provider_settings" PRIMARY KEY (id),
        CONSTRAINT ck_assessment_provider_settings_anti_cheat CHECK ((anti_cheat_threshold IS NULL) = (anti_cheat_consequence IS NULL) AND (anti_cheat_threshold IS NULL OR anti_cheat_threshold BETWEEN 1 AND 20) AND (anti_cheat_consequence IS NULL OR anti_cheat_consequence IN ('warn', 'auto_submit', 'void')))
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    ALTER TABLE assessment_provider_attempts ADD CONSTRAINT ck_assessment_provider_attempts_completed_by CHECK (completed_by IS NULL OR completed_by IN ('candidate', 'time_limit', 'proctoring_auto_submit'));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    ALTER TABLE assessment_provider_attempts ADD CONSTRAINT ck_assessment_provider_attempts_proctoring CHECK ((proctoring_lockdown IS NULL) = (proctoring_identity_check IS NULL) AND (proctoring_anti_cheat_threshold IS NULL) = (proctoring_anti_cheat_consequence IS NULL) AND (proctoring_anti_cheat_threshold IS NULL OR proctoring_lockdown IS NOT NULL) AND (proctoring_anti_cheat_threshold IS NULL OR proctoring_anti_cheat_threshold BETWEEN 1 AND 20) AND (proctoring_anti_cheat_consequence IS NULL OR proctoring_anti_cheat_consequence IN ('warn', 'auto_submit', 'void')));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    ALTER TABLE assessment_provider_attempts ADD CONSTRAINT ck_assessment_provider_attempts_void_reason CHECK (void_reason IS NULL OR void_reason IN ('proctoring_void', 'identity_check_failed', 'administrative_void', 'consent_withdrawn'));
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    CREATE UNIQUE INDEX ux_assessment_provider_settings_org ON assessment_provider_settings (organization_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    ALTER TABLE "assessment_provider_settings" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "assessment_provider_settings" FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON "assessment_provider_settings"
        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    GRANT SELECT, INSERT, UPDATE ON assessment_provider_settings TO app_tenant;
    REVOKE DELETE, TRUNCATE ON assessment_provider_settings FROM app_tenant;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    DO $acl$
    DECLARE r text;
    BEGIN
      FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('REVOKE ALL ON TABLE assessment_provider_settings FROM %I', r);
        END IF;
      END LOOP;
    END
    $acl$;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111170159_assessment_provider_proctoring') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261111170159_assessment_provider_proctoring', '10.0.4');
    END IF;
END $EF$;
COMMIT;

