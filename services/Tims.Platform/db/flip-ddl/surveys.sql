-- GENERATED FILE — DO NOT EDIT BY HAND.
-- Regenerate: node scripts/db/extract-table-ddl.mjs surveys survey_responses
--
-- Tables: survey_responses, surveys
-- Source: packages/db/baseline/prod-public-schema.sql (captured 2026-08-03T18:13:55Z, server 17.6)
--
-- WHY THIS FILE EXISTS (issue #128, runbook §0 P8)
-- Deleting a Prisma model during an ownership flip can remove the only executable definition of a
-- table from this repository. `prisma db push` is the documented post-clone bootstrap step, so
-- without this file a fresh dev database would simply not have the table, and seeds referencing it
-- would fail. This DDL is extracted from the committed pg_dump of production, so it is what prod
-- ACTUALLY has — not what a migration file claims (see #111).
--
-- ⚠  NEVER APPLY THIS TO PRODUCTION. These tables already exist there. This is a bootstrap and
--    dev-parity artifact. Production DDL goes through docs/architecture/ddl-governance.md.
--
-- Idempotent and safe to re-run: IF NOT EXISTS on tables/indexes, catalog guards on constraints,
-- DROP POLICY IF EXISTS before CREATE POLICY, and GRANTs guarded on the role existing.

BEGIN;

-- Refuse to run against a Supabase-managed database. "Do not apply to production" is otherwise only
-- a comment, and a comment is not a control. Every Supabase project (prod, branches, previews) has a
-- `supabase_migrations` schema; a local dev database does not. This aborts the whole transaction, so
-- a mistaken apply changes nothing.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'supabase_migrations') THEN
    RAISE EXCEPTION 'REFUSED: this is a Supabase-managed database (supabase_migrations exists). These tables already exist here. This artifact is for local dev bootstrap only — see docs/architecture/ddl-governance.md.';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ──────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.survey_responses (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    survey_id uuid NOT NULL,
    user_id uuid,
    answers jsonb NOT NULL,
    submitted_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS public.surveys (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    questions jsonb NOT NULL,
    target_groups jsonb,
    starts_at timestamp(3) without time zone,
    ends_at timestamp(3) without time zone,
    response_count integer DEFAULT 0 NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Primary keys and unique constraints
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'survey_responses_pkey'
                    AND conrelid = 'public.survey_responses'::regclass) THEN
    ALTER TABLE ONLY public.survey_responses
        ADD CONSTRAINT survey_responses_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'surveys_pkey'
                    AND conrelid = 'public.surveys'::regclass) THEN
    ALTER TABLE ONLY public.surveys
        ADD CONSTRAINT surveys_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS survey_responses_organization_id_idx ON public.survey_responses USING btree (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS survey_responses_survey_id_user_id_key ON public.survey_responses USING btree (survey_id, user_id);

CREATE INDEX IF NOT EXISTS survey_responses_user_id_idx ON public.survey_responses USING btree (user_id);

CREATE INDEX IF NOT EXISTS surveys_created_by_id_idx ON public.surveys USING btree (created_by_id);

CREATE INDEX IF NOT EXISTS surveys_organization_id_idx ON public.surveys USING btree (organization_id);

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Row-level security — the tenant-isolation guard, as it exists in production
-- ──────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.survey_responses FORCE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.surveys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.survey_responses;
CREATE POLICY tenant_isolation ON public.survey_responses USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

DROP POLICY IF EXISTS tenant_isolation ON public.surveys;
CREATE POLICY tenant_isolation ON public.surveys USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Grants — guarded, because app_tenant may not exist on a fresh dev database
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.survey_responses TO app_tenant;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.surveys TO app_tenant;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Foreign keys — LAST, so a multi-table extraction applies in any order
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'survey_responses_survey_id_fkey'
                    AND conrelid = 'public.survey_responses'::regclass) THEN
    ALTER TABLE ONLY public.survey_responses
        ADD CONSTRAINT survey_responses_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.surveys(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'survey_responses_user_id_fkey'
                    AND conrelid = 'public.survey_responses'::regclass) THEN
    ALTER TABLE ONLY public.survey_responses
        ADD CONSTRAINT survey_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'surveys_created_by_id_fkey'
                    AND conrelid = 'public.surveys'::regclass) THEN
    ALTER TABLE ONLY public.surveys
        ADD CONSTRAINT surveys_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
