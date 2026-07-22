# Table-Ownership Ledger (CI-enforced)

Date: 2026-07-15 · Status: **Active, CI-enforced (WP1.7).**
Parent: `csharp-migration/00-master-plan.md` §4 (One DDL path) + `phase-1-runway-and-spikes.md` WP1.7.

During the C#/.NET convergence, **two ORMs coexist** (Prisma today, EF Core as domains are
built/strangled). Exactly one owns the DDL of each table. This ledger is the source of truth,
and `scripts/table-ownership.mjs` (run by both CIs, asserted by `tests/governance/table-ownership.test.ts`)
**fails any PR that lets one ORM mutate a table the other owns.**

## The rule

- **`defaultOwner: prisma`** — every table mapped in `packages/db/prisma/schema/*.prisma`
  (`@@map("…")`) is Prisma-owned. Prisma is authoritative for all product tables today.
- **`efcore`** — the explicit allow-list of tables owned by EF Core / `Tims.Platform`. A table
  here must **NOT** also be `@@map`'d in the Prisma schema (that is a cross-owner conflict → red build).
  Every new EF-owned table (Phase 3 HRIS onward) is added here in the same PR that creates it, and
  ships its RLS block via `EnableTenantRls()` (org-scoped tables only).

A migration authored by one owner that touches a table owned by the other is a merge blocker.
Ownership transfers (Phase 5 strangler) move a table from `prisma` to `efcore` in one reviewed step.

## Ledger

