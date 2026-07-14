-- Sprint 1.7 Slice 1: 360 Evaluation greenfield foundation.
-- Additive only. Includes RLS in this same migration (every org-scoped table).

CREATE TYPE "ReviewCycleStatus" AS ENUM ('draft', 'open', 'closed', 'published');
CREATE TYPE "RaterRelationship" AS ENUM ('self', 'manager', 'peer', 'direct_report');
CREATE TYPE "RaterAssignmentStatus" AS ENUM ('pending', 'submitted');

CREATE TABLE "review_cycles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ReviewCycleStatus" NOT NULL DEFAULT 'draft',
    "opens_at" TIMESTAMP(3),
    "closes_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "review_cycles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rater_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "subject_user_id" UUID NOT NULL,
    "rater_user_id" UUID NOT NULL,
    "relationship" "RaterRelationship" NOT NULL,
    "status" "RaterAssignmentStatus" NOT NULL DEFAULT 'pending',
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rater_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rater_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "competency_key" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(5000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rater_responses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_cycles_organization_id_idx" ON "review_cycles"("organization_id");

CREATE UNIQUE INDEX "rater_assignments_cycle_id_subject_user_id_rater_user_id_key" ON "rater_assignments"("cycle_id", "subject_user_id", "rater_user_id");
CREATE INDEX "rater_assignments_organization_id_idx" ON "rater_assignments"("organization_id");
CREATE INDEX "rater_assignments_cycle_id_idx" ON "rater_assignments"("cycle_id");
CREATE INDEX "rater_assignments_rater_user_id_idx" ON "rater_assignments"("rater_user_id");
CREATE INDEX "rater_assignments_subject_user_id_idx" ON "rater_assignments"("subject_user_id");

CREATE UNIQUE INDEX "rater_responses_assignment_id_competency_key_key" ON "rater_responses"("assignment_id", "competency_key");
CREATE INDEX "rater_responses_organization_id_idx" ON "rater_responses"("organization_id");
CREATE INDEX "rater_responses_assignment_id_idx" ON "rater_responses"("assignment_id");

ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rater_assignments" ADD CONSTRAINT "rater_assignments_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rater_assignments" ADD CONSTRAINT "rater_assignments_cycle_id_fkey"
    FOREIGN KEY ("cycle_id") REFERENCES "review_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rater_assignments" ADD CONSTRAINT "rater_assignments_subject_user_id_fkey"
    FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rater_assignments" ADD CONSTRAINT "rater_assignments_rater_user_id_fkey"
    FOREIGN KEY ("rater_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rater_responses" ADD CONSTRAINT "rater_responses_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rater_responses" ADD CONSTRAINT "rater_responses_assignment_id_fkey"
    FOREIGN KEY ("assignment_id") REFERENCES "rater_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS — identical ENABLE/FORCE/tenant_isolation pattern to
-- 20260713120000_add_hire_predictions and the 81-table baseline.
ALTER TABLE "review_cycles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "review_cycles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "review_cycles";
CREATE POLICY tenant_isolation ON "review_cycles"
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "rater_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rater_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "rater_assignments";
CREATE POLICY tenant_isolation ON "rater_assignments"
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

ALTER TABLE "rater_responses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rater_responses" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "rater_responses";
CREATE POLICY tenant_isolation ON "rater_responses"
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
