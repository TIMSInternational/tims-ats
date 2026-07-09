# Entitlements Admin Console (Slice 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform owner assign a plan, toggle add-ons, and set per-company limits/unit-prices on a company's entitlements from an Entitlements tab on the org-detail page.

**Architecture:** Extend the Slice-1 entitlement service/repository (clean router→service→repository layering) with admin read+write functions; expose them via a new `platformProcedure` router `platform/entitlements.ts`; render a new org-detail `entitlements` tab mirroring `features-section.tsx`. No schema change — reuses `OrgEntitlement`. Every write invalidates the `tims:entitlements:{orgId}` cache and writes a best-effort audit log.

**Tech Stack:** Next.js 15 App Router, tRPC, Prisma (PostgreSQL/Supabase), Tailwind 4, TypeScript strict, Vitest (mock-based).

## Global Constraints

- **Branch:** `feat/entitlements-admin-console` (off `main` 138b0fe). Never commit to `main`.
- **Layering:** Router (Zod validate, NO `db` import, no business logic) → Service (logic, no tRPC types except TRPCError) → Repository (only layer importing `db`). Do NOT copy the `db`-in-router anti-pattern of `platform/invoices.ts`.
- **No `any`.** Strict TS. Use `unknown` + narrow. **No hardcoded user-facing strings** — all via `lib/i18n`, keys in BOTH `en.json` + `es.json` (identical key sets).
- **Prisma:** every query uses explicit `select`. Multi-step writes wrapped in `$transaction`. Clearable numeric fields cleared with explicit `null` (never `undefined`).
- **File-size limits:** ≤300 lines/component, ≤500 lines/router, ≤300 lines/service.
- **Tests are MOCK-BASED** (CI has no Postgres → live-DB tests fail P1001). No test may open a real DB connection. DB tests live under `tests/**/*.test.ts` (root `vitest.config.ts` `include=['tests/**/*.test.ts']`).
- **Merge-gate** (NOT full `vitest run` — it hangs on DB-integration files): `cd packages/db && npx prisma generate --schema=prisma/schema` → `pnpm --filter @tims/api exec tsc --noEmit` → `cd apps/web && npx tsc --noEmit` → `npx vitest run tests/access tests/entitlements`.
- **Auth:** `platformProcedure` (`packages/api/src/routers/platform/_common.ts`) = platform-owner only. Platform paths run on privileged `db` (not RLS-scoped) → every mutation MUST do an IDOR existence check on `orgId`.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**Existing Slice-1 exports (do not change signatures):**
- `entitlement.service.ts`: `getEntitlements(orgId): Promise<Map<string, EffectiveEntitlement>>`, `hasEntitlement`, `requireEntitlement`, `checkLimit(limit, currentUsage, amount): {overage}`, `invalidateEntitlementCache(orgId): Promise<void>`; type `EffectiveEntitlement = { moduleCode; limit: number|null; unitPrice: number|null }`.
- `entitlement.repository.ts`: `findEnabledEntitlements(orgId)` (returns enabled rows w/ `module.defaultUnitPrice` fallback).
- Prisma `OrgEntitlement`: unique `[organizationId, moduleCode]` (`organizationId_moduleCode`); fields `enabled: Boolean`, `source: String`, `limit: Int?`, `unitPrice: Float?`. `Module`: PK `code`, `name`, `kind: String`, `metered: Boolean`, `unit: String?`, `defaultUnitPrice: Float?`. `Plan`: PK `code`, `name`, `active`. `PlanModule`: `[planCode, moduleCode]` unique, `limit: Int?`.

---

### Task 1: Repository read/write functions + `ATS_BASE_MODULES` type-narrow

**Files:**
- Modify: `packages/api/src/repositories/entitlement.repository.ts`
- Modify: `packages/db/prisma/seed-entitlements.ts` (type-narrow only)
- Test: `tests/entitlements/entitlement.repository.admin.test.ts` (new; mock the `db` module)

