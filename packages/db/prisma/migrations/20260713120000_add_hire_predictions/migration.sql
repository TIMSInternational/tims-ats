-- Sprint 1.1.f: HirePrediction — immutable FIT-prediction snapshot at hire time.
-- Additive only. Includes RLS in this same migration (every org-scoped table).

CREATE TYPE "HirePredictionStatus" AS ENUM ('scored', 'partial', 'none');

CREATE TABLE "hire_predictions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "vacancy_id" UUID NOT NULL,
    "offer_id" UUID NOT NULL,
    "application_id" UUID,
    "overall_score" DOUBLE PRECISION,
    "breakdown" JSONB,
    "weights" JSONB,
    "is_partial" BOOLEAN,
    "fit_calculated_at" TIMESTAMP(3),
    "prediction_status" "HirePredictionStatus" NOT NULL,
    "hired_by_id" UUID,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hire_predictions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hire_predictions_offer_id_key" ON "hire_predictions"("offer_id");
CREATE INDEX "hire_predictions_organization_id_idx" ON "hire_predictions"("organization_id");
CREATE INDEX "hire_predictions_user_id_idx" ON "hire_predictions"("user_id");
CREATE INDEX "hire_predictions_candidate_id_idx" ON "hire_predictions"("candidate_id");
CREATE INDEX "hire_predictions_vacancy_id_idx" ON "hire_predictions"("vacancy_id");
CREATE INDEX "hire_predictions_application_id_idx" ON "hire_predictions"("application_id");
CREATE INDEX "hire_predictions_hired_by_id_idx" ON "hire_predictions"("hired_by_id");

ALTER TABLE "hire_predictions" ADD CONSTRAINT "hire_predictions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hire_predictions" ADD CONSTRAINT "hire_predictions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hire_predictions" ADD CONSTRAINT "hire_predictions_candidate_id_fkey"
    FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hire_predictions" ADD CONSTRAINT "hire_predictions_vacancy_id_fkey"
    FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hire_predictions" ADD CONSTRAINT "hire_predictions_offer_id_fkey"
    FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hire_predictions" ADD CONSTRAINT "hire_predictions_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hire_predictions" ADD CONSTRAINT "hire_predictions_hired_by_id_fkey"
    FOREIGN KEY ("hired_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS — identical ENABLE/FORCE/tenant_isolation pattern to
-- 20260710160000_enable_rls_role_family_weight_profiles and the 81-table baseline.
ALTER TABLE "hire_predictions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hire_predictions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hire_predictions";
CREATE POLICY tenant_isolation ON "hire_predictions"
    USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
