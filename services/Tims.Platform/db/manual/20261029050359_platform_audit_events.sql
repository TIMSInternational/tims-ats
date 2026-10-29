CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL,
    CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
);

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    DO $pae_precheck$
    BEGIN
        IF to_regprocedure('public.tims_append_only_guard()') IS NULL THEN
            RAISE EXCEPTION 'platform_audit_events requires public.tims_append_only_guard(); apply the baseline first';
        END IF;
    END $pae_precheck$;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    CREATE TABLE platform_audit_events (
        id uuid NOT NULL,
        actor_id uuid,
        action text NOT NULL,
        entity text NOT NULL,
        entity_id text,
        organization_id uuid,
        changes jsonb,
        metadata jsonb,
        ip_address text,
        user_agent text,
        created_at timestamp with time zone NOT NULL DEFAULT (now()),
        CONSTRAINT "PK_platform_audit_events" PRIMARY KEY (id)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    CREATE INDEX ix_platform_audit_events_action_created_at ON platform_audit_events (action, created_at DESC);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    CREATE INDEX ix_platform_audit_events_created_at ON platform_audit_events (created_at DESC);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    CREATE TRIGGER platform_audit_events_append_only BEFORE UPDATE OR DELETE ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION public.tims_append_only_guard();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    ALTER TABLE platform_audit_events ENABLE ALWAYS TRIGGER platform_audit_events_append_only;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    CREATE TRIGGER platform_audit_events_append_only_truncate BEFORE TRUNCATE ON platform_audit_events FOR EACH STATEMENT EXECUTE FUNCTION public.tims_append_only_guard();
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    ALTER TABLE platform_audit_events ENABLE ALWAYS TRIGGER platform_audit_events_append_only_truncate;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    ALTER TABLE platform_audit_events ENABLE ROW LEVEL SECURITY;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    CREATE POLICY platform_audit_events_deny_tenant ON platform_audit_events AS RESTRICTIVE FOR ALL TO app_tenant USING (false) WITH CHECK (false);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    REVOKE ALL ON platform_audit_events FROM PUBLIC, app_tenant, anon, authenticated;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261029050359_platform_audit_events') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261029050359_platform_audit_events', '10.0.4');
    END IF;
END $EF$;
COMMIT;

