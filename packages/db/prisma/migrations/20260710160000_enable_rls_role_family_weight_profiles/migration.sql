-- Codex review Finding 1 (Sprint 1.5 FIT Engine): role_family_weight_profiles was created in
-- 20260710140000_add_fit_engine_schema without RLS. Every org-scoped tenant table must have
-- RLS enabled per .claude/rules/db.md ("RLS enabled on EVERY table") and the baseline
-- migration 20260604100000_enable_rls_tenant_isolation. This migration brings
-- role_family_weight_profiles in line with that baseline, using the exact same
-- ENABLE/FORCE/policy pattern applied there to sibling org-scoped tables (e.g. fit_scores,
-- job_profiles). Additive only — does not touch any previously-applied migration.

ALTER TABLE "role_family_weight_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_family_weight_profiles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "role_family_weight_profiles";
CREATE POLICY tenant_isolation ON "role_family_weight_profiles" USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