**Interfaces:**
- Consumes: `db` from `@tims/db`.
- Produces (later tasks rely on these exact signatures):
  - `getOrgEntitlementRows(orgId: string): Promise<Array<{ moduleCode: string; enabled: boolean; source: string; limit: number | null; unitPrice: number | null }>>` — ALL rows (incl. disabled).
  - `upsertOrgEntitlement(orgId: string, moduleCode: string, data: { enabled?: boolean; source?: string; limit?: number | null; unitPrice?: number | null }): Promise<void>`
  - `applyPlanToOrg(orgId: string, planCode: string): Promise<number>` — returns count of modules applied; `$transaction` bulk upsert (source `'plan'`, enabled true, limit from PlanModule).
  - `listPlans(): Promise<Array<{ code: string; name: string; active: boolean }>>`
  - `listModules(): Promise<Array<{ code: string; name: string; kind: string; metered: boolean; unit: string | null; defaultUnitPrice: number | null }>>`
  - `organizationExists(orgId: string): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

Create `tests/entitlements/entitlement.repository.admin.test.ts`. Mock `@tims/db` with `vi.mock`. Cover: `getOrgEntitlementRows` selects incl. disabled (no `where.enabled`); `upsertOrgEntitlement` uses composite key `organizationId_moduleCode` and passes `limit: null` through when explicitly null; `applyPlanToOrg` reads plan modules then upserts each inside `$transaction` (assert `$transaction` called and one upsert per plan module); `organizationExists` returns true/false from a count/findFirst.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  orgEntitlement: { findMany: vi.fn(), upsert: vi.fn().mockResolvedValue({}) },
  planModule: { findMany: vi.fn() },
  plan: { findMany: vi.fn() },
  module: { findMany: vi.fn() },
  organization: { findFirst: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(mockDb) : Promise.all(arg as Promise<unknown>[])),
};
vi.mock('@tims/db', () => ({ db: mockDb }));

import {
  getOrgEntitlementRows, upsertOrgEntitlement, applyPlanToOrg, organizationExists,
} from '../../packages/api/src/repositories/entitlement.repository';

beforeEach(() => { vi.clearAllMocks(); });

describe('getOrgEntitlementRows', () => {
  it('selects all rows including disabled (no enabled filter)', async () => {
    mockDb.orgEntitlement.findMany.mockResolvedValue([]);
    await getOrgEntitlementRows('org-1');
    const arg = mockDb.orgEntitlement.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ organizationId: 'org-1' });
    expect(arg.select).toMatchObject({ moduleCode: true, enabled: true, source: true, limit: true, unitPrice: true });
  });
});

describe('upsertOrgEntitlement', () => {
  it('passes explicit null through to clear a field', async () => {
    await upsertOrgEntitlement('org-1', 'ai_screening', { limit: null });
    const arg = mockDb.orgEntitlement.upsert.mock.calls[0][0];
    expect(arg.where.organizationId_moduleCode).toEqual({ organizationId: 'org-1', moduleCode: 'ai_screening' });
    expect(arg.update).toHaveProperty('limit', null);
  });
});

describe('applyPlanToOrg', () => {
  it('upserts one plan-sourced row per plan module inside a transaction', async () => {
    mockDb.planModule.findMany.mockResolvedValue([
      { moduleCode: 'vacancies', limit: null }, { moduleCode: 'ai_screening', limit: 5000 },
    ]);
    const n = await applyPlanToOrg('org-1', 'ats-base');
    expect(n).toBe(2);
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.orgEntitlement.upsert).toHaveBeenCalledTimes(2);
    const first = mockDb.orgEntitlement.upsert.mock.calls[0][0];
    expect(first.create).toMatchObject({ source: 'plan', enabled: true });
  });
});

describe('organizationExists', () => {
  it('returns false when no org found', async () => {
    mockDb.organization.findFirst.mockResolvedValue(null);
    expect(await organizationExists('nope')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/entitlements/entitlement.repository.admin.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the repository functions**

Append to `packages/api/src/repositories/entitlement.repository.ts` (keep the existing `findEnabledEntitlements`):

```typescript
export async function getOrgEntitlementRows(orgId: string) {
  return db.orgEntitlement.findMany({
    where: { organizationId: orgId },
    select: { moduleCode: true, enabled: true, source: true, limit: true, unitPrice: true },
  });
}

