-- GENERATED FILE — DO NOT EDIT BY HAND.
-- Regenerate: node scripts/db/extract-table-ddl.mjs salary_adjustments employee_compensations
--
-- Tables: employee_compensations, salary_adjustments
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

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ──────────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_compensations (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    current_salary double precision NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    compa_ratio double precision,
    band_id uuid,
    variable_pay double precision,
    effective_date timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS public.salary_adjustments (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    previous_salary double precision NOT NULL,
    new_salary double precision NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    approved_by_id uuid,
    effective_date timestamp(3) without time zone,
    requested_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL
);

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Primary keys and unique constraints
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'employee_compensations_pkey'
                    AND conrelid = 'public.employee_compensations'::regclass) THEN
    ALTER TABLE ONLY public.employee_compensations
        ADD CONSTRAINT employee_compensations_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'salary_adjustments_pkey'
                    AND conrelid = 'public.salary_adjustments'::regclass) THEN
    ALTER TABLE ONLY public.salary_adjustments
        ADD CONSTRAINT salary_adjustments_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS employee_compensations_band_id_idx ON public.employee_compensations USING btree (band_id);

CREATE INDEX IF NOT EXISTS employee_compensations_organization_id_idx ON public.employee_compensations USING btree (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS employee_compensations_organization_id_user_id_key ON public.employee_compensations USING btree (organization_id, user_id);

CREATE INDEX IF NOT EXISTS salary_adjustments_approved_by_id_idx ON public.salary_adjustments USING btree (approved_by_id);

CREATE INDEX IF NOT EXISTS salary_adjustments_organization_id_idx ON public.salary_adjustments USING btree (organization_id);

CREATE INDEX IF NOT EXISTS salary_adjustments_requested_by_id_idx ON public.salary_adjustments USING btree (requested_by_id);

CREATE INDEX IF NOT EXISTS salary_adjustments_user_id_idx ON public.salary_adjustments USING btree (user_id);

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Row-level security — the tenant-isolation guard, as it exists in production
-- ──────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.employee_compensations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.salary_adjustments ENABLE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.employee_compensations FORCE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.salary_adjustments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.employee_compensations;
CREATE POLICY tenant_isolation ON public.employee_compensations USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

DROP POLICY IF EXISTS tenant_isolation ON public.salary_adjustments;
CREATE POLICY tenant_isolation ON public.salary_adjustments USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Grants — guarded, because app_tenant may not exist on a fresh dev database
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.employee_compensations TO app_tenant;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.salary_adjustments TO app_tenant;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Foreign keys — LAST, so a multi-table extraction applies in any order
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'employee_compensations_band_id_fkey'
                    AND conrelid = 'public.employee_compensations'::regclass) THEN
    ALTER TABLE ONLY public.employee_compensations
        ADD CONSTRAINT employee_compensations_band_id_fkey FOREIGN KEY (band_id) REFERENCES public.salary_bands(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'employee_compensations_user_id_fkey'
                    AND conrelid = 'public.employee_compensations'::regclass) THEN
    ALTER TABLE ONLY public.employee_compensations
        ADD CONSTRAINT employee_compensations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'salary_adjustments_approved_by_id_fkey'
                    AND conrelid = 'public.salary_adjustments'::regclass) THEN
    ALTER TABLE ONLY public.salary_adjustments
        ADD CONSTRAINT salary_adjustments_approved_by_id_fkey FOREIGN KEY (approved_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'salary_adjustments_requested_by_id_fkey'
                    AND conrelid = 'public.salary_adjustments'::regclass) THEN
    ALTER TABLE ONLY public.salary_adjustments
        ADD CONSTRAINT salary_adjustments_requested_by_id_fkey FOREIGN KEY (requested_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'salary_adjustments_user_id_fkey'
                    AND conrelid = 'public.salary_adjustments'::regclass) THEN
    ALTER TABLE ONLY public.salary_adjustments
        ADD CONSTRAINT salary_adjustments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;
