-- Wave 2.5 slice 1 — access-control anchors + sensitive-data compliance models.
-- Adds UserBusinessUnit (hrbp↔unit scope anchor), DataAccessLog (7-yr audit trail
-- for confidential/restricted reads), and DataConsent (subject consent; withdrawal
-- hides sensitive data in application layer).
-- Tenant-scoped via organization_id; RLS enabled to match every other tenant table
-- (see 20260604100000_enable_rls_tenant_isolation). Additive + idempotent.

-- 1) Tables.
CREATE TABLE IF NOT EXISTS "user_business_units" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"  UUID         NOT NULL,
  "user_id"          UUID         NOT NULL,
  "business_unit_id" UUID         NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_business_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_business_units_user_id_business_unit_id_key"
  ON "user_business_units" ("user_id", "business_unit_id");
CREATE INDEX IF NOT EXISTS "user_business_units_organization_id_idx"
  ON "user_business_units" ("organization_id");
CREATE INDEX IF NOT EXISTS "user_business_units_business_unit_id_idx"
  ON "user_business_units" ("business_unit_id");

-- DataAccessLog has no updated_at (append-only audit log; rows are never mutated).
CREATE TABLE IF NOT EXISTS "data_access_logs" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID         NOT NULL,
  "actor_id"        UUID         NOT NULL,
  "data_type"       TEXT         NOT NULL,
  "record_id"       UUID         NOT NULL,
  "action"          TEXT         NOT NULL,
  "ip_address"      TEXT,
  "user_agent"      TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_access_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "data_access_logs_organization_id_idx"
  ON "data_access_logs" ("organization_id");
CREATE INDEX IF NOT EXISTS "data_access_logs_actor_id_idx"
  ON "data_access_logs" ("actor_id");
CREATE INDEX IF NOT EXISTS "data_access_logs_data_type_record_id_idx"
  ON "data_access_logs" ("data_type", "record_id");

CREATE TABLE IF NOT EXISTS "data_consents" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID         NOT NULL,
  "subject_user_id" UUID         NOT NULL,
  "consent_type"    TEXT         NOT NULL,
  "text_version"    TEXT         NOT NULL,
  "agreed_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawn_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "data_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "data_consents_subject_user_id_consent_type_key"
  ON "data_consents" ("subject_user_id", "consent_type");
CREATE INDEX IF NOT EXISTS "data_consents_organization_id_idx"
  ON "data_consents" ("organization_id");

-- 2) Foreign keys (idempotent checks).
--    Only user_business_units gets hard FKs — it is the structural join table.
--    DataAccessLog and DataConsent use soft actor/subject references so audit and
--    consent rows survive user deletion (log integrity + GDPR evidence preservation).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_business_units_user_id_fkey') THEN
    ALTER TABLE "user_business_units"
      ADD CONSTRAINT "user_business_units_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_business_units_business_unit_id_fkey') THEN
    ALTER TABLE "user_business_units"
      ADD CONSTRAINT "user_business_units_business_unit_id_fkey"
      FOREIGN KEY ("business_unit_id") REFERENCES "business_units" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Grants for the RLS tenant role (harmless if already covered by defaults).
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_business_units" TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "data_access_logs" TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "data_consents" TO app_tenant;

-- 4) RLS — fail-closed tenant isolation, identical policy shape to every other
--    tenant table. Unset GUC → NULL → no rows visible.
ALTER TABLE "user_business_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_business_units" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "user_business_units";
CREATE POLICY tenant_isolation ON "user_business_units"
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "data_access_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_access_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "data_access_logs";
CREATE POLICY tenant_isolation ON "data_access_logs"
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "data_consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_consents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "data_consents";
CREATE POLICY tenant_isolation ON "data_consents"
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