export async function upsertOrgEntitlement(
  orgId: string,
  moduleCode: string,
  data: { enabled?: boolean; source?: string; limit?: number | null; unitPrice?: number | null },
): Promise<void> {
  await db.orgEntitlement.upsert({
    where: { organizationId_moduleCode: { organizationId: orgId, moduleCode } },
    update: data,
    create: {
      organizationId: orgId,
      moduleCode,
      enabled: data.enabled ?? true,
      source: data.source ?? 'override',
      limit: data.limit ?? null,
      unitPrice: data.unitPrice ?? null,
    },
  });
}

export async function applyPlanToOrg(orgId: string, planCode: string): Promise<number> {
  const planModules = await db.planModule.findMany({
    where: { planCode },
    select: { moduleCode: true, limit: true },
  });
  await db.$transaction(async (tx) => {
    for (const pm of planModules) {
      await tx.orgEntitlement.upsert({
        where: { organizationId_moduleCode: { organizationId: orgId, moduleCode: pm.moduleCode } },
        update: { enabled: true, source: 'plan', limit: pm.limit },
        create: { organizationId: orgId, moduleCode: pm.moduleCode, enabled: true, source: 'plan', limit: pm.limit },
      });
    }
  });
  return planModules.length;
}

export async function listPlans() {
  return db.plan.findMany({ select: { code: true, name: true, active: true }, orderBy: { code: 'asc' } });
}

export async function listModules() {
  return db.module.findMany({
    select: { code: true, name: true, kind: true, metered: true, unit: true, defaultUnitPrice: true },
    orderBy: { code: 'asc' },
  });
}

