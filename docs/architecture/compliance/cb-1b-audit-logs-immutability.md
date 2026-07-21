# CB-1b — `audit_logs` immutability (the second audit trail)

Date: 2026-07-17 · Parent: `00-compliance-by-design-roadmap.md`. Branch: `feat/compliance-cb1b-audit-logs-immutable`.
Control: **SOC 2 CC7.2 · ISO 27001 A.8.15 · SOC 1 audit trail.** The twin of CB-1.

## Why
The TIMS audit trail is TWO tables (mapped in the CB-1b audit-surface study):
- `data_access_logs` — sensitive-data READS (hardened by CB-1).
- `audit_logs` — the **admin/security-event** trail: all 20 `db.auditLog.create` sites (impersonation start/stop,
  user deactivate/activate/pw-reset/session-revoke, **role changes**, org create/update/suspend, entitlements,
  **feature-flag flips**, billing/dunning, AI-agent admin, GDPR export).

CB-1 hardened only the first. `audit_logs` was **fully mutable** at the engine level (no trigger, no REVOKE) —
the most security-relevant events could be silently rewritten or wiped. CB-1b closes that with the SAME
reusable control (`AuditImmutability.BuildAppendOnlySql("audit_logs")`).

## Control
Identical to CB-1: `REVOKE UPDATE/DELETE/TRUNCATE` (PUBLIC + app_tenant), shared `tims_append_only_guard()`
(TG_TABLE_NAME), `BEFORE UPDATE/DELETE` (row) + `BEFORE TRUNCATE` (statement) triggers, both `ENABLE ALWAYS`
(replica-mode bypass closed). Prod DDL (Prisma-owns the table) = **Federico-run**:
`packages/db/prisma/manual/2026-07-17-audit-logs-immutable.sql` (byte-pinned to the builder by
`ProdSqlMatchesBuilderTests`). Proven by `Tims.IntegrationTests/AuditLogsImmutabilityTests` on the raw owner
connection — append works; UPDATE/DELETE/TRUNCATE/replica-DELETE all raise; and the shared guard reports
`audit_logs` (not `data_access_logs`), validating the CB-1-review reusability fix on a real second table.

## ⚠️ FK-cascade constraint (audit_logs differs from data_access_logs)
`data_access_logs` is FK-less by design (soft refs — survives deletion). `audit_logs` has REAL FKs:
`organization_id -> organizations ON DELETE CASCADE`, `user_id`/`actor_id -> users` (optional → SET NULL). Once
immutable, a **hard delete of an organization** (cascade → DELETE audit rows) or a **user** (SET NULL = UPDATE)
is BLOCKED by the guard (fail-LOUD, SQLSTATE 42501) — BOTH FK vectors pinned as behavior by
`Org_hard_delete_is_blocked_by_the_audit_cascade_guard` (cascade DELETE) +
`User_hard_delete_is_blocked_by_the_audit_setnull_guard` (SET NULL UPDATE; closes review Med).
- **Verified safe TODAY:** the app NEVER hard-deletes organizations or users (soft-delete / suspend only), and
  has no GDPR erasure path (data-requests is export-only). Comprehensive grep across packages/apps/workers/scripts.
- **Future:** any org/user hard-delete or erasure MUST use a controlled privileged-exception (CB-6).
- **Recommended follow-up (Federico decision):** make `audit_logs` FK-less like `data_access_logs` (the correct
  audit design — rows survive deletion). NOT done here because dropping the relations affects the audit-read
  UI queries (which may `include` user/org) — evaluate + migrate separately.

## Gate
build 0-warn · `dotnet format` · unit (drift-pin ×2) + integration (Docker: append-only ×2 tables + cascade).
No TS product touched. Prod apply + verify commands in the SQL header.

## Deferred → CB-1c (security-event COVERAGE)
The audit-surface study found UNLOGGED events (immutable but incomplete): **authN failures** (no `login_failed`
written despite the health dashboard querying for it), **authZ denials** (every FORBIDDEN/UNAUTHORIZED throw in
`trpc.ts` is silent), `rolePermission` grant-matrix edits, feature-flag bulk ops, and **platform-owner cross-org
reads/exports** (BYPASSRLS path writes no trail). Also: the `withAudit` middleware is wired but DEAD (never
applied). CB-1c adds this coverage in the LIVE app (where Type-II evidence accrues) — its own slice + gate.
