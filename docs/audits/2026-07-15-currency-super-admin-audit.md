# 2026-07-15 Currency Foundation + Super Admin Audit

## Scope

This pass covered two things:

1. Money handling: stop treating COP/USD/etc. as interchangeable and establish a shared currency/FX foundation.
2. First role audit: `super_admin` navigation, route gating, and the high-risk money/recruitment settings surfaces.

## Currency Foundation

Implemented in this branch:

- Shared ISO currency utilities in `@tims/shared`.
- API FX adapter in `packages/api/src/lib/currency.ts`.
  - Default provider: Frankfurter public FX API.
  - Same-currency conversion is local and never calls the network.
  - Mixed-currency sums normalize into the requested display currency and return conversion metadata.
  - Provider failure fails closed instead of showing mathematically wrong money.
- Frontend `formatCurrency(value, currency)` now respects the actual currency, including zero-decimal currencies.
- Currency pickers now use runtime-supported currency codes instead of hard-coded USD/COP/EUR/MXN.
- Compensation, DEI pay equity, invoice, platform dashboard, churn-risk, offer KPI, vacancy, and billing UI paths now carry or display currency explicitly.
- `SalaryAdjustment.currency` added and approval writes both salary and currency to `EmployeeCompensation`.
- Migration backfills existing salary adjustments from the current employee compensation currency where possible.

Tests added/updated:

- `tests/currency/currency.test.ts`
- DEI mixed-currency pay-equity regression in `tests/dei/dei-service.test.ts`
- Existing k-anonymity/compensation tests updated to model currency deterministically.

## Super Admin Audit

Checks run:

- `pnpm --filter @tims/api exec tsc --noEmit`
- `apps/web`: `npx tsc --noEmit`
- `npx vitest run` -> 199 files, 1815 tests
- `apps/web`: `npx next build` -> success; Next/ESLint still prints the known circular-config warning, but build exits 0.
- Static cross-check of:
  - `apps/web/lib/nav/manifest.ts`
  - `apps/web/lib/nav/routes.ts`
  - `packages/db/prisma/seed-access-matrix.ts`
  - `packages/api/src/routers/fit-engine.ts`
  - `docs/ROLE-ACCESS-AND-NAVIGATION-AUDIT.md`
  - `docs/REMAINING-WORK.md`

Findings:

1. Fixed: `/settings/fit-weights` existed but was not in `PATH_MODULE`.
   - Before: route guard treated it as unmapped/allowed-by-URL.
   - After: mapped to `fit_engine`.
   - Locked by `tests/nav/routes.test.ts`.

2. Fixed: super_admin/base admin sidebar did not surface the FIT weights settings page.
   - After: base admin settings includes `/settings/fit-weights`.
   - Locked by `tests/nav/manifest.test.ts` and i18n parity.

3. Confirmed: super_admin has org-scoped `fit_engine` grants in the seed matrix.
   - Router procedures use `permissionProcedure('fit_engine', ...)`.
   - The settings page calls `fitEngine.listRoleFamilyWeightProfiles` and `fitEngine.upsertRoleFamilyWeightProfile`.

4. Confirmed stale doc: `docs/ROLE-ACCESS-AND-NAVIGATION-AUDIT.md` still says super_admin lands on a recruitment-framed dashboard and lacks several org-admin links.
   - Current code lands super_admin on the org command center via `pick-dashboard.ts`.
   - Current base admin nav has business units, branding, FIT weights, billing, and integrations.
   - Still not in org sidebar: org audit log and org feature flags. Platform-owner-only pages exist under `/platform/*`; this is a product decision, not a runtime failure.

## Remaining Doc-vs-Code Gaps

From `docs/REMAINING-WORK.md` and the Architecture annexes, the main gaps that still matter after this pass are:

- Daily key replacement: human video interviews still depend on a valid `DAILY_API_KEY`.
- Stripe production go-live: billing code exists, production Stripe keys/webhook/portal still need owner action.
- Assessment Player: candidate take-flow, internal scoring engine, norm/band tables, and proctoring remain unbuilt.
- HRIS connectors and bi-directional sync remain unbuilt.
- Export pipeline remains stubbed for audit/candidate-pool/DEI CSVs.
- Advanced audit retention/purge automation is still deferred.
- DEI full phase items remain partial: fairness audit, inclusive-language org scan, goal tracker, compliance report generation, intersectional analysis.
- Workers/background jobs remain essentially absent; scheduled/batch jobs are still in-process or deferred.
- Known honest-unavailable panels remain intentionally labeled `N/D`/empty where backing telemetry or ML services do not exist.

## Next Audit Queue

Recommended sequence:

1. Finish currency foundation PR and deploy.
2. Live-smoke super_admin in prod after deployment, focused on:
   - compensation page
   - DEI pay equity
   - vacancy detail FIT ranking
   - settings/FIT weights
   - platform invoices/org billing
3. Then repeat the profile audit for `hr_admin`, `hrbp`, `recruiter`, `leader`, `committee`, and `employee`.

