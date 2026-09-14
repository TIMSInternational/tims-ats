# Audit / Compliance — domain characterization (Phase-5 domain #4)

Date: 2026-08-10 · Issue: #102 · Branch: `docs/102-103-design-spikes`

This is the **domain characterization** that has to exist before anyone can plan the port. It is not a
slice plan. Every number below was re-derived from source on this branch; nothing is carried over from
the issue body, from `REMAINING-WORK.md`, or from the CB-series docs. Where I contradict one of those,
the contradiction is stated with both citations.

**Filename note.** #102's acceptance criteria asks for `phase-5-slice-19-audit-compliance.md`. This file
is deliberately named `audit-compliance-domain.md` instead: §5 concludes the port is **four slices**, not
one, so a `slice-19` filename would encode a scoping claim the evidence does not support. That deviation
does not make #102's AC1 satisfied — see §8, which states exactly which of #102's and #61's acceptance
criteria this document does and does not close.

---

## 0. Corrections to the issue and to existing docs

| #   | Claim                                                        | Source                                                                                                                                                                                     | Reality                                                                                                              |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| C1  | "**17** TS `auditLog.create` sites"                          | #102 comment (2026-08-10)                                                                                                                                                                  | **23** non-test sites. See §1.1.                                                                                     |
| C2  | "~20 TS `db.auditLog.create` call sites"                     | #102 body                                                                                                                                                                                  | 23. Same miss as C1.                                                                                                 |
| C3  | "all 20 `db.auditLog.create` sites"                          | `docs/architecture/compliance/cb-1b-audit-logs-immutability.md:9`; repeated at `docs/REMAINING-WORK.md:438` and at `packages/db/prisma/manual/2026-07-17-audit-logs-immutable.sql:3`       | 23.                                                                                                                  |
| C4  | "**5** `ISecurityEventWriter` call sites"                    | #102 comment                                                                                                                                                                               | **6** `WriteAsync` invocations. See §1.3.                                                                            |
| C5  | "**3** C# writers"                                           | #102 comment                                                                                                                                                                               | Confirmed — 3 concrete writer classes. See §1.3.                                                                     |
| C6  | `routers/audit.ts` is "dead code", "zero frontend consumers" | `docs/superpowers/plans/2026-07-25-phase5-slice17-audit-log-read.md:17,1466`; `docs/architecture/csharp-migration/phase-5-slice-17-audit-log-read.md:12` (calls `exportLogs` a "`[stub]`") | **False as of `863b62f4`.** `exportLogs` is live at `apps/web/app/(admin)/settings/audit-log/page.tsx:28`. See §2.3. |
| C7  | "`withAudit` middleware is wired but DEAD (never applied)"   | `cb-1b-audit-logs-immutability.md:48-49`                                                                                                                                                   | **Still true today** — and it has a live consequence nobody has recorded. See §4.4.                                  |

**On C1/C2/C3 — why the count was wrong three times.** The naive grep `auditLog\.create` misses **6** of
the 23 sites, because those break the line between the delegate and the method:

```
packages/api/src/trpc.ts:160                          await db.auditLog
packages/api/src/repositories/billing.repository.ts:56    await tenantDb.auditLog
packages/api/src/routers/platform/ai-agents.ts:134        await db.auditLog
packages/api/src/routers/platform/system.ts:103           await db.auditLog
packages/api/src/routers/platform/system.ts:312           await db.auditLog
packages/api/src/routers/platform/data-requests.ts:264        db.auditLog
```

A multiline-aware scan (`auditLog\s*\.\s*create`) over `.ts`/`.tsx` returns 34 hits, of which 11 are in
`tests/` — leaving **23** product sites. Any inventory that reuses the single-line pattern will
under-count by the same 6, and `packages/api/src/trpc.ts:160` — the one global writer — is among them.

