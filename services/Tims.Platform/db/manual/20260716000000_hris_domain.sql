-- Phase-3 HRIS domain — the four EF-OWNED hris_* tables.
--
-- ⚠️  DRIFT: this migration was NEVER APPLIED TO PRODUCTION until 2026-08-03, despite Phase 3 being
--     documented as "DONE, greenfield — the FIRST EF-owned product tables". Found by querying prod
--     directly (all four tables absent) while auditing migration state for #115. This is exactly the
--     class of divergence #115 exists to catch, and it answers an open question recorded during the
--     #63 investigation ("why were the hris_* tables never applied — deliberate or overlooked?").
--
-- Generated from the EF migration, NOT hand-written:
--     dotnet ef migrations script --context HrisDbContext --idempotent \
--       --project src/Tims.Infrastructure --startup-project src/Tims.Infrastructure
--
-- Same provenance pattern as db/manual/20260723032952_fx_rates.sql. Idempotent, so re-running is safe.
--
-- Each table is org-scoped, so the migration wraps it with EnableTenantRls — ENABLE + FORCE ROW LEVEL
-- SECURITY + the fail-closed `tenant_isolation` policy — and GRANTs SELECT/INSERT/UPDATE/DELETE to
-- app_tenant. Verify after applying that an unset org GUC returns 0 rows:
--     npx tsx scripts/security/verify-rls-isolation.ts
--
-- APPLY (failure-atomic):
--   psql -v ON_ERROR_STOP=1 --single-transaction "<SESSION_POOLER_URI>" \
--     -f services/Tims.Platform/db/manual/20260716000000_hris_domain.sql
CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL,
    CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
);

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    CREATE TABLE hris_connectors (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        provider text NOT NULL,
        display_name text NOT NULL,
        status text NOT NULL,
        secret_ref text,
        subdomain text,
        field_map jsonb NOT NULL DEFAULT ('{}'::jsonb),
        sync_cursor text,
        sync_cadence text,
        last_sync_run_id uuid,
        last_synced_at timestamp with time zone,
        created_at timestamp with time zone NOT NULL DEFAULT (now()),
        updated_at timestamp with time zone NOT NULL DEFAULT (now()),
        CONSTRAINT "PK_hris_connectors" PRIMARY KEY (id)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    ALTER TABLE "hris_connectors" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "hris_connectors" FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON "hris_connectors"
        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hris_connectors TO app_tenant;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    CREATE TABLE hris_external_employees (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        connector_id uuid NOT NULL,
        external_id text NOT NULL,
        first_name text NOT NULL,
        last_name text NOT NULL,
        work_email text,
        job_title text,
        department text,
        division text,
        hire_date date,
        employment_status text,
        supervisor_external_id text,
        raw_payload jsonb NOT NULL DEFAULT ('{}'::jsonb),
        source_hash text NOT NULL,
        is_deleted_in_source boolean NOT NULL DEFAULT FALSE,
        first_seen_at timestamp with time zone NOT NULL DEFAULT (now()),
        last_synced_at timestamp with time zone NOT NULL DEFAULT (now()),
        last_sync_run_id uuid,
        created_at timestamp with time zone NOT NULL DEFAULT (now()),
        updated_at timestamp with time zone NOT NULL DEFAULT (now()),
        CONSTRAINT "PK_hris_external_employees" PRIMARY KEY (id)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    ALTER TABLE "hris_external_employees" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "hris_external_employees" FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON "hris_external_employees"
        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hris_external_employees TO app_tenant;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    CREATE TABLE hris_sync_record_errors (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        sync_run_id uuid NOT NULL,
        connector_id uuid NOT NULL,
        external_id text,
        error_type text NOT NULL,
        message text NOT NULL,
        details jsonb,
        created_at timestamp with time zone NOT NULL DEFAULT (now()),
        CONSTRAINT "PK_hris_sync_record_errors" PRIMARY KEY (id)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    ALTER TABLE "hris_sync_record_errors" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "hris_sync_record_errors" FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON "hris_sync_record_errors"
        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hris_sync_record_errors TO app_tenant;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    CREATE TABLE hris_sync_runs (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        connector_id uuid NOT NULL,
        status text NOT NULL,
        trigger text NOT NULL,
        idempotency_key text NOT NULL,
        cursor_before text,
        cursor_after text,
        records_seen integer NOT NULL DEFAULT 0,
        records_upserted integer NOT NULL DEFAULT 0,
        records_failed integer NOT NULL DEFAULT 0,
        error_summary text,
        started_at timestamp with time zone,
        finished_at timestamp with time zone,
        created_at timestamp with time zone NOT NULL DEFAULT (now()),
        CONSTRAINT "PK_hris_sync_runs" PRIMARY KEY (id)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    ALTER TABLE "hris_sync_runs" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "hris_sync_runs" FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON "hris_sync_runs"
        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hris_sync_runs TO app_tenant;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    CREATE UNIQUE INDEX ux_hris_connectors_org_provider ON hris_connectors (organization_id, provider);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    CREATE INDEX ix_hris_external_employees_connector ON hris_external_employees (connector_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    CREATE UNIQUE INDEX ux_hris_external_employees_org_connector_external ON hris_external_employees (organization_id, connector_id, external_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    CREATE INDEX ix_hris_sync_record_errors_connector ON hris_sync_record_errors (connector_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    CREATE INDEX ix_hris_sync_record_errors_sync_run ON hris_sync_record_errors (sync_run_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    CREATE INDEX ix_hris_sync_runs_connector ON hris_sync_runs (connector_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    CREATE UNIQUE INDEX ux_hris_sync_runs_org_connector_idempotency ON hris_sync_runs (organization_id, connector_id, idempotency_key);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20260716000000_hris_domain') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20260716000000_hris_domain', '10.0.4');
    END IF;
END $EF$;
COMMIT;

