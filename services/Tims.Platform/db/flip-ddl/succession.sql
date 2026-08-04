-- GENERATED FILE — DO NOT EDIT BY HAND.
-- Regenerate: node scripts/db/extract-table-ddl.mjs critical_roles successors
--
-- Tables: critical_roles, successors
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
-- 1. Tables
-- ──────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.critical_roles (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    position_id text,
    current_holder_id uuid,
    company_id uuid,
    unit_id uuid,
    criticality text NOT NULL,
    flight_risk double precision,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    target_band_level text
);

CREATE TABLE IF NOT EXISTS public.successors (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    critical_role_id uuid NOT NULL,
    user_id uuid NOT NULL,
    readiness text NOT NULL,
    type text NOT NULL,
    development_plan text,
    added_by_id uuid,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Primary keys and unique constraints
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'critical_roles_pkey'
                    AND conrelid = 'public.critical_roles'::regclass) THEN
    ALTER TABLE ONLY public.critical_roles
        ADD CONSTRAINT critical_roles_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'successors_pkey'
                    AND conrelid = 'public.successors'::regclass) THEN
    ALTER TABLE ONLY public.successors
        ADD CONSTRAINT successors_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS critical_roles_company_id_idx ON public.critical_roles USING btree (company_id);

CREATE INDEX IF NOT EXISTS critical_roles_current_holder_id_idx ON public.critical_roles USING btree (current_holder_id);

CREATE INDEX IF NOT EXISTS critical_roles_organization_id_idx ON public.critical_roles USING btree (organization_id);

CREATE INDEX IF NOT EXISTS critical_roles_unit_id_idx ON public.critical_roles USING btree (unit_id);

CREATE INDEX IF NOT EXISTS successors_added_by_id_idx ON public.successors USING btree (added_by_id);

CREATE UNIQUE INDEX IF NOT EXISTS successors_critical_role_id_user_id_key ON public.successors USING btree (critical_role_id, user_id);

CREATE INDEX IF NOT EXISTS successors_organization_id_idx ON public.successors USING btree (organization_id);

CREATE INDEX IF NOT EXISTS successors_user_id_idx ON public.successors USING btree (user_id);

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Row-level security — the tenant-isolation guard, as it exists in production
-- ──────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.critical_roles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.successors ENABLE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.critical_roles FORCE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.successors FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.critical_roles;
CREATE POLICY tenant_isolation ON public.critical_roles USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

DROP POLICY IF EXISTS tenant_isolation ON public.successors;
CREATE POLICY tenant_isolation ON public.successors USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Grants — guarded, because app_tenant may not exist on a fresh dev database
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.critical_roles TO app_tenant;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.successors TO app_tenant;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Foreign keys — LAST, so a multi-table extraction applies in any order
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'critical_roles_current_holder_id_fkey'
                    AND conrelid = 'public.critical_roles'::regclass) THEN
    ALTER TABLE ONLY public.critical_roles
        ADD CONSTRAINT critical_roles_current_holder_id_fkey FOREIGN KEY (current_holder_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'successors_added_by_id_fkey'
                    AND conrelid = 'public.successors'::regclass) THEN
    ALTER TABLE ONLY public.successors
        ADD CONSTRAINT successors_added_by_id_fkey FOREIGN KEY (added_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'successors_critical_role_id_fkey'
                    AND conrelid = 'public.successors'::regclass) THEN
    ALTER TABLE ONLY public.successors
        ADD CONSTRAINT successors_critical_role_id_fkey FOREIGN KEY (critical_role_id) REFERENCES public.critical_roles(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'successors_user_id_fkey'
                    AND conrelid = 'public.successors'::regclass) THEN
    ALTER TABLE ONLY public.successors
        ADD CONSTRAINT successors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