<!-- machine-readable: parsed by scripts/table-ownership.mjs. Keep this the ONLY json block. -->
```json
{
  "defaultOwner": "prisma",
  "efcore": [
    "widgets",
    "hris_connectors",
    "hris_external_employees",
    "hris_sync_runs",
    "hris_sync_record_errors"
  ],
  "efcoreReadOnly": [
    "users",
    "user_roles",
    "roles",
    "organizations",
    "api_keys",
    "role_permissions",
    "permissions",
    "teams",
    "user_teams",
    "user_business_units",
    "business_units",
    "interview_evaluators",
    "interviews",
    "candidates",
    "assessment_results",
    "assessment_assignments",
    "assessment_types",
    "invoices",
    "vacancies",
    "applications",
    "offers",
    "pipeline_stages",
    "stage_movements",
    "okrs",
    "review_cycles",
    "rater_assignments",
    "rater_responses",
    "critical_roles",
    "successors",
    "salary_bands",
    "employee_compensations",
    "nine_box_evaluations"
  ],
  "efcoreAppendOnly": [
    "data_access_logs",
    "audit_logs"
  ],
  "efcoreStranglerWrite": [
    "preemployment_validations",
    "subscriptions"
  ],
  "quartzInfra": [
    "qrtz_job_details",
    "qrtz_triggers",
    "qrtz_simple_triggers",
    "qrtz_simprop_triggers",
    "qrtz_cron_triggers",
    "qrtz_blob_triggers",
    "qrtz_calendars",
    "qrtz_paused_trigger_grps",
    "qrtz_fired_triggers",
    "qrtz_scheduler_state",
    "qrtz_locks"
  ],
  "notes": {
    "widgets": "Phase-1 Spike A test-only table (Testcontainers DDL + TenantWidgetDbContext). NOT a product table; created by hand-authored test SQL, never by an EF migration against prod.",
    "hris": "Phase-3 HRIS (WP3.1): the FIRST EF-OWNED product tables — EF holds the DDL (migration 20260716000000_hris_domain, HrisDbContext) AND writes them. NOT @@map'd in Prisma. Deliberately `hris_`-prefixed so they are DISTINCT from the live Prisma-owned `connectors`/`connector_syncs`/`sync_errors` integration tables (reusing those names would be a cross-owner collision → red build). All four are org-scoped, so the migration wraps each with EnableTenantRls (ENABLE + FORCE ROW LEVEL SECURITY + fail-closed tenant_isolation policy) and GRANTs SELECT/INSERT/UPDATE/DELETE to app_tenant; every read/write runs UNDER TenantScope. Proven for real in Testcontainers (HrisRlsTests): org isolation, unset-GUC fail-closed, WITH-CHECK insert block.",
    "efcoreReadOnly": "Phase-2 identity plane reads these Prisma-OWNED tables via EF (IdentityDbContext, no writes) to resolve principals + API keys and to enforce permissions (WP2.5 reads role_permissions + permissions joined to roles for the grant fetch). WP2.5b adds the AnchorDbContext read-only maps (teams, user_teams, user_business_units, business_units, interview_evaluators, interviews) for the EF anchor loaders + the AssertScoped IDOR probe — run UNDER TenantScope (app_tenant/RLS), SELECT only. The candidate-resolution WP adds `candidates` (IdentityDbContext maps id, organization_id, email, is_active, deleted_at) — the privileged pre-tenant read that resolves the 4th principal type (a portal Supabase session with no staff User row → PrincipalType.Candidate by email+org), read-only like the rest. Prisma keeps the DDL; EF only SELECTs. NOT an ownership transfer — they still appear in the Prisma schema (that is expected, not a collision). Writes stay on the owning (Prisma/tRPC) stack until a Phase-5 strangler transfers a domain. Phase-5 Slice 1 (the FIRST strangler) adds `assessment_results`, `assessment_assignments`, `assessment_types` — the external-vendor assessment READ surface (ExternalAssessmentDbContext, SELECT-only, AsNoTracking) run UNDER TenantScope (app_tenant/RLS), joined result⋈assignment⋈type and gated completed-only. This is a READ port only: no ownership flip, no coexistence write — the TS `external-assessment` router/service/repo still serves prod (cutover deploy-gated/deferred). Prisma keeps the DDL. Phase-5 Slice 3 (the SECOND strangler, billing) adds `invoices` + `subscriptions` — the billing invoice READ surface (BillingReadDbContext, SELECT-only, AsNoTracking) run UNDER TenantScope (app_tenant/RLS), invoice⋈subscription (nullable FK LEFT join) for getInvoice, cursor-paginated for listInvoices. First STAFF-JWT C# product read (billing:read grant via PermissionService; org-level, no per-row scope). The billing enums (InvoiceStatus/OrgPlan/SubscriptionStatus) are native Prisma enums read into C# strings. READ port only: no ownership flip, no coexistence write — the TS `billing` router still serves prod; the C# read route is dark-by-default behind `Platform:BillingReadEnabled` (deploy-gated cutover). Prisma keeps the DDL. Phase-5 Slice 3b (billing, cont'd) adds `vacancies` (the getUsage vacancies count) — with `users` + `assessment_assignments` + `subscriptions` (already listed) it backs the C# billing usage/plan/config READ surface (getUsage/getCurrentPlan/getBillingConfig): minimal read-only count maps on BillingReadDbContext (id/org + is_active | status/deleted_at | assigned_at), SELECT-only AsNoTracking run UNDER TenantScope (app_tenant/RLS) with an explicit org filter. Same billing:read staff-JWT gate; dark-by-default behind `Platform:BillingUsageEnabled`. READ port only, Prisma keeps the DDL + the write path. (All Stripe writes + the eventual billing ownership flip are deferred to later slices.) Phase-5 Slice 5 (the THIRD strangler, reporting/analytics) adds `applications` + `offers` + `pipeline_stages` + `stage_movements` (with `vacancies` + `users`, already listed) — the recruitment-analytics READ surface (ReportingReadDbContext, SELECT-only AsNoTracking) run UNDER TenantScope (app_tenant/RLS) with an explicit org filter, org-wide aggregation for the six reports (kpis/funnel/source-breakdown/trend/lost-by-delay/recruiter-sla). Staff-JWT + `vacancy:read` grant via PermissionService AND the organization/company org-scope gate (Codex F3 — narrow team/unit/own roles fail closed 403, because the aggregates are org-wide). The aggregated status/source columns are ordinary Prisma Strings (NOT native enums), so this context needs no NpgsqlDataSource/EnableUnmappedTypes. All response shaping is in the pure @tims/shared / Tims.Domain.Reporting kernels (golden-parity both stacks); the wire is the raw kernel view shape (no schemaVersion — INTERNAL read). READ port only: no ownership flip, no coexistence write — the TS `recruitment-analytics` router/service/repo still serves prod; the C# route is dark-by-default behind `Platform:ReportingReadEnabled` (deploy-gated cutover). Prisma keeps the DDL. Phase-5 Slice 6 (the FOURTH strangler, team-intel) adds `okrs` (with `teams` + `user_teams` + `users` + `business_units` + `vacancies`, already listed) — the team-intel READ surface (TeamIntelReadDbContext, SELECT-only AsNoTracking) run UNDER TenantScope (app_tenant/RLS) with an explicit org filter, backing the seven teamIntel reads (getTeamProfile/getMembers/getBalanceScore/getBalanceAlerts[501]/getRecommendedHires[501]/compareTeams/getDashboardKpis). Staff-JWT + `team_intel:read` grant via PermissionService; this is the FIRST live `assertScoped('team')` IDOR probe on a READ path (endpoints 1–5 fetch-then-probe by-id → 404-not-403), compareTeams composes `scopeWhereFor('team')` (out-of-scope teamIds silently drop, via ScopePredicateSqlTranslator), and getDashboardKpis applies the organization/company org-gate (Codex F3 — narrow team/unit/own roles fail closed 403). The balance/comparison/tenure/diversity shaping is in the pure @tims/shared / Tims.Domain.TeamIntel kernels (golden-parity both stacks); the wire is the raw model/kernel shape (no schemaVersion — INTERNAL read). READ port only: no ownership flip, no coexistence write — the TS `teamIntel` router/`team-intel-metrics` still serve prod; the C# route is dark-by-default behind `Platform:TeamIntelReadEnabled` (deploy-gated cutover). Prisma keeps the DDL. Phase-5 Slice 7 (the FIFTH strangler, evaluation360) adds `review_cycles` + `rater_assignments` + `rater_responses` (with `users`, already listed) — the evaluation360 READ surface (Evaluation360ReadDbContext, SELECT-only AsNoTracking) run UNDER TenantScope (app_tenant/RLS) with an explicit org filter, backing the five reads (listCycles/getCycleProgress [STAFF] + myRaterTasks/myReport/myReportCycles [SELF-SERVICE]). TWO auth patterns, not crossed: the STAFF reads use Staff-JWT + `evaluation360:read` grant via PermissionService AND the organization/company org-gate (Codex F3 — narrow team/unit/own roles fail closed 403); the SELF-SERVICE reads are the FIRST identity-anchored (`protectedProcedure`) C# pattern — authorization is IDENTITY (any resolved principal; NO grant, NO scope, NO org-gate/assertScoped/scopeWhereFor), and EVERY query HARD-FILTERS on the resolved caller's own user id (`rater_user_id` for tasks, `subject_user_id` for report/report-cycles), since an org-scoped admin would otherwise degrade those to match-all and read another user's data. UNLIKE the reporting/team-intel reads, `review_cycles.status` / `rater_assignments.relationship` / `rater_assignments.status` are NATIVE Prisma enums that this surface FILTERS on, so its data source maps them to CLR enums (Postgres has no implicit enum=text operator; EnableUnmappedTypes-as-text cannot supply a typed enum parameter). The myReport min-3 anonymity aggregation reuses the ALREADY-ported pure kernel `Tims.Domain.Access.Eval360Aggregate` (Phase-1 Spike B; golden-fixtured BOTH stacks, contracts/access-fixtures/eval360-min3.json) — no re-port. `findReportRows` NEVER selects a rater's user id (peer/direct_report anonymity). The wire is the raw model/kernel shape (no schemaVersion — INTERNAL read). READ port only: no ownership flip, no coexistence write — the TS `evaluation360` router/service/repo still serve prod; the C# route is dark-by-default behind `Platform:Evaluation360ReadEnabled` (deploy-gated cutover). Prisma keeps the DDL. (Only the 5 reads are ported; the 6 writes — createCycle/openCycle/closeCycle/publishCycle/assignRaters/submitRatings — stay on TS.) Phase-5 Slice 8 (the SIXTH strangler, succession) adds `critical_roles` + `successors` + `salary_bands` + `employee_compensations` + `nine_box_evaluations` (with `users`, already listed) — the succession READ surface (SuccessionReadDbContext, SELECT-only AsNoTracking) run UNDER TenantScope (app_tenant/RLS) with an explicit org filter, backing the nine succession reads (listCriticalRoles/getCriticalRole/getFlightRisk/getCompetencyCoverage/getRolesWithoutSuccessor/getCompGapAlerts/getSuggestedSuccessors/simulateExit/getDashboardKpis). Staff-JWT + `succession:read` grant via PermissionService; this is the RICHEST scope surface yet — it exercises ALL THREE scope mechanics in one domain: `scopeWhereFor('criticalRole'|'successor'|'nineBoxEvaluation')` row filters (out-of-scope rows drop, via ScopePredicateSqlTranslator), the `assertScoped('criticalRole')` by-id IDOR probe (getCriticalRole/getSuggestedSuccessors/simulateExit → 404-not-403; critical_roles registered as the probe root, anchored on current_holder_id — NOT soft-deletable), and the organization/company org-gate on the five analytics reads (Codex F3 — narrow team/unit/own → 403). getCompGapAlerts ALSO enforces a SECONDARY `compensation:read` grant (buildAccessForUser parity) and, via `selectFor(roles,'employeeCompensation')`, reads the restricted current_salary/currency from the DB ONLY for entitled roles (never selected-then-nulled), then audits every EXPOSED employee_compensations row fail-closed (Restricted) via IDataAccessAuditor BEFORE returning. All aggregation/scoring is in the pure @tims/shared / Tims.Domain.Succession kernels (golden-parity both stacks: competency-coverage/kpis/exit-simulation/suggested-successors/comp-gap); the wire is the raw model/kernel shape (no schemaVersion — INTERNAL read). READ port only: no ownership flip, no coexistence write — the TS `succession` router still serves prod; the C# route is dark-by-default behind `Platform:SuccessionReadEnabled` (deploy-gated cutover). Prisma keeps the DDL. (Only the 9 reads are ported; the 5 writes — addCriticalRole/addSuccessor/removeSuccessor/updateSuccessorReadiness/updateCriticalRoleBand — stay on TS.)",
    "efcoreStranglerWrite": "Phase-5 Slice 2: preemployment_validations is Prisma-OWNED (DDL/migrations) AND is written by the TS STAFF path (updateValidation, sets completed_by_id). This slice ports ONLY the external-vendor write (external.submitValidationResult): the C# WRITER (ExternalValidationDbContext + ExternalValidationRepository) performs ONE documented atomic pending-only UPDATE — status/result/notes + vendor provenance (completed_by_api_key_id set, completed_by_id null; the DB CHECK preemployment_validations_single_completer_chk enforces the XOR) — UNDER TenantScope (app_tenant + org GUC) so RLS engages. It NEVER issues DDL and touches no other table. This is NOT `efcore` (Prisma still owns the DDL — labeling it EF-OWNED would be a cross-owner collision), NOT `efcoreReadOnly` (C# genuinely writes it), and honestly stronger than `efcoreAppendOnly` (an UPDATE, not append). The one-active-writer guarantee is a REAL runtime FACT, not just a ledger claim: the C# write route is mapped ONLY when the deploy flag `Platform:ExternalVendorWriteEnabled` is true, and it DEFAULTS false (dark) — so deploying Tims.Api adds NO second live writer (a request 404s) and TS stays the sole active writer until Federico flips the flag per-surface at canary (dark → canary → full). (The Slice-1 read surface is gated the same way by `Platform:ExternalVendorReadEnabled`.) The build-time OpenAPI document still describes the routes — GetDocument.Insider forces them mapped during generation — so the contract stays accurate while runtime stays dark. FULL ownership flip to `efcore` is the sequenced completing step, BLOCKED on ALSO migrating the staff updateValidation write — the whole preemployment_validations write surface must flip together, else two stacks write one table (one-writer violation). Until then the table stays here and TS is the active writer; cutover (route the vendor submit → C#, canary, prod-verify) is deploy-gated/deferred. Like efcoreReadOnly/efcoreAppendOnly, the table still appears in the Prisma schema — expected, not a collision. Phase-5 Slice 4 registers `subscriptions` here (the Stripe webhook state-sync write). subscriptions is Prisma-OWNED (DDL/migrations) AND written by non-webhook TS paths (platform/subscriptions admin + 3 org-provisioning subscription.create in invitations/organizations/auth-callback), so the ownership flip is BLOCKED (the whole write surface must flip together) and this is a COEXISTENCE write. The C# WRITER (BillingWebhookDbContext + BillingWebhookRepository) performs the atomic upsert (INSERT..ON CONFLICT organization_id) + the organizations.plan mirror on the PRIVILEGED connection — NOT under TenantScope, because the Stripe webhook carries no org GUC (Stripe is not a tenant); it scopes every write by EXPLICIT organization_id on a role that bypasses RLS, serialized per-org by pg_advisory_xact_lock (proven in Testcontainers past FORCE RLS). subscriptions is ALSO still read by BillingReadDbContext (Slice 3/3b, SELECT-only) — a strangler-write table may be read too; the ledger tracks the table's strongest EF relationship (write). One-active-writer is a runtime FACT: the C# route is mapped ONLY when `Platform:BillingWebhookWriteEnabled` is true (default false / dark), so deploying Tims.Api adds no second writer — TS's webhook stays the sole active writer until Federico flips it at canary. Cutover (route Stripe's webhook → C#, canary, prod-verify, delete the TS webhook) is deploy-gated/deferred. Phase-5 (staff validation write) adds the SECOND C# writer on `preemployment_validations`: the staff `updateValidation` path (StaffValidationDbContext + StaffValidationRepository) performs the tracked partial UPDATE — status/completer/completedAt always, result/notes only when the body carries them (Prisma undefined-skip) — UNDER TenantScope (app_tenant + org GUC → RLS), setting completed_by_id = the staff user + completed_by_api_key_id = null (the single_completer_chk XOR). The endpoint additionally runs the by-id offer IDOR probe (ScopedProbe assertScoped('offer') — the FIRST live scope-probe wiring). With the external-vendor submit (Slice 2) this makes BOTH strangler writers of preemployment_validations C#, so the table is now FLIP-READY; the ownership flip to `efcore` still requires the cutover (route the staff + vendor writes → C#, canary, prod-verify, delete the TS router/service/repo). One-active-writer is a runtime FACT: the staff route is mapped ONLY when `Platform:ValidationStaffWriteEnabled` is true (default false / dark), so deploying Tims.Api adds no second active writer — TS's updateValidation stays the sole active staff writer until Federico flips it at canary.",
    "quartzInfra": "Phase-4 Slice-2: the 11 qrtz_* tables of the Quartz.NET clustered ADO job store (job details, triggers + the 5 trigger sub-tables, calendars, paused groups, fired triggers, scheduler state, locks). They hold cross-tenant SCHEDULER INFRA state (not tenant data) and are owned by NEITHER ORM: Quartz owns the DDL via the hand-applied services/Tims.Platform/db/quartz/quartz-tables_postgres.sql (the SAME file the Testcontainers proof applies — zero drift), and the scheduler is the only reader/writer via the Quartz AdoJobStore. They are RLS-EXEMPT BY DESIGN (no organization_id, no EnableTenantRls, no row policies — access is gated solely by DML GRANTs to the app DB role); adding RLS would break cluster locking. They must NOT be @@map'd by Prisma nor .ToTable'd by any EF DbContext — the check flags either as a violation (quartz-infra table claimed by Prisma / by EF). Dark-by-default behind Workers:ClusteredSchedulerEnabled (RAMJobStore until Federico applies the DDL + flips it on).",
    "efcoreAppendOnly": "WP2.7 audit plane: data_access_logs is Prisma-OWNED for schema/migrations. The C# WRITER (DataAccessAuditDbContext + DataAccessAuditWriter) only APPENDS — it INSERTs one audit row per sensitive read/export UNDER TenantScope (app_tenant + org GUC) so the RLS WITH CHECK passes, and it NEVER issues UPDATE/DELETE and touches no other table. IMPORTANT — append-only is a WRITER discipline, NOT yet a DB-enforced invariant: the live migration (20260612000000_access_control_models) still GRANTs UPDATE, DELETE on data_access_logs to app_tenant, and the tenant RLS policy only constrains rows to the caller's org — so a tenant-role SQLi/bug could still alter or erase same-org audit rows. DB-level insert-only enforcement is an OPEN security follow-up (see below). This category is deliberately NOT `efcore` (Prisma still owns the DDL — labeling it EF-OWNED would be a cross-owner collision) and NOT `efcoreReadOnly` (C# genuinely writes it — labeling it read-only would be dishonest). Like efcoreReadOnly, the table still appears in the Prisma schema — expected, not a collision. Phase-5 Slice 4b adds `audit_logs` (the SECOND append-only table, the admin/security event ledger distinct from data_access_logs): the FIRST C# writer to it is `BillingAuditWriter` (AuditLogDbContext), which APPENDS one row (`entity='billing'`) per self-service billing action (portal open / cancel) UNDER TenantScope (app_tenant + org GUC, RLS WITH CHECK), best-effort/fail-soft (a lost audit row never fails the billing action), and NEVER UPDATE/DELETE — honoring the CB-1b append-only immutability. Faithful port of the TS recordBillingAudit; Prisma keeps the DDL."
  }
}
```

