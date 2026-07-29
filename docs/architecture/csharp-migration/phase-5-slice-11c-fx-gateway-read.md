# Phase 5 Slice 11c — FX GATEWAY + the deferred FX reads → C# (strangler, dark)

**Flag:** `Platform:FxReadsEnabled` (default false) · covers BOTH `dei.getPayEquity` (people-dashboards) AND compensation **Slice-9b** (5 FX reads: getBandDistribution/getPayEquity/simulateAdjustment/getTotalCompBreakdown/getDashboardKpis). One gateway, two consumers.
**FEDERICO DECISION MADE (2026-07-22): DB-pinned rates + daily Quartz refresh.** Build against that.
**Depends on:** compensation FX-free (#162) + DEI (11b) merged. Branch off main after 11b.

**UPDATE 2026-07-28: FX PROVIDER SWAPPED.** Frankfurter's fixed ~30-currency ECB list does not
include COP or CRC — the actual currencies this platform's real customer orgs use — discovered via
the first-ever live COP/CRC API call (the `FxSeedOnce` tool's integration test). Replaced with
ExchangeRate-API's open/free tier (still keyless, still free) — see
`docs/architecture/csharp-migration/fx-provider-swap-2026-07-28.md`. Every mention of
"frankfurter"/"ECB" below is historical (describes what shipped originally, not the current
provider); the table/job/gateway design itself is unaffected.

## The gateway (net-new external-integration pattern — 3rd after BambooHR/Stripe)

### 1. `fx_rates` table — efcore-OWNED (first efcore-owned table since HRIS), GLOBAL (org-agnostic — FX is not tenant data)

- Columns: `id uuid pk`, `base_currency text`, `quote_currency text`, `rate double`, `as_of date` (ECB effective date), `fetched_at timestamptz`, `source text` (='frankfurter'). Unique `(base_currency, quote_currency, as_of)`.
- **RLS posture: EXEMPT (global catalog, like ai_agents/permissions/platform_owner_emails)** — NOT EnableTenantRls (FX rates are shared, org-agnostic; a tenant GUC would hide all rows). Register in the table-ownership ledger as `efcore` + document the RLS-exemption rationale. The refresh job + readers use the privileged/non-tenant connection for this table ONLY (like the billing-webhook privileged path), OR a dedicated read-only global context. ⚠️ Design the connection carefully: the FX read is a SUB-query of a tenant-scoped comp read — the comp rows are RLS-tenant-scoped, the fx_rates lookup is global. Two contexts: tenant CompensationReadDbContext (comp rows) + a global FxRateDbContext (fx_rates, no RLS). Compose in the use-case.
- **Ledger:** `efcore += fx_rates` (owned, migration-managed). EF migration `20260722xxxxxx_fx_rates` (EnableTenantRls NOT called; explicit GRANTs to app_tenant for SELECT).

### 2. `FxRefreshJob` — Quartz IJob (reuses the Phase-4 Workers scheduler — the anticipated "2nd recurring job")

- Daily cron (e.g. 05:00 UTC, after ECB ~16:00 CET publish). `ResilientJobRunner`-wrapped (retry/alert/OTel, DisallowConcurrentExecution).
- Fetches frankfurter (`GET https://api.frankfurter.dev/v2/latest?base=XXX` or per-pair) via a typed `HttpClient` + Polly v8 resilience (`Microsoft.Extensions.Http.Resilience` — already a dep from HRIS). `IFxRateGateway` port (fake-tested; NEVER golden-parity a live rate). Upserts `fx_rates` rows `ON CONFLICT (base,quote,as_of) DO UPDATE`. Idempotent (same as_of → no dup). Which pairs? The currencies present in employee_compensations/companies (COP/USD/CRC/… → base). Seed on first run (cold-start: if table empty, the reads fail-soft or the job runs once at boot).

### 3. `IFxRateProvider` (Application port) → reads the LATEST effective-dated pin

- `GetRateAsync(from, to, cancellationToken)` → newest `fx_rates` row for the pair (as_of desc). Cross-rate via base (frankfurter base=EUR or USD) if no direct pair. Fail-soft policy (Federico): if no pin exists (cold start / missing pair), return null → the read SUPPRESSES/omits the FX-derived field rather than 500 (define per read; matches the "availability" rationale of the DB-pin decision). Document the cold-start behavior.

## The FX-derived reads (port the deterministic shaping; FX rate is an injected input)

- **convertMoney / sumMoney** kernels → `Tims.Domain.Compensation` (roundMoney already ported Phase-1). These take `(amount, from, to, rate)` — PURE given a rate → GOLDEN-FIXTURED both stacks with FIXED rates in the fixture (deterministic). The live-rate fetch is NOT fixtured (fake-tested in the gateway).
- **dei.getPayEquity** (people-dashboards): per-gender avg/median salary + gapPct + currency; convertMoney to a display currency (companies.displayCurrency). k-anon min-5 per gender cohort (reuse). employee_compensations (restricted — FieldClassification) + employee_demographics(gender enum — reuse 11b's enum datasource) + companies.
- **compensation Slice-9b (5 reads)**: getBandDistribution / getPayEquity / simulateAdjustment / getTotalCompBreakdown / getDashboardKpis — each calls convertMoney/sumMoney over employee_compensations. Reuse the Slice-9 FieldClassification.employeeCompensation + ScopeWhereFor + k-anon already ported.

## Regression corpus (each bite-proven)

- convertMoney/sumMoney rounding (roundMoney JS EPSILON, Phase-1 fixture) with fixed rates — golden both stacks.
- k-anon min-5 on pay-equity gender cohorts (differencing guard).
- FX cold-start fail-soft (no pin → field omitted/suppressed, not 500) — integration.
- FxRefreshJob idempotent upsert (same as_of → no dup; new as_of → new row) — Testcontainers.
- fx_rates RLS-EXEMPT but SELECT-granted to app_tenant (a tenant read of a global rate works; no tenant GUC needed) — Testcontainers.
- Gateway: Polly retry on 5xx, timeout, fail-soft on frankfurter down — fake HttpMessageHandler.
- FieldClassification restricted-column authorization on comp reads (reuse Slice-9 bites).

## ⚠️ Novel-integration gate rigor (like Quartz/Stripe.net slices)

- The gateway is the ONLY frankfurter surface. Pin the frankfurter HttpClient base URL in config. No secrets (frankfurter is keyless) — but register it as a subprocessor in the SOC2 vendor register (only currency codes egress, no PII).
- 3-review + Codex; the novel bits (RLS-exempt global table, cross-context compose, cold-start fail-soft, refresh idempotency) are the Codex focus.

## 🔴 FEDERICO (prod)

- Apply the `fx_rates` EF migration DDL to prod (new efcore-owned table, RLS-exempt + app_tenant SELECT grant).
- Confirm the FxRefreshJob cron + that the Workers host runs it; seed the first rate pull.
- Register frankfurter.dev in the subprocessor/vendor register (SOC2).
- Flip `Platform:FxReadsEnabled` at canary AFTER the first refresh populates fx_rates.

## After 11c

People-dashboards + compensation read surfaces COMPLETE. Remaining strangler: any other unmigrated read routers (audit remaining) → then WRITES + the ownership flips (billing/validation) → Phase 6/7 consolidation. Migration ~78%+.
