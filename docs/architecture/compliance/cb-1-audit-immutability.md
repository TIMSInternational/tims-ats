# CB-1 — Audit-log immutability (tamper-evident audit trail)

Date: 2026-07-17 · Parent: `00-compliance-by-design-roadmap.md`. Branch: `feat/compliance-cb1-audit-immutability`.
Control: **SOC 2 CC7.2 · ISO 27001 A.8.15 · SOC 1 audit trail.** First compliance-by-design slice.

## Problem
`data_access_logs` is our append-only audit trail (the C# `DataAccessAuditWriter`, efcoreAppendOnly). Today
append-only is enforced only by GRANT (`SELECT, INSERT` to `app_tenant`, no UPDATE/DELETE). A GRANT is NOT
tamper-evidence: any role that DOES hold UPDATE/DELETE — the table owner, a future mis-grant, a
superuser-via-role — can silently rewrite or wipe audit history. SOC 2 / ISO / SOC 1 all want the audit trail
provably immutable.

## Control
Engine-level append-only that survives privilege changes (`AuditImmutability.BuildAppendOnlySql`,
`Tims.Domain/Audit`), reusable for every append-only table:
1. `REVOKE UPDATE, DELETE, TRUNCATE ON data_access_logs FROM PUBLIC` (belt-and-suspenders on the GRANT layer).
2. A shared `tims_append_only_guard()` function that `RAISE`s (SQLSTATE 42501), attached as:
   - `BEFORE UPDATE OR DELETE` (row-level) — blocks row tampering/deletion;
   - `BEFORE TRUNCATE` (statement-level) — blocks the "wipe the logs" path.
   BEFORE triggers fire for EVERY role including the table owner and superusers (unless
   `session_replication_role='replica'`), so no in-band actor can mutate the trail.

Append (INSERT) is unaffected — the table stays append-only, not read-only.

**Pre-prod finding (over-grant):** migration `20260612000000_access_control_models` granted `app_tenant`
`SELECT, INSERT, UPDATE, DELETE` on `data_access_logs` — but the only writer is `db.dataAccessLog.create`
(`packages/api/src/access/audit.ts`, INSERT-only). So prod currently lets the tenant role DELETE audit rows.
CB-1 additionally `REVOKE UPDATE, DELETE ON data_access_logs FROM app_tenant` (least-privilege, SOC 2 CC6.3 /
ISO A.8.2) so grants match intent; the trigger is the hard control that blocks it regardless of grants.
Verified INSERT-only across the codebase (no `dataAccessLog.update/delete/deleteMany`, no raw DELETE/TRUNCATE).

## Where
- `services/Tims.Platform/src/Tims.Domain/Audit/AuditImmutability.cs` — pure SQL builder (DB-free, unit-tested).
- Prisma owns the `data_access_logs` DDL → prod is a hand-applied migration
  `packages/db/prisma/manual/2026-07-17-data-access-logs-immutable.sql` (**Federico runs prod DDL**, direct 5432).
- Testcontainers: `AuditWriterFixture` now applies the hardening (writer tests run against the prod-shaped
  table); `Tims.IntegrationTests/AuditImmutabilityTests` proves it BITES on the raw `postgres` (owner)
  connection — append works, UPDATE/DELETE/TRUNCATE all raise, the row survives, a fresh append still succeeds.
- `Tims.UnitTests/Audit/AuditImmutabilityTests` pins the emitted SQL clauses.

## Evidence (SOC 2 / ISO operating-effectiveness)
The Testcontainers proof (UPDATE/DELETE/TRUNCATE blocked even for the owner) + the prod-apply verification step
are the design + operating evidence. The prod script's header documents the apply + verify commands.

## Retention & erasure interoperability (review M2 — CB-6 dependency)
`data_access_logs` carries PII (`actor_id`, `ip_address`, `user_agent`) with a documented **7-yr retention**
and a *planned* (not-built) purge job, and CB-6 owns GDPR / Colombian Habeas Data / CCPA **erasure**. This
control now BLOCKS those future deletions at the engine level — by design. When CB-6 builds retention/erasure
it MUST use a deliberate, audited, privileged exception, NOT a plain DELETE:
- **age-scoped purge** via a `SECURITY DEFINER` function that temporarily bypasses the guard (owned + logged),
  or a break-glass `SET session_replication_role = 'replica'` inside a single audited maintenance transaction;
- **crypto-shredding** the PII columns (erase the key, keep the immutable row) to satisfy erasure without DELETE;
- every such run is itself audited. Until CB-6, the table is fully immutable (7-yr retention is far off).

## Tamper-EVIDENT, not tamper-PROOF (reviews L1/Med3 — CB-3 dependency)
The `session_replication_role='replica'` trigger-bypass is CLOSED — the triggers are `ENABLE ALWAYS`, so they
fire even in replica mode (bite-proven in `AuditImmutabilityTests`). The remaining residual is out-of-band DDL:
a superuser/owner can still `DROP TRIGGER` / `DROP TABLE` — a trigger cannot protect its own existence. On
Supabase the migration-running role is highly privileged. Compensating controls: **restrict prod owner/superuser
access** (few humans, MFA, logged — CB-2/CB-4) and ship **append-only log EXPORT to WORM/off-box storage**
(CloudTrail + central log store, CB-3) so any in-DB tampering is still caught out-of-band. Document this
residual for the auditor.

## Operational note (review L3)
The triggers/revokes live OUTSIDE Prisma's managed schema, so a future Prisma migration that RECREATES
(drops+creates) `data_access_logs` would silently drop them. Ordinary ALTERs are unaffected. **Runbook: re-run
the manual SQL after any migration that recreates the table** (the script is idempotent).

## Deferred → CB-1b (security-event coverage)
Extend the append-only writer beyond data-access to authN success/**failure**, authZ denials, admin/privileged
actions, data exports, **feature-flag flips**, and role/permission changes — so the immutable trail covers the
full SOC 2 CC7.2 / ISO A.8.16 monitorable event set. Larger (many call sites) → its own slice.

## Gate
build 0-warn · `dotnet format` · unit + integration (Docker) · table-ownership. No TS product touched (the SQL
script is a prod migration artifact, not app code).
