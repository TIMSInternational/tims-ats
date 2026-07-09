# Company Entitlements — Slice 2a: Platform-Owner Admin Console

> Status: approved design | Date: 2026-07-08 | Depends on: Slice 1 (shipped, prod `138b0fe`)
> Next slices: 2a.1 tenant upsell UI (notIncluded/contactSales) · 2b usage-metering + invoicing

## Goal

Let a platform owner configure a company's entitlements from the admin UI, replacing
the current seed-only workflow (`provisionInvu`). Concretely: **assign a plan**, **toggle
add-ons**, and **set per-company limits and unit prices** on `OrgEntitlement` rows.

Slice 1 shipped the schema + resolver (`Module`/`Plan`/`PlanModule`/`OrgEntitlement`,
`getEntitlements`/`requireEntitlement`/`checkLimit`, 300s cache) and the seed comment on
`provisionInvu` explicitly names this console as the intended editor for the
"operator-tunable" per-org rows.

## Scope

**In scope (2a):**
- An **Entitlements tab** on `/platform/organizations/[id]` (mirrors the existing
  `features`/`ai`/`billing` tabs).
- **Apply a plan** to the org (bulk-applies the plan's modules as plan-sourced rows).
- **Per-module editing**: toggle `enabled`, set/clear `limit`, set/clear `unitPrice`.
- Best-effort audit logging + entitlement cache invalidation on every write.
- Folded deferred minor: type-narrow `ATS_BASE_MODULES` in `seed-entitlements.ts`.

**Out of scope (deferred):**
- Tenant-facing upsell UI wiring (`entitlements.notIncluded`/`contactSales` reading
  `entitlement.mine`) → **Slice 2a.1** (own UX decision: which tenant features are gated).
- Usage-metering + invoicing (`aiAgentUsageLog` → overage → billable line items) → **Slice 2b**.
- Catalog CRUD (creating/editing `Module`/`Plan` from the console). Catalog stays
  code-owned via `seedEntitlementCatalog`. (Would also require converting `kind`/`unit`/
  `source` `String` fields to Prisma enums — a larger change; not now.)

**No schema change.** Reuses `OrgEntitlement` (`[organizationId, moduleCode]` unique;
fields `enabled`, `source`, `limit?`, `unitPrice?`).

## Data & semantics

- **`source` provenance** (the row's origin, informational + drives the source badge):
  - **Apply-plan** upserts each `PlanModule` of the chosen plan → `enabled=true`,
    `source='plan'`, `limit=planModule.limit`, `unitPrice` left null (resolver already
    falls back to the module's catalog `defaultUnitPrice`).
  - **Manual enable** of a catalog module with `kind='addon'` → `source='addon'`.
    Manual enable of any other module → `source='override'`.
  - **Manual `limit`/`unitPrice` edit** on an existing row preserves its current `source`.
- **Apply-plan is additive** and wrapped in `$transaction`: it upserts the plan's modules
  and does NOT delete pre-existing add-on/override rows. Removing a module = admin toggles
  it off (sets `enabled=false`; the row is kept for provenance). Plan-teardown /
  full reconciliation is explicitly out of 2a scope.
- **Clearing a numeric field** (`limit`/`unitPrice`) sends explicit **`null`**, never
  `undefined` — Prisma strips `undefined` from `update`, so only `null` can clear a set
  value (documented gotcha, same as `updateAiAgentOrgConfig`). Zod: `.number().nullable()`
  for clearable fields; distinguish "field omitted (leave as-is)" from "field = null (clear)".

## API — clean layering (extend Slice-1 service/repository)

Follows the router→service→repository rule (`.claude/rules/api-security.md`), extending
`entitlement.service.ts`/`entitlement.repository.ts` — NOT the platform-router
`db`-in-router anti-pattern used by `invoices.ts`/`ai-agents.ts`.

**`packages/api/src/repositories/entitlement.repository.ts`** (only layer importing `db`):
- `getOrgEntitlementRows(orgId)` — all `OrgEntitlement` rows for the org **including
  disabled** (distinct from `findEnabledEntitlements`, which filters `enabled:true` for the
  resolver). Explicit `select`.
- `upsertOrgEntitlement(orgId, moduleCode, data)` — composite-key
  (`organizationId_moduleCode`) upsert.
- `applyPlanToOrg(orgId, planCode)` — reads the plan's `PlanModule`s, `$transaction`
  bulk-upserts plan-sourced `OrgEntitlement` rows.
- `listPlans()` / `listModules()` — catalog reads (explicit `select`).
- `organizationExists(orgId)` — for IDOR check.

**`packages/api/src/services/entitlement.service.ts`** (business logic, no tRPC types):
- `getOrgEntitlementsAdmin(orgId)` → **catalog × org-rows merge**: every catalog `Module`
  joined with the org's row (if any). Returns per module: `{ moduleCode, name, kind,
  metered, unit, enabled, source, limit, effectiveUnitPrice }` where
  `effectiveUnitPrice = row.unitPrice ?? module.defaultUnitPrice`. This is the admin view
  (shows even not-yet-enabled modules so they can be turned on).
- `setOrgEntitlement(orgId, moduleCode, { enabled?, limit?, unitPrice? })` — resolves
  `source` per the semantics above, upserts, then `invalidateEntitlementCache(orgId)`.
- `assignPlan(orgId, planCode)` — `applyPlanToOrg` then `invalidateEntitlementCache(orgId)`.
- (Existing `getEntitlements`/`hasEntitlement`/`requireEntitlement`/`checkLimit`/
  `invalidateEntitlementCache` unchanged. `EffectiveEntitlement` type unchanged.)

**`packages/api/src/routers/platform/entitlements.ts`** (all `platformProcedure`; mounted
in `platform/index.ts` via `mergeRouters`; kept under the 500-line router limit):
- Queries: `getOrgEntitlements({ orgId })`, `listPlans()`, `listModules()`.
- Mutations: `setOrgEntitlement({ orgId, moduleCode, enabled?, limit?, unitPrice? })`,
  `assignPlan({ orgId, planCode })`.
- Each mutation: **IDOR** (`organizationExists(orgId)` → `NOT_FOUND` if absent — platform
  paths run on privileged `db`, so this is the sole tenant-scoping defense), best-effort
  `auditLog.create({...}).catch(() => {})` (mirrors `updateFeatureFlag`), then the service
  call (which invalidates cache). Zod inputs bounded (`orgId`/`moduleCode`/`planCode`
  `.uuid()`/`.max()`; numeric fields `.nullable()` where clearable).

## UI — org-detail Entitlements tab

- **`apps/web/app/(admin)/platform/organizations/[id]/sections/entitlements-section.tsx`**
  (mirrors `features-section.tsx`; ≤300 lines — split a row subcomponent if needed):
  - **Plan control**: a `<select>` of `listPlans()` + an "Apply plan" button →
    `assignPlan` mutation (confirm before applying, since it's a bulk write).
  - **Module table** from `getOrgEntitlements`: columns = module name + `kind` badge,
    `enabled` toggle, `limit` input (metered modules only), `unitPrice` input (metered
    only; placeholder shows the catalog `defaultUnitPrice`), `source` badge. Inline edits
    call `setOrgEntitlement`; optimistic where safe, `utils.platform.getOrgEntitlements
    .invalidate()` + `toast` on success, `toast(err.message,{type:'error'})` on error.
    `isLoading`→`Skeleton`, `isError`→`ErrorState` with retry, empty→`EmptyState`.
- **`org-detail.tsx`**: add `'entitlements'` to the tab union + render the new section.
- **i18n**: new **`entitlementsAdmin`** namespace in BOTH `apps/web/lib/i18n/en.json` and
  `es.json` (kept in sync). Deliberately separate from the existing tenant-facing
  `entitlements` block (notIncluded/contactSales) to avoid collision. No hardcoded strings.

## Audit + cache

- Every mutation → best-effort `auditLog.create({...}).catch(() => {})` (action, orgId,
  actor, `changes` JSON) — non-blocking, per the `updateFeatureFlag` precedent.
- Every mutation → `invalidateEntitlementCache(orgId)` (inside the service) so the tenant
  resolver's `tims:entitlements:{orgId}` (300s) reflects edits immediately.

## Testing (mock-based — CI has no Postgres service; live-DB tests fail P1001)

- **Service** (`tests/entitlements/`): `setOrgEntitlement` upsert payload incl. explicit
  `null` clearing + correct `source` resolution; `assignPlan` bulk upsert shape + that
  `invalidateEntitlementCache` is called; `getOrgEntitlementsAdmin` merge (catalog module
  with no org row → disabled + catalog default price; org override wins).
- **Router** (`tests/entitlements/` or `tests/access/`): `platformProcedure` gate →
  `FORBIDDEN` for a non-platform-owner caller; IDOR → `NOT_FOUND` for a missing org;
  audit best-effort failure doesn't fail the mutation.
- **i18n**: `entitlementsAdmin` keys present + identical key set in both `en.json`/`es.json`
  (the repo's no-hardcoded-strings vitest gate covers usage).

## Folded deferred minor

- `packages/db/prisma/seed-entitlements.ts`: type-narrow `ATS_BASE_MODULES` from
  `string[]` to `readonly MODULES[number]['code'][]` so an invalid base-module code is a
  compile error.

## Build order (for the plan)

1. Repository writes + reads (`getOrgEntitlementRows`, `upsertOrgEntitlement`,
   `applyPlanToOrg`, `listPlans`, `listModules`, `organizationExists`) + `ATS_BASE_MODULES`
   type-narrow.
2. Service (`getOrgEntitlementsAdmin`, `setOrgEntitlement`, `assignPlan`) + service tests.
3. Platform router (`entitlements.ts`) + mount + router tests (gate/IDOR/audit).
4. UI (`entitlements-section.tsx` + org-detail tab wiring) + i18n keys.
5. Whole-branch review (opus) + Codex adversarial + merge-gate (prisma generate, tsc x2,
   unit-subset vitest) → PR → squash-merge. (No prod DDL — no schema change.)
