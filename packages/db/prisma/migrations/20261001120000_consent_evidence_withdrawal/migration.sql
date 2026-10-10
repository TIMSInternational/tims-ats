-- Candidate data-processing consent: per-application evidence (#313) and withdrawal (#312).
-- Colombia Ley 1581 de 2012 / Decreto 1377 de 2013: the controller must KEEP PROOF of each
-- authorization and let the data subject REVOKE it and request deletion (supresion).
--
-- Additive and idempotent: safe to re-run (IF NOT EXISTS everywhere, the policy is dropped and
-- recreated, the backfill is ON CONFLICT DO NOTHING). Apply by hand via psql BEFORE the code that
-- writes these columns/tables is deployed (docs/architecture/ddl-governance.md).

-- 1. Withdrawal evidence on the subject-level status row.
ALTER TABLE "data_consents"
  ADD COLUMN IF NOT EXISTS "withdrawal_channel" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "withdrawal_reason" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "withdrawn_by_user_id" UUID;

-- 2. Per-application consent evidence. Soft references (no FK) to applications/candidates:
--    the proof of an authorization must outlive the erasure of what it authorized.
CREATE TABLE IF NOT EXISTS "application_consent_evidence" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "consent_type" VARCHAR(64) NOT NULL,
    "text_version" VARCHAR(64) NOT NULL,
    "text_sha256" VARCHAR(64),
    "locale" VARCHAR(5),
    "agreed_at" TIMESTAMP(3) NOT NULL,
    "ip_hash" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "captcha_verified" BOOLEAN,
    "is_backfilled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "application_consent_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "application_consent_evidence_application_id_consent_type_key"
  ON "application_consent_evidence"("application_id", "consent_type");
CREATE INDEX IF NOT EXISTS "application_consent_evidence_organization_id_idx"
  ON "application_consent_evidence"("organization_id");
CREATE INDEX IF NOT EXISTS "application_consent_evidence_candidate_id_idx"
  ON "application_consent_evidence"("candidate_id");

-- 3. Data-subject requests needing a human decision (today: deletion on withdrawal).
CREATE TABLE IF NOT EXISTS "data_subject_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "request_type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "source" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(500),
    "requested_by_user_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "data_subject_requests_organization_id_status_idx"
  ON "data_subject_requests"("organization_id", "status");
CREATE INDEX IF NOT EXISTS "data_subject_requests_candidate_id_idx"
  ON "data_subject_requests"("candidate_id");

-- 4. RLS — the identical ENABLE/FORCE/fail-closed tenant_isolation pattern of every tenant table
--    (20260713120000_add_hire_predictions). Check 17's invariant ("app_tenant writes only where
--    Prisma-owned OR RLS-protected") holds on both counts.
ALTER TABLE "application_consent_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_consent_evidence" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "application_consent_evidence";
CREATE POLICY tenant_isolation ON "application_consent_evidence"
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "data_subject_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_subject_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "data_subject_requests";
CREATE POLICY tenant_isolation ON "data_subject_requests"
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

-- Production's ALTER DEFAULT PRIVILEGES grants app_tenant SELECT/INSERT/UPDATE/DELETE on every new table.
-- application_consent_evidence is PROOF: like audit_logs it is insert-only for the application role, so
-- UPDATE/DELETE are revoked (also from Supabase's API roles, which never need it). data_subject_requests keeps
-- UPDATE for resolution.
DO $$
DECLARE r text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT SELECT, INSERT ON TABLE "application_consent_evidence" TO app_tenant;
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "application_consent_evidence" FROM app_tenant;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "data_subject_requests" TO app_tenant;
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON TABLE "application_consent_evidence" FROM %I', r);
      EXECUTE format('REVOKE ALL ON TABLE "data_subject_requests" FROM %I', r);
    END IF;
  END LOOP;
END
$$;

-- 5. Backfill: one evidence row per EXISTING application covered by the candidate's subject-level
--    recruitment consent, reconstructed from that row and marked is_backfilled. Its text hash, locale
--    and request metadata are unknown (NULL) — the row records only what the subject-level row proves.
--    Only applications created at or after the consent was given (an earlier application was not
--    authorized by it), never from a withdrawal-only marker or a withdrawn consent. Re-running inserts
--    nothing new.
INSERT INTO "application_consent_evidence"
    ("id", "organization_id", "application_id", "candidate_id", "consent_type", "text_version",
     "agreed_at", "is_backfilled", "created_at", "updated_at")
SELECT gen_random_uuid(), a."organization_id", a."id", a."candidate_id", dc."consent_type", dc."text_version",
       dc."agreed_at", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "applications" a
JOIN "data_consents" dc
  ON dc."subject_user_id" = a."candidate_id"
 AND dc."organization_id" = a."organization_id"
 AND dc."consent_type" = 'recruitment_data_processing'
WHERE dc."text_version" <> 'none:withdrawal-only'
  AND dc."withdrawn_at" IS NULL
  AND a."created_at" >= dc."agreed_at"
ON CONFLICT ("application_id", "consent_type") DO NOTHING;
