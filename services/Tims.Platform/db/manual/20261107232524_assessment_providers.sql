CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" (
    "MigrationId" character varying(150) NOT NULL,
    "ProductVersion" character varying(32) NOT NULL,
    CONSTRAINT "PK___EFMigrationsHistory" PRIMARY KEY ("MigrationId")
);

START TRANSACTION;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE TABLE assessment_provider_bindings (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        provider text NOT NULL,
        provider_tenant_id uuid NOT NULL,
        enabled_instruments text[] NOT NULL DEFAULT ('{}'::text[]),
        default_locale text NOT NULL,
        is_active boolean NOT NULL DEFAULT TRUE,
        created_at timestamp with time zone NOT NULL DEFAULT (now()),
        updated_at timestamp with time zone NOT NULL DEFAULT (now()),
        CONSTRAINT "PK_assessment_provider_bindings" PRIMARY KEY (id),
        CONSTRAINT ck_assessment_provider_bindings_instruments CHECK (enabled_instruments <@ ARRAY['lia', 'english', 'itcia', 'personality', 'mi', 'pca']::text[]),
        CONSTRAINT ck_assessment_provider_bindings_locale CHECK (default_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
        CONSTRAINT ck_assessment_provider_bindings_provider CHECK (provider = 'tims-assessments')
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE TABLE assessment_provider_webhook_inbox (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        event_id uuid NOT NULL,
        event_type text NOT NULL,
        event_version integer NOT NULL,
        provider_tenant_id uuid NOT NULL,
        occurred_at timestamp with time zone NOT NULL,
        delivery_attempt integer,
        status text NOT NULL,
        processing_attempts integer NOT NULL DEFAULT 0,
        last_error_code text,
        data jsonb NOT NULL,
        received_at timestamp with time zone NOT NULL DEFAULT (now()),
        processed_at timestamp with time zone,
        CONSTRAINT "PK_assessment_provider_webhook_inbox" PRIMARY KEY (id),
        CONSTRAINT ck_assessment_provider_webhook_inbox_attempts CHECK (processing_attempts >= 0),
        CONSTRAINT ck_assessment_provider_webhook_inbox_error_code CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 64),
        CONSTRAINT ck_assessment_provider_webhook_inbox_status CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
        CONSTRAINT ck_assessment_provider_webhook_inbox_type CHECK (event_type IN ('assignment.started', 'session.completed', 'session.voided', 'result.ready', 'assignment.expired', 'subject.erased')),
        CONSTRAINT ck_assessment_provider_webhook_inbox_version CHECK (event_version = 1)
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE TABLE assessment_provider_attempts (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        binding_id uuid NOT NULL,
        candidate_id uuid NOT NULL,
        vacancy_id uuid NOT NULL,
        instrument text NOT NULL,
        state text NOT NULL,
        purpose text NOT NULL,
        job_relatedness_reason text NOT NULL,
        locale text NOT NULL,
        time_multiplier numeric(3,2) NOT NULL,
        aids text[] NOT NULL DEFAULT ('{}'::text[]),
        requested_expires_at timestamp with time zone,
        provider_subject_id uuid,
        provider_assignment_id uuid,
        instrument_version text,
        content_version text,
        required_consents text[] NOT NULL DEFAULT ('{}'::text[]),
        expires_at timestamp with time zone,
        started_at timestamp with time zone,
        completed_at timestamp with time zone,
        last_launched_at timestamp with time zone,
        latest_result_id uuid,
        last_error_code text,
        assigned_by_id uuid NOT NULL,
        created_at timestamp with time zone NOT NULL DEFAULT (now()),
        updated_at timestamp with time zone NOT NULL DEFAULT (now()),
        CONSTRAINT "PK_assessment_provider_attempts" PRIMARY KEY (id),
        CONSTRAINT ck_assessment_provider_attempts_aids CHECK (aids <@ ARRAY['extended_breaks', 'screen_reader', 'screen_magnification', 'high_contrast', 'assistive_input', 'captions_or_transcript', 'reader_assistance', 'separate_setting']::text[]),
        CONSTRAINT ck_assessment_provider_attempts_content_version CHECK (content_version IS NULL OR char_length(content_version) <= 64),
        CONSTRAINT ck_assessment_provider_attempts_error_code CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 64),
        CONSTRAINT ck_assessment_provider_attempts_external_ids CHECK (state IN ('pending_create', 'cancelled') OR (provider_assignment_id IS NOT NULL AND provider_subject_id IS NOT NULL)),
        CONSTRAINT ck_assessment_provider_attempts_instrument CHECK (instrument IN ('lia', 'english', 'itcia', 'personality', 'mi', 'pca')),
        CONSTRAINT ck_assessment_provider_attempts_instrument_version CHECK (instrument_version IS NULL OR instrument_version ~ '^[0-9]{1,3}\.[0-9]{1,3}$'),
        CONSTRAINT ck_assessment_provider_attempts_locale CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
        CONSTRAINT ck_assessment_provider_attempts_purpose CHECK (purpose = 'selection'),
        CONSTRAINT ck_assessment_provider_attempts_reason CHECK (char_length(job_relatedness_reason) BETWEEN 3 AND 500),
        CONSTRAINT ck_assessment_provider_attempts_required_consents CHECK (required_consents <@ ARRAY['assessment', 'biometric', 'voice', 'ai_scoring']::text[]),
        CONSTRAINT ck_assessment_provider_attempts_state CHECK (state IN ('pending_create', 'created', 'launched', 'in_progress', 'completed', 'result_ready', 'voided', 'expired', 'cancelled', 'erased')),
        CONSTRAINT ck_assessment_provider_attempts_time_multiplier CHECK (time_multiplier BETWEEN 1 AND 3),
        CONSTRAINT fk_assessment_provider_attempts_binding FOREIGN KEY (binding_id) REFERENCES assessment_provider_bindings (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE TABLE assessment_provider_results (
        id uuid NOT NULL,
        organization_id uuid NOT NULL,
        attempt_id uuid NOT NULL,
        provider_result_id uuid NOT NULL,
        result_revision integer NOT NULL,
        result_schema text NOT NULL,
        instrument text NOT NULL,
        instrument_version text NOT NULL,
        content_version text NOT NULL,
        content_sha256 text NOT NULL,
        norm_version text,
        scoring_version text NOT NULL,
        scoring_method text NOT NULL,
        purpose text NOT NULL,
        validity_status text NOT NULL,
        validity_reasons text[] NOT NULL DEFAULT ('{}'::text[]),
        requires_human_review boolean NOT NULL DEFAULT FALSE,
        completion text NOT NULL,
        global_percentile double precision,
        cefr text,
        level integer,
        time_multiplier_applied numeric(3,2) NOT NULL,
        rendered_for text NOT NULL,
        rendered_level text NOT NULL,
        scores jsonb,
        completed_at timestamp with time zone NOT NULL,
        scored_at timestamp with time zone NOT NULL,
        created_at timestamp with time zone NOT NULL DEFAULT (now()),
        updated_at timestamp with time zone NOT NULL DEFAULT (now()),
        CONSTRAINT "PK_assessment_provider_results" PRIMARY KEY (id),
        CONSTRAINT ck_assessment_provider_results_cefr CHECK (cefr IS NULL OR cefr IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
        CONSTRAINT ck_assessment_provider_results_completion CHECK (completion IN ('complete', 'partial')),
        CONSTRAINT ck_assessment_provider_results_instrument CHECK (instrument IN ('lia', 'english', 'itcia', 'personality', 'mi', 'pca')),
        CONSTRAINT ck_assessment_provider_results_level CHECK (level IS NULL OR level BETWEEN 1 AND 5),
        CONSTRAINT ck_assessment_provider_results_percentile CHECK (global_percentile IS NULL OR (global_percentile >= 0 AND global_percentile <= 100)),
        CONSTRAINT ck_assessment_provider_results_purpose CHECK (purpose = 'selection'),
        CONSTRAINT ck_assessment_provider_results_rendering CHECK (rendered_for = 'tenant_hr' AND rendered_level IN ('summary', 'full')),
        CONSTRAINT ck_assessment_provider_results_revision CHECK (result_revision >= 1),
        CONSTRAINT ck_assessment_provider_results_schema CHECK (result_schema IN ('LiaResultV1', 'EnglishResultV1', 'ItciaResultV1', 'PersonalityResultV1', 'MiResultV1', 'PcaResultV1')),
        CONSTRAINT ck_assessment_provider_results_scoring_method CHECK (scoring_method IN ('deterministic', 'ai_assisted', 'provider')),
        CONSTRAINT ck_assessment_provider_results_sha256 CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
        CONSTRAINT ck_assessment_provider_results_time_multiplier CHECK (time_multiplier_applied BETWEEN 1 AND 3),
        CONSTRAINT ck_assessment_provider_results_validity CHECK (validity_status IN ('valid', 'voided', 'needs_review')),
        CONSTRAINT fk_assessment_provider_results_attempt FOREIGN KEY (attempt_id) REFERENCES assessment_provider_attempts (id) ON DELETE RESTRICT
    );
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE INDEX ix_assessment_provider_attempts_binding ON assessment_provider_attempts (binding_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE INDEX ix_assessment_provider_attempts_candidate_vacancy ON assessment_provider_attempts (organization_id, candidate_id, vacancy_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE INDEX ix_assessment_provider_attempts_subject ON assessment_provider_attempts (organization_id, provider_subject_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE UNIQUE INDEX ux_assessment_provider_attempts_open ON assessment_provider_attempts (organization_id, candidate_id, vacancy_id, instrument) WHERE state IN ('pending_create', 'created', 'launched', 'in_progress', 'completed', 'result_ready');
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE UNIQUE INDEX ux_assessment_provider_attempts_provider_assignment ON assessment_provider_attempts (organization_id, provider_assignment_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE UNIQUE INDEX ux_assessment_provider_bindings_org_provider ON assessment_provider_bindings (organization_id, provider);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE UNIQUE INDEX ux_assessment_provider_bindings_provider_tenant ON assessment_provider_bindings (provider, provider_tenant_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE INDEX ix_assessment_provider_results_attempt ON assessment_provider_results (attempt_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE UNIQUE INDEX ux_assessment_provider_results_provider_result ON assessment_provider_results (organization_id, provider_result_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    CREATE UNIQUE INDEX ux_assessment_provider_webhook_inbox_event ON assessment_provider_webhook_inbox (organization_id, event_id);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    ALTER TABLE "assessment_provider_bindings" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "assessment_provider_bindings" FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON "assessment_provider_bindings"
        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    ALTER TABLE "assessment_provider_attempts" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "assessment_provider_attempts" FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON "assessment_provider_attempts"
        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    ALTER TABLE "assessment_provider_results" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "assessment_provider_results" FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON "assessment_provider_results"
        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    ALTER TABLE "assessment_provider_webhook_inbox" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "assessment_provider_webhook_inbox" FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON "assessment_provider_webhook_inbox"
        USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_provider_attempts TO app_tenant;
    GRANT SELECT, INSERT, UPDATE, DELETE ON assessment_provider_results TO app_tenant;
    GRANT SELECT, INSERT, UPDATE ON assessment_provider_webhook_inbox TO app_tenant;
    REVOKE DELETE, TRUNCATE ON assessment_provider_webhook_inbox FROM app_tenant;
    GRANT SELECT ON assessment_provider_bindings TO app_tenant;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON assessment_provider_bindings FROM app_tenant;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    DO $acl$
    DECLARE r text;
    BEGIN
      FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('REVOKE ALL ON TABLE assessment_provider_bindings, assessment_provider_attempts, assessment_provider_results, assessment_provider_webhook_inbox FROM %I', r);
        END IF;
      END LOOP;
    END
    $acl$;
    END IF;
END $EF$;

DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM "__EFMigrationsHistory" WHERE "MigrationId" = '20261107232524_assessment_providers') THEN
    INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
    VALUES ('20261107232524_assessment_providers', '10.0.4');
    END IF;
END $EF$;
COMMIT;

