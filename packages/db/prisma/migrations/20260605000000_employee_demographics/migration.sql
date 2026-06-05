-- Employee demographics — voluntary self-ID data for DEI analytics, stored 1:1
-- with users in a separate table so this sensitive PII stays out of User selects.
-- Tenant-scoped via organization_id; RLS enabled to match every other tenant table
-- (see 20260604100000_enable_rls_tenant_isolation). Additive + reversible.

-- 1) Enums (idempotent guards so re-running is safe).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Gender') THEN
    CREATE TYPE "Gender" AS ENUM ('female', 'male', 'non_binary', 'undisclosed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Ethnicity') THEN
    CREATE TYPE "Ethnicity" AS ENUM ('mestizo', 'afrodescendiente', 'indigena', 'raizal', 'rom', 'palenquero', 'blanco', 'otro', 'undisclosed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DisabilityStatus') THEN
    CREATE TYPE "DisabilityStatus" AS ENUM ('none', 'has_disability', 'undisclosed');
  END IF;
END $$;

-- 2) Table.
CREATE TABLE IF NOT EXISTS "employee_demographics" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"   UUID NOT NULL,
  "user_id"           UUID NOT NULL,
  "gender"            "Gender" NOT NULL DEFAULT 'undisclosed',
  "date_of_birth"     DATE,
  "nationality"       TEXT,
  "ethnicity"         "Ethnicity" NOT NULL DEFAULT 'undisclosed',
  "disability_status" "DisabilityStatus" NOT NULL DEFAULT 'undisclosed',
  "self_identified"   BOOLEAN NOT NULL DEFAULT false,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_demographics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "employee_demographics_user_id_key" ON "employee_demographics" ("user_id");
CREATE INDEX IF NOT EXISTS "employee_demographics_organization_id_idx" ON "employee_demographics" ("organization_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_demographics_user_id_fkey') THEN
    ALTER TABLE "employee_demographics"
      ADD CONSTRAINT "employee_demographics_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3) Grants for the RLS tenant role (default privileges may already cover this;
--    explicit GRANT is harmless and keeps the migration self-contained).
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_demographics" TO app_tenant;

-- 4) RLS — fail-closed tenant isolation, identical policy shape to all other
--    tenant tables. Unset GUC → NULL → no rows visible.
ALTER TABLE "employee_demographics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_demographics" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "employee_demographics";
CREATE POLICY tenant_isolation ON "employee_demographics"
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
