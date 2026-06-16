# Role Rebuild — Slice 0 (Substrate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the permission vocabulary and correct the live grant seed so every role's access matches the client-signed spec — the substrate every later IA slice sits on.

**Architecture:** Three code-only changes + one data re-seed. (1) Extract the grant MATRIX from the auto-executing `seed-access.ts` into a pure, importable module so grants are unit-testable. (2) Delete dead `DEFAULT_ROLE_PERMISSIONS`, then repair the `Module`/`Action` type unions to reflect reality (add 5 live modules + `publish`; drop 6 dead modules) and tighten `permissionProcedure` so typos are caught. (3) Add the 3 grant corrections (leader, recruiter, hrbp) with client-spec citations. No `.sql` migration — the new grants are `RolePermission` rows applied by running the seed with `--apply`; every needed `Permission` row already exists via super_admin.

**Tech Stack:** TypeScript (strict), tRPC, Prisma (PostgreSQL/Supabase), Vitest. Monorepo: `packages/shared` (types), `packages/api` (kernel + routers), `packages/db` (seed). Tests at repo-root `tests/access/`.

**Source of truth:** `ROLE-EXPERIENCE-REBUILD-SPEC.md` §2 (grant matrix + vocabulary repairs). Grant decisions D1–D3 locked: hrbp offers read-only, recruiter keeps delete, leader `vacancy:create@team`.

---

## Reconciliation against the LIVE seed (not the dead constant)

The kernel reads grants from the DB (`rolePermission`), seeded by `packages/db/prisma/seed-access.ts` `MATRIX`. `DEFAULT_ROLE_PERMISSIONS` in `roles.ts` is dead code (zero imports). Reconciled against the **live MATRIX**, exactly 3 roles change:

| Role | Current live grant (verbatim) | Add | Citation |
|---|---|---|---|
| **leader** | no `candidate`; `vacancy:[read,approve]@team` | `candidate:read@team` · `vacancy:create@team` | spec §2 "revisar candidatos finalistas" / "solicitar vacantes" |
| **recruiter** | `offer:[read]@org`; `vacancy:[read,create,update,delete]@org` (no publish) | `offer:create@org` · `vacancy:publish@org` | spec §2 "crear ofertas" |
| **hrbp** | `vacancy/pipeline/candidate/assessment/interview/offer:[read]@unit`; `performance:[read]@unit`; no monitoring | `vacancy:create,update@unit` · `pipeline:update@unit` · `candidate:update@unit` · `interview:create@unit` · `performance:update@unit` · `monitoring:read@unit` | spec §2 "gestionar... monitoreo estratégico" |

**hr_admin needs no change** — the live MATRIX already grants it CRUD on `ninebox`, `succession`, `engagement` (nine-box calibrate / succession edit / survey authoring all satisfied). The spec's "verify" is resolved: confirmed present.

**hrbp offer stays read-only** (D1) — it already is; we add nothing to `offer`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/db/prisma/seed-access-matrix.ts` | **NEW.** Pure data: `Scope`/`Entry`/`Triple` types, `MATRIX`, `flattenEntries`, `grantsFor`. No side effects. | Create (move from seed-access.ts) |
| `packages/db/prisma/seed-access.ts` | The seed **runner** (DB upserts, diff, apply). Auto-runs `main()`. | Import matrix from new module; add 3 grant corrections live in the matrix module |
| `packages/shared/src/types/permissions.ts` | `MODULES`/`ACTIONS` unions + `Module`/`Action`/`Permission` types | Repair unions |
| `packages/shared/src/types/roles.ts` | Role types/constants | Delete dead `DEFAULT_ROLE_PERMISSIONS` (lines 129–208) |
| `packages/api/src/trpc.ts` | tRPC init; `permissionProcedure` factory | Type its `module`/`action` params |
| `tests/access/seed-matrix.test.ts` | **NEW.** Pins the grant matrix content (baseline + corrections) | Create |
| `tests/access/permission-vocabulary.test.ts` | **NEW.** Pins the union content + no-drift invariant | Create |

---

## Task 1: Extract the grant matrix into a pure, importable module

**Files:**
- Create: `packages/db/prisma/seed-access-matrix.ts`
- Modify: `packages/db/prisma/seed-access.ts:24-34,53-157`
- Test: `tests/access/seed-matrix.test.ts`

- [ ] **Step 1: Write the failing characterization test**

Create `tests/access/seed-matrix.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { grantsFor } from '../../packages/db/prisma/seed-access-matrix';

