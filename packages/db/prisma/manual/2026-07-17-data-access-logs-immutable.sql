-- CB-1 compliance control (SOC 2 CC7.2 / ISO 27001 A.8.15 / SOC 1 audit trail): make the append-only
-- `data_access_logs` audit table TAMPER-EVIDENT at the database engine level. The app writer + GRANT
-- express append-only for app_tenant, but a GRANT is defeated by any role holding UPDATE/DELETE (the table
-- owner, a mis-grant, a superuser-via-role). This adds a BEFORE UPDATE/DELETE (row-level) + BEFORE TRUNCATE
-- (statement-level) trigger, ENABLE ALWAYS so it fires even under session_replication_role='replica', that
-- RAISEs for EVERY role, plus REVOKEs. Migration 20260612000000 over-granted app_tenant
-- SELECT,INSERT,UPDATE,DELETE though the only writer is db.dataAccessLog.create (INSERT-only,
-- packages/api/src/access/audit.ts), so we also revoke the tenant role's UPDATE/DELETE/TRUNCATE (least-priv).
--
-- The NON-COMMENT lines below are byte-identical to Tims.Domain.Audit.AuditImmutability.BuildAppendOnlySql
-- ("data_access_logs") and pinned by ProdSqlMatchesBuilderTests (drift = red build). Proven by
-- Tims.IntegrationTests.AuditImmutabilityTests. Idempotent (CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
--
-- APPLY (Federico, prod — direct 5432, NOT the pooler; --single-transaction makes the whole apply
--   failure-atomic so an interrupted run can't leave the table between DROP and CREATE TRIGGER):
--   psql -v ON_ERROR_STOP=1 --single-transaction "<DIRECT_PROD_URL>" \
--     -f packages/db/prisma/manual/2026-07-17-data-access-logs-immutable.sql
-- VERIFY: UPDATE/DELETE/TRUNCATE data_access_logs should raise "data_access_logs is append-only: ...".
-- NOTE: re-run this script after any Prisma migration that RECREATES (drops+creates) data_access_logs.
REVOKE UPDATE, DELETE, TRUNCATE ON "data_access_logs" FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON "data_access_logs" FROM app_tenant;
CREATE OR REPLACE FUNCTION tims_append_only_guard() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "data_access_logs_append_only" ON "data_access_logs";
CREATE TRIGGER "data_access_logs_append_only"
    BEFORE UPDATE OR DELETE ON "data_access_logs"
    FOR EACH ROW EXECUTE FUNCTION tims_append_only_guard();
ALTER TABLE "data_access_logs" ENABLE ALWAYS TRIGGER "data_access_logs_append_only";
DROP TRIGGER IF EXISTS "data_access_logs_append_only_truncate" ON "data_access_logs";
CREATE TRIGGER "data_access_logs_append_only_truncate"
    BEFORE TRUNCATE ON "data_access_logs"
    FOR EACH STATEMENT EXECUTE FUNCTION tims_append_only_guard();
ALTER TABLE "data_access_logs" ENABLE ALWAYS TRIGGER "data_access_logs_append_only_truncate";
