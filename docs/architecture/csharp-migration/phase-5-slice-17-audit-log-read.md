# Phase 5 Slice 17 — Cross-org Audit-Log READ → C# (design)

Date: 2026-07-25 · Domain #4 in the strangler order (`phase-5-strangler.md`: "Audit/compliance — the audit
writer is already cross-cutting (Phase 2 WP2.7); consolidate it here"). `audit_logs` is already
`efcoreAppendOnly` (Slice 4b's `BillingAuditWriter`) — this slice adds the matching read. Dark-by-default,
cutover deferred, TS untouched except behavior-preserving pure-kernel extraction.

## Scope decision (read this first)

Three surfaces touch "audit" in this codebase; only two are live:

- `packages/api/src/routers/audit.ts` (org-scoped `listLogs`/`getLogDetail`/`exportLogs`[stub]/`getAccessReport`/
  `getChangesByEntity`) — registered in `root.ts`, **zero frontend consumers**. Dead code. **Out of scope** —
  not ported, not deleted, in this slice.
- `platform.getCrossOrgAuditLogs` + `platform.exportAuditLogsCsv` (`routers/platform/system.ts:257-354`) —
  backs `apps/web/app/(admin)/platform/audit/page.tsx`. **In scope.**
- `routers/platform/access-review.ts` (CB-2b — `getAccessReview`/`exportAccessReviewCsv`/`attestAccessReview`/
  `listAccessReviewAttestations`) — real, live, platform-owner. **Deferred to Slice 18.** It reuses tables
  already `efcoreReadOnly` since Phase 2 (`users`/`user_roles`/`roles`/`role_permissions`/`permissions`/
  `organizations`) and will reuse this slice's platform-owner-gate pattern, so it becomes a faster follow-up
  once this slice proves the pattern once.

## Surface

`platform.getCrossOrgAuditLogs` (cursor-paginated list, filters: userId/organizationId/action/entity/
dateFrom/dateTo) + `platform.exportAuditLogsCsv` (bounded `take: 1000`, CSV or JSON). Both `platformProcedure`
— platform-owner only, no org boundary (organizationId is an optional _narrowing_ filter, not a scope). Reads
`audit_logs` via the privileged `db` client (not `tenantDb`) — cross-org visibility is the intended behavior,
not a leak.

## Why this is a new pattern (read before porting)

Every prior Phase-5 domain (team-intel, succession, compensation, nine-box, engagement, …) is staff-JWT +
org-scoped, proven via Testcontainers RLS isolation (`assertScoped`/`scopeWhereFor`/org-gate). This surface has
**no per-tenant RLS invariant to prove** — a platform owner is supposed to see every org. The invariant here is
narrower and different: **only a resolved platform-owner principal may call this endpoint; the other 3
principal types (org-user/candidate/external-key) get 403.** Phase 2's identity plane already resolves all 4
principal types, so this is wiring a new gate on top of existing resolution, not new identity work.

- **`PlatformOwnerGate`** (new, `Tims.Api` middleware/filter) — checks the resolved `ITenantContext` principal
  type; anything but platform-owner → 403. Mirrors the semantics of `platformProcedure` in `_common.ts`.
- **`AuditReadDbContext`** (new, EF Core, `SELECT`-only, `AsNoTracking`) — maps `audit_logs` for reads,
  runs on the **privileged connection** (no `SET LOCAL ROLE`, no org GUC — the first EF context built this
  way; every prior context ran `UNDER TenantScope`). `action`/`entity` are plain Prisma strings, no
  `NpgsqlDataSource` needed.

## Pure kernel

Minimal — filter + cursor-paginate + CSV, no aggregation/scoring math. The one real parity risk is CSV output:
port the shared `csvCell`/`csvRow` escaping (`packages/shared/src/csv.ts` — extracted this slice from
`access-review.ts`, see below) to `Tims.Domain.Csv` and golden-fixture the exact byte output. That means RFC-4180
quoting and formula-injection neutralization for a leading `=`, `+`, `-`, `@`, tab, or CR, matched against real
TS output, including the `Sistema`-fallback actor-name rule and the JSON-export shape.

## Incidental fix landed alongside this slice (already committed, not gated on the slice)

While characterizing `exportAuditLogsCsv`, found it escaped only commas (`.replace(/,/g, ' ')`) — missing the
formula-injection defense `access-review.ts`'s CSV export already had (an org/actor name starting with
`=`/`+`/`-`/`@` executes as a spreadsheet formula for an auditor opening the export). Fixed by extracting
`access-review.ts`'s `csvCell` into `packages/shared/src/csv.ts` (`csvCell` + `csvRow`) and wiring both
call sites to it. `tests/security/csv-export-hardening.test.ts` (new) + the updated
`tests/security/access-review.test.ts` tripwire pin this. This is a TS-side security fix, independent of the
C# port, and does not block or gate this slice's design.

## Recipe

1. **Characterize.** Golden-fixture the TS behavior first: pagination (`take+1`/cursor), every filter
   combination, the `total` count, and CSV/JSON export output byte-for-byte (incl. the formula-injection
   cases). `contracts/audit-fixtures/*.json`.
2. **Model.** `Tims.Domain/Audit/AuditLogEntry.cs` (read model) + `Tims.Domain/Csv/CsvCell.cs` (ported escaping
   kernel, golden-fixtured against `packages/shared/src/csv.ts`).
3. **Port + parity.** `AuditReadDbContext` (privileged connection, no TenantScope) + `AuditReadRepository`
   (list with cursor + filters, count, bounded export query). `PlatformOwnerGate` wraps both endpoints.
4. **Route (dark).** `GET /audit/logs` (list) + `GET /audit/logs/export` (csv/json), gated by
   `Platform:AuditLogReadEnabled` (default `false`), mapped only when the flag is true or during OpenAPI-doc
   generation — matches every prior slice's flag convention.
5. **Verify.** Extend `scripts/parity/surfaces.ts` with an `audit-log` surface entry; `expectedByRole` proves
   platform-owner → 200, every other principal type → 403 (this replaces the RLS/RBAC-per-role matrix used by
   tenant-scoped surfaces — there is no tenant role matrix here, only the 4-principal-type gate).
6. **Flip ownership / delete TS.** Deferred — Federico-only, at canary, same as every other Phase-5 domain.
   `audit_logs` stays `efcoreAppendOnly` in the ledger until then (a read mapping doesn't change its ledger
   category — same treatment as every other `efcoreReadOnly` port of a Prisma-owned table).

## Regression corpus

- Cursor pagination edge cases (empty result, exactly `take` rows, `take+1` overflow → `nextCursor`).
- Every filter combination (userId/organizationId/action/entity/date range), including none set (full
  cross-org scan — intended, not a leak).
- CSV/JSON export: header row, `Sistema` actor fallback, the 4 formula-injection neutralization cases, embedded
  quotes/commas, the `take: 1000` bound.
- `PlatformOwnerGate`: all 4 principal types probed against both endpoints — only platform-owner passes.

## Ledger

`audit_logs` read mapping registered under the existing `efcoreAppendOnly` entry (no new category — Prisma
keeps the DDL, the table already has a documented C# writer). No new tables.