- **`efcore`** — EF-OWNED (DDL + writes). Must NOT be `@@map`'d in Prisma.
- **`efcoreReadOnly`** — Prisma-OWNED, EF reads only. MUST be `@@map`'d in Prisma.
- **`efcoreAppendOnly`** — Prisma-OWNED (DDL/migrations), EF INSERT-only. MUST be `@@map`'d in Prisma. C#
  appends rows (never UPDATE/DELETE) under tenant RLS; it is the honest middle category for the audit
  writer — neither a full ownership transfer nor read-only. **Append-only here is a C# WRITER discipline,
  not a DB-enforced invariant** (see the security follow-up below).
- **`efcoreStranglerWrite`** — Prisma-OWNED (DDL/migrations), EF performs a specific documented UPDATE
  during an in-progress Phase-5 strangler. MUST be `@@map`'d in Prisma. The honest middle between
  `efcoreAppendOnly` (INSERT-only) and `efcore` (owned): C# genuinely UPDATEs the table, but Prisma still
  owns the DDL **and another (staff) write path**, so a REAL deploy flag keeps exactly ONE active runtime
  writer. The flag is `Platform:ExternalVendorWriteEnabled` (**default false / dark**): when off, the C#
  write route is NOT mapped (a request 404s), so deploying Tims.Api activates no second writer — Federico
  flips it per-surface at canary. **The full ownership flip to `efcore` is BLOCKED on ALSO migrating that
  staff write** (the whole table's write surface flips together, else two stacks write one table =
  one-writer violation) — the documented, sequenced completing step. Phase-5 Slice 2 registers
  `preemployment_validations` here (the external-vendor `submitValidationResult` write).
