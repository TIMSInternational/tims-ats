-- Synthetic stand-in for production, used ONLY by scripts/backup-drill/local-e2e.sh.
-- Every value here is fake. Run as `postgres` (non-superuser, as on Supabase) except where noted.
-- It deliberately exercises the shapes the drill must survive: RLS with FORCE, policies naming both
-- Supabase roles (authenticated) and a project role that a fresh Supabase image lacks (app_tenant),
-- an FK into auth.users, a partitioned table, a trigger, a sequence, a unique index, and an enum, a
-- domain and a composite type.
\set ON_ERROR_STOP on

CREATE ROLE app_tenant NOLOGIN;

CREATE TYPE public.candidate_stage AS ENUM ('applied', 'screening', 'offer', 'hired');
CREATE DOMAIN public.email_address AS text CHECK (VALUE LIKE '%@%');
CREATE TYPE public.money_amount AS (amount numeric(12, 2), currency char(3));

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users (id),
  email public.email_address NOT NULL,
  stage public.candidate_stage NOT NULL DEFAULT 'applied',
  full_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX candidates_org_email_key ON public.candidates (organization_id, email);

CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER candidates_touch BEFORE UPDATE ON public.candidates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.audit_logs (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL,
  action text NOT NULL
);

CREATE TABLE public.events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at date NOT NULL,
  kind text NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE public.events_2026h1 PARTITION OF public.events FOR VALUES FROM ('2026-01-01') TO ('2026-07-01');
CREATE TABLE public.events_2026h2 PARTITION OF public.events FOR VALUES FROM ('2026-07-01') TO ('2027-01-01');

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.candidates TO app_tenant
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
CREATE POLICY own_profile ON public.candidates FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY tenant_isolation ON public.organizations TO app_tenant
  USING (id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON public.audit_logs AS RESTRICTIVE TO app_tenant
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON public.candidates, public.organizations TO app_tenant;
GRANT SELECT ON public.candidates TO authenticated;

INSERT INTO public.organizations (name) SELECT 'Org ' || g FROM generate_series(1, 3) g;
INSERT INTO public.candidates (organization_id, email, full_name)
SELECT o.id, 'person' || g || '@synthetic.example.test', 'Synthetic Person ' || g
FROM generate_series(1, 250) g
JOIN LATERAL (SELECT id FROM public.organizations ORDER BY name OFFSET (g % 3) LIMIT 1) o ON true;
INSERT INTO public.audit_logs (organization_id, action)
SELECT (SELECT id FROM public.organizations ORDER BY name LIMIT 1), 'action-' || g FROM generate_series(1, 40) g;
INSERT INTO public.events (occurred_at, kind)
SELECT date '2026-01-01' + (g * 3), 'kind-' || (g % 5) FROM generate_series(1, 100) g;
