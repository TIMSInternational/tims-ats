-- GENERATED FILE — DO NOT EDIT BY HAND.
-- Regenerate: node scripts/db/extract-table-ddl.mjs review_cycles rater_assignments rater_responses
--
-- Tables: rater_assignments, rater_responses, review_cycles
-- Source: packages/db/baseline/prod-public-schema.sql (captured 2026-08-04T17:30:30Z, server 17.6)
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
-- 1. Enum types — must exist before the columns that use them
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'RaterAssignmentStatus') THEN
    CREATE TYPE public."RaterAssignmentStatus" AS ENUM (
        'pending',
        'submitted'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'RaterRelationship') THEN
    CREATE TYPE public."RaterRelationship" AS ENUM (
        'self',
        'manager',
        'peer',
        'direct_report'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'ReviewCycleStatus') THEN
    CREATE TYPE public."ReviewCycleStatus" AS ENUM (
        'draft',
        'open',
        'closed',
        'published'
    );
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Tables
-- ──────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rater_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    cycle_id uuid NOT NULL,
    subject_user_id uuid NOT NULL,
    rater_user_id uuid NOT NULL,
    relationship public."RaterRelationship" NOT NULL,
    status public."RaterAssignmentStatus" DEFAULT 'pending'::public."RaterAssignmentStatus" NOT NULL,
    submitted_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS public.rater_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    competency_key text NOT NULL,
    rating integer NOT NULL,
    comment character varying(5000),
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS public.review_cycles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    status public."ReviewCycleStatus" DEFAULT 'draft'::public."ReviewCycleStatus" NOT NULL,
    opens_at timestamp(3) without time zone,
    closes_at timestamp(3) without time zone,
    published_at timestamp(3) without time zone,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Primary keys and unique constraints
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'rater_assignments_pkey'
                    AND conrelid = 'public.rater_assignments'::regclass) THEN
    ALTER TABLE ONLY public.rater_assignments
        ADD CONSTRAINT rater_assignments_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'rater_responses_pkey'
                    AND conrelid = 'public.rater_responses'::regclass) THEN
    ALTER TABLE ONLY public.rater_responses
        ADD CONSTRAINT rater_responses_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'review_cycles_pkey'
                    AND conrelid = 'public.review_cycles'::regclass) THEN
    ALTER TABLE ONLY public.review_cycles
        ADD CONSTRAINT review_cycles_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS rater_assignments_cycle_id_idx ON public.rater_assignments USING btree (cycle_id);

CREATE UNIQUE INDEX IF NOT EXISTS rater_assignments_cycle_id_subject_user_id_rater_user_id_key ON public.rater_assignments USING btree (cycle_id, subject_user_id, rater_user_id);

CREATE INDEX IF NOT EXISTS rater_assignments_organization_id_idx ON public.rater_assignments USING btree (organization_id);

CREATE INDEX IF NOT EXISTS rater_assignments_rater_user_id_idx ON public.rater_assignments USING btree (rater_user_id);

CREATE INDEX IF NOT EXISTS rater_assignments_subject_user_id_idx ON public.rater_assignments USING btree (subject_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS rater_responses_assignment_id_competency_key_key ON public.rater_responses USING btree (assignment_id, competency_key);

CREATE INDEX IF NOT EXISTS rater_responses_assignment_id_idx ON public.rater_responses USING btree (assignment_id);

CREATE INDEX IF NOT EXISTS rater_responses_organization_id_idx ON public.rater_responses USING btree (organization_id);

CREATE INDEX IF NOT EXISTS review_cycles_organization_id_idx ON public.review_cycles USING btree (organization_id);

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Row-level security — the tenant-isolation guard, as it exists in production
-- ──────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.rater_assignments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.rater_responses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.review_cycles ENABLE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.rater_assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.rater_responses FORCE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.review_cycles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.rater_assignments;
CREATE POLICY tenant_isolation ON public.rater_assignments USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

DROP POLICY IF EXISTS tenant_isolation ON public.rater_responses;
CREATE POLICY tenant_isolation ON public.rater_responses USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

DROP POLICY IF EXISTS tenant_isolation ON public.review_cycles;
CREATE POLICY tenant_isolation ON public.review_cycles USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Grants — guarded, because app_tenant may not exist on a fresh dev database
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rater_assignments TO app_tenant;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.rater_responses TO app_tenant;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.review_cycles TO app_tenant;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Foreign keys — LAST, so a multi-table extraction applies in any order
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'rater_assignments_cycle_id_fkey'
                    AND conrelid = 'public.rater_assignments'::regclass) THEN
    ALTER TABLE ONLY public.rater_assignments
        ADD CONSTRAINT rater_assignments_cycle_id_fkey FOREIGN KEY (cycle_id) REFERENCES public.review_cycles(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'rater_assignments_organization_id_fkey'
                    AND conrelid = 'public.rater_assignments'::regclass) THEN
    ALTER TABLE ONLY public.rater_assignments
        ADD CONSTRAINT rater_assignments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'rater_assignments_rater_user_id_fkey'
                    AND conrelid = 'public.rater_assignments'::regclass) THEN
    ALTER TABLE ONLY public.rater_assignments
        ADD CONSTRAINT rater_assignments_rater_user_id_fkey FOREIGN KEY (rater_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'rater_assignments_subject_user_id_fkey'
                    AND conrelid = 'public.rater_assignments'::regclass) THEN
    ALTER TABLE ONLY public.rater_assignments
        ADD CONSTRAINT rater_assignments_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'rater_responses_assignment_id_fkey'
                    AND conrelid = 'public.rater_responses'::regclass) THEN
    ALTER TABLE ONLY public.rater_responses
        ADD CONSTRAINT rater_responses_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.rater_assignments(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'rater_responses_organization_id_fkey'
                    AND conrelid = 'public.rater_responses'::regclass) THEN
    ALTER TABLE ONLY public.rater_responses
        ADD CONSTRAINT rater_responses_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'review_cycles_created_by_id_fkey'
                    AND conrelid = 'public.review_cycles'::regclass) THEN
    ALTER TABLE ONLY public.review_cycles
        ADD CONSTRAINT review_cycles_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'review_cycles_organization_id_fkey'
                    AND conrelid = 'public.review_cycles'::regclass) THEN
    ALTER TABLE ONLY public.review_cycles
        ADD CONSTRAINT review_cycles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
