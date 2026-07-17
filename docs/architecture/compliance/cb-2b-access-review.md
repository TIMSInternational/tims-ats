# CB-2b — Access-review + recertification tooling (design/spec)

Date: 2026-07-17 · Track: [[tims-soc2-iso27001-compliance]] · Roadmap CB-2 (slice 2). Follows CB-2a (MFA
enforcement depth, #148). SOC 2 CC6.2–6.3 · ISO 27001 A.5.18 (access review / JML recertification).

## Problem
No tooling exists to review WHO has WHAT access, or to record that access was periodically recertified — the
CC6.2–6.3 "access review + quarterly recertification" control. All the data exists (`User.lastLoginAt`/`isActive`/
`deletedAt`; `UserRole.assignedAt`/`assignedBy`/`companyScope`/`unitScope`/`expiresAt`; `Role`/`Permission`/
`RolePermission`) but there is no report, no export, and no attestation record.

## Scope (decided with Federico 2026-07-17)
Per-ORG snapshot recertification; report + export + attestation in ONE slice. Platform-owner-only surface
(`platformProcedure`, privileged `db` across orgs).

## Design

**1. Pure risk kernel** — `packages/api/src/access/access-review-kernel.ts`, `assessUserAccess({ isActive,
deletedAt, lastLoginAt, roleSlugs, now })` → `{ status: 'active'|'inactive'|'deleted', flags }`:
- `neverLoggedIn` — active but `lastLoginAt == null`
- `stale` — active and `lastLoginAt` older than `STALE_LOGIN_DAYS` (90)
- `privileged` — holds `platform_owner`/`super_admin` (reuse the CB-2a `isMfaPrivileged` set)
- `deprovisionGap` — `!isActive` or `deletedAt != null` but STILL holds ≥1 role (a JML gap)
Golden-fixtured; each flag must BITE. `now` injected (deterministic).

> NOTE (post-review): the kernel takes full role assignments (`{ slug, organizationId, expiresAt }`), not bare
> `roleSlugs`, and BOTH the report read and the CSV export REQUIRE an `organizationId` (no unauditable
> platform-wide bulk egress); `getAccessReview` audits an `access_review_viewed` event. See the Review-gate
> section below for the final shape.

**2. The report** — `platform.accessReview.getReport({ organizationId })` (platformProcedure): per-user rows
(name, email, org, status, roles+scope+assignedBy/assignedAt/expiresAt, the flattened permission grants
module:action:scope from `role_permissions`, and the kernel flags). Read-only via privileged `db`. REQUIRES an
`organizationId` (per-org is the review/audit unit) and audits an `access_review_viewed` event; bounded by the
org safety cap.

**3. Export** — `platform.accessReview.exportCsv({ organizationId })` → CSV, audited via the CB-1c
`logPlatformExport` (`resource: 'access_review'`, data egress) — no raw secrets, roles/grants/flags only.

**4. Recertification attestation** — NEW table `access_reviews` (org-scoped, NOT-NULL org FK, `tenant_isolation`
RLS + `app_tenant` grants like every org table; written/read via the platform privileged path):
```
id, organization_id (FK), reviewer_id (the attesting platform owner), reviewed_at,
user_count, privileged_count, stale_count, deprovision_gap_count, notes (VARCHAR 2000), created_at
```
- `platform.accessReview.attest({ organizationId, notes? })` — recompute the org's snapshot counts from the
  report kernel, insert one `access_reviews` row, and write a `access_recertified` security event (CB-1c
  `logSecurityEvent`). This is the durable evidence an auditor samples.
- `platform.accessReview.listAttestations({ organizationId })` — attestation history (proves the quarterly
  cadence).
- Migration `packages/db/prisma/migrations/<ts>_add_access_reviews/migration.sql` (table + indexes + FK + RLS
  ENABLE/FORCE + `tenant_isolation` policy + `app_tenant` grants, mirroring the eval360 migration) + a manual prod
  SQL `packages/db/prisma/manual/<date>-add-access-reviews.sql` for **Federico to apply** (prod is not
  migrate-managed). Prisma model added to `system.prisma`; RLS pinned in the table-ownership/RLS conventions.

**5. Tests** (`tests/security/access-review.test.ts`): kernel flags bite (stale/never/privileged/deprovision-gap
each RED if the rule is dropped, `now` fixed); export audited (logPlatformExport called with `access_review`);
attest computes snapshot counts + inserts + audits; static wiring (router uses platformProcedure).

## Review gate (fresh reviewer + Codex adversarial + opus) — findings & fixes
Fresh reviewer (no Critical) + Codex (NO-GO) CONVERGED; both confirmed access control airtight (all
platformProcedure; impersonation blocked), RLS + migration correct. Fixed in-branch bite-proven (gate re-green:
api/web tsc 0, vitest 2195/2195):
- **Unaudited global export (Codex High):** a whole-platform CSV by an org-less owner skipped the audit (empty-org
  FK). FIX: `exportAccessReviewCsv` now REQUIRES an org → always auditable + bounded (matches the attestation unit);
  `getAccessReview` was ALSO scoped+audited in recheck round 2 (see below).
- **False attestation evidence (fresh M2 / Codex High):** `attest` persisted capped counts for a >2000-user org.
  FIX: org-scoped cap raised to 10 000 and `attest` REFUSES a truncated org (PRECONDITION_FAILED) rather than
  record under-counted evidence; export/report surface `truncated` (audit metadata too).
- **Expired-but-live grants not flagged (H1 / Codex Med):** enforcement ignores `user_role.expiresAt`, so an expired
  grant is LIVE access. FIX: `expiredGrant` kernel flag + persisted `expired_gap_count` + CSV column.
- **Cross-org grant corruption not surfaced (Codex Med):** the report didn't compare `role.organizationId` to the
  user's. FIX: `crossOrgRole` kernel flag (select `role.organizationId`) + a `crossOrgRoleCount` in the report.
- **CSV injection (M3 / Codex Med):** FIX: `csvCell` RFC-4180-quotes every field, doubles quotes, and neutralizes a
  leading `=/+/-/@/tab/CR` (Excel/Sheets formula + row injection).
- **Lows:** `reviewer_id` index added; export audit carries `truncated`; the manual-SQL "byte-identical" claim
  softened to "DDL-identical".
- **Codex recheck round 2 (item 1 re-opened):** scoping+auditing only the CSV export had left the SAME dataset
  readable via the unscoped `getAccessReview` JSON endpoint (unaudited platform-wide egress). FIX: `getAccessReview`
  now REQUIRES an org too (buildReport/repo are always org-scoped — the platform-wide branch removed) AND audits an
  `access_review_viewed` security event. The whole access-review surface (view + export + attest) is now org-scoped
  + auditable. (Codex also noted the pre-existing org-less-owner `logPlatformExport` skip on OTHER exports —
  ai-agents/subscriptions/invitations — which is the CB-1c residual tracked to the FK-less-`audit_logs` follow-up
  (CB-1b), not a CB-2b regression.)

## Out of scope (follow-ups)
- A platform UI page (read the report + an "Attest" button + history) — a thin frontend follow-up; the
  backend + CSV export is the auditor-facing deliverable.
- Auto-deprovisioning of stale/gap users (a policy action, not this reporting control).
- `expiresAt`-based auto-revoke of `user_roles` (flagged in the report; enforcement is a separate slice).

## Compliance mapping
SOC 2 CC6.2 (registration/authorization), CC6.3 (role-based access + periodic review) · ISO 27001 A.5.18
(access rights review + JML). The attestation records are the retained Type-II evidence. Pairs with CB-1c
(export + attest are audited) + CB-2a (privileged-access MFA).
