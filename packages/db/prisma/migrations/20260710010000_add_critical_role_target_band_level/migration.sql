-- Sprint 1.4 Task 4: target salary band level for a Critical Role, used by the
-- Compensation <-> Succession comp-gap check (succession.getCompGapAlerts /
-- succession.updateCriticalRoleBand). Soft string match to salary_bands.level
-- (no FK — bands are looked up by (organization_id, level) at query time).
-- Additive nullable column, no backfill/data-migration needed.
ALTER TABLE "critical_roles" ADD COLUMN IF NOT EXISTS "target_band_level" TEXT;
