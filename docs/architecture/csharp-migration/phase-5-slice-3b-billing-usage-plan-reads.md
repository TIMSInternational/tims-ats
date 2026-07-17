# Phase 5 Slice 3b — billing usage / plan / config reads → C# (strangler domain #2, cont'd)

Date: 2026-07-17 · Status: **In build (SDD).** Parent: `phase-5-slice-3-billing-invoice-reads.md` / `phase-5-strangler.md`.
Branch: `feat/csharp-phase5-billing-usage-plan-reads` off main `2231fdd`. **Cutover deferred + dark-by-default.**

## Objective + scope
Continue the billing strangler (domain #2). Slice 3 ported the invoice reads; this slice ports the three
remaining billing **read** procedures (`routers/billing.ts`), all `permissionProcedure('billing','read')`:

- **getBillingConfig** → `{ configured: billingService.isConfigured() }`. `isBillingConfigured(env)` = Stripe
  secret key AND both self-serve price ids present (`lib/stripe.ts`). Pure config-presence predicate.
- **getCurrentPlan** → `db.subscription.findUnique({ where:{ organizationId } })` → the **RAW full Subscription
  row or `null`** (no `select`). The wire shape == the Slice-3 `SubscriptionV1` (reused verbatim) or top-level `null`.
- **getUsage** → REAL counts + entitled-plan limits envelope:
  - `sub = subscription.findUnique(select currentPeriodStart,currentPeriodEnd,plan,status)`.
  - `limits = planLimits(entitledPlan(sub?.plan, sub?.status))` — **cancelled-sub / missing-plan → trial** limits.
  - counts (all org-scoped): `employees` = active users; `vacancies` = not-deleted, status ∉ {closed,cancelled};
    `assessments` = assessment_assignments assignedAt ≥ periodStart (or all if no period).
  - envelope: `{ employees:{used,limit}, vacancies:{used,limit}, assessments:{used,limit},
    storage:{usedMb:null,limitMb:null}, apiCalls:{used:null,limit:null},
    periodStart: periodStart?.toISOString() ?? null, periodEnd: currentPeriodEnd?.toISOString() ?? null }`.
    `limit` is `number|null` (enterprise = null = unlimited); storage/apiCalls are **always null** (no metering
    source yet — honest, rule #4); period fields are ISO strings or null.

Deferred (later slices): all Stripe **writes** (checkout/portal/cancel — external boundary) and the billing
**ownership flip** (billing OWNS its tables → clean `efcore` flip candidate).

## The pure kernels (golden-fixtured BOTH stacks — the anti-drift core)
Three pure functions cross the wire and are asserted byte-identical by the REAL TS exports + C#:
1. **`entitledPlan(plan,status)`** + **`planLimits(plan)`** (`packages/shared/src/constants/index.ts`). Port →
   `Tims.Domain.Billing.PlanEntitlement`. Fixture `plan-entitlement.json`: each plan, cancelled→trial,
   unknown-plan→trial (defensive `?? trial`), null/undefined plan→trial.
2. **`buildUsageView(input)`** — a pure builder **extracted from the TS router** (below) so the golden reflects
   REAL router output, NOT a hand-rolled mirror (the #141 synthetic-fixture trap). Port → `UsageViewBuilder`.
   Fixture `usage-view.json`: null-period (assessments = all), enterprise null-limits, storage/apiCalls null,
   canonical `…fffZ` period dates, cancelled-sub→trial limits end-to-end.
3. **`isBillingConfigured(env)`** (`lib/stripe.ts`) — pure over an explicit env object. Port →
   `StripeBillingConfig.IsConfigured`. Fixture `billing-config.json`: all-3-present→true, each one missing→false,
   empty-string→false.

### HONEST-fixture refactor (touches TS product — a shared golden that genuinely spans both stacks)
`billing.getUsage` builds its envelope inline. To keep the cross-stack `usage-view.json` golden faithful (not
synthetic), extract a pure `buildUsageView({ employees, vacancies, assessments, plan, status, periodStart,
periodEnd })` into `@tims/shared` (beside `planLimits`/`entitledPlan`; it calls them internally) and refactor
the router to `return buildUsageView({...counts, plan: sub?.plan, status: sub?.status, periodStart,
periodEnd: sub?.currentPeriodEnd ?? null })`. **Behavior-preserving** (identical output); pinned RED by the new
vitest + the existing router behavior. This is the sanctioned "shared golden spans both stacks" exception; no
other TS product code changes.

## C# structure (`services/Tims.Platform/`)
```
src/Tims.Domain/Billing/
  PlanEntitlement.cs      → PLAN_LIMITS + planLimits + entitledPlan (pure; string plan/status in).
  UsageView.cs            → UsageMetric(used,limit?) / UsageStorage(usedMb?,limitMb?) / UsageApiCalls(used?,limit?)
                            / UsageV1 (period fields via NodeIsoNullable converter) + pure UsageViewBuilder.Build.
  StripeBillingConfig.cs  → pure IsConfigured(secret?,priceStarter?,priceProfessional?) + BillingConfigV1{configured}.
  (getCurrentPlan reuses SubscriptionV1 / SubscriptionRow / SubscriptionV1Mapper verbatim.)
src/Tims.Application/Billing/
  IBillingReadRepository.cs → += GetSubscriptionAsync(org) (SubscriptionRow?) + GetUsageCountsAsync(org,periodStart?).
  BillingUsageUseCase.cs    → getCurrentPlan (row→SubscriptionV1 or null); getUsage (sub period/plan/status +
                              counts → UsageViewBuilder.Build); getBillingConfig (StripeBillingConfig over options).
  UsageCounts.cs            → record (Employees,Vacancies,Assessments).
src/Tims.Infrastructure/Billing/
  BillingReadEntities.cs   → += minimal count entities UsageUserCountEntity/UsageVacancyCountEntity/
                              UsageAssignmentCountEntity (id, org, + isActive / status+deletedAt / assignedAt).
  BillingReadDbContext.cs  → map the 3 count tables (users/vacancies/assessment_assignments) read-only.
  BillingReadRepository.cs → GetSubscriptionAsync (AsNoTracking, TenantScope+org); GetUsageCountsAsync (3 counts
                              under ONE TenantScope + explicit org; status ∉ {closed,cancelled}; period-gated).
src/Tims.Api/
  Billing/BillingStaffGate.cs   → EXTRACT the staff-JWT gate (resolve principal → 401 / PermissionService(module,
                                  action) → 403 / TenantOrgRequired → 400) shared by BillingReadEndpoints +
                                  BillingUsageEndpoints (behavior-preserving; existing auth tests pin it).
  Billing/BillingUsageEndpoints.cs → GET /billing/usage, /billing/plan, /billing/config (staff JWT + billing:read).
  Configuration/PlatformOptions.cs → += BillingUsageEnabled (default false, dark). + a Stripe config section
                                     (SecretKey/PriceStarter/PriceProfessional, all optional) for getBillingConfig.
  Program.cs → register BillingUsageUseCase; map the 3 endpoints only when BillingUsageEnabled || OpenAPI-gen.
```

## Auth (identical to Slice 3 invoices)
All three are `permissionProcedure('billing','read')` = Supabase JWT + `billing:read` grant, org-level (no
per-row scope). Reuse the extracted `BillingStaffGate` (stash-first PrincipalResolver → 401; PermissionService
`billing:read` → 403; TenantOrgRequired → 400). Reads run under the resolved org's `TenantScope` (RLS).

## Counts + RLS (the fixture crux)
The three counts run **under `TenantScope`** (`SET LOCAL ROLE app_tenant` + org GUC) with an explicit org filter
(defense-in-depth), single scope per getUsage. `users`/`vacancies`/`assessment_assignments` are Prisma-OWNED →
`efcoreReadOnly`, `AsNoTracking`, SELECT-only. In prod these have RLS; the privileged identity path uses the
BYPASSRLS role. **Testcontainers:** add the 3 tables with `ENABLE`+`FORCE RLS` + `tenant_isolation` policy +
`GRANT SELECT ... TO app_tenant` (the privileged identity reads stay on the superuser `postgres` connection →
bypass RLS, unaffected; the count under app_tenant respects the policy). Seed OrgA + OrgB to prove cross-org
isolation and the filters (isActive / deletedAt / status ∉ {closed,cancelled} / period-gated assignedAt).

## Golden parity + regression corpus (every ported TS-fix pinned red-if-regressed)
- `plan-entitlement.json` — cancelled-sub → trial (the load-bearing fallback), unknown-plan → trial, per-plan limits.
- `usage-view.json` — null-period (assessments = all-time), enterprise null-limits, storage/apiCalls always-null,
  ISO `…fffZ` period dates, cancelled-sub → trial limits end-to-end.
- `billing-config.json` — all-3-present → configured; any missing / empty → not configured.
- Testcontainers: real counts (isActive/deleted/status/period filters), cancelled-sub→trial live, cross-org
  isolation (OrgB counts never bleed), getCurrentPlan raw-row / null, getBillingConfig shape.
- Endpoint boot matrix: billing:read → 200; no-grant → 403; no/tampered/non-staff JWT → 401; flag-off → 404 (dark).

## Ledger + flags
`efcoreReadOnly += vacancies` (users/assessment_assignments/subscriptions already present). New
`PlatformOptions.BillingUsageEnabled` (default false); Program maps the endpoints only when on (or the
build-time `GetDocument.Insider` OpenAPI pass). Cutover (route→canary→flip→delete TS) deferred.

## Deliberate parity notes (flag at cutover)
- getBillingConfig's C# runtime value is computed from the C# deploy's own Stripe config (absent today →
  `configured:false`, honest). The *predicate* is golden-parity-locked to TS `isBillingConfigured`.
- getCurrentPlan wire == raw `SubscriptionV1` or top-level `null` (faithful to `findUnique` no-select).
- `limit`/period nulls are EMITTED (keys present, value null) — matches the TS object literal (not omitted).

## Adjudicated review-gate fixes (2026-07-17)
opus whole-branch = **GO** (no Crit/High/Med); Codex adversarial = clean runtime, one Med (contract-only).
Fixed in-branch:
- **Med (Codex) — `/billing/plan` 200 was non-nullable in OpenAPI** though the endpoint faithfully returns
  `200 null` (getCurrentPlan = `findUnique`, org may have no subscription). Added a Program.cs
  `AddOperationTransformer` that rewrites the `billing/plan` 200 schema to the SAME nullable-ref form the
  generator uses elsewhere (`oneOf: [{type:null},{$ref SubscriptionV1}]`, cf. `InvoiceDetailV1.subscription`),
  so a generated client models the legitimate `200 null`.
- **Low — OpenAPI omitted the 400 the shared gate can emit** (org-less privileged principal on a tenant
  module → `organization_required`). Added `.Produces(Status400BadRequest)` to all three usage endpoints.
- **Low — test sharpening:** OrgB in-period assessment count made DISTINCT from OrgA (3 vs 2, so a cross-org
  bleed changes the value, not just the total); added an OrgC case (assignments but no subscription) proving
  the no-period ALL-TIME count branch counts every row (incl. a 2020 assignment), not just an empty org.

### Cutover note (opus L1) — superjson envelope
The live tRPC wire uses the `superjson` transformer (`packages/api/src/trpc.ts`), so the CURRENT
`getUsage`/`getCurrentPlan` HTTP responses are superjson-enveloped (`{json, meta}`, Dates carried in `meta`).
The C# surface is plain-JSON REST (ISO `…fffZ` date strings). This is a deliberate cutover consideration, NOT
a slice bug: the migration end-state puts the frontend on the **generated OpenAPI client** consuming the C#
REST shape directly — the superjson tRPC client is NOT pointed at the C# routes. The cross-stack golden
anti-drift is on the transformer-independent PURE kernels (entitledPlan/planLimits/buildUsageView/
isBillingConfigured), which is exactly where drift would hide. Applies to the whole billing (and
external-vendor) REST surface; confirm at cutover the FE consumes the REST shape (already the plan).

## Local gate
From `services/Tims.Platform`: build `-c Release` 0-warn · `dotnet format --verify-no-changes` · unit +
integration (Docker). Root: `node scripts/table-ownership.mjs`. TS (shared goldens + router refactor):
`prisma generate` → `@tims/api tsc` → `apps/web tsc` → `vitest run`.