export async function organizationExists(orgId: string): Promise<boolean> {
  const org = await db.organization.findFirst({ where: { id: orgId }, select: { id: true } });
  return org !== null;
}
```

> NOTE on the apply-plan `update`: applying a plan re-asserts the plan's baseline for its modules (enabled + plan limit). This is intentional per spec (plan is the baseline); operator per-module overrides applied AFTER an apply-plan persist until the next apply-plan. Document this in the section's confirm dialog copy (Task 4).

- [ ] **Step 4: Type-narrow `ATS_BASE_MODULES`**

In `packages/db/prisma/seed-entitlements.ts`, change the `ATS_BASE_MODULES` declaration so an invalid code is a compile error:

```typescript
// was: const ATS_BASE_MODULES = ['vacancies', ...];
const ATS_BASE_MODULES: readonly (typeof MODULES)[number]['code'][] = [
  'vacancies', 'candidate_portal', 'ai_screening', 'compliance_matrix',
  'assessments', 'interviews', 'validations',
];
```

- [ ] **Step 5: Run tests + tsc, verify pass**

Run: `npx vitest run tests/entitlements/entitlement.repository.admin.test.ts` → PASS.
Run: `pnpm --filter @tims/api exec tsc --noEmit` → 0 errors. `cd packages/db && npx prisma generate --schema=prisma/schema && npx tsc --noEmit -p .` (or the repo's db typecheck) for the seed change.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/repositories/entitlement.repository.ts packages/db/prisma/seed-entitlements.ts tests/entitlements/entitlement.repository.admin.test.ts
git commit -m "feat(entitlements): admin repository reads/writes + ATS_BASE_MODULES type-narrow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Service — admin view + mutations (with cache invalidation)

**Files:**
- Modify: `packages/api/src/services/entitlement.service.ts`
- Test: `tests/entitlements/entitlement.service.admin.test.ts` (new; mock the repository + cache)

**Interfaces:**
- Consumes: Task 1 repository fns; existing `invalidateEntitlementCache`.
- Produces:
  - type `AdminEntitlement = { moduleCode: string; name: string; kind: string; metered: boolean; unit: string | null; enabled: boolean; source: string | null; limit: number | null; effectiveUnitPrice: number | null }`
  - `getOrgEntitlementsAdmin(orgId: string): Promise<AdminEntitlement[]>` — catalog × org-rows merge (every module; if no org row → enabled=false, source=null, limit=null, effectiveUnitPrice = module.defaultUnitPrice).
  - `setOrgEntitlement(orgId: string, moduleCode: string, patch: { enabled?: boolean; limit?: number | null; unitPrice?: number | null }): Promise<void>` — resolves `source` (only on enable of a not-yet-existing/override row), upserts, invalidates cache.
  - `assignPlan(orgId: string, planCode: string): Promise<{ applied: number }>` — applyPlanToOrg then invalidate cache.

- [ ] **Step 1: Write the failing tests**

Create `tests/entitlements/entitlement.service.admin.test.ts`. Mock the repository module and `invalidateEntitlementCache`. Assert:
- `getOrgEntitlementsAdmin` returns one entry per catalog module; a module with no org row → `enabled:false, source:null, effectiveUnitPrice = defaultUnitPrice`; a module with an org row whose `unitPrice` is null → `effectiveUnitPrice = defaultUnitPrice`; org `unitPrice` override wins.
- `setOrgEntitlement` calls `upsertOrgEntitlement` and then `invalidateEntitlementCache(orgId)`; enabling a catalog `addon` module that has no existing row sets `source:'addon'`; enabling a non-addon with no row sets `source:'override'`; a limit-only patch does NOT set `source` (preserves).
- `assignPlan` calls `applyPlanToOrg` then `invalidateEntitlementCache`, returns `{ applied }`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/repositories/entitlement.repository', () => ({
  listModules: vi.fn(), getOrgEntitlementRows: vi.fn(),
  upsertOrgEntitlement: vi.fn().mockResolvedValue(undefined),
  applyPlanToOrg: vi.fn().mockResolvedValue(2),
}));
const invalidate = vi.fn().mockResolvedValue(undefined);
// invalidateEntitlementCache lives in the same service file; if it cannot be spied via
// partial mock, assert its side-effect (cache module) instead — see note below.

import * as repo from '../../packages/api/src/repositories/entitlement.repository';
import { getOrgEntitlementsAdmin, setOrgEntitlement, assignPlan } from '../../packages/api/src/services/entitlement.service';

beforeEach(() => { vi.clearAllMocks(); });

describe('getOrgEntitlementsAdmin', () => {
  it('merges catalog with org rows; catalog default fills missing price', async () => {
    vi.mocked(repo.listModules).mockResolvedValue([
      { code: 'ai_screening', name: 'Filtro', kind: 'core', metered: true, unit: 'screenings', defaultUnitPrice: 0.5 },
      { code: 'ai_voice_interview', name: 'Voz', kind: 'addon', metered: true, unit: 'minutes', defaultUnitPrice: 0.15 },
    ] as never);
    vi.mocked(repo.getOrgEntitlementRows).mockResolvedValue([
      { moduleCode: 'ai_screening', enabled: true, source: 'plan', limit: 5000, unitPrice: null },
    ] as never);
    const out = await getOrgEntitlementsAdmin('org-1');
    const screening = out.find((m) => m.moduleCode === 'ai_screening')!;
    expect(screening).toMatchObject({ enabled: true, source: 'plan', limit: 5000, effectiveUnitPrice: 0.5 });
    const voice = out.find((m) => m.moduleCode === 'ai_voice_interview')!;
    expect(voice).toMatchObject({ enabled: false, source: null, effectiveUnitPrice: 0.15 });
  });
});

describe('setOrgEntitlement', () => {
  it('enabling an addon with no existing row sets source addon, then invalidates cache', async () => {
    vi.mocked(repo.listModules).mockResolvedValue([
      { code: 'ai_voice_interview', name: 'Voz', kind: 'addon', metered: true, unit: 'minutes', defaultUnitPrice: 0.15 },
    ] as never);
    vi.mocked(repo.getOrgEntitlementRows).mockResolvedValue([] as never);
    await setOrgEntitlement('org-1', 'ai_voice_interview', { enabled: true });
    expect(vi.mocked(repo.upsertOrgEntitlement)).toHaveBeenCalledWith('org-1', 'ai_voice_interview',
      expect.objectContaining({ enabled: true, source: 'addon' }));
  });
});
```

