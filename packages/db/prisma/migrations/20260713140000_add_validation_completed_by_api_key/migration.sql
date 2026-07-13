-- Sprint 1.6: vendor provenance on preemployment validations. Additive only.
-- No RLS block: preemployment_validations already has tenant_isolation from the
-- baseline (20260604100000); RLS is row-level and covers the new column.
ALTER TABLE "preemployment_validations" ADD COLUMN "completed_by_api_key_id" UUID;
CREATE INDEX "preemployment_validations_completed_by_api_key_id_idx"
    ON "preemployment_validations"("completed_by_api_key_id");
ALTER TABLE "preemployment_validations" ADD CONSTRAINT "preemployment_validations_completed_by_api_key_id_fkey"
    FOREIGN KEY ("completed_by_api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Provenance is mutually exclusive: a validation is completed by staff (completed_by_id)
-- XOR by an API-key vendor (completed_by_api_key_id), never both. Enforced at the DB
-- level so no code path can violate it. Safe on existing rows: completed_by_api_key_id
-- is a brand-new column (all NULL), so every existing row already satisfies this check.
ALTER TABLE "preemployment_validations" ADD CONSTRAINT "preemployment_validations_single_completer_chk"
    CHECK ("completed_by_id" IS NULL OR "completed_by_api_key_id" IS NULL);
