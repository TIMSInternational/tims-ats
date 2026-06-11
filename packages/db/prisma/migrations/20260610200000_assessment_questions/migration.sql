-- Wave 1.5a slice 1 — assessment authoring + taking primitives.
-- Adds question bank (AssessmentQuestion), per-attempt responses
-- (AssessmentResponse) and data-processing consent (AssessmentConsent).
-- Tenant-scoped via organization_id; RLS enabled to match every other tenant
-- table (see 20260604100000_enable_rls_tenant_isolation). Additive + idempotent.

-- 1) Enums (idempotent guard so re-running is safe).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuestionType') THEN
    CREATE TYPE "QuestionType" AS ENUM ('single_choice', 'multi_choice', 'free_text');
  END IF;
END $$;

-- 2) Tables.
CREATE TABLE IF NOT EXISTS "assessment_questions" (
  "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"    UUID NOT NULL,
  "assessment_type_id" UUID NOT NULL,
  "order"              INTEGER NOT NULL,
  "type"               "QuestionType" NOT NULL,
  "prompt"             TEXT NOT NULL,
  "options"            JSONB NOT NULL DEFAULT '[]',
  "correct_option_ids" JSONB NOT NULL DEFAULT '[]',
  "points"             INTEGER NOT NULL DEFAULT 1,
  "is_active"          BOOLEAN NOT NULL DEFAULT true,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "assessment_questions_organization_id_idx" ON "assessment_questions" ("organization_id");
CREATE INDEX IF NOT EXISTS "assessment_questions_assessment_type_id_idx" ON "assessment_questions" ("assessment_type_id");

CREATE TABLE IF NOT EXISTS "assessment_responses" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id"     UUID NOT NULL,
  "assignment_id"       UUID NOT NULL,
  "question_id"         UUID NOT NULL,
  "selected_option_ids" JSONB,
  "free_text"           TEXT,
  "is_correct"          BOOLEAN,
  "points_awarded"      DOUBLE PRECISION,
  "submitted_at"        TIMESTAMP(3),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assessment_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "assessment_responses_assignment_id_question_id_key" ON "assessment_responses" ("assignment_id", "question_id");
CREATE INDEX IF NOT EXISTS "assessment_responses_organization_id_idx" ON "assessment_responses" ("organization_id");
CREATE INDEX IF NOT EXISTS "assessment_responses_assignment_id_idx" ON "assessment_responses" ("assignment_id");
CREATE INDEX IF NOT EXISTS "assessment_responses_question_id_idx" ON "assessment_responses" ("question_id");

CREATE TABLE IF NOT EXISTS "assessment_consents" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "assignment_id"   UUID NOT NULL,
  "candidate_id"    UUID NOT NULL,
  "consent_type"    TEXT NOT NULL,
  "text_version"    TEXT NOT NULL,
  "agreed_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_address"      TEXT,
  "user_agent"      TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assessment_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "assessment_consents_assignment_id_key" ON "assessment_consents" ("assignment_id");
CREATE INDEX IF NOT EXISTS "assessment_consents_organization_id_idx" ON "assessment_consents" ("organization_id");
CREATE INDEX IF NOT EXISTS "assessment_consents_candidate_id_idx" ON "assessment_consents" ("candidate_id");

-- 3) Foreign keys (idempotent checks; all cascade with their parent).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_questions_assessment_type_id_fkey') THEN
    ALTER TABLE "assessment_questions"
      ADD CONSTRAINT "assessment_questions_assessment_type_id_fkey"
      FOREIGN KEY ("assessment_type_id") REFERENCES "assessment_types" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_responses_assignment_id_fkey') THEN
    ALTER TABLE "assessment_responses"
      ADD CONSTRAINT "assessment_responses_assignment_id_fkey"
      FOREIGN KEY ("assignment_id") REFERENCES "assessment_assignments" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- RESTRICT (not CASCADE): once a question has submitted responses it can only
  -- be deactivated, never hard-deleted — the DB protects answer history even if
  -- an app-level guard regresses. (Slice 2 will additionally enforce that a
  -- response's question belongs to its assignment's assessment type in-tx.)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_responses_question_id_fkey') THEN
    ALTER TABLE "assessment_responses"
      ADD CONSTRAINT "assessment_responses_question_id_fkey"
      FOREIGN KEY ("question_id") REFERENCES "assessment_questions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_consents_assignment_id_fkey') THEN
    ALTER TABLE "assessment_consents"
      ADD CONSTRAINT "assessment_consents_assignment_id_fkey"
      FOREIGN KEY ("assignment_id") REFERENCES "assessment_assignments" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 4) Grants for the RLS tenant role (harmless if already covered by defaults).
GRANT SELECT, INSERT, UPDATE, DELETE ON "assessment_questions" TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "assessment_responses" TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "assessment_consents" TO app_tenant;

-- 5) RLS — fail-closed tenant isolation, identical policy shape to every other
--    tenant table. Unset GUC → NULL → no rows visible.
ALTER TABLE "assessment_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_questions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assessment_questions";
CREATE POLICY tenant_isolation ON "assessment_questions"
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "assessment_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_responses" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assessment_responses";
CREATE POLICY tenant_isolation ON "assessment_responses"
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "assessment_consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_consents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "assessment_consents";
CREATE POLICY tenant_isolation ON "assessment_consents"
  USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