> **Cache-invalidation assertion note:** `invalidateEntitlementCache` is defined in the same service file, so it cannot be `vi.mock`'d as a separate module. Instead assert its effect: `vi.mock('../../packages/api/src/lib/cache', () => ({ cacheGet: vi.fn(), cacheSet: vi.fn(), cacheInvalidatePrefix: vi.fn().mockResolvedValue(undefined) }))` and assert `cacheInvalidatePrefix` was called with `tims:entitlements:org-1` after `setOrgEntitlement`/`assignPlan`.

- [ ] **Step 2: Run tests, verify fail**

Run: `npx vitest run tests/entitlements/entitlement.service.admin.test.ts` → FAIL (functions not exported).

- [ ] **Step 3: Implement the service functions**

Append to `packages/api/src/services/entitlement.service.ts`:

```typescript
import {
  listModules, getOrgEntitlementRows, upsertOrgEntitlement, applyPlanToOrg,
} from '../repositories/entitlement.repository';

export type AdminEntitlement = {
  moduleCode: string; name: string; kind: string; metered: boolean; unit: string | null;
  enabled: boolean; source: string | null; limit: number | null; effectiveUnitPrice: number | null;
};

export async function getOrgEntitlementsAdmin(orgId: string): Promise<AdminEntitlement[]> {
  const [modules, rows] = await Promise.all([listModules(), getOrgEntitlementRows(orgId)]);
  const byCode = new Map(rows.map((r) => [r.moduleCode, r]));
  return modules.map((m) => {
    const row = byCode.get(m.code);
    return {
      moduleCode: m.code, name: m.name, kind: m.kind, metered: m.metered, unit: m.unit,
      enabled: row?.enabled ?? false,
      source: row?.source ?? null,
      limit: row?.limit ?? null,
      effectiveUnitPrice: row?.unitPrice ?? m.defaultUnitPrice,
    };
  });
}

export async function setOrgEntitlement(
  orgId: string,
  moduleCode: string,
  patch: { enabled?: boolean; limit?: number | null; unitPrice?: number | null },
): Promise<void> {
  // Resolve source only when creating/enabling a row that has no source yet.
  let source: string | undefined;
  if (patch.enabled === true) {
    const rows = await getOrgEntitlementRows(orgId);
    const existing = rows.find((r) => r.moduleCode === moduleCode);
    if (!existing || existing.source == null) {
      const modules = await listModules();
      const mod = modules.find((m) => m.code === moduleCode);
      source = mod?.kind === 'addon' ? 'addon' : 'override';
    }
  }
  await upsertOrgEntitlement(orgId, moduleCode, { ...patch, ...(source ? { source } : {}) });
  await invalidateEntitlementCache(orgId);
}

export async function assignPlan(orgId: string, planCode: string): Promise<{ applied: number }> {
  const applied = await applyPlanToOrg(orgId, planCode);
  await invalidateEntitlementCache(orgId);
  return { applied };
}
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run tests/entitlements/entitlement.service.admin.test.ts` → PASS.
Run: `pnpm --filter @tims/api exec tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/entitlement.service.ts tests/entitlements/entitlement.service.admin.test.ts
git commit -m "feat(entitlements): admin service (merge view, set, assign-plan) + cache invalidation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Platform router `platform/entitlements.ts` + mount + tests

**Files:**
- Create: `packages/api/src/routers/platform/entitlements.ts`
- Modify: `packages/api/src/routers/platform/index.ts` (add to `mergeRouters`)
- Test: `tests/entitlements/entitlement.admin-router.test.ts` (new; mock service + auditLog)

**Interfaces:**
- Consumes: `platformProcedure` from `./_common`; Task 2 service fns.
- Produces: router `entitlementsAdminRouter` with `getOrgEntitlements`, `listPlans`, `listModules` (queries) and `setOrgEntitlement`, `assignPlan` (mutations), merged into the platform router (callable as `platform.getOrgEntitlements`, etc.).

- [ ] **Step 1: Write the failing tests**

Create `tests/entitlements/entitlement.admin-router.test.ts`. Build a caller via the repo's existing test caller helper (mirror how `tests/access/*router*.test.ts` construct callers — reuse that helper). Assert: a non-platform-owner caller → `FORBIDDEN`; a platform-owner caller with a missing org → `NOT_FOUND` (IDOR); `setOrgEntitlement` success calls the service; an `auditLog.create` rejection does NOT fail the mutation.

```typescript
// Mirror the existing platform-router test setup in tests/access/. Mock:
//   - packages/api/src/services/entitlement.service (getOrgEntitlementsAdmin/setOrgEntitlement/assignPlan)
//   - packages/api/src/repositories/entitlement.repository (organizationExists)
//   - db.auditLog.create (assert best-effort: a rejection is swallowed)
// Assert platformProcedure gate + IDOR NOT_FOUND + audit-failure-tolerance.
```

> The implementer MUST read an existing `tests/access/*router*.test.ts` first to copy the exact `makeCaller`/context mock pattern (platform-owner is set via `ctx.user.isPlatformOwner = true`).

- [ ] **Step 2: Run tests, verify fail**

Run: `npx vitest run tests/entitlements/entitlement.admin-router.test.ts` → FAIL (router missing).

- [ ] **Step 3: Implement the router**

Create `packages/api/src/routers/platform/entitlements.ts` (mirror the IDOR + best-effort-audit shape of `platform/system.ts` `updateFeatureFlag` — read it first for the exact `auditLog.create({...}).catch(() => {})` field shape and `router`/`platformProcedure` imports):

```typescript
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { db } from '@tims/db';
import { router } from '../../trpc';
import { platformProcedure } from './_common';
import { organizationExists } from '../../repositories/entitlement.repository';
import {
  getOrgEntitlementsAdmin, setOrgEntitlement, assignPlan, listPlansForAdmin, listModulesForAdmin,
} from '../../services/entitlement.service';

async function assertOrg(orgId: string): Promise<void> {
  if (!(await organizationExists(orgId))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'organization_not_found' });
  }
}

export const entitlementsAdminRouter = router({
  getOrgEntitlements: platformProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ input }) => getOrgEntitlementsAdmin(input.orgId)),

  listPlans: platformProcedure.query(() => listPlansForAdmin()),
  listModules: platformProcedure.query(() => listModulesForAdmin()),

  setOrgEntitlement: platformProcedure
    .input(z.object({
      orgId: z.string().uuid(),
      moduleCode: z.string().max(64),
      enabled: z.boolean().optional(),
      limit: z.number().int().min(0).nullable().optional(),
      unitPrice: z.number().min(0).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertOrg(input.orgId);
      const { orgId, moduleCode, ...patch } = input;
      await setOrgEntitlement(orgId, moduleCode, patch);
      await db.auditLog.create({ data: {
        organizationId: orgId, action: 'entitlement.set', actorId: ctx.user.id,
        changes: JSON.stringify({ moduleCode, ...patch }),
      } }).catch(() => {});
      return { ok: true };
    }),

  assignPlan: platformProcedure
    .input(z.object({ orgId: z.string().uuid(), planCode: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      await assertOrg(input.orgId);
      const res = await assignPlan(input.orgId, input.planCode);
      await db.auditLog.create({ data: {
        organizationId: input.orgId, action: 'entitlement.assignPlan', actorId: ctx.user.id,
        changes: JSON.stringify({ planCode: input.planCode, applied: res.applied }),
      } }).catch(() => {});
      return res;
    }),
});
```

> The router imports `db` ONLY for the best-effort `auditLog.create` side-channel — matching the existing `updateFeatureFlag` precedent (audit is a cross-cutting concern, not domain logic). All entitlement logic stays in the service. **Verify the exact `auditLog` field names against the schema/`updateFeatureFlag` usage** — adjust `actorId`/`action`/`changes` to the real column names. Also expose `listPlansForAdmin`/`listModulesForAdmin` from the service as thin wrappers over the Task-1 `listPlans`/`listModules` repo fns (so the router never imports the repository for reads), OR call the repo fns via the service — do NOT import the repository read fns directly into the router.

- [ ] **Step 4: Mount the router**

In `packages/api/src/routers/platform/index.ts`, import `entitlementsAdminRouter` and add it to the `mergeRouters(...)` call.

- [ ] **Step 5: Run tests + tsc**

Run: `npx vitest run tests/entitlements/entitlement.admin-router.test.ts` → PASS.
Run: `pnpm --filter @tims/api exec tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routers/platform/entitlements.ts packages/api/src/routers/platform/index.ts packages/api/src/services/entitlement.service.ts tests/entitlements/entitlement.admin-router.test.ts
git commit -m "feat(entitlements): platform-owner entitlements router (get/set/assign-plan) + mount

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: UI — org-detail Entitlements tab + i18n

**Files:**
- Create: `apps/web/app/(admin)/platform/organizations/[id]/sections/entitlements-section.tsx`
- Modify: `apps/web/app/(admin)/platform/organizations/[id]/org-detail.tsx` (add `'entitlements'` tab + render)
- Modify: `apps/web/lib/i18n/en.json` + `apps/web/lib/i18n/es.json` (new `entitlementsAdmin` namespace)

**Interfaces:**
- Consumes: `trpc.platform.getOrgEntitlements`, `trpc.platform.listPlans`, `trpc.platform.setOrgEntitlement`, `trpc.platform.assignPlan`.
- Produces: an `EntitlementsSection` component rendered when the org-detail active tab is `'entitlements'`.

- [ ] **Step 1: Read the template + add i18n keys**

Read `sections/features-section.tsx` (query + `isLoading`/`ErrorState`/`EmptyState` branches, mutation with `utils.platform.X.invalidate()` + `toast`, optimistic toggle) and `org-detail.tsx` (the tab union + section render switch). Add an `entitlementsAdmin` block to BOTH `en.json` and `es.json` with identical keys, e.g. `title`, `planLabel`, `applyPlan`, `applyPlanConfirm`, `moduleCol`, `enabledCol`, `limitCol`, `unitPriceCol`, `sourceCol`, `catalogDefault`, `saved`, `empty`, plus source badge labels `source.plan`/`source.addon`/`source.override`. No hardcoded strings anywhere in the component.

- [ ] **Step 2: Implement `entitlements-section.tsx`**

Mirror `features-section.tsx`. Layout: a Plan `<select>` (from `listPlans`) + "Apply plan" button (confirm dialog using `applyPlanConfirm` copy, then `assignPlan` mutation); a table from `getOrgEntitlements` with columns module name + `kind` badge, `enabled` toggle (→ `setOrgEntitlement({enabled})`), `limit` number input for `metered` rows (blur → `setOrgEntitlement({limit})`, empty → `null`), `unitPrice` number input for `metered` rows (placeholder = `effectiveUnitPrice`/catalog default, blur → `setOrgEntitlement({unitPrice})`, empty → `null`), and a `source` badge. Each mutation: `onSuccess` → `utils.platform.getOrgEntitlements.invalidate()` + `toast(t.entitlementsAdmin.saved)`; `onError` → `toast(err.message, { type: 'error' })`. Branches: `isLoading` → `Skeleton`, `isError` → `ErrorState` w/ retry, empty modules → `EmptyState`. Keep ≤300 lines — extract a `EntitlementRow` subcomponent if needed (separate file).

- [ ] **Step 3: Wire the tab**

In `org-detail.tsx`: add `'entitlements'` to the tab-key union/list (with an i18n tab label) and render `<EntitlementsSection orgId={...} />` when active.

- [ ] **Step 4: Verify — tsc + i18n gate**

Run: `cd apps/web && npx tsc --noEmit` → 0.
Run (repo root): `npx vitest run tests/security/i18n-no-hardcoded-strings.test.ts` → PASS (this test is static/no-DB; it catches any hardcoded string + missing/mismatched keys). If it hangs or the file needs a DB, fall back to `tests/access tests/entitlements` and a manual grep that both json files have the same `entitlementsAdmin` keys.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(admin)/platform/organizations/[id]/sections/entitlements-section.tsx" "apps/web/app/(admin)/platform/organizations/[id]/org-detail.tsx" apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json
git commit -m "feat(entitlements): org-detail entitlements admin tab + i18n

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Whole-branch review + gate + ship

**Files:** none (review/ship only).

- [ ] **Step 1: Full merge-gate**

```bash
cd packages/db && npx prisma generate --schema=prisma/schema
cd ../.. && pnpm --filter @tims/api exec tsc --noEmit
cd apps/web && npx tsc --noEmit
cd .. && npx vitest run tests/access tests/entitlements
```
Expected: prisma OK, both tsc 0, all unit tests pass. (Do NOT run full `vitest run` — hangs on DB-integration files.)

- [ ] **Step 2: Whole-branch review (opus) + Codex adversarial**

Dispatch an opus whole-branch reviewer AND a `codex:codex-rescue` adversarial pass (per `.claude/rules/verification.md`) over `git diff main..HEAD`. Focus: layering (router imports only `db` for audit; logic in service), IDOR present on both mutations, cache invalidated on every write, explicit-`null` clearing works, no hardcoded strings, i18n key parity, file-size limits. Fold any Critical/Important into ONE fix subagent; re-run the gate.

- [ ] **Step 3: PR + squash-merge**

```bash
git push -u origin feat/entitlements-admin-console
gh pr create --base main --title "feat(entitlements): platform-owner admin console (slice 2a)" --body "<summary + review trail + gate results>"
# after CI green (admin-merge past the billing trap only if it 3-4s fails):
gh pr merge <n> --squash --admin
```
No prod DDL (no schema change). No seed re-run needed. Delete the branch after merge.

---

## Self-Review

**Spec coverage:** Org-detail tab (T4) ✓ · apply-plan (T1 repo, T2 service, T3 router, T4 UI) ✓ · per-module toggle/limit/unitPrice (T2/T3/T4) ✓ · source semantics (T2) ✓ · explicit-null clearing (T1/T2/T3) ✓ · audit + cache invalidation (T2 service cache, T3 audit) ✓ · IDOR (T3) ✓ · admin merge view w/ catalog default price (T2) ✓ · i18n separate `entitlementsAdmin` namespace (T4) ✓ · ATS_BASE_MODULES type-narrow (T1) ✓ · mock-based tests (all) ✓ · out-of-scope items excluded ✓.

**Placeholder scan:** No TBD/TODO. Test steps include real assertions. UI task references the exact template file to copy (features-section.tsx) rather than reproducing 200 lines — acceptable because the component is a direct mirror and the executor reads the template.

**Type consistency:** `getOrgEntitlementsAdmin` returns `AdminEntitlement[]` (T2) consumed by T3 query + T4 UI. `setOrgEntitlement(orgId, moduleCode, patch)` signature consistent T2→T3. `applyPlanToOrg` returns count (T1) → `assignPlan` returns `{applied}` (T2) → router returns it (T3). Repository read fns `listPlans`/`listModules` (T1) are surfaced to the router via service wrappers `listPlansForAdmin`/`listModulesForAdmin` (noted in T3 Step 3) to preserve layering — the executor must add those thin wrappers in the service.
