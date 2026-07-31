# Phase 5 Slice 18 — Access Review (CB-2b) → C# (design)

> **HISTORICAL — informational only.** This is the original design doc (2026-07-26), written
> when the surface was dark and untouched. As of 2026-07-31 the picture has changed: both flags
> are confirmed live in prod, a real FE consumer was built (`apps/web/app/(admin)/platform/access-review/{page,attest-modal}.tsx` — the "no frontend consumer exists today" line below is stale), and the TS side of the WRITE (`attestAccessReview`/`attest()`/`insertAttestation`/
> `orgExists`) has been deleted outright — C# is now the sole writer of `access_reviews`. The TS
> READ procedures (getAccessReview/exportAccessReviewCsv/listAccessReviewAttestations) are
> unaffected — their deletion is a separate, not-yet-done task. See
> `docs/architecture/table-ownership.md`'s `access_reviews` entry and `docs/REMAINING-WORK.md`
> for current status; the design/recipe content below is kept for historical context, not as a
> live description of the surface.

Date: 2026-07-26 · Domain #5 in the strangler order. Deferred from Slice 17
(`phase-5-slice-17-audit-log-read.md:17-21`), which named this exact surface and predicted it would
be a faster follow-up: it reuses tables already `efcoreReadOnly` since Phase 2, and reuses Slice 17's
`PlatformOwnerGate` pattern verbatim. Dark-by-default, cutover deferred, TS untouched.

## Scope decision (read this first)

Four procedures in `packages/api/src/routers/platform/access-review.ts`, all `platformProcedure`
(platform-owner only, no org RBAC), all `organizationId`-required (no unauditable whole-platform bulk
read — the TS schema deliberately forbids `.optional()` here and pins it with a static test):

- `getAccessReview` — the report: one org's users × roles × grants × last-login × risk flags.
- `exportAccessReviewCsv` — the same report as a 13-column CSV (one line per user×role pair).
- `attestAccessReview` — a WRITE: recomputes the report, refuses if the org is over-cap, persists a
  recertification snapshot to `access_reviews` (a brand-new table, never touched by C# before this
  slice).
- `listAccessReviewAttestations` — attestation history for one org.

**No frontend consumer exists today** (confirmed by exhaustive grep of `apps/web` + the CB-2b design
doc's own "Out of scope" note: a platform UI page is an acknowledged future follow-up). Unlike Slice
17, this slice has **zero FE-parity concern** — it's a pure backend port.

**In scope, beyond the 4 endpoints** (both confirmed with the user before writing this doc):

- **Audit-write parity.** All 4 procedures fire a TS-side `logSecurityEvent`/`logPlatformExport` write
  into `audit_logs` (`access_review_viewed`, `platform_export`, `access_recertified`). Slice 17 never
  touched `audit_logs` writes. This slice adds a new, generic, standalone `SecurityEventWriter` — not
  a modification of the existing billing-specific `BillingAuditWriter` (different write pattern, see
  "Why this needs a new writer, not `BillingAuditWriter`" below).
- **Parity-harness registration.** `scripts/parity/surfaces.ts` gets a new entry proving the auth
  matrix for this surface. Slice 17's own harness entry shipped with a real bug (its seed never
  produced a working platform-owner identity) — this slice reuses that now-fixed seed path.

## Surface

Four `platformProcedure` endpoints, org-scoped by an explicit `organizationId` filter (not RLS — see
below), reading via the privileged `db` client. `attestAccessReview` additionally writes one row to
`access_reviews` and (new, in scope) one row to `audit_logs` via `SecurityEventWriter`.

## Why this is a new pattern (read before porting)

Slice 17 proved "platform-owner-only, no per-tenant RLS, cross-org visibility" for a **pure read**
surface. This slice reuses that exact authorization primitive (`PlatformOwnerGate`, reused verbatim,
zero changes) but adds two things Slice 17 never needed:

1. **A privileged WRITE.** `attest`'s insert into `access_reviews` runs on the same privileged,
   unscoped connection as the reads — a platform owner isn't a tenant member, so there's no
   `SET LOCAL ROLE app_tenant` + org GUC to wrap it in. This is a _different_ write pattern than
   `BillingAuditWriter`'s (which deliberately runs under `TenantScope` because billing writes ARE
   tenant-attributed, in a normal request flow, by a tenant user). `access_reviews` itself does carry
   an RLS policy in Postgres (`tenant_isolation`, `organization_id = current_setting(...)`), but the
   TS write bypasses it entirely via the privileged `db` client — it's defense-in-depth for a
   non-privileged path that doesn't exist yet, not something this write actually satisfies. The C#
   write must match that: privileged, `organizationId` set explicitly on the row, no GUC.