- **`quartzInfra`** — the `qrtz_*` Quartz.NET clustered-scheduler tables, owned by **neither** ORM (Quartz
  owns the DDL via the hand-applied `services/Tims.Platform/db/quartz/quartz-tables_postgres.sql`). Cross-tenant
  scheduler INFRA, **RLS-EXEMPT**. Must **NOT** be `@@map`'d by Prisma nor `.ToTable`'d by EF (the check flags
  either). Phase-4 Slice-2.

  Every EF `ToTable(...)` in `Tims.Platform` must appear in one of the four EF lists, or the CI check fails;
  every `quartzInfra` table must be claimed by neither ORM.

## Security follow-up — DB-enforce insert-only on `data_access_logs` (OPEN, Federico)

The audit ledger is append-only at the C# writer, but **not yet at the database**. The live migration
`20260612000000_access_control_models` GRANTs `UPDATE, DELETE` on `data_access_logs` to `app_tenant`
(line ~84), and the tenant RLS policy (line ~99) only scopes rows to the caller's org — so a tenant-role
SQL-injection or application bug could still **alter or erase same-org audit rows** after a restricted
read. To make append-only a real invariant, a **prod migration (owner action — Federico)** should:

1. `REVOKE UPDATE, DELETE ON data_access_logs FROM app_tenant;` (keep `INSERT`, `SELECT`).
2. Add an insert-only guard — a `BEFORE UPDATE OR DELETE` trigger that `RAISE`s (or an RLS policy with a
   `USING (false)` clause for `UPDATE`/`DELETE`) — so even a future accidental grant cannot mutate the ledger.

This is DOC-ONLY here (no migration/DB change in this slice); `scripts/table-ownership.mjs` continues to
treat `data_access_logs` as Prisma-owned + EF append-only.

## What the CI check enforces (Phase 1)

1. **No cross-owner collision:** no table in `efcore[]` may appear as a Prisma `@@map` table.
   (Catches a Prisma model silently re-declaring an EF-owned table, or an EF table added without
   first removing the Prisma one during a strangler transfer.)
2. **EF ownership is registered:** the only EF-mapped table in `Tims.Platform`
   (`TenantWidgetDbContext` → `widgets`) is present in `efcore[]`. A new EF `ToTable(...)` not
   listed here fails the check (forces the ledger update to accompany the schema change).

Later phases extend check #2 to parse every EF `ToTable`/migration and every Prisma migration for
the tables they mutate; Phase 1 keeps it deterministic against the single spike table.
