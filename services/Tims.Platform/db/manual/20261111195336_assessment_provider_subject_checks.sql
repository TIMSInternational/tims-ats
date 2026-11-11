START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111195336_assessment_provider_subject_checks') THEN
    CREATE TABLE assessment_provider_subject_checks (
        organization_id uuid NOT NULL,
        provider_subject_id uuid NOT NULL,
        last_checked_at timestamp with time zone,
        CONSTRAINT "PK_assessment_provider_subject_checks" PRIMARY KEY (organization_id, provider_subject_id)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111195336_assessment_provider_subject_checks') THEN
    ALTER TABLE "assessment_provider_subject_checks" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "assessment_provider_subject_checks" FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON "assessment_provider_subject_checks"
        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111195336_assessment_provider_subject_checks') THEN
    GRANT SELECT, INSERT, UPDATE ON assessment_provider_subject_checks TO app_tenant;
    REVOKE DELETE, TRUNCATE ON assessment_provider_subject_checks FROM app_tenant;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111195336_assessment_provider_subject_checks') THEN
    DO $acl$
    DECLARE r text;
    BEGIN
      FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('REVOKE ALL ON TABLE assessment_provider_subject_checks FROM %I', r);
        END IF;
      END LOOP;
    END
    $acl$;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261111195336_assessment_provider_subject_checks') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261111195336_assessment_provider_subject_checks', '10.0.4');
    END IF;
END $EF$;
COMMIT;