2. **An org-scoped (not cross-org) read.** Unlike audit-log's cross-org list, every access-review call
   targets exactly one org via a required `organizationId` parameter. The privileged connection still
   applies (no RLS involvement — a platform owner isn't `SET LOCAL ROLE`'d into any org), but the
   filter is an explicit `WHERE organization_id = @orgId`, matching the real TS repository's
   `db.user.findMany({ where: { organizationId }, ... })`. This is _data-correctness_ to prove ("did
   the filter actually filter"), not an RLS-isolation proof — an important distinction for the test
   plan below.

## Why this needs a new writer, not `BillingAuditWriter`

`BillingAuditWriter` (`services/Tims.Platform/src/Tims.Infrastructure/Audit/BillingAuditWriter.cs`) is
entity-hardcoded (`entity = "billing"`) and wraps every write in `TenantScope.BeginAsync` — correct for
its own domain (a tenant-attributed billing action), wrong for this one (a privileged, cross-org
security event with no tenant context to scope into). Rather than overload one class with a
scoped/unscoped branch, this slice adds a sibling: `SecurityEventWriter` — same fail-soft insert-only
discipline, same `AuditLogDbContext`/`AuditLogEntity` (reused, not duplicated — mirrors how Slice 17's
`AuditReadDbContext` reused `AuditLogEntity` from `AuditLogDbContext` rather than redeclaring it), but
**no `TenantScope`**, `entity`/`action` supplied by the caller, `organizationId` set explicitly. This is
also the generic form the TS side already has (`logSecurityEvent` is a general utility, not
access-review-specific) — future privileged-write slices can reuse it as-is.

## Components

- **`AccessReviewDbContext`** (`Tims.Infrastructure/AccessReview/`, new) — one context, privileged, no
  `TenantScope` (see "DbContext shape" below for why this is one context, not split read/write). Local
  read-entities: `User` (`firstName`/`lastName`/`email`/`organizationId`/`isActive`/`deletedAt`/
  `lastLoginAt`/`isPlatformOwner`), `Role` (`slug`/`name`/`isActive`/`organizationId`), `UserRole`
  (`assignedAt`/`assignedBy`/`companyScope`/`unitScope`/`expiresAt`), `RolePermission`
  (`scope`+joined `Permission.module`/`action`), `Organization` (`name`). Plus a trackable
  `DbSet<AccessReviewEntity>` (full CRUD) for `access_reviews` — list + insert.
- **`AccessReviewRepository`** — `FetchUsersForReviewAsync(orgId, cap)` (bounded `cap+1`, newest-first,
  matching TS's honest-truncation pattern), `InsertAttestationAsync(...)`, `ListAttestationsAsync(orgId,
limit)`, `OrgExistsAsync(orgId)`. Direct port of `access-review.repository.ts`'s four methods and
  exact select shapes (see "Data model" below).
- **`AccessRiskKernel`** (`Tims.Domain/AccessReview/`, pure) — port of `access-review-kernel.ts`:
  `AccessStatusOf`, `AssessUserAccess`, the 6-flag `AccessRiskFlags` record, `STALE_LOGIN_DAYS = 90`
  constant. Needs `IsMfaPrivileged(roles, isPlatformOwner)` ported too (`packages/shared/src/mfa.ts:34-37`
  — `isPlatformOwner || roles.any(slug => slug is "super_admin" or "platform_owner")`); only this one
  function is needed from the MFA module, not the session/AAL logic.
- **`AccessReviewService`** (`Tims.Application/AccessReview/`) — orchestration: `BuildReportAsync`
  (fetch → kernel → shape rows → summarize), `AttestAsync` (org-exists → rebuild report → refuse if
  truncated → insert → fire `SecurityEventWriter`), `ListAttestationsAsync`. `ORG_CAP = 10000` constant.
- **`AccessReviewEndpoints`** (`Tims.Api/AccessReview/`) — 4 minimal-API routes, all behind
  `PlatformOwnerGate.AuthorizeAsync` (reused verbatim). CSV export reuses `Tims.Domain.Csv.CsvCell.Row`
  verbatim (already proven byte-compatible in Slice 17).
- **`SecurityEventWriter`** (`Tims.Infrastructure/Audit/`, new, standalone) — see above.

### DbContext shape: one `AccessReviewDbContext`, not split read/write

Considered and rejected:

- **Split `AccessReviewReadDbContext` + `AccessReviewWriteDbContext`.** Stricter CQRS-style separation,
  but there's no scoping boundary between the two paths to justify it (both are privileged/unscoped) —
  unlike Slice 17, where read vs. write difference would have been an actual authorization difference.
  Just ceremony for a write surface that's one `INSERT` statement.
- **Extend `IdentityDbContext`.** It already maps `Users`/`Roles`/`UserRoles`/`Permissions`/
  `RolePermissions`, but deliberately minimally — it's the pre-tenant principal-resolution hot path hit
  on every authenticated request. Coupling this feature's broader column needs onto it risks
  destabilizing an auth-critical path. Rejected for the same reason Slice 17 built its own
  `AuditReadDbContext` instead of reusing something shared.

## Data model

**Reads** (`AccessReviewRepository.FetchUsersForReviewAsync`, mirrors
`access-review.repository.ts`'s `reviewUserSelect` exactly):

```
User: id, firstName, lastName, email, organizationId, isActive, deletedAt, lastLoginAt, isPlatformOwner
  → Organization: name
  → UserRoles[]: assignedAt, assignedBy, companyScope, unitScope, expiresAt
      → Role: slug, name, isActive, organizationId (cross-org-grant detection)
          → RolePermissions[]: scope
              → Permission: module, action
```

`where: { organizationId }`, `orderBy: { createdAt: 'desc' }`, `take: cap + 1` (cap=10000, so the
caller can report `truncated` honestly — no silent cap, matching Slice 17's cursor-pagination honesty
convention).

**Write** (`access_reviews`, Prisma model `AccessReview`, `packages/db/prisma/schema/system.prisma:47-67`):
`id`, `organizationId` (FK → organizations, `ON DELETE CASCADE`), `reviewerId` (FK → users,
`ON DELETE RESTRICT`), `reviewedAt` (default now), `userCount`/`privilegedCount`/`staleCount`/
`deprovisionGapCount`/`expiredGapCount` (all `Int`), `notes` (`VarChar(2000)`, nullable), `createdAt`.
No unique constraint — a history table, multiple attestations per org over time are expected. Table
already has RLS `ENABLE`+`FORCE` + a `tenant_isolation` policy (irrelevant to this privileged write
path, per "Why this is a new pattern" above).

## Endpoint behavior

All 4 gated by `PlatformOwnerGate` (401 unresolvable principal, 403 non-platform-owner) — identical
mechanics to Slice 17, zero new authorization code.

| Endpoint                          | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /access-review`              | Builds the report for one org. Fires `SecurityEventWriter` (`access_review_viewed`, metadata: `targetOrgId`, `userCount`). Returns full JSON: `rows`, `summary`, `crossOrgRoleCount`, `truncated`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET /access-review/export`       | Same report. Fires `SecurityEventWriter` (`platform_export`, entity `export:access_review`, metadata: `resource`/`count`/`format`/`targetOrgId`/`truncated`). Returns `{format:"csv", data, count, truncated}`. CSV: 13-column Spanish header (`Usuario,Email,Organizacion,Estado,Rol,Alcance,AsignadoPor,Privilegiado,Inactivo,SinAcceso,BrechaBaja,Expirado,RolCruzado`), one line per (user, role) pair — users with 0 roles emit one line with role `"-"`. `assignedBy` emitted raw (a GUID, not resolved to a name — unlike audit-log's actor-name resolution; this is a deliberate TS behavior, not an oversight, and must be matched exactly). |
| `POST /access-review/attest`      | Recomputes the report fresh server-side (never trusts client-supplied counts). `OrgExistsAsync` → 404 if missing. If `truncated` → refuse with 412 (matching TS's `PRECONDITION_FAILED`) rather than persist under-counted compliance evidence. Otherwise inserts the attestation snapshot (5 counts + `notes`, bounded `.max(2000)`), fires `SecurityEventWriter` (`access_recertified`, metadata = the summary), returns the created row.                                                                                                                                                                                                           |
| `GET /access-review/attestations` | Lists attestation history for one org, newest first, `limit` bounded 1–100 (default 20), includes nested reviewer `firstName`/`lastName`/`email`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Pure kernel — the risk-assessment flags

The largest pure-logic surface in this slice (bigger than Slice 17's minimal CSV-only kernel), so it
gets the most golden-fixture coverage. `AssessUserAccess(user, now)` computes:

- **Status** (`AccessStatusOf`): `deleted` (has `deletedAt`) > `inactive` (`!isActive`) > `active`.
  Precedence matters and must be tested explicitly.
- **`neverLoggedIn`**: active AND `lastLoginAt == null`.
- **`stale`**: active AND `lastLoginAt != null` AND `now - lastLoginAt > 90 days`. Boundary-test at
  exactly 90 days.
- **`privileged`**: `isPlatformOwner || roles.any(slug in {"super_admin","platform_owner"})` — the
  single-source-of-truth set shared with the MFA gate in TS; ported as its own small function, not
  duplicated logic.
- **`deprovisionGap`**: NOT active AND (`isPlatformOwner` OR has ≥1 role) — a JML (joiner/mover/leaver)
  failure: the account is deactivated/deleted but still holds a grant.
- **`expiredGrant`**: active AND any role's `expiresAt` is in the past. Enforcement ignores expiry
  today, so this is _live_ lingering access, not a historical fact — must fire even though the grant
  still technically works.
- **`crossOrgRole`**: any role's `organizationId` differs from the user's `organizationId` — a
  grant-corruption detector, not a normal-path case.

Each flag needs an independent bite-proof fixture, plus the precedence and 90-day-boundary edge cases,
mirroring the real TS test file's structure (`tests/security/access-review.test.ts`).

## Feature flags

`PlatformOptions` gains two, both default `false` (dark by default, same discipline as every prior
slice): `AccessReviewReadEnabled` (gates report/export/list-attestations) and
`AccessReviewWriteEnabled` (gates attest) — matching the runbook's established Read/Write-per-domain
flag convention.

## Table-ownership ledger

`access_reviews` moves from `defaultOwner: prisma` to `efcoreStranglerWrite` (coexistence: TS keeps
writing it live until this surface is cut over and prod-verified; the C# write path ships dark).
`users`/`roles`/`user_roles`/`role_permissions`/`permissions`/`organizations` need no ledger change
(already `efcoreReadOnly` since Phase 2).

## Golden fixtures

New `contracts/access-review-fixtures/*.json`, mirroring `contracts/audit-fixtures/`: characterize the
real TS report/export output first — one fixture per risk flag independently, a combo case, and the
CSV formula-injection cases (an org/actor/role field starting with `=`/`+`/`-`/`@`/tab/CR) — before the
C# port is held to it byte-for-byte.

## C# test plan (Testcontainers, not mocks — same rigor as Slice 17)

- **`AccessReviewFixture`** — seeds 2 orgs with rows hitting every risk flag (never-logged-in, stale,
  privileged-role holder, deprovisioned-with-grant, expired-role, cross-org-corrupted grant) + a
  platform-owner sub and an org-admin sub.
- **`AccessReviewEndpointAuthTests`** — the 401/403/200/dark-404 matrix across all 4 endpoints (mirrors
  `AuditReadEndpointAuthTests`).
- **`AccessReviewOrgScopeTests`** (new shape — NOT a copy of Slice 17's cross-org test, which proved
  the opposite property) — proves the `organizationId` filter actually filters: querying org A never
  returns org B's rows; attesting org A never touches org B's data. Data-correctness, not RLS-isolation
  (per "Why this is a new pattern" above).
- **`AccessRiskKernelTests`** (unit, `Tims.UnitTests`) — each of the 6 flags independently, the
  status-precedence rule, and the 90-day boundary, against the new golden fixtures.
- **`AccessReviewRepositoryTests`** — direct repo-level query-shape tests (mirrors
  `AuditReadRepositoryTests`).
- **`SecurityEventWriterTests`** — correct `entity`/`action`/`metadata` shape written to `audit_logs`;
  fails soft (doesn't throw/block the caller) on a simulated DB error.

## Parity harness

New `scripts/parity/surfaces.ts` entry proving the **auth matrix only**: `platform_owner` (org-scoped)
→ 200, `org_admin` → 403, no JWT → 401, nonexistent org on attest → 404. Reuses the now-fixed
platform-owner seed path from Slice 17's own harness-bug fix. Does **not** attempt to prove "different
orgs return different data" through this harness — that's what `AccessReviewOrgScopeTests` is for; the
TS↔C# parity harness is built for auth-matrix proofs, not data-correctness proofs.

## Recipe (execution order for the implementation plan)

1. **Characterize.** Golden-fixture the TS behavior first: every risk flag independently + combos,
   `total`/`truncated` behavior at the `ORG_CAP` boundary, CSV/JSON export byte-for-byte (incl.
   formula-injection cases), attest's 404/412/success paths, and `SecurityEventWriter`'s expected
   `entity`/`action`/`metadata` shape for all 3 event types.
2. **Model.** `Tims.Domain/AccessReview/AccessRiskKernel.cs` (pure, no DB) + supporting types.
3. **Data.** `AccessReviewDbContext` + `AccessReviewRepository`.
4. **Write infra.** `SecurityEventWriter` (new, generic, reuses `AuditLogDbContext`/`AuditLogEntity`).
5. **Orchestration.** `AccessReviewService` (report/attest/list, `ORG_CAP` truncation refusal).
6. **Endpoints.** `AccessReviewEndpoints` behind `PlatformOwnerGate` + the two feature flags.
7. **Table-ownership ledger** update (`access_reviews` → `efcoreStranglerWrite`).
8. **Parity harness** entry (auth matrix).
9. **Whole-branch review** (general-purpose + Codex per `.claude/rules/verification.md`) before PR.

## Out of scope (explicit)

- Any frontend/UI for access review (no consumer exists today; CB-2b's own design doc defers this).
- Production cutover / flag flip / TS deletion — Federico-only, at canary, per the master plan.
- Generalizing/refactoring `BillingAuditWriter` — left untouched; `SecurityEventWriter` is a new
  sibling, not a replacement.