const has = (role: string, module: string, action: string, scope: string) =>
  grantsFor(role).some((g) => g.module === module && g.action === action && g.scope === scope);

describe('seed grant matrix (baseline, pre-corrections)', () => {
  it('committee scorecards + calibration are present', () => {
    expect(has('committee', 'interview', 'read', 'team')).toBe(true);
    expect(has('committee', 'ninebox', 'update', 'team')).toBe(true);
  });
  it('importing the matrix runs no seed (no PrismaClient side effect)', () => {
    expect(typeof grantsFor).toBe('function'); // import resolved without executing main()
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/access/seed-matrix.test.ts`
Expected: FAIL — `Cannot find module '.../seed-access-matrix'`.

- [ ] **Step 3: Create the pure matrix module**

Create `packages/db/prisma/seed-access-matrix.ts` by moving the types + MATRIX + flatten out of `seed-access.ts` (verbatim), plus a new `grantsFor` helper. No `@prisma/client` import — this file must stay side-effect-free:
```typescript
/**
 * packages/db/prisma/seed-access-matrix.ts
 *
 * PURE DATA — the single source of truth for every role's grants.
 * No side effects (no PrismaClient, no main()). Imported by the seed runner
 * (seed-access.ts) AND by tests. Keep Scope in sync with SCOPE_LADDER in
 * packages/api/src/access/types.ts.
 */
export type Scope = 'own' | 'team' | 'unit' | 'company' | 'organization';
export type Entry = { module: string; actions: string[]; scope: Scope };
export type Triple = { module: string; action: string; scope: Scope };

export const MATRIX: Record<string, Entry[]> = {
  // ... move the ENTIRE existing MATRIX object verbatim from seed-access.ts
  //     (super_admin … candidate), unchanged. Corrections come in Task 5.
};

export function flattenEntries(entries: Entry[]): Triple[] {
  return entries.flatMap((e) =>
    e.actions.map((action) => ({ module: e.module, action, scope: e.scope })),
  );
}

/** All { module, action, scope } triples granted to a role slug. */
export function grantsFor(role: string): Triple[] {
  return flattenEntries(MATRIX[role] ?? []);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/access/seed-matrix.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Update the seed runner to import from the new module**

In `packages/db/prisma/seed-access.ts`: delete the now-moved `type Scope`/`Entry`/`Triple` (lines 33–34, 151), the `MATRIX` object (lines ~61–146), and `flattenEntries` (lines 153–157). Add at the top (after the `PrismaClient` import):
```typescript
import { MATRIX, flattenEntries, type Scope, type Triple } from './seed-access-matrix';
```
Leave `SYSTEM_ROLES` and all runner logic (`buildPermissionMap`, the org loop, diff, `--apply`, `main()`) exactly as-is — they now consume the imported `MATRIX`/`flattenEntries`.

- [ ] **Step 6: Verify the runner still type-checks and the full suite is green**

Run: `pnpm --filter @tims/db exec tsc --noEmit`
Expected: 0 errors.
Run: `npx vitest run tests/access`
Expected: all existing access tests PASS (unchanged behavior).

- [ ] **Step 7: Verify the seed dry-run still works (no behavior change)**

Run: `pnpm --filter @tims/db exec tsx prisma/seed-access.ts`
Expected: dry-run prints planned creates/updates/deletes and exits 0 (no `--apply`, DB untouched). Output identical to before the refactor.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/seed-access-matrix.ts packages/db/prisma/seed-access.ts tests/access/seed-matrix.test.ts
git commit -m "refactor(db): extract grant matrix into pure importable seed-access-matrix module"
```

---

## Task 2: Delete the dead `DEFAULT_ROLE_PERMISSIONS` constant

A pure removal of unreferenced code — done first because it is the only thing referencing the 6 dead module literals (`coaching`, `evaluation`, `commitment`, `talent`, `team`, `lnd`) via the `Module` type; Task 3 removes those literals from the union and would fail `tsc` if this constant still existed.

**Files:**
- Modify: `packages/shared/src/types/roles.ts:129-208`

- [ ] **Step 1: Confirm it is truly dead**

Run: `grep -rn "DEFAULT_ROLE_PERMISSIONS" --include=*.ts packages apps tests`
Expected: exactly ONE hit — the definition at `packages/shared/src/types/roles.ts:129`. If any other file references it, STOP and reassess (it is not dead).

- [ ] **Step 2: Delete the constant**

In `packages/shared/src/types/roles.ts`, delete the entire `export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, ...> = { ... };` block (lines 129–208). Then check the file's imports: if `Module`, `Action`, or `Scope` were imported ONLY for this constant and are now unused, remove them from the import to keep `tsc` clean (verify by reading the rest of the file before deleting any import).

- [ ] **Step 3: Verify nothing broke**

Run: `pnpm --filter @tims/shared exec tsc --noEmit`
Expected: 0 errors.
Run: `pnpm --filter @tims/api exec tsc --noEmit && cd apps/web && npx tsc --noEmit && cd ../..`
Expected: 0 errors (nothing consumed the constant).
Run: `npx vitest run`
Expected: full suite PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/roles.ts
git commit -m "chore(shared): delete dead DEFAULT_ROLE_PERMISSIONS (never read by the kernel)"
```

---

## Task 3: Repair the `Module` and `Action` unions

**Files:**
- Modify: `packages/shared/src/types/permissions.ts:1-13`
- Test: `tests/access/permission-vocabulary.test.ts`

- [ ] **Step 1: Confirm the 6 dead modules have no runtime references**

Run: `grep -rEn "['\"](coaching|evaluation|commitment|talent|team|lnd)['\"]" --include=*.ts packages/api apps`
Expected: NO hits in router/procedure code (after Task 2, `DEFAULT_ROLE_PERMISSIONS` is gone). If any `permissionProcedure('coaching', …)` etc. appears, that module is live — keep it in the union and note the divergence. (`team` may appear as an entity/relation name, not a module string — only module-string usage in `permissionProcedure(...)` counts.)

- [ ] **Step 2: Write the failing vocabulary test**

Create `tests/access/permission-vocabulary.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { MODULES, ACTIONS } from '@tims/shared';
import { MATRIX, grantsFor } from '../../packages/db/prisma/seed-access-matrix';

describe('permission vocabulary', () => {
  it('adds the 5 live modules', () => {
    for (const m of ['succession', 'team_intel', 'learning', 'feature_flags', 'notification'])
      expect(MODULES).toContain(m);
  });
  it('drops the 6 dead modules', () => {
    for (const m of ['coaching', 'evaluation', 'commitment', 'talent', 'team', 'lnd'])
      expect(MODULES).not.toContain(m);
  });
  it('adds the publish action', () => {
    expect(ACTIONS).toContain('publish');
  });
  it('every seeded grant uses a valid module + action (no drift)', () => {
    for (const role of Object.keys(MATRIX))
      for (const g of grantsFor(role)) {
        expect(MODULES, `module ${g.module}`).toContain(g.module);
        expect(ACTIONS, `action ${g.action}`).toContain(g.action);
      }
  });
});
```
(If `@tims/shared` does not resolve in vitest, import instead from `../../packages/shared/src/types/permissions`.)

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/access/permission-vocabulary.test.ts`
Expected: FAIL — `succession` not in `MODULES`, `publish` not in `ACTIONS`, and dead modules still present.

- [ ] **Step 4: Repair the unions**

In `packages/shared/src/types/permissions.ts`, replace lines 1–13 with the reality-aligned vocabulary (23 modules = exactly the set the seed uses):
```typescript
export const MODULES = [
  'vacancy', 'pipeline', 'candidate', 'assessment',
  'interview', 'offer', 'onboarding', 'performance',
  'learning', 'ninebox', 'succession', 'team_intel',
  'engagement', 'dei', 'compensation', 'monitoring',
  'organization', 'user', 'notification', 'audit',
  'feature_flags', 'billing', 'integration',
] as const;

export type Module = typeof MODULES[number];

export const ACTIONS = ['create', 'read', 'update', 'delete', 'approve', 'export', 'publish'] as const;
export type Action = typeof ACTIONS[number];
```
Leave `SCOPES`, `Permission`, and `PermissionCheck` (lines 15–32) unchanged.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/access/permission-vocabulary.test.ts`
Expected: PASS (all 4 tests, incl. the no-drift invariant over the current matrix).

- [ ] **Step 6: Type-check shared**

Run: `pnpm --filter @tims/shared exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/permissions.ts tests/access/permission-vocabulary.test.ts
git commit -m "fix(shared): align Module/Action unions to reality (+5 live modules, +publish, -6 dead)"
```

---

## Task 4: Type-check `permissionProcedure` against `Module`/`Action`

Re-enables compile-time catching of module/action typos at the router authoring surface. `tsc` IS the test here: with the unions now a complete superset of every live module/action, all call sites must compile.

**Files:**
- Modify: `packages/api/src/trpc.ts:249-251`

- [ ] **Step 1: Type the factory parameters**

In `packages/api/src/trpc.ts`, add `Module`/`Action` to the existing `@tims/shared` import (or add an import if none exists):
```typescript
import type { Module, Action } from '@tims/shared';
```
Change the factory signature (lines 249–251):
```typescript
export function permissionProcedure(module: Module, action: Action) {
  return protectedProcedure.use(requirePermission(module, action));
}
```
(`requirePermission` and `buildAccessForUser` keep their `string` params — `Module`/`Action` are assignable to `string`, so only this outermost authoring surface tightens.)

- [ ] **Step 2: Type-check the API — this is the verification**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: **0 errors.** If an error appears, it names a `permissionProcedure('X', 'Y')` call whose `X`/`Y` is not in the union:
- If `X`/`Y` is a real, intended module/action → add it to `MODULES`/`ACTIONS` in `permissions.ts` (and re-run Task 3's invariant test).
- If it is a typo/stale string → fix the call site to the correct module/action.
Do not loosen the signature back to `string` — surfacing these is the point.

- [ ] **Step 3: Type-check web (per CLAUDE.md both must pass)**

Run: `cd apps/web && npx tsc --noEmit && cd ../..`
Expected: 0 errors (web does not call `permissionProcedure`; unaffected).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/trpc.ts
git commit -m "fix(api): type permissionProcedure against Module/Action unions"
```

---

## Task 5: Apply the 3 grant corrections to the matrix

**Files:**
- Modify: `packages/db/prisma/seed-access-matrix.ts` (the `MATRIX` object — `leader`, `recruiter`, `hrbp`)
- Test: `tests/access/seed-matrix.test.ts` (extend)

- [ ] **Step 1: Write the failing correction tests**

Append to `tests/access/seed-matrix.test.ts`:
```typescript
describe('seed grant matrix (Slice 0 corrections, client spec §2)', () => {
  it('leader can review finalists + request vacancies (@team)', () => {
    expect(has('leader', 'candidate', 'read', 'team')).toBe(true);   // "revisar candidatos finalistas"
    expect(has('leader', 'vacancy', 'create', 'team')).toBe(true);   // "solicitar vacantes"
  });
  it('recruiter can create offers + publish vacancies (@organization)', () => {
    expect(has('recruiter', 'offer', 'create', 'organization')).toBe(true);   // "crear ofertas"
    expect(has('recruiter', 'vacancy', 'publish', 'organization')).toBe(true);
  });
  it('hrbp can MANAGE its units (@unit)', () => {
    for (const [m, a] of [
      ['vacancy', 'create'], ['vacancy', 'update'], ['pipeline', 'update'],
      ['candidate', 'update'], ['interview', 'create'], ['performance', 'update'],
      ['monitoring', 'read'],
    ] as const)
      expect(has('hrbp', m, a, 'unit'), `hrbp ${m}:${a}`).toBe(true);
  });
  it('hrbp offers stay READ-ONLY — no approve (D1)', () => {
    expect(has('hrbp', 'offer', 'approve', 'unit')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/seed-matrix.test.ts`
Expected: FAIL on the three new positive blocks (grants not yet present); the hrbp-offer-read-only block already passes.

- [ ] **Step 3: Apply the corrections in the matrix**

In `packages/db/prisma/seed-access-matrix.ts`, edit the three role entries. **leader** — add a `candidate` line and `create` to vacancy's actions:
```typescript
  leader: [
    { module: 'vacancy',      actions: ['read', 'create', 'approve'], scope: 'team' }, // +create: spec §2 "solicitar vacantes"
    { module: 'candidate',    actions: ['read'],                      scope: 'team' }, // spec §2 "revisar candidatos finalistas"
    { module: 'pipeline',     actions: ['read', 'update'],            scope: 'team' },
    { module: 'interview',    actions: ['read', 'create', 'update'],  scope: 'team' },
    { module: 'offer',        actions: ['read', 'approve'],           scope: 'team' },
    { module: 'onboarding',   actions: ['read', 'update'],            scope: 'team' },
    { module: 'performance',  actions: ['read', 'create', 'update'],  scope: 'team' },
    { module: 'learning',     actions: ['read'],                      scope: 'team' },
    { module: 'ninebox',      actions: ['read'],                      scope: 'team' },
    { module: 'succession',   actions: ['read'],                      scope: 'team' },
    { module: 'team_intel',   actions: ['read'],                      scope: 'team' },
    { module: 'engagement',   actions: ['read'],                      scope: 'team' },
    { module: 'compensation', actions: ['read'],                      scope: 'team' },
  ],
```
**recruiter** — add `publish` to vacancy and `create` to offer:
```typescript
  recruiter: [
    ...['vacancy', 'pipeline', 'candidate', 'interview'].map((m) => ({
      module: m, actions: ['read', 'create', 'update', 'delete'], scope: 'organization' as Scope,
    })),
    { module: 'vacancy',    actions: ['read', 'create', 'update', 'delete', 'publish'], scope: 'organization' }, // +publish: posts to job boards
    { module: 'assessment', actions: ['read', 'create', 'update'],                      scope: 'organization' },
    { module: 'offer',      actions: ['read', 'create'],                                scope: 'organization' }, // +create: spec §2 "crear ofertas"
  ],
```
(The explicit `vacancy` line overrides the spread's `vacancy` to add `publish`; the seed dedupes by `(module, action)` when flattening + upserting, so the duplicate `read/create/update/delete` are harmless — but if you prefer no duplicate, drop `'vacancy'` from the `.map` array and keep only the explicit line.)

**hrbp** — promote the read-only modules to manage, and add monitoring:
```typescript
  hrbp: [
    { module: 'vacancy',     actions: ['read', 'create', 'update'], scope: 'unit' }, // spec §2 "gestionar procesos de HR"
    { module: 'pipeline',    actions: ['read', 'update'],           scope: 'unit' },
    { module: 'candidate',   actions: ['read', 'update'],           scope: 'unit' },
    { module: 'assessment',  actions: ['read'],                     scope: 'unit' },
    { module: 'interview',   actions: ['read', 'create'],           scope: 'unit' },
    { module: 'offer',       actions: ['read'],                     scope: 'unit' }, // D1: read-only, no approve
    { module: 'onboarding',  actions: ['read', 'create', 'update'], scope: 'unit' },
    { module: 'performance', actions: ['read', 'update'],           scope: 'unit' },
    ...['learning', 'ninebox', 'succession', 'engagement', 'compensation'].map(
      (m) => ({ module: m, actions: ['read'], scope: 'unit' as Scope }),
    ),
    { module: 'monitoring',  actions: ['read'],                     scope: 'unit' }, // spec §2 "monitoreo estratégico de sus áreas"
  ],
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access/seed-matrix.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Re-run the no-drift invariant + type-check db**

Run: `npx vitest run tests/access/permission-vocabulary.test.ts`
Expected: PASS (new grants use only modules/actions already in the unions).
Run: `pnpm --filter @tims/db exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/seed-access-matrix.ts tests/access/seed-matrix.test.ts
git commit -m "feat(access): correct leader/recruiter/hrbp grants to match client spec §2"
```

---

## Task 6: Full local gate + seed dry-run verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full local gate**

Run: `pnpm --filter @tims/api exec tsc --noEmit && cd apps/web && npx tsc --noEmit && cd ../.. && npx vitest run`
Expected: tsc 0 errors on both; full vitest suite PASS.

- [ ] **Step 2: Seed dry-run against the dev DB — confirm additive-only**

Run: `pnpm --filter @tims/db exec tsx prisma/seed-access.ts`
Expected: for `leader`, `recruiter`, `hrbp` the dry-run lists the new triples as **CREATE** (leader +2, recruiter +2, hrbp +6 per org) and **zero DELETEs / zero scope-change UPDATEs** for those roles. Other roles: no change. If any DELETE appears for leader/recruiter/hrbp, STOP — the change is unexpectedly removing a grant; investigate before applying anywhere.

- [ ] **Step 3: Run the project gate (squashed-PR discipline, per doctrine G3)**

Run: `/gate`
Expected: green (tsc + tests + build + gitleaks).

---

## Deployment (prod) — wave-data step, NO `.sql` migration

The grant corrections are **data** (`RolePermission` rows). Every needed `Permission` row already exists (super_admin holds `offer:create`, `vacancy:publish`, `candidate:read`, `monitoring:read`, `vacancy:create`). So there is **no Prisma migration** — deploy is: merge code, then re-seed.

1. **Merge + push** the Slice 0 PR → `main`. Vercel auto-deploys the code (types + seed). (Code deploy alone changes nothing live — grants are still in the DB.)
2. **Dry-run against prod first** (point `DATABASE_URL`/`DIRECT_URL` at prod):
   `pnpm --filter @tims/db exec tsx prisma/seed-access.ts`
   Confirm: only CREATEs for leader/recruiter/hrbp (×11 orgs ⇒ ~110 new rows total: leader 2, recruiter 2, hrbp 6, per org), **zero deletes/updates**. If anything else appears, STOP.
3. **Apply:** `pnpm --filter @tims/db exec tsx prisma/seed-access.ts --apply`
4. **Flush the decision cache:** flush `tims:access:*` / `tims:perm:*`. Prod has no Upstash (per project state) → in-memory TTL (≤300s) self-clears; flush is a no-op but note it.
5. **Verify live (per-role probes):** as a leader, open a team candidate (was 403 before → now 200); as a recruiter, create an offer (was absent → now allowed); as an hrbp, update a unit candidate (was read-only → now allowed) and confirm `offer:approve` is still **denied**.

---

## Self-Review

**Spec coverage (§2 of the rebuild spec):**
- Delete dead `DEFAULT_ROLE_PERMISSIONS` → Task 2. ✓
- Add 5 live modules + `publish`; remove 6 dead modules → Task 3. ✓
- Re-enable type-checking of module/action strings → Task 4. ✓
- Re-seed corrected grants (leader/recruiter/hrbp) with citations → Task 5 + Deployment. ✓
- hr_admin "verify" → resolved in reconciliation (no change needed). ✓
- Add missing org-admin **nav** items → **deferred to Slice 1** (IA engine); Slice 0 only ensures the modules exist in the type (`feature_flags`, `audit` etc. now in `MODULES`). Noted, not a gap.

**Placeholder scan:** the only `// ...` is the explicit "move the MATRIX verbatim" instruction in Task 1 Step 3 (a move, not new logic) — acceptable; every other step shows exact code.

**Type consistency:** `grantsFor`/`flattenEntries`/`Triple`/`Entry`/`Scope` defined in Task 1, used identically in Tasks 3 & 5. `has(role, module, action, scope)` helper signature consistent across all `seed-matrix.test.ts` blocks. `MODULES`/`ACTIONS` names match `permissions.ts`.

---

*Next after Slice 0 ships: plan Slice 1 (manifest engine + 2-shell scaffold + super_admin/recruiter landings).*
