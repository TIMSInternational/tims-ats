-- GENERATED FILE — DO NOT EDIT BY HAND.
-- Regenerate: node scripts/db/extract-table-ddl.mjs calibration_sessions calibration_members calibration_votes
--
-- Tables: calibration_members, calibration_sessions, calibration_votes
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

CREATE TABLE IF NOT EXISTS public.calibration_members (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS public.calibration_sessions (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    period text NOT NULL,
    status text NOT NULL,
    scheduled_at timestamp(3) without time zone,
    completed_at timestamp(3) without time zone,
    created_by_id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS public.calibration_votes (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    evaluated_user_id uuid NOT NULL,
    voter_id uuid NOT NULL,
    quadrant text NOT NULL,
    justification text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Primary keys and unique constraints
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'calibration_members_pkey'
                    AND conrelid = 'public.calibration_members'::regclass) THEN
    ALTER TABLE ONLY public.calibration_members
        ADD CONSTRAINT calibration_members_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'calibration_sessions_pkey'
                    AND conrelid = 'public.calibration_sessions'::regclass) THEN
    ALTER TABLE ONLY public.calibration_sessions
        ADD CONSTRAINT calibration_sessions_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'calibration_votes_pkey'
                    AND conrelid = 'public.calibration_votes'::regclass) THEN
    ALTER TABLE ONLY public.calibration_votes
        ADD CONSTRAINT calibration_votes_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS calibration_members_session_id_user_id_key ON public.calibration_members USING btree (session_id, user_id);

CREATE INDEX IF NOT EXISTS calibration_members_user_id_idx ON public.calibration_members USING btree (user_id);

CREATE INDEX IF NOT EXISTS calibration_sessions_created_by_id_idx ON public.calibration_sessions USING btree (created_by_id);

CREATE INDEX IF NOT EXISTS calibration_sessions_organization_id_idx ON public.calibration_sessions USING btree (organization_id);

CREATE INDEX IF NOT EXISTS calibration_votes_evaluated_user_id_idx ON public.calibration_votes USING btree (evaluated_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS calibration_votes_session_id_evaluated_user_id_voter_id_key ON public.calibration_votes USING btree (session_id, evaluated_user_id, voter_id);

CREATE INDEX IF NOT EXISTS calibration_votes_voter_id_idx ON public.calibration_votes USING btree (voter_id);

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Row-level security — the tenant-isolation guard, as it exists in production
-- ──────────────────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.calibration_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calibration_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calibration_votes ENABLE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.calibration_members FORCE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.calibration_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE ONLY public.calibration_votes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.calibration_members;
CREATE POLICY tenant_isolation ON public.calibration_members USING ((EXISTS ( SELECT 1
   FROM public.calibration_sessions par
  WHERE ((par.id = calibration_members.session_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.calibration_sessions par
  WHERE ((par.id = calibration_members.session_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))));

DROP POLICY IF EXISTS tenant_isolation ON public.calibration_sessions;
CREATE POLICY tenant_isolation ON public.calibration_sessions USING ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)) WITH CHECK ((organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid));

DROP POLICY IF EXISTS tenant_isolation ON public.calibration_votes;
CREATE POLICY tenant_isolation ON public.calibration_votes USING ((EXISTS ( SELECT 1
   FROM public.calibration_sessions par
  WHERE ((par.id = calibration_votes.session_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.calibration_sessions par
  WHERE ((par.id = calibration_votes.session_id) AND (par.organization_id = (NULLIF(current_setting('app.current_org_id'::text, true), ''::text))::uuid)))));

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Grants — guarded, because app_tenant may not exist on a fresh dev database
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.calibration_members TO app_tenant;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.calibration_sessions TO app_tenant;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.calibration_votes TO app_tenant;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────────────────────
-- Foreign keys — LAST, so a multi-table extraction applies in any order
-- ──────────────────────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'calibration_members_session_id_fkey'
                    AND conrelid = 'public.calibration_members'::regclass) THEN
    ALTER TABLE ONLY public.calibration_members
        ADD CONSTRAINT calibration_members_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.calibration_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'calibration_members_user_id_fkey'
                    AND conrelid = 'public.calibration_members'::regclass) THEN
    ALTER TABLE ONLY public.calibration_members
        ADD CONSTRAINT calibration_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'calibration_sessions_created_by_id_fkey'
                    AND conrelid = 'public.calibration_sessions'::regclass) THEN
    ALTER TABLE ONLY public.calibration_sessions
        ADD CONSTRAINT calibration_sessions_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'calibration_votes_evaluated_user_id_fkey'
                    AND conrelid = 'public.calibration_votes'::regclass) THEN
    ALTER TABLE ONLY public.calibration_votes
        ADD CONSTRAINT calibration_votes_evaluated_user_id_fkey FOREIGN KEY (evaluated_user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'calibration_votes_session_id_fkey'
                    AND conrelid = 'public.calibration_votes'::regclass) THEN
    ALTER TABLE ONLY public.calibration_votes
        ADD CONSTRAINT calibration_votes_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.calibration_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'calibration_votes_voter_id_fkey'
                    AND conrelid = 'public.calibration_votes'::regclass) THEN
    ALTER TABLE ONLY public.calibration_votes
        ADD CONSTRAINT calibration_votes_voter_id_fkey FOREIGN KEY (voter_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
