-- #181 — index audit_logs.action.
--
-- WHY. #177 made the platform service write an `authz_denied` row on every staff 401/403, and #180
-- extended that to the API-key surface. Both are queried BY ACTION (an access-review / attestation
-- read, and every incident triage of "who was denied what"). `audit_logs` had indexes on
-- organization_id, (organization_id, entity), (organization_id, user_id), actor_id and created_at —
-- nothing on `action`. So the one query those rows exist to serve was a sequential scan over an
-- append-only table that can never be pruned (the ENABLE ALWAYS trigger blocks DELETE/UPDATE/TRUNCATE
-- and retention automation is still open). That gets worse monotonically, forever.
--
-- SHAPE. (organization_id, action) mirrors the existing (organization_id, entity) index: every
-- tenant-facing read of this table is org-scoped first, so a bare `action` index would be the wrong
-- leading column for them. `created_at` is deliberately NOT a third column here — the existing
-- created_at index already serves time-ordering, and a three-column index would be the widest write
-- amplification on a table that is now written on EVERY denial.
--
-- SAFETY. CREATE INDEX CONCURRENTLY so the write path is never blocked: this table takes an INSERT on
-- every 401/403 across the whole service, and a plain CREATE INDEX would hold a lock against all of
-- them for the duration of the build. CONCURRENTLY cannot run inside a transaction block, so this file
-- must be applied on its own (psql runs each statement autocommit by default — do NOT wrap it in BEGIN).
-- IF NOT EXISTS makes it re-runnable.
--
-- If this is interrupted, Postgres can leave an INVALID index behind. Check and drop before retrying:
--   SELECT i.indisvalid FROM pg_index i
--     JOIN pg_class c ON c.oid = i.indexrelid
--    WHERE c.relname = 'audit_logs_organization_id_action_idx';
--   -- if false:  DROP INDEX CONCURRENTLY audit_logs_organization_id_action_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_organization_id_action_idx"
  ON "audit_logs" ("organization_id", "action");
