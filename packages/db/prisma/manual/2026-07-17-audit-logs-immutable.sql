-- CB-1b compliance control (SOC 2 CC7.2 / ISO 27001 A.8.15 / SOC 1 audit trail): make the append-only
-- `audit_logs` admin/security-event trail TAMPER-EVIDENT at the database engine level — the TWIN of the
-- CB-1 `data_access_logs` control. All 20 admin/security writers use db.auditLog.create (INSERT-only); no
-- code updates/deletes audit_logs. This installs the same BEFORE UPDATE/DELETE (row) + BEFORE TRUNCATE
-- (statement) guard, ENABLE ALWAYS (fires even under session_replication_role='replica'), plus REVOKEs.
--
-- ⚠️ FK-CASCADE CONSTRAINT (audit_logs differs from data_access_logs — the latter is FK-less by design):
--   audit_logs.organization_id -> organizations(id) ON DELETE CASCADE, and user_id/actor_id -> users(id)
--   (optional → SET NULL). Once this trigger is installed, a HARD DELETE of an organization (cascade) or a
--   user (SET NULL = an UPDATE) whose audit rows exist will be BLOCKED by the guard (fail-LOUD, SQLSTATE
--   42501). Verified safe TODAY: the app NEVER hard-deletes organizations or users (soft-delete / suspend
--   only) and has no GDPR erasure path. A FUTURE org/user hard-delete or erasure MUST go through a controlled
--   privileged-exception (CB-6), OR audit_logs should first be made FK-less like data_access_logs (recommended
--   follow-up — has audit-read-UI query implications, evaluate separately).
--
-- The NON-COMMENT lines below are byte-identical to AuditImmutability.BuildAppendOnlySql("audit_logs"),
-- pinned by ProdSqlMatchesBuilderTests. Proven by Tims.IntegrationTests.AuditLogsImmutabilityTests.
--
-- APPLY (Federico, prod — direct 5432, failure-atomic):
--   psql -v ON_ERROR_STOP=1 --single-transaction "<DIRECT_PROD_URL>" \
--     -f packages/db/prisma/manual/2026-07-17-audit-logs-immutable.sql
-- VERIFY: UPDATE/DELETE/TRUNCATE audit_logs should raise "audit_logs is append-only: ...".
-- NOTE: re-run after any Prisma migration that RECREATES audit_logs.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM app_tenant;
CREATE OR REPLACE FUNCTION tims_append_only_guard() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "audit_logs_append_only" ON "audit_logs";
CREATE TRIGGER "audit_logs_append_only"
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION tims_append_only_guard();
ALTER TABLE "audit_logs" ENABLE ALWAYS TRIGGER "audit_logs_append_only";
DROP TRIGGER IF EXISTS "audit_logs_append_only_truncate" ON "audit_logs";
CREATE TRIGGER "audit_logs_append_only_truncate"
    BEFORE TRUNCATE ON "audit_logs"
    FOR EACH STATEMENT EXECUTE FUNCTION tims_append_only_guard();
ALTER TABLE "audit_logs" ENABLE ALWAYS TRIGGER "audit_logs_append_only_truncate";