**On C6.** The slice-17 doc was written 2026-07-25 (`e44b3a22`); the export page landed 2026-07-31 in
`863b62f4` _feat(audit): tenant-scoped audit-log CSV/JSON export (#7)_. The claim was **true when written
and has been false since**. This is doc drift, not an authoring error — but the two files still assert it,
and #102's plan should not inherit it. #61 AC3 asks for the correction to land in
`docs/architecture/csharp-migration/phase-5-slice-17-audit-log-read.md`; that file is corrected on this
branch (see §8). `docs/superpowers/plans/2026-07-25-phase5-slice17-audit-log-read.md` is deliberately left
untouched: it is a dated plan artifact recording what was believed on 2026-07-25, and rewriting history in
it would destroy the evidence that this is drift rather than an authoring error.

**Where C3's wrong "20" also lives.** The same count is baked into the header comment of
`packages/db/prisma/manual/2026-07-17-audit-logs-immutable.sql:3` ("All 20 admin/security writers use
`db.auditLog.create`"). That file carries a standing operational requirement — re-run after any Prisma
migration that recreates `audit_logs` (§6.1) — so it is the copy most likely to be re-read during an
incident, by someone deciding whether the guard still covers every writer. It does not need to be edited
for the guard to be correct (the guard is table-scoped, not writer-scoped), but the number is wrong by 3
and should be fixed the next time that file is touched.

---

## 1. Writer census

Two physical tables carry this domain: `audit_logs` (admin/security events) and `data_access_logs`
(sensitive-read/export evidence). Both are `efcoreAppendOnly` in the ownership ledger —
`docs/architecture/table-ownership.md:93` — i.e. Prisma owns the DDL, both stacks may INSERT, neither may
UPDATE or DELETE.

### 1.1 TS → `audit_logs`: 23 sites

Everything routes through the Prisma `auditLog.create` delegate; there is no raw-SQL writer
(`$queryRaw`/`$executeRaw` against `audit_logs`: zero hits repo-wide).

| #     | Site                                                             | `action`                                                                                                  | Failure mode                    | `actorId`              |
| ----- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------- |
| 1     | `packages/api/src/access/security-audit.ts:44`                   | caller-supplied                                                                                           | try/catch, fail-soft (`:57-59`) | caller-supplied        |
| 2     | `packages/api/src/trpc.ts:160`                                   | `'access'`                                                                                                | `.catch`                        | `impersonatorId ?? id` |
| 3     | `apps/web/app/api/impersonate/start/route.ts:61`                 | `impersonation_started`                                                                                   | `.catch`                        | `owner.id`             |
| 4     | `apps/web/app/api/impersonate/stop/route.ts:32`                  | `impersonation_stopped`                                                                                   | `.catch`                        | `owner.id`             |
| 5     | `packages/api/src/repositories/billing.repository.ts:56`         | caller-supplied                                                                                           | `.catch`                        | caller-supplied        |
| 6     | `packages/api/src/routers/platform/ai-agents.ts:134`             | `ai_agent_status_*`                                                                                       | `.catch`                        | **missing**            |
| 7     | `packages/api/src/routers/platform/data-requests.ts:264`         | `data_subject_export`                                                                                     | `.catch` (`:283`)               | `impersonatorId ?? id` |
| 8–9   | `packages/api/src/routers/platform/entitlements.ts:57,79`        | `entitlement_set`, `entitlement_plan_assigned`                                                            | `.catch`                        | `ctx.user.id`          |
| 10    | `packages/api/src/routers/platform/invoices.ts:205`              | `invoice_status_*`                                                                                        | **uncaught**                    | **missing**            |
| 11    | `packages/api/src/routers/platform/invoices.ts:264`              | `payment_reminder_sent`                                                                                   | **uncaught**                    | **missing**            |
| 12–14 | `packages/api/src/routers/platform/organizations.ts:228,275,309` | `org_created/updated/suspended/activated`                                                                 | `.catch`                        | `ctx.user.id`          |
| 15    | `packages/api/src/routers/platform/subscriptions.ts:291`         | `dunning_reminder_sent`                                                                                   | **uncaught**                    | **missing**            |
| 16    | `packages/api/src/routers/platform/system.ts:103`                | `bulk_notification_sent`                                                                                  | `.catch`                        | `ctx.user.id`          |
| 17    | `packages/api/src/routers/platform/system.ts:312`                | `feature_flag_enabled/disabled`                                                                           | `.catch`                        | `ctx.user.id`          |
| 18    | `packages/api/src/routers/platform/usage-billing.ts:76`          | `entitlement_usage_invoiced`                                                                              | `.catch`                        | `ctx.user.id`          |
| 19–23 | `packages/api/src/routers/platform/users.ts:157,183,232,281,326` | `user_deactivated`, `user_activated`, `password_reset_requested`, `sessions_revoked`, `user_role_changed` | `.catch`                        | `ctx.user.id`          |

Three consistency defects fall straight out of the table, and all three are **portability hazards** — a
naive port would carry them across:

- **Three writers are uncaught** (#10, #11, #15). Every other site is best-effort. **Two of the three**
  (#10, #11) throw a 500 _after_ the state change has already committed: the invoice status is written at
  `invoices.ts:199` before the audit at `:205`, and the reminder email is dispatched at `invoices.ts:250`
  (`const sent = await sendEmail(...)`, guarded at `:262`) before the audit at `:264`. So an audit outage
  there turns a succeeded action into a reported failure, and the caller retries a send that already
  happened.

  > **Corrected 2026-08-10.** That consequence does **not** apply to #15. `subscriptions.ts:291` sits inside
  > `sendDunningReminder` (`subscriptions.ts:269-310`), which does a `findUnique`, two guard throws, the
  > audit row, then `return { sent: true }` — there is no state change and **no `sendEmail` call anywhere in
  > the procedure**. For #15 the uncaught write is harmless-to-correct: a 500 there leaves nothing
  > inconsistent, because nothing happened. So the port must decide the fail-closed question deliberately
  > for #10 and #11; #15 is a consistency cleanup, not a correctness one.

- **Four writers set no `actorId`** (#6, #10, #11, #15) — the rows are unattributable. `audit_logs.actorId`
  is nullable (`packages/db/prisma/schema/system.prisma:21`), so nothing catches it.
- **Only 3 of 23 populate `ipAddress`/`userAgent`** — the `security-audit.ts` helper (#1, `:53-54`), the
  global `access` writer (#2, `trpc.ts:168-169`) and the DSAR export (#7, `data-requests.ts:279-280`). The
  columns exist (`system.prisma:27-28`) and the tenant CSV export ships them
  (`packages/api/src/repositories/audit.repository.ts:58-59`), so **20** writers produce rows whose forensic
  columns are permanently null and un-backfillable (append-only).

  > **Corrected 2026-08-10** from "2 of 23 / 21 writers". Site #2 (`trpc.ts:160`) does populate both columns.
  > Note the interaction with §4.4: #2 is the writer inside the dead `withAudit` middleware, so among
  > **live** writers it is 2 of 22 — `access/security-audit.ts:53-54` and
  > `routers/platform/data-requests.ts:279-280`. Wiring `withAudit` would move live writers 22 → 23 and
  > IP-populating ones 2 → 3. The remediation size is **20 either way**, which is the number that matters.

Additionally, `packages/api/src/routers/platform/ai-agents.ts:140` hardcodes
`organizationId: '00000000-0000-0000-0000-000000000000'`. `audit_logs.organization_id` is a NOT-NULL FK to
`organizations` (`system.prisma:19,31`). Unless a row with that id exists, the insert violates the FK and
the `.catch(() => {})` at `:144` swallows it — AI-agent status changes would be **silently unaudited**. I
could not verify prod's `organizations` contents from this environment; this is the one item in this
document that needs a live query before it is stated as fact.

**Impersonation attribution.** **13** of the 23 sites use bare `ctx.user.id`, not the `impersonatorId ?? id`
form that CB-1c introduced at `data-requests.ts:273`. The 13 are exactly the rows the table above marks
`ctx.user.id`: `entitlements.ts:57,79` · `organizations.ts:228,275,309` · `system.ts:103,312` ·
`usage-billing.ts:76` · `users.ts:157,183,232,281,326`. The other 10 split as 4 `actorId`-missing (#6, #10,
#11, #15) and 6 already-correct forms (`trpc.ts` and `data-requests.ts` use `impersonatorId ?? id`,
`security-audit.ts` and `billing.repository.ts` take a caller-supplied actor, the two impersonate routes use
`owner.id`).

> **Corrected 2026-08-10** from "15 sites". 15 was never derived from the table two paragraphs above, which
> lists 13. The count sizes the Slice-C attribution remediation, so it is 13 sites to change, not 15.

On `platformProcedure` surfaces the blast radius is narrow:
during impersonation `ctx.user` is the target, and `packages/api/src/routers/platform/_common.ts:6-8`
403s a non-owner target. It bites only when a platform owner impersonates another platform owner.

### 1.2 TS → `data_access_logs`: 2 write sites, 5 call paths

| Write site                                                                     | Client                    | Policy                                                                              | Reached from                                                                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api/src/access/audit.ts:49` (`logDataAccess`)                        | `tenantDb` (`audit.ts:2`) | fail-CLOSED if `dataClassOf(entity) === 'restricted'`, else fail-soft (`:46,60-69`) | `routers/compensation.ts:97`, `routers/assessment.ts:58`, `services/compensation.service.ts:80`, `services/external-validation.service.ts:67` |
| `packages/api/src/routers/platform/data-requests.ts:47` (`auditSensitiveRead`) | privileged `db`           | same registry, same polarity (`:45,59-65`)                                          | `exportSubjectData` only                                                                                                                      |

`auditSensitiveRead` is a **deliberate** second writer, not a duplicate: `data-requests.ts:22-32` records
why `logDataAccess` cannot be substituted (it writes through `tenantDb`, so a platform owner who has an
org of their own runs under `SET LOCAL ROLE app_tenant` with the GUC pinned to the _operator's_ org, and
the fail-closed `tenant_isolation` `WITH CHECK` — `packages/db/baseline/prod-public-schema.sql:7575` —
rejects a row carrying the _subject's_ org). That reasoning survives the port verbatim and must be
carried into the C# design, because C#'s `DataAccessAuditWriter` has exactly the same `TenantScope`
coupling (§1.3).

### 1.3 C# writers: 3 classes, 14 invocation sites

Three concrete writer classes, confirming #102's C5:

| Class                                                                              | Table              | Interface              | Policy                                                                                      |
| ---------------------------------------------------------------------------------- | ------------------ | ---------------------- | ------------------------------------------------------------------------------------------- |
| `services/Tims.Platform/src/Tims.Infrastructure/Audit/DataAccessAuditWriter.cs:22` | `data_access_logs` | `IDataAccessAuditor`   | fail-CLOSED or fail-soft by data class (`:29-30,56-64`); writes under `TenantScope` (`:39`) |
| `services/Tims.Platform/src/Tims.Infrastructure/Audit/BillingAuditWriter.cs:15`    | `audit_logs`       | `IBillingAuditWriter`  | fail-soft; entity hardcoded `'billing'`; under `TenantScope`                                |
| `services/Tims.Platform/src/Tims.Infrastructure/Audit/SecurityEventWriter.cs:12`   | `audit_logs`       | `ISecurityEventWriter` | fail-soft (`:36-42`); **no** `TenantScope` — cross-org/pre-tenant by design (`:8-10`)       |

**`ISecurityEventWriter.WriteAsync` — 6 call sites, not 5** (correction C4):

1. `services/Tims.Platform/src/Tims.Api/AccessReview/AccessReviewEndpoints.cs:50` — `access_review_viewed`
2. `services/Tims.Platform/src/Tims.Api/AccessReview/AccessReviewEndpoints.cs:91` — export
3. `services/Tims.Platform/src/Tims.Api/AccessReview/AccessReviewEndpoints.cs:157` — `access_recertified`
4. `services/Tims.Platform/src/Tims.Api/Authentication/SecurityDenialAuditMiddleware.cs:132` — **global**, `authz_denied` on every 401/403 (#177/#178/#180/#181)
5. `services/Tims.Platform/src/Tims.Api/Authentication/MfaStepUpMiddleware.cs:88` — **global**, `mfa_step_up_required`
6. `services/Tims.Platform/src/Tims.Application/AlertMetrics/AlertMetricsReadUseCase.cs:71` — `alert_metric_cron_read` (#172)

The issue comment is right that (4) and (5) are the easy-to-miss ones — they live under
`Tims.Api/Authentication/`, in no domain folder, and they are wired as pipeline middleware at
`services/Tims.Platform/src/Tims.Api/Program.cs:803` and `:821` rather than as endpoint dependencies. The
comment's count of 5 appears to have collapsed the three `AccessReviewEndpoints` sites into two.

`IBillingAuditWriter.WriteAsync`: injected once, at
`services/Tims.Platform/src/Tims.Application/Billing/BillingSelfServeUseCase.cs:17`.

`IDataAccessAuditor.LogAsync`: **7** invocation sites —
`Tims.Api/Compensation/CompensationFxReadEndpoints.cs:195`,
`Tims.Api/Compensation/CompensationReadEndpoints.cs:395`,
`Tims.Api/Succession/SuccessionReadEndpoints.cs:309`,
`Tims.Application/Compensation/CompensationWriteUseCase.cs:89`,
`Tims.Application/ExternalVendor/ExternalAssessmentReadUseCase.cs:88`,
`Tims.Application/ExternalVendor/ExternalValidationSubmitUseCase.cs:66`,
`Tims.Application/Hris/RunHrisSyncUseCase.cs:347`. Registered twice — API host
(`Tims.Api/Program.cs:180`) and worker host (`Tims.Workers/Program.cs:100`).

### 1.4 Writer census — totals

| Stack | `audit_logs`                    | `data_access_logs`            |
| ----- | ------------------------------- | ----------------------------- |
| TS    | 23 sites, 1 delegate            | 2 sites, 2 helpers            |
| C#    | 2 writer classes, 7 invocations | 1 writer class, 7 invocations |

**There is no single owning module on either stack.** That is the gap #102 names, and it is real.

---

## 2. Reader census

### 2.1 `audit_logs` — TS

| Surface                            | Reader                                                    | Client            | Scope                                                         |
| ---------------------------------- | --------------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| `audit.listLogs`                   | `packages/api/src/repositories/audit.repository.ts:79`    | `tenantDb` (`:1`) | org                                                           |
| `audit.getLogDetail`               | `audit.repository.ts:109`                                 | `tenantDb`        | org                                                           |
| `audit.exportLogs`                 | `audit.repository.ts:46`                                  | `tenantDb`        | org, `EXPORT_LIMIT = 10_000` (`services/audit.service.ts:13`) |
| `audit.getAccessReport`            | `audit.repository.ts:140` (`groupBy`, `action: 'access'`) | `tenantDb`        | org                                                           |
| `audit.getChangesByEntity`         | `audit.repository.ts:153`                                 | `tenantDb`        | org                                                           |
| `platform.getSystemHealth`         | `routers/platform/system.ts:41,43,46`                     | privileged `db`   | **cross-org**                                                 |
| `platform.getRecentPlatformEvents` | `routers/platform/system.ts:119`                          | privileged `db`   | **cross-org**                                                 |
| `platform.getOrgAuditLogs`         | `routers/platform/system.ts:265`                          | privileged `db`   | single org by input                                           |
| `platform.getRecentActivity`       | `routers/platform/dashboard.ts:354` (read at `:358`)      | privileged `db`   | **cross-org**                                                 |

> **Corrected 2026-08-10.** The last row previously read `platform.getPlatformDashboard`. No procedure of
> that name exists anywhere in the repo (`grep -rn getPlatformDashboard packages apps` → zero hits); the
> cross-org `audit_logs` read at `dashboard.ts:358` belongs to `getRecentActivity`, declared at `:354`.
> §3 and §5 Slice B are corrected to the same name.

`platform.getCrossOrgAuditLogs` and `platform.exportAuditLogsCsv` **no longer exist in TS** — deleted at
the Slice-17 cutover; the FE now calls C# unconditionally (`apps/web/lib/platform-api/audit-log.ts:1-8`).
Verified by grep: zero occurrences of either name under `packages/`.

### 2.2 `audit_logs` — C#

`services/Tims.Platform/src/Tims.Api/Audit/AuditReadEndpoints.cs` — `GET /audit/logs` (`:32`) and
`GET /audit/logs/export` (`:63`), both behind `PlatformOwnerGate` and mapped when
`PlatformOptions.AuditLogReadEnabled` is set **or** during OpenAPI-doc generation — the guard is
`if (externalOptions.AuditLogReadEnabled || isOpenApiDocGeneration)` at `Tims.Api/Program.cs:1118`, with the
carve-out stated on the option itself (`Tims.Api/Configuration/PlatformOptions.cs:253-258`). A port that
reads the flag alone will mis-model when the surface is reachable. Backed by `AuditReadRepository` /
`AuditReadDbContext` — never wrapped in `TenantScope` (`Program.cs:445-450`).

### 2.3 User-facing readers (and correction C6)

| Page                                                                                | Calls                                        | Reaches                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| `apps/web/app/(admin)/platform/audit/page.tsx:9`                                    | `useAuditLogs` / `useAuditLogsExport`        | **C#** `/audit/logs` (`apps/web/lib/platform-api/audit-log.ts`) |
| **`apps/web/app/(admin)/settings/audit-log/page.tsx:28`**                           | **`trpc.audit.exportLogs`**                  | **TS** `auditService.exportLogs`                                |
| `apps/web/app/(admin)/platform/organizations/[id]/sections/activity-section.tsx:50` | `trpc.platform.getOrgAuditLogs`              | TS                                                              |
| `apps/web/app/(admin)/platform/health/page.tsx:16`                                  | `trpc.platform.getSystemHealth`              | TS                                                              |
| `apps/web/app/(admin)/platform/support/system-info.tsx:10-11`                       | `getSystemHealth`, `getRecentPlatformEvents` | TS                                                              |
| `apps/web/app/(admin)/dashboard/activity-feed.tsx:43`                               | `trpc.platform.getSystemHealth`              | TS                                                              |

**Correction C6, restated concretely.** `audit.exportLogs` is a real, reachable, permission-gated tenant
surface: router `packages/api/src/routers/audit.ts:28` (`permissionProcedure('audit','export')`) → service
`packages/api/src/services/audit.service.ts:50` (a full CSV/JSON builder, not a stub) → repository
`packages/api/src/repositories/audit.repository.ts:46` → nav entry
`apps/web/lib/nav/manifest.ts:93` (`module: 'audit'`) → page
`apps/web/app/(admin)/settings/audit-log/page.tsx:28`. It also emits its own `platform_export` audit row
(`routers/audit.ts:41-46`). Any port plan that treats `routers/audit.ts` as deletable dead code will
remove a live customer-facing export.

The other four `auditRouter` procedures (`listLogs`, `getLogDetail`, `getAccessReport`,
`getChangesByEntity`) genuinely have **zero** frontend consumers — grep across `apps/web` returns only the
`exportLogs` line above. So the original doc was right about 4 of 5 and wrong about the one that matters.

Reader base is narrow by grant: `audit` is granted **only to `super_admin`** —
`packages/db/prisma/seed-access-matrix.ts:35` (read/create/update/delete) and `:40` (export). No other
role in `MATRIX` carries an `audit` entry.

### 2.4 `data_access_logs` — **zero readers, on either stack**

Grep for `dataAccessLog.` across `packages`, `apps`, `workers`, `scripts` returns **three** hits: two writes
(`access/audit.ts:49`, `platform/data-requests.ts:47`) and one prose mention in a SQL comment
(`packages/db/prisma/manual/2026-07-17-data-access-logs-immutable.sql:7`). **Zero reads.** C# has no read
context and no endpoint for it either — the only `DataAccessLogEntity` `DbSet` is the writer's
(`DataAccessAuditDbContext.cs:23`).

The §21 sensitive-read trail is therefore **write-only**: evidence is accruing that nobody — including an
auditor, including an incident responder — can retrieve through the product. Retrieval today means direct
psql. That is a genuine control gap and it belongs in this domain's scope, not in a footnote.

---

## 3. C# surface: what exists vs what is missing

**Exists.**

- Cross-org audit **read** (Slice 17): `Tims.Api/Audit/AuditReadEndpoints.cs`, `AuditReadRepository`,
  `AuditReadDbContext`, `PlatformOwnerGate`. Flipped and live in prod 2026-07-31
  (`docs/REMAINING-WORK.md:202-205`); TS counterpart deleted.
- Three writers (§1.3) with Testcontainers proofs: `tests/Tims.IntegrationTests/Audit/`
  (`SecurityEventWriterTests`, `AuditReadRepositoryTests`, `AuditReadCrossOrgTests`,
  `AuditReadEndpointAuthTests`), plus `DataAccessAuditWriterTests.cs`,
  `Billing/BillingAuditWriterTests.cs`, and the immutability pins `AuditImmutabilityTests.cs` /
  `AuditLogsImmutabilityTests.cs`.
- Two global security-event middlewares (`SecurityDenialAuditMiddleware`, `MfaStepUpMiddleware`) —
  coverage TS reaches through observers instead.

**Missing.**

| Gap                                                                          | Evidence                                                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| The whole **tenant-scoped** `auditRouter` — all 5 procedures                 | no C# equivalent of `packages/api/src/routers/audit.ts`; this is #61, which #102 absorbs. Only `exportLogs` is proposed for a port — §5 Slice A |
| `platform.getOrgAuditLogs`                                                   | `routers/platform/system.ts:264`, no C# counterpart                                                                                             |
| `platform.getSystemHealth` / `getRecentPlatformEvents` / `getRecentActivity` | `system.ts:41,43,46,119`, `dashboard.ts:354`                                                                                                    |
| Any `data_access_logs` **read** surface                                      | §2.4 — missing on both stacks                                                                                                                   |
| A C# home for the 23 TS `audit_logs` writers                                 | `SecurityEventWriter` is the right shape (§1.3) but has 6 callers, none of them a port of the 18 platform-router writers                        |
| Retention / purge                                                            | **zero** matches in `workers/` and `services/Tims.Platform/src/`; the 6 elsewhere are all prose — see §4.5                                      |

> **Corrected 2026-08-10, two rows.**
>
> - "21 platform-router writers" → **18**. Counting the §1.1 table's rows under
>   `packages/api/src/routers/platform/`: ai-agents 1, data-requests 1, entitlements 2, invoices 2,
>   organizations 3, subscriptions 1, system 2, usage-billing 1, users 5 = 18. The other 5 of the 23 live
>   outside that directory (`trpc.ts`, `access/security-audit.ts`, `repositories/billing.repository.ts`, and
>   the two `apps/web/app/api/impersonate/*` routes). "21" was the (also wrong) `ipAddress` figure reused in
>   a context it does not describe.
> - "zero matches for `purge`/`retention`" → a case-insensitive scan of those four trees returns **6**:
>   `packages/api/src/routers/dei.ts:46`, `packages/api/src/routers/platform/data-requests.ts:17,296`,
>   `packages/db/prisma/migrations/20260810000000_audit_logs_action_index/migration.sql:9`,
>   `packages/db/prisma/schema/access.prisma:3` and `scripts/parity/surfaces.test.ts:150`. Every one is a
>   comment or an unrelated use of the word; `workers/` and `services/Tims.Platform/src/` are genuinely 0.
>   **The finding survives intact** — no purge job exists — but §4.5's phrasing ("no job, no scheduler
>   entry, no SQL") is the accurate one, and this row now matches it.

---

## 4. Compliance obligations — and where each is actually enforced

### 4.1 Append-only (CB-1 / CB-1b) — **enforced in the database**

Trigger + REVOKE, applied to prod and present in the committed baseline:

- `packages/db/baseline/prod-public-schema.sql:5531` `audit_logs_append_only` (BEFORE DELETE OR UPDATE, row)
- `:5539` `audit_logs_append_only_truncate` (BEFORE TRUNCATE, statement)
- `:5547`, `:5555` — the same pair on `data_access_logs`
- `:5533`, `:5541`, `:5549`, `:5557` — all four are `ENABLE ALWAYS` (fire under
  `session_replication_role='replica'`)
- `:269` `tims_append_only_guard()` — `RAISE EXCEPTION` with `ERRCODE = 'insufficient_privilege'` (42501)
- `packages/db/prisma/manual/2026-07-17-audit-logs-immutable.sql:24-25` — `REVOKE UPDATE, DELETE, TRUNCATE`
  from `PUBLIC` and `app_tenant`; the `data_access_logs` twin is
  `packages/db/prisma/manual/2026-07-17-data-access-logs-immutable.sql`

Residual grants confirm the shape: `GRANT SELECT,INSERT ... TO app_tenant` on both tables
(`baseline:8150`, `:8264`).

**Caveat that survives the port (CB-1b FK cascade).** `audit_logs.organizationId` is NOT-NULL with
`onDelete: Cascade` (`packages/db/prisma/schema/system.prisma:19,31`); `userId`/`actorId` are optional FKs
(`:20-21,32-33`). Once the guard is installed, a hard delete of an org (cascade → DELETE) or a user
(SET NULL → UPDATE) is blocked with 42501. `data_access_logs` is FK-less by design and unaffected.

### 4.2 Tenant isolation — enforced, with a documented BYPASSRLS carve-out

`ENABLE` + `FORCE ROW LEVEL SECURITY` on both tables (`baseline:689,1096,6883,6997`) with a fail-closed
`tenant_isolation` policy (`:7453`, `:7575`). But per
`~/.claude/.../reference_prod_db_roles_and_rls_facts.md`, the app connects as `postgres`, which is
BYPASSRLS — **FORCE RLS removes only the owner's exemption, not BYPASSRLS**. So the privileged `db`
readers in §2.1 are cross-org by construction, and the isolation guarantee for tenant surfaces rests on
`tenantDb`/`TenantScope` issuing `SET LOCAL ROLE app_tenant`. The port must not "simplify" a
`TenantScope`-wrapped writer into a privileged one.

### 4.3 §21 min-5 suppression — enforced, but **not by this domain**

`MIN_AGGREGATE_SIZE` / `suppressBelowMin5` live at `packages/api/src/access/aggregate.ts:19-21`, exported
via `packages/api/src/access/index.ts:15`, and are consumed by the _analytics_ surfaces —
`routers/engagement.ts:114`, `routers/monitoring.ts:35,226`, `routers/compensation.ts:49`, and C#'s
`DeiKernels` (`routers/dei.ts:28`). **No audit surface applies it, and none should**: audit rows are
per-event forensic records, not cohort aggregates, and flooring them would destroy the evidence.

Where §21 _does_ bind this domain is the `+AUDIT` obligation — "confidential + restricted reads must be
logged" (`packages/api/src/access/audit.ts:15-18`, citing the matrix in `docs/TIMS ATS - Architecture.md`
§21 lines 2472–2553). That is §1.2 + §4.6.

I am flagging this explicitly because #102's framing bundles min-5 into the audit domain. It is
enforced — just in `access/aggregate.ts`, owned by the analytics slices, and it is **not** a port
deliverable here.

### 4.4 Security-event coverage (CB-1c) — enforced with two live holes

Coverage is real on the denial path: `observeDenial` at `packages/api/src/trpc.ts:191` (transparent
outermost observer, `:189-193`), `observeExternalDenial` at `:291` and `:303`, `mfa_step_up_required` at
`:220`, `feature_flag_changed` at `routers/platform/system.ts:360`, role changes at `routers/user.ts:190`
and `:250`, flags at `routers/featureFlag.ts:52`, and 7 `logPlatformExport` call sites
(`routers/audit.ts:41`, `candidate/pool.ts:39`, `platform/invoices.ts:298`, `platform/ai-agents.ts:292`,
`platform/invitations.ts:299`, `platform/subscriptions.ts:265`, `platform/users.ts:368`).

Two things asserted somewhere but **not enforced in code**:

- **`withAudit` is still dead.** Defined `packages/api/src/trpc.ts:153`, composed into
  `auditedProcedure` at `:237` — and `auditedProcedure` has **zero** consumers repo-wide. CB-1c recorded
  this as a scope decision (`cb-1c-security-event-coverage.md:24`). The undocumented consequence:
  `audit.getAccessReport` filters on `action: 'access'`
  (`packages/api/src/repositories/audit.repository.ts:132`), and `'access'` is written **only** by
  `trpc.ts:160` inside the dead middleware. **`getAccessReport` returns an empty group-by, permanently.**
  It has no FE consumer, so nobody has noticed; it is also offered to `super_admin` as a real
  `permissionProcedure('audit','read')` surface (`routers/audit.ts:51`). Decide it, don't port it.
- **`login_failed` is read but never written.** `routers/platform/system.ts:43` counts it and `:47`
  includes it in `recentErrors`. Repo-wide, the only other occurrences are **five, all in C# tests** —
  `tests/Tims.IntegrationTests/Audit/AuditReadFixture.cs:143,145` (the seeded fixture rows),
  `AuditReadRepositoryTests.cs:98` and `AuditReadEndpointAuthTests.cs:85,159` (assertions over those rows).
  No product code on either stack writes it. CB-1c deferred this deliberately to CB-2 with a good reason — password login is client-side
  via the Supabase SDK, so no server observes a wrong password
  (`cb-1c-security-event-coverage.md:15-22`). The health dashboard's "failed logins today" tile is
  therefore a **structural zero**, not a measurement.

### 4.5 7-year retention — **asserted in docs, enforced nowhere**

`docs/architecture/compliance/cb-1-audit-immutability.md:57` documents a 7-year retention for
`data_access_logs` PII (`actor_id`, `ip_address`, `user_agent`); the roadmap repeats "7yr audit" at
`00-compliance-by-design-roadmap.md:62` and assigns retention/erasure jobs to **CB-6**
(`:69`). CB-6 has not been built: a case-insensitive scan for `purge|retention` across `packages/`,
`apps/`, `workers/`, `scripts/` and `services/Tims.Platform/src/` finds **no job, no scheduler entry, no
SQL**. `cb-1-audit-immutability.md:64` is candid about it — "Until CB-6, the table is fully immutable".

Two consequences the port must own: (a) retention is currently _infinite_, which is a
data-minimization exposure, not merely an unbuilt feature; (b) when CB-6 arrives it needs a **privileged
exception path**, because the append-only guard blocks its own DELETEs by design — and that path is
itself a control that must be audited.

### 4.6 GDPR / Habeas Data (Ley 1581/2012) — export-only, and the erasure path is blocked

`packages/api/src/routers/platform/data-requests.ts:11-17` — right-of-access is implemented
(`exportSubjectData`, `platformProcedure`); **deletion is explicitly not**. This is consistent with
CB-1b's cascade caveat: an erasure that hard-deletes a user or org would hit the 42501 guard.

Live minimization defect, still open: `data_subject_export` writes the subject's plaintext email into
**both** `entityId` (`data-requests.ts:276`) and `metadata.email` (`:277`, where `auditMeta = { email, … }`
is built at `:260`), into an append-only table, readable
by any same-org holder of `audit:read`. CB-1c flagged it and escalated it to CB-6 rather than fixing it
(`cb-1c-security-event-coverage.md:52-58`). It is unfixable after the fact — append-only.

### 4.7 Fail-closed audit writes — where they exist

**Three** fail-closed paths exist — two in TS and one in C# — all three on `data_access_logs`, all three
class-derived:

- TS: `packages/api/src/access/audit.ts:46` + throw at `:60-66`.
- TS, privileged: `packages/api/src/routers/platform/data-requests.ts:45` + throw at `:59-65` — this is
  #155's contribution, **the first fail-closed privileged audit write in the codebase**. Its call site is
  `:227`, and the reason it is sequenced first and alone (rather than inside the `Promise.all` at `:228`)
  is written out at `:220-226`: `data_access_logs` is append-only, so if a concurrent fail-soft write had
  already committed, a subsequent fail-closed abort would leave permanent, uncorrectable rows asserting
  an export that never returned anything.
- C#: `Tims.Infrastructure/Audit/DataAccessAuditWriter.cs:29-30,56-64`.

> **Corrected 2026-08-10.** This read "Exactly **two** fail-closed paths exist" and was then refuted by its
> own three-item list one line later. The C# writer is a third fail-closed path, not an aside — a port that
> counts two will think it is adding one where one already exists.

`audit_logs` has **no** fail-closed writer on either stack. The three uncaught TS sites (§1.1) are
fail-closed only by omission — no comment claims it, and they sit after the state change.

---

## 5. Recommended slice breakdown

The port is **four slices**, not one. Justification: the surfaces have three different auth models
(tenant RBAC, platform-owner, machine/cron), two different failure polarities, and one of them
(`data_access_logs` read) does not exist on either stack and so is new build, not a port.

### Slice A — tenant-scoped `auditRouter` export (closes #61)

Port **`exportLogs` only**. Reuse `AuditReadDbContext` shapes, but **wrap in `TenantScope`** — unlike
Slice 17's platform reader, this one is org-scoped RBAC.

> **Corrected 2026-08-10 — this changes the slice, not just a number.** Slice A previously scheduled a port
> of `listLogs` / `getLogDetail` / `exportLogs` / `getChangesByEntity`. Three of those four are procedures
> §2.3 proves have **zero consumers**, and #61 AC1 asks that unused procedures be deleted _or_ that a reason
> they survive be recorded. Porting them silently is the opposite of that, so the recommendation is
> corrected: **only `exportLogs` is ported**, and `listLogs`, `getLogDetail` and `getChangesByEntity` join
> `getAccessReport` in Slice D's decide-or-delete bucket.
>
> The evidence for the four, re-checked today:
> `grep -rn 'listLogs\|getLogDetail\|getChangesByEntity\|getAccessReport' packages apps scripts`
> restricted to source (`--include='*.ts' --include='*.tsx'`, excluding `node_modules` and `.next`)
> returns **20 hits, every one inside the implementation chain itself**: 8 in `routers/audit.ts`
> (the declarations), 8 in `services/audit.service.ts` (the methods they call), and 4 in
> `repositories/audit.repository.ts`. The repository four are **comments**, not call sites — the repo
> methods are named `findLogs` / `findAccessReport` / `findChangesByEntity`, and those lines record
> where the logic moved from.
>
> The load-bearing part is the negative, and it is exact: **0** hits in `apps/web`, **0** in `scripts/`,
> **0** in `tests/`. No FE consumer, no test, no script. (Counting source files only — `apps/web/.next/`
> contains bundled copies of the router and will match a careless grep.) There is no evidence they survive deletion, and this document
> does not have the standing to delete them; naming the decision and its owner is what #61 asks for.
>
> The default should be **delete**, for a reason beyond tidiness: `getAccessReport` returns a permanently
> empty group-by (§4.4), so at least one of the four is not merely unused but actively broken, and porting
> a broken surface manufactures a C# parity test that pins the bug.

Hazards:

- `exportLogs` **is live** (§2.3, correction C6). This is a customer-visible cutover with a real FE
  consumer, not a dark port. It needs the standard `NEXT_PUBLIC_*` wrapper + canary.
- `EXPORT_LIMIT = 10_000` with a `take: limit + 1` truncation probe
  (`services/audit.service.ts:13`, `repositories/audit.repository.ts:48`) and a `truncated` flag the page
  renders (`settings/audit-log/page.tsx:49-53`). Off-by-one parity matters.
- The export select **deliberately excludes** `changes`/`metadata`
  (`repositories/audit.repository.ts:29-32`). Do not "complete" it.
- Grant surface: `audit:read` / `audit:export`, `super_admin` only
  (`seed-access-matrix.ts:35,40`). The C# port needs the same grant check, not just `PlatformOwnerGate`.

### Slice B — the platform audit reads

`getOrgAuditLogs` (`system.ts:264`), `getSystemHealth`'s three audit aggregates (`system.ts:41,43,46`),
`getRecentPlatformEvents` (declared `system.ts:118`, read at `:119`), `getRecentActivity` (declared
`dashboard.ts:354`, audit read at `:358`).

Hazards:

- All privileged/cross-org — `PlatformOwnerGate`, **no** `TenantScope`, same as Slice 17.
- `getSystemHealth` is not an audit surface; it is a health surface that happens to count `audit_logs`.
  Porting it drags `system.helpers.ts` (`buildSystemHealthServices`) along. Consider porting the
  **counts** only and leaving the composition in TS.
- Do not port the `login_failed` count as a working metric (§4.4) — it is structurally 0.
- **`getRecentPlatformEvents` has no `where` clause at all.** `packages/api/src/routers/platform/system.ts:118-130`
  is a bare `db.auditLog.findMany({ orderBy, take, select })` on the privileged client — every org's audit
  rows, newest first, bounded only by `input.limit` (`z.number().int().min(1).max(50).default(10)`,
  `system.schemas.ts:10-12`). It is rendered by
  `apps/web/app/(admin)/platform/support/system-info.tsx:11`. The page bound must be carried over: it is
  the only thing besides `PlatformOwnerGate` limiting how much cross-tenant audit history this returns, and
  the C# port must decide deliberately whether an unfiltered cross-org tail is the intended contract.
- **`getRecentActivity` — a different procedure — filters `action: { not: 'access' }`**
  (`dashboard.ts:358`), and that filter only makes sense because of the dead `withAudit` (§4.4): `'access'`
  is written solely by `trpc.ts:160`, so today it excludes nothing and would begin excluding everything the
  moment `withAudit` is wired. Re-derive it, don't copy it.

  > **Corrected 2026-08-10.** This hazard previously attached the `action: { not: 'access' }` filter to
  > `getRecentPlatformEvents` and cited `dashboard.ts:358` for it. Both halves were wrong, and the error hid
  > the more serious fact: the procedure it named is an **unfiltered cross-org read**, which is precisely
  > what a porter needs to know before reimplementing it.

### Slice C — consolidate the 23 `audit_logs` writers

This is the slice #102 actually asks for. `SecurityEventWriter` is the correct target shape (generic,
privileged, no `TenantScope`, caller-supplied action/entity). `BillingAuditWriter` stays separate —
it is tenant-attributed and runs under `TenantScope` (`ISecurityEventWriter.cs:6-10`).

Sequencing that de-risks it: **first** normalize the 23 TS sites onto `logSecurityEvent`
(`access/security-audit.ts:37`) — a TS-only refactor with no cutover risk — **then** port the single
resulting helper. Porting 23 hand-rolled sites individually multiplies the parity surface by 23.

Hazards:

- The four missing `actorId`s (§1.1) and the **two** uncaught writers that sit after a committed state
  change (#10, #11) are **behavior changes** whichever way they are resolved. Resolve them in the TS
  normalization step, where a revert is cheap. The third uncaught writer (#15, `subscriptions.ts:291`) is
  not in that class — it precedes no state change and no send, so making it fail-soft is a pure
  consistency fix (§1.1).
- **20** of 23 write null `ipAddress`/`userAgent`, and the 13 bare-`ctx.user.id` sites (§1.1) need the
  `impersonatorId ?? id` form. Adding the forensic columns is an improvement but changes the export payload
  the tenant CSV already ships (`audit.repository.ts:58-59`).
- `ai-agents.ts:140`'s all-zeros org id needs a live prod check before anything is ported (§1.1).
- Metadata wire format is a known trap: TS writes a raw jsonb **object**
  (`access/security-audit.ts:18-22,51-52`), C#'s `AuditLogEntity.Metadata` is a `string?`, so the wire
  carries a JSON-encoded **string** and the FE re-parses (`apps/web/lib/platform-api/audit-log.ts:22-28`).
  A consolidated writer must not silently normalize one into the other.
- `audit_logs` is `efcoreAppendOnly` (`table-ownership.md:93`), so this slice adds a writer **without**
  an ownership flip. Do not treat it as flip-shaped work.

### Slice D — the `data_access_logs` read surface (new build) + the three policy decisions

Build the §21 evidence reader that has never existed (§2.4), and land the decisions this characterization
surfaced: (a) `withAudit`/`auditedProcedure`/`getAccessReport` — wire, delete, or redefine (§4.4); (b) the
DSAR subject-email minimization question (§4.6); (c) **the three consumer-less `auditRouter` procedures
moved out of Slice A** — `listLogs`, `getLogDetail`, `getChangesByEntity` — delete or record why they
survive, per #61 AC1. (c) is cheap and should land first: it is a TS-only deletion with no cutover, and
resolving it before Slice A starts keeps the C# surface from inheriting dead procedures.

Hazards:

- A reader over `data_access_logs` exposes actor IP/user-agent for confidential and restricted reads.
  Its own grant model needs designing — `audit:read` is probably too broad.
- Wiring `withAudit` would add **one INSERT per authenticated request** into an append-only table on a
  platform targeting thousands of concurrent users. C# already refused the analogous cost — see the
  `PrincipalResolutionMiddleware.cs:48` exemption note ("audit_logs INSERT per request, through a path
  with no throttle") and `SecurityDenialAuditMiddleware.cs:56-63` (resolve the writer at point of use,
  not per request). Deleting is the likelier right answer; either way it is a decision, not a port.

**Explicitly out of scope for all four slices:** CB-6 retention/purge (§4.5) and the FK-less `audit_logs`
follow-up (`cb-1b-audit-logs-immutability.md:36-38`). Both are prerequisites for GDPR erasure and for
faithful attribution of global cross-org platform actions, and both are DDL-shaped work under
`docs/architecture/ddl-governance.md`, not strangler work.

---

## 6. What this domain must NOT lose

1. **The append-only triggers and the REVOKEs.** Four triggers, all `ENABLE ALWAYS`, plus REVOKE
   UPDATE/DELETE/TRUNCATE from `PUBLIC` and `app_tenant`
   (`baseline:5531,5539,5547,5555,5533,5541,5549,5557`;
   `packages/db/prisma/manual/2026-07-17-audit-logs-immutable.sql:24-25`). Note the standing operational
   requirement in that file's header: **re-run after any Prisma migration that recreates `audit_logs`**.
   Pinned by `tests/Tims.IntegrationTests/AuditImmutabilityTests.cs` and `AuditLogsImmutabilityTests.cs`.
2. **The fail-CLOSED restricted-read policy, including its ordering.**
   `packages/api/src/access/audit.ts:46,60-66`;
   `packages/api/src/routers/platform/data-requests.ts:45,59-65` (#155's first fail-closed privileged
   write, called at `:227`); C# `DataAccessAuditWriter.cs:29-30,56-64`. The sequencing rationale at
   `data-requests.ts:220-226` is load-bearing and must survive verbatim.
3. **The `data-requests.ts:22-32` reason `logDataAccess` cannot be used on a cross-org surface.** A C#
   port that routes the DSAR audit through `DataAccessAuditWriter` (which does wrap `TenantScope`,
   `await using var scope = await TenantScope.BeginAsync(...)` at `DataAccessAuditWriter.cs:39`)
   reintroduces exactly the bug that comment documents.
4. **Transparency of the denial observer.** `packages/api/src/trpc.ts:189-193` inspects `!result.ok` and
   returns the result **unchanged** — tRPC does not reject `next()` on a downstream error, so a
   try/catch would never fire. C#'s equivalent never rethrows
   (`SecurityDenialAuditMiddleware.cs:150-154`). An audit observer must never turn a 403 into a 500.
5. **The kill-switch polarity.** `SecurityDenialAuditMiddleware.IsDisabled` matches the exact string
   `"true"` and is **disabled**-phrased on purpose (`:53`, `:47-52`): an `Enabled`-phrased flag with the
   house default of `false` would silently switch off a live security control on the next deploy. An
   absent or garbled value keeps the control ON. Contrast `MfaEnforced`, which fails **open** so it
   cannot lock operators out (`PlatformOptions.cs:436`). Two different polarities, both deliberate.
6. **`CancellationToken.None` on the post-response audit write.**
   `SecurityDenialAuditMiddleware.cs:142-148` — binding it to `context.RequestAborted` let a client that
   closed the socket cancel its own audit row, and the fail-soft catch swallowed the cancellation. A
   prober that disconnects on each 403 would have left no trace.
7. **Audit in a `finally`, not on the success path.** `AlertMetricsReadUseCase.cs:56-62` — an earlier
   version wrote nothing when the repository threw, so an enumerating secret-holder left no trace for any
   erroring request. Plus the local `catch` at `:87-90` (rationale `:64-70`), which exists because a `finally`-sited write that
   threw would **replace** the original exception.
8. **Actor = the real operator under impersonation.** `data-requests.ts:268-272` (with the bug it fixed
   written out), `trpc.ts:164`, and C# `AuditActor.ActorFor`. **13** TS sites still use bare `ctx.user.id`
   (§1.1, enumerated there) — that is the direction of the fix, not a precedent to copy.
9. **Resolve-or-skip on the org FK.** `access/security-audit.ts:38-42` centralizes it; the C# twin is
   `SecurityDenialAuditMiddleware.cs:121-124`, which additionally refuses to audit unauthenticated 401s
   so an anonymous caller cannot become an unbounded writer into an append-only table.
10. **`ENABLE ALWAYS`, specifically.** It is what closes the `session_replication_role='replica'` bypass
    (`cb-1b-audit-logs-immutability.md:19-20`). A regenerated `flip-ddl` or re-applied migration that
    drops it silently reopens the hole.
11. **The narrow grant.** `audit` read/export is `super_admin`-only
    (`seed-access-matrix.ts:35,40`). A C# surface gated on `PlatformOwnerGate` alone is a **different**
    and wider authorization model than the TS tenant surface it replaces.

---

## 7. Verification status

Not applicable — documentation-only change, no code touched, so `tsc`/vitest/`dotnet test` are unchanged
by it. Cross-model verification per `.claude/rules/verification.md` was **not run** for this document
(⚠️ NOT RUN, not PASS). Every claim above is single-sourced to `file:line` on this branch so a reviewer
can refute it directly.

One claim is **not** verified and is marked as such in-line: whether an `organizations` row with id
`00000000-0000-0000-0000-000000000000` exists in production (§1.1). It needs a live query.

A claim-audit pass over every citation in this document ran 2026-08-10 and found 16 false claims and 8
unsupported quantifiers. All are corrected above. The corrections that changed a **conclusion** rather than
a number are marked in-line with a `> **Corrected 2026-08-10.**` note — §1.1 (the uncaught-writer
consequence; the `ipAddress` count), §2.1 (a procedure name that does not exist), §3 (two counts), §4.7 (a
quantifier its own list refuted), §5 Slice A (the slice's contents) and §5 Slice B (the hazard aimed at the
wrong procedure).

---

## 8. Deliverable status against #102 and #61

This section exists so the gap between "characterized" and "planned" is visible in the document rather than
inferred from its absence.

| AC                                                        | Status                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #102 AC1 — write `phase-5-slice-19-audit-compliance.md`   | **Not closed.** This file is the characterization under a different name (filename note above), and it says outright it is not a slice plan. No sub-plan file exists under either name.                                                                                                              |
| #102 AC7 — derive the port slices from the sub-plan       | **Partially.** §5 recommends four slices with scope, sequencing and hazards, at roughly a paragraph each. No per-slice plan document was written, so the derivation stops at a recommendation and the four slices still need `phase-5-slice-*.md` files before anyone ports.                         |
| #61 AC1 — delete the 4 unused procedures or record why    | **Resolved as a decision, not as code.** §5 Slice A removes `listLogs`/`getLogDetail`/`getChangesByEntity` from the port and moves them, with `getAccessReport`, into Slice D's decide-or-delete item (c), with the zero-consumer evidence recorded there. The deletion itself is still outstanding. |
| #61 AC3 — document tenant vs platform in the slice-17 doc | **Closed.** `docs/architecture/csharp-migration/phase-5-slice-17-audit-log-read.md` now carries a dated correction block stating both the C6 drift and the two authorization models (`tenantDb` + `audit` grant vs privileged `db` + `PlatformOwnerGate`).                                           |

**Why AC1 and AC7 are left open rather than papered over.** Writing four thin `phase-5-slice-*.md` files
to satisfy a checkbox would produce exactly the artifact this document spent §0 correcting — a plan whose
numbers nobody re-derived. The four slices have real open decisions in front of them (§5 Slice D items a–c,
and the `ai-agents.ts:140` prod check in §1.1) that change their scope. They should be written after those
land, not before.
