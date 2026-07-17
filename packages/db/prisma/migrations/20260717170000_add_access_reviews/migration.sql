-- CB-2b: access recertification evidence (SOC 2 CC6.2–6.3 / ISO A.5.18).
-- Additive only. Org-scoped table with RLS, mirroring 20260713150000_add_evaluation360.

CREATE TABLE "access_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_count" INTEGER NOT NULL,
    "privileged_count" INTEGER NOT NULL,
    "stale_count" INTEGER NOT NULL,
    "deprovision_gap_count" INTEGER NOT NULL,
    "expired_gap_count" INTEGER NOT NULL,
    "notes" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "access_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "access_reviews_organization_id_idx" ON "access_reviews"("organization_id");
CREATE INDEX "access_reviews_organization_id_reviewed_at_idx" ON "access_reviews"("organization_id", "reviewed_at");
CREATE INDEX "access_reviews_reviewer_id_idx" ON "access_reviews"("reviewer_id");

ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_reviewer_id_fkey"
    FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS — identical ENABLE/FORCE/tenant_isolation pattern to the org-scoped baseline.
-- Reads/writes go through the platform privileged connection, but the policy is kept
-- as defense-in-depth (and so a future tenantDb read is scoped, not open).
ALTER TABLE "access_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "access_reviews" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "access_reviews";
CREATE POLICY tenant_isolation ON "access_reviews"
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "access_reviews" TO app_tenant;
