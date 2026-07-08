# Company Entitlements — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the contract-driven entitlement layer (Module/Plan/OrgEntitlement) and prove it end-to-end by moving the existing #95 AI-voice-interview per-org toggle onto a first-class `requireEntitlement` gate.

**Architecture:** A second, company-scoped gate that composes with existing RBAC. `OrgEntitlement` rows are the runtime source of truth for "what the company bought"; a cached resolver + `requireEntitlement(orgId, code)` service function (mirrors the existing `assertAiInterviewEnabled` pattern) enforces it server-side. Enforcement is **meter-and-bill, never hard-block**.

**Tech Stack:** Next.js 15, tRPC, Prisma (Postgres/Supabase), Upstash Redis, Turborepo/pnpm, Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-07-08-company-entitlements-design.md`

## Global Constraints

- **Architecture:** Router → Service → Repository. Routers never import `db`; only repositories import `db`/`systemDb`. Services never import tRPC types except `TRPCError`.
- **TypeScript strict, NO `any`** — use `unknown` + narrow, or inferred Prisma types.
- **Zod at every tRPC boundary.**
- **Prisma conventions:** `@id @default(uuid()) @db.Uuid`; `@map("snake_case")` on every field; `@@index([organizationId])`; `@@map("table_name")`; relations to `Organization` with `onDelete: Cascade`.
- **RLS:** tenant-scoped tables get the `tenant_isolation` policy (`organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid`). Global catalogs (Module/Plan/PlanModule) are RLS-exempt.
- **i18n:** any new UI string added as a key in BOTH `packages/i18n/messages/es.json` and `.../en.json` (and the `apps/web/lib/i18n/*` overrides if a key is app-local). No hardcoded strings.
- **Cache:** `tims:entitlements:{orgId}`, TTL 300s, invalidate-on-update via `cacheInvalidatePrefix`.
- **Local gate (run before every commit, exact order):** `cd packages/db && npx prisma generate --schema=prisma/schema` → `pnpm --filter @tims/api exec tsc --noEmit` → `cd apps/web && npx tsc --noEmit` → `npx vitest run` (from root).
- **Build-gate review:** Codex cross-model verification (`codex:codex-rescue`) at the whole-slice review, alongside the per-task reviewer.

## File Structure

- **Create** `packages/db/prisma/schema/entitlement.prisma` — `Module`, `Plan`, `PlanModule`, `OrgEntitlement`.
- **Modify** `packages/db/prisma/schema/organization.prisma` — add `entitlements OrgEntitlement[]` back-relation.
- **Create** `packages/db/prisma/migrations/<ts>_add_entitlements/migration.sql` — tables + RLS on `org_entitlements`.
- **Create** `packages/db/prisma/seed-entitlements.ts` — module catalog + `ats-base` plan + INVU provisioning.
- **Modify** `packages/db/prisma/seed.ts` — call the entitlements seed.
- **Create** `packages/api/src/repositories/entitlement.repository.ts` — the only file importing `db` for entitlements.
- **Create** `packages/api/src/services/entitlement.service.ts` — resolver, `requireEntitlement`, `hasEntitlement`, `checkLimit`, cache.
- **Create** `packages/api/src/services/__tests__/entitlement.service.test.ts` — unit tests.
- **Modify** `packages/api/src/services/ai-interview-access.service.ts` — route the gate through `requireEntitlement`.
- **Create** `packages/api/src/routers/entitlement.ts` — `entitlement.mine` query for the UI.
- **Modify** the root tRPC router to mount `entitlement`.

---

### Task 1: Entitlement schema + migration + RLS

**Files:**
- Create: `packages/db/prisma/schema/entitlement.prisma`
- Modify: `packages/db/prisma/schema/organization.prisma` (add back-relation)
- Create: `packages/db/prisma/migrations/<ts>_add_entitlements/migration.sql`
- Test: `packages/db/prisma/__tests__/entitlement-schema.test.ts`

**Interfaces:**
- Produces: Prisma models `Module` (fields: `code`, `name`, `description`, `kind`, `metered`, `unit`, `defaultUnitPrice`), `Plan` (`code`, `name`, `description`, `active`), `PlanModule` (`planCode`, `moduleCode`, `limit`), `OrgEntitlement` (`organizationId`, `moduleCode`, `enabled`, `source`, `limit`, `unitPrice`). Client accessors: `db.module`, `db.plan`, `db.planModule`, `db.orgEntitlement`.

- [ ] **Step 1: Write `entitlement.prisma`**

```prisma
// packages/db/prisma/schema/entitlement.prisma

model Module {
  code             String   @id
  name             String
  description      String?
  kind             String   // 'core' | 'addon'
  metered          Boolean  @default(false)
  unit             String?  // 'minutes' | 'screenings' | 'exams' | 'checks'
  defaultUnitPrice Float?   @map("default_unit_price")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  planModules     PlanModule[]
  orgEntitlements OrgEntitlement[]

  @@map("modules")
}

model Plan {
  code        String   @id
  name        String
  description String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  modules PlanModule[]

  @@map("plans")
}

model PlanModule {
  id         String @id @default(uuid()) @db.Uuid
  planCode   String @map("plan_code")
  moduleCode String @map("module_code")
  limit      Int?

  plan   Plan   @relation(fields: [planCode], references: [code], onDelete: Cascade)
  module Module @relation(fields: [moduleCode], references: [code], onDelete: Cascade)

  @@unique([planCode, moduleCode])
  @@map("plan_modules")
}

model OrgEntitlement {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  moduleCode     String   @map("module_code")
  enabled        Boolean  @default(true)
  source         String   // 'plan' | 'addon' | 'override'
  limit          Int?
  unitPrice      Float?   @map("unit_price")
  activatedAt    DateTime @default(now()) @map("activated_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  module       Module       @relation(fields: [moduleCode], references: [code], onDelete: Cascade)

  @@unique([organizationId, moduleCode])
  @@index([organizationId])
  @@map("org_entitlements")
}
```

- [ ] **Step 2: Add the back-relation to `organization.prisma`**

In `packages/db/prisma/schema/organization.prisma`, inside `model Organization { ... }`, add alongside the other relation fields:

```prisma
  entitlements OrgEntitlement[]
```

- [ ] **Step 3: Validate + author the prod migration SQL (run BEFORE applying locally)**

The local dev DB is `db push`-managed and prod is NOT migrate-managed, so we do not use `migrate dev`. Instead, capture the delta DDL as a deploy artifact *while the DB still lacks the new tables*:
```bash
cd packages/db && npx prisma format --schema=prisma/schema && npx prisma validate --schema=prisma/schema
mkdir -p prisma/migrations/20260708000000_add_entitlements
npx prisma migrate diff --from-schema-datasource prisma/schema --to-schema-datamodel prisma/schema --script > prisma/migrations/20260708000000_add_entitlements/migration.sql
```
Expected: `migration.sql` contains `CREATE TABLE "modules"`, `"plans"`, `"plan_modules"`, `"org_entitlements"` (the delta between the live DB, which lacks them, and the schema). No shadow DB is used. This file is applied to **prod** later via `prisma db execute --file` per repo convention — it is not auto-applied.

- [ ] **Step 4: Append RLS to the migration (org_entitlements only)**

Append to the generated `migration.sql`:
```sql
-- Tenant isolation for org_entitlements (modules/plans/plan_modules are global catalogs, RLS-exempt)
ALTER TABLE "org_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_entitlements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "org_entitlements";
CREATE POLICY tenant_isolation ON "org_entitlements" USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
```

- [ ] **Step 5: Apply to the local dev DB + regenerate client**

Run:
```bash
cd packages/db && npx prisma db push --schema=prisma/schema && npx prisma generate --schema=prisma/schema
```
Expected: "Your database is now in sync with your Prisma schema"; client regenerated with `db.module`, `db.plan`, `db.planModule`, `db.orgEntitlement`. (RLS from Step 4 lives in the prod migration SQL only; local `db push` applies tables without policies so seed tests can write as the DB owner.)

- [ ] **Step 6: Write a schema smoke test**

```typescript
// packages/db/prisma/__tests__/entitlement-schema.test.ts
import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';

describe('entitlement schema', () => {
  it('exposes entitlement models on the client', () => {
    const db = new PrismaClient();
    expect(db.module).toBeDefined();
    expect(db.plan).toBeDefined();
    expect(db.planModule).toBeDefined();
    expect(db.orgEntitlement).toBeDefined();
  });
});
```

- [ ] **Step 7: Run the test**

Run: `npx vitest run packages/db/prisma/__tests__/entitlement-schema.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema/entitlement.prisma packages/db/prisma/schema/organization.prisma packages/db/prisma/migrations packages/db/prisma/__tests__/entitlement-schema.test.ts
git commit -m "feat(entitlements): add Module/Plan/OrgEntitlement schema + RLS"
```

---

### Task 2: Module catalog + ats-base plan seed

**Files:**
- Create: `packages/db/prisma/seed-entitlements.ts`
- Modify: `packages/db/prisma/seed.ts` (invoke the seed)
- Test: `packages/db/prisma/__tests__/seed-entitlements.test.ts`

**Interfaces:**
- Produces: `seedEntitlementCatalog(db: PrismaClient): Promise<void>` — upserts the module catalog + `ats-base` plan + its `PlanModule` rows.

- [ ] **Step 1: Write the catalog seed**

```typescript
// packages/db/prisma/seed-entitlements.ts
import type { PrismaClient } from '@prisma/client';

export const MODULES = [
  { code: 'vacancies',          name: 'Vacantes',              kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'candidate_portal',   name: 'Portal del candidato',  kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'ai_screening',       name: 'Filtro IA documental',  kind: 'core',  metered: true,  unit: 'screenings',defaultUnitPrice: 0.5 },
  { code: 'compliance_matrix',  name: 'Matriz de cumplimiento',kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'assessments',        name: 'Evaluaciones TIMS',     kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'interviews',         name: 'Entrevistas',           kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'validations',        name: 'Validaciones',          kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'ai_voice_interview', name: 'Entrevista por voz IA', kind: 'addon', metered: true,  unit: 'minutes',   defaultUnitPrice: 0.15 },
  { code: 'video_interviews',   name: 'Videollamadas',         kind: 'addon', metered: true,  unit: 'minutes',   defaultUnitPrice: 0.02 },
  { code: 'proctoring',         name: 'Proctoring',            kind: 'addon', metered: true,  unit: 'exams',      defaultUnitPrice: 10 },
  { code: 'custom_reports',     name: 'Reportes personalizados',kind: 'addon', metered: false, unit: null,        defaultUnitPrice: null },
] as const;

// Modules included in the base ATS license.
const ATS_BASE_MODULES = [
  'vacancies', 'candidate_portal', 'ai_screening', 'compliance_matrix',
  'assessments', 'interviews', 'validations',
];

export async function seedEntitlementCatalog(db: PrismaClient): Promise<void> {
  for (const m of MODULES) {
    await db.module.upsert({ where: { code: m.code }, update: m, create: m });
  }
  await db.plan.upsert({
    where: { code: 'ats-base' },
    update: {},
    create: { code: 'ats-base', name: 'ATS Base', description: 'Licencia base del ATS' },
  });
  for (const moduleCode of ATS_BASE_MODULES) {
    await db.planModule.upsert({
      where: { planCode_moduleCode: { planCode: 'ats-base', moduleCode } },
      update: {},
      create: { planCode: 'ats-base', moduleCode },
    });
  }
}
```

- [ ] **Step 2: Invoke it from `seed.ts`**

In `packages/db/prisma/seed.ts`, add the import at the top and call it after the org block (before the demo data). Add:
```typescript
import { seedEntitlementCatalog } from './seed-entitlements';
// ... after `const org = await db.organization.upsert(...)`:
await seedEntitlementCatalog(db);
```

- [ ] **Step 3: Write the seed test**

```typescript
// packages/db/prisma/__tests__/seed-entitlements.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedEntitlementCatalog, MODULES } from '../seed-entitlements';

const db = new PrismaClient();

describe('seedEntitlementCatalog', () => {
  beforeAll(async () => { await seedEntitlementCatalog(db); });

  it('creates every module in the catalog', async () => {
    const count = await db.module.count();
    expect(count).toBeGreaterThanOrEqual(MODULES.length);
  });

  it('creates ats-base with 7 core modules', async () => {
    const rows = await db.planModule.findMany({ where: { planCode: 'ats-base' } });
    expect(rows).toHaveLength(7);
  });
});
```

- [ ] **Step 4: Run the seed then the test**

Run:
```bash
cd packages/db && npx tsx prisma/seed.ts
npx vitest run packages/db/prisma/__tests__/seed-entitlements.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/seed-entitlements.ts packages/db/prisma/seed.ts packages/db/prisma/__tests__/seed-entitlements.test.ts
git commit -m "feat(entitlements): seed module catalog + ats-base plan"
```

---

### Task 3: Resolver service + repository + cache + guard

**Files:**
- Create: `packages/api/src/repositories/entitlement.repository.ts`
- Create: `packages/api/src/services/entitlement.service.ts`
- Test: `packages/api/src/services/__tests__/entitlement.service.test.ts`

**Interfaces:**
- Consumes: `cacheGet`, `cacheSet`, `cacheInvalidatePrefix` from `packages/api/src/lib/cache.ts`; `db` from the db package.
- Produces:
  - `getEntitlements(orgId: string): Promise<Map<string, EffectiveEntitlement>>`
  - `hasEntitlement(orgId: string, moduleCode: string): Promise<boolean>`
  - `requireEntitlement(orgId: string, moduleCode: string): Promise<EffectiveEntitlement>` (throws `TRPCError` `FORBIDDEN` / `entitlement_missing`)
  - `checkLimit(limit: number | null, currentUsage: number, amount: number): { overage: boolean }` (pure; meter-and-bill, never blocks)
  - `invalidateEntitlementCache(orgId: string): Promise<void>`
  - type `EffectiveEntitlement = { moduleCode: string; limit: number | null; unitPrice: number | null }`

- [ ] **Step 1: Write the repository**

```typescript
// packages/api/src/repositories/entitlement.repository.ts
import { db } from '@tims/db';

export async function findEnabledEntitlements(orgId: string) {
  return db.orgEntitlement.findMany({
    where: { organizationId: orgId, enabled: true },
    select: { moduleCode: true, limit: true, unitPrice: true },
  });
}
```

- [ ] **Step 2: Write the failing service test**

```typescript
// packages/api/src/services/__tests__/entitlement.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

vi.mock('../../lib/cache', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheInvalidatePrefix: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../repositories/entitlement.repository', () => ({
  findEnabledEntitlements: vi.fn(),
}));

import { findEnabledEntitlements } from '../../repositories/entitlement.repository';
import { requireEntitlement, hasEntitlement, checkLimit } from '../entitlement.service';

const mockRepo = vi.mocked(findEnabledEntitlements);

describe('entitlement.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hasEntitlement is true when the module is enabled', async () => {
    mockRepo.mockResolvedValue([{ moduleCode: 'ai_voice_interview', limit: null, unitPrice: 0.15 }]);
    expect(await hasEntitlement('org1', 'ai_voice_interview')).toBe(true);
  });

  it('hasEntitlement is false when the module is absent', async () => {
    mockRepo.mockResolvedValue([]);
    expect(await hasEntitlement('org1', 'ai_voice_interview')).toBe(false);
  });

  it('requireEntitlement throws FORBIDDEN when absent', async () => {
    mockRepo.mockResolvedValue([]);
    await expect(requireEntitlement('org1', 'ai_voice_interview')).rejects.toThrow(TRPCError);
  });

  it('checkLimit signals overage but never blocks', () => {
    expect(checkLimit(100, 100, 1)).toEqual({ overage: true });
    expect(checkLimit(100, 40, 1)).toEqual({ overage: false });
    expect(checkLimit(null, 999999, 1)).toEqual({ overage: false });
  });
});
```

- [ ] **Step 3: Run it to verify failure**

Run: `npx vitest run packages/api/src/services/__tests__/entitlement.service.test.ts`
Expected: FAIL ("Cannot find module '../entitlement.service'").

- [ ] **Step 4: Write the service**

```typescript
// packages/api/src/services/entitlement.service.ts
import { TRPCError } from '@trpc/server';
import { cacheGet, cacheSet, cacheInvalidatePrefix } from '../lib/cache';
import { findEnabledEntitlements } from '../repositories/entitlement.repository';

export type EffectiveEntitlement = { moduleCode: string; limit: number | null; unitPrice: number | null };

const TTL_SECONDS = 300;
const keyFor = (orgId: string) => `tims:entitlements:${orgId}`;

export async function getEntitlements(orgId: string): Promise<Map<string, EffectiveEntitlement>> {
  const cached = await cacheGet<EffectiveEntitlement[]>(keyFor(orgId));
  const rows = cached ?? (await findEnabledEntitlements(orgId));
  if (!cached) await cacheSet(keyFor(orgId), rows, TTL_SECONDS);
  return new Map(rows.map((r) => [r.moduleCode, r]));
}

export async function hasEntitlement(orgId: string, moduleCode: string): Promise<boolean> {
  return (await getEntitlements(orgId)).has(moduleCode);
}

export async function requireEntitlement(orgId: string, moduleCode: string): Promise<EffectiveEntitlement> {
  const ent = (await getEntitlements(orgId)).get(moduleCode);
  if (!ent) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `entitlement_missing:${moduleCode}` });
  }
  return ent;
}

// Meter-and-bill: over-limit returns overage=true; it NEVER blocks. null limit = unlimited.
export function checkLimit(limit: number | null, currentUsage: number, amount: number): { overage: boolean } {
  if (limit === null) return { overage: false };
  return { overage: currentUsage + amount > limit };
}

export async function invalidateEntitlementCache(orgId: string): Promise<void> {
  await cacheInvalidatePrefix(keyFor(orgId));
}
```

- [ ] **Step 5: Run the test to verify pass**

Run: `npx vitest run packages/api/src/services/__tests__/entitlement.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/repositories/entitlement.repository.ts packages/api/src/services/entitlement.service.ts packages/api/src/services/__tests__/entitlement.service.test.ts
git commit -m "feat(entitlements): resolver service + requireEntitlement guard + cache"
```

---

### Task 4: Provision INVU org via seed

**Files:**
- Modify: `packages/db/prisma/seed-entitlements.ts` (add `provisionInvu`)
- Test: `packages/db/prisma/__tests__/provision-invu.test.ts`

**Interfaces:**
- Consumes: `seedEntitlementCatalog` (Task 2 must run first).
- Produces: `provisionInvu(db: PrismaClient): Promise<{ orgId: string }>` — creates the INVU org, assigns `ats-base` (seeds `OrgEntitlement` source=`plan`), turns on `ai_voice_interview` (source=`addon`) and caps `ai_screening`.

- [ ] **Step 1: Add `provisionInvu` to `seed-entitlements.ts`**

```typescript
// append to packages/db/prisma/seed-entitlements.ts
export async function provisionInvu(db: PrismaClient): Promise<{ orgId: string }> {
  const org = await db.organization.upsert({
    where: { slug: 'invu' },
    update: {},
    create: { name: 'INVU', slug: 'invu', domain: 'invu.go.cr', plan: 'ats-base' },
  });

  const plan = await db.planModule.findMany({ where: { planCode: 'ats-base' } });
  for (const pm of plan) {
    await db.orgEntitlement.upsert({
      where: { organizationId_moduleCode: { organizationId: org.id, moduleCode: pm.moduleCode } },
      update: { enabled: true, source: 'plan', limit: pm.moduleCode === 'ai_screening' ? 5000 : pm.limit },
      create: {
        organizationId: org.id, moduleCode: pm.moduleCode, enabled: true, source: 'plan',
        limit: pm.moduleCode === 'ai_screening' ? 5000 : pm.limit,
      },
    });
  }

  await db.orgEntitlement.upsert({
    where: { organizationId_moduleCode: { organizationId: org.id, moduleCode: 'ai_voice_interview' } },
    update: { enabled: true, source: 'addon', unitPrice: 0.15 },
    create: { organizationId: org.id, moduleCode: 'ai_voice_interview', enabled: true, source: 'addon', unitPrice: 0.15 },
  });

  return { orgId: org.id };
}
```

- [ ] **Step 2: Call it from `seed.ts`**

In `packages/db/prisma/seed.ts`, after `await seedEntitlementCatalog(db);` add:
```typescript
import { provisionInvu } from './seed-entitlements'; // combine with existing import
await provisionInvu(db);
```

- [ ] **Step 3: Write the test**

```typescript
// packages/db/prisma/__tests__/provision-invu.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedEntitlementCatalog, provisionInvu } from '../seed-entitlements';

const db = new PrismaClient();

describe('provisionInvu', () => {
  let orgId: string;
  beforeAll(async () => {
    await seedEntitlementCatalog(db);
    ({ orgId } = await provisionInvu(db));
  });

  it('gives INVU the ai_voice_interview add-on enabled', async () => {
    const row = await db.orgEntitlement.findUnique({
      where: { organizationId_moduleCode: { organizationId: orgId, moduleCode: 'ai_voice_interview' } },
    });
    expect(row?.enabled).toBe(true);
    expect(row?.source).toBe('addon');
  });

  it('caps ai_screening at 5000', async () => {
    const row = await db.orgEntitlement.findUnique({
      where: { organizationId_moduleCode: { organizationId: orgId, moduleCode: 'ai_screening' } },
    });
    expect(row?.limit).toBe(5000);
  });
});
```

- [ ] **Step 4: Seed + run the test**

Run:
```bash
cd packages/db && npx tsx prisma/seed.ts
npx vitest run packages/db/prisma/__tests__/provision-invu.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/seed-entitlements.ts packages/db/prisma/seed.ts packages/db/prisma/__tests__/provision-invu.test.ts
git commit -m "feat(entitlements): provision INVU org (ats-base + ai_voice_interview + ai_screening cap)"
```

---

### Task 5: Migrate the #95 AI-voice-interview gate onto entitlements

**Files:**
- Modify: `packages/api/src/services/ai-interview-access.service.ts` (`assertAiInterviewEnabled`)
- Test: `packages/api/src/services/__tests__/ai-interview-access.entitlement.test.ts`

**Interfaces:**
- Consumes: `requireEntitlement` (Task 3).
- Behavior change: enablement is now decided by the `ai_voice_interview` entitlement; `aiAgentOrgConfig` remains the source of **billing** params (budgets, per-minute price, minute caps) but no longer the enablement toggle.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/services/__tests__/ai-interview-access.entitlement.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

vi.mock('../entitlement.service', () => ({ requireEntitlement: vi.fn() }));
vi.mock('@tims/db', () => ({
  systemDb: { aiAgentOrgConfig: { findFirst: vi.fn().mockResolvedValue({
    enabled: true, monthlyBudget: null, billableUsdPerMinute: 0.15,
    addonMonthlyFeeUsd: null, aiInterviewDefaultMaxMinutes: 30, aiInterviewMaxMinutesByType: null,
  }) } },
}));

import { requireEntitlement } from '../entitlement.service';
import { assertAiInterviewEnabled } from '../ai-interview-access.service';

const mockReq = vi.mocked(requireEntitlement);

describe('assertAiInterviewEnabled via entitlement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes when the org is entitled', async () => {
    mockReq.mockResolvedValue({ moduleCode: 'ai_voice_interview', limit: null, unitPrice: 0.15 });
    const cfg = await assertAiInterviewEnabled('org1');
    expect(mockReq).toHaveBeenCalledWith('org1', 'ai_voice_interview');
    expect(cfg.billableUsdPerMinute).toBe(0.15);
  });

  it('throws FORBIDDEN when not entitled', async () => {
    mockReq.mockRejectedValue(new TRPCError({ code: 'FORBIDDEN', message: 'entitlement_missing:ai_voice_interview' }));
    await expect(assertAiInterviewEnabled('org2')).rejects.toThrow(TRPCError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/api/src/services/__tests__/ai-interview-access.entitlement.test.ts`
Expected: FAIL (current `assertAiInterviewEnabled` checks `aiAgentOrgConfig.enabled`, not the entitlement).

- [ ] **Step 3: Update `assertAiInterviewEnabled`**

Replace the body of `assertAiInterviewEnabled` in `packages/api/src/services/ai-interview-access.service.ts` so the entitlement is the gate and the config supplies billing:

```typescript
import { requireEntitlement } from './entitlement.service';

export async function assertAiInterviewEnabled(organizationId: string): Promise<AiInterviewConfig> {
  // Gate: the company must have the ai_voice_interview module entitled (contract-driven).
  await requireEntitlement(organizationId, 'ai_voice_interview');
  // Billing params still come from aiAgentOrgConfig (budget, per-minute price, minute caps).
  const config = await loadAiInterviewConfig(organizationId);
  return (config ?? {
    enabled: true, monthlyBudget: null, billableUsdPerMinute: null,
    addonMonthlyFeeUsd: null, aiInterviewDefaultMaxMinutes: null, aiInterviewMaxMinutesByType: null,
  }) as AiInterviewConfig;
}
```

Leave `loadAiInterviewConfig` and `isEnabledConfig` unchanged; the enforcement call site (`packages/api/src/routers/ai-interview.ts:203`) is unchanged — it already calls `assertAiInterviewEnabled`.

- [ ] **Step 4: Run the test to verify pass**

Run: `npx vitest run packages/api/src/services/__tests__/ai-interview-access.entitlement.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing ai-interview tests for regressions**

Run: `npx vitest run packages/api/src/services/__tests__/ai-interview` packages/api/src/routers/__tests__/ai-interview* 2>/dev/null || npx vitest run --dir packages/api/src -t "ai interview"`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/ai-interview-access.service.ts packages/api/src/services/__tests__/ai-interview-access.entitlement.test.ts
git commit -m "feat(entitlements): gate AI voice interview via requireEntitlement (migrate #95)"
```

---

### Task 6: Expose entitlements to the UI + hide nav when off

**Files:**
- Create: `packages/api/src/routers/entitlement.ts`
- Modify: root router (e.g. `packages/api/src/root.ts` or `router.ts`) to mount `entitlement`
- Modify: the AI-interview nav entry in the role/nav manifest under `apps/web` to check the entitlement
- Modify: `packages/i18n/messages/es.json` + `packages/i18n/messages/en.json`
- Test: `packages/api/src/routers/__tests__/entitlement.router.test.ts`

**Interfaces:**
- Consumes: `getEntitlements` (Task 3), `protectedProcedure`.
- Produces: tRPC query `entitlement.mine(): { modules: string[] }` — the active module codes for the caller's org; a `hasModule(code)` client helper reads it.

- [ ] **Step 1: Write the router**

```typescript
// packages/api/src/routers/entitlement.ts
import { router, protectedProcedure } from '../trpc';
import { getEntitlements } from '../services/entitlement.service';

export const entitlementRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => {
    const map = await getEntitlements(ctx.user.organizationId);
    return { modules: Array.from(map.keys()) };
  }),
});
```

- [ ] **Step 2: Mount it on the root router**

In the root router file, import `entitlementRouter` and add `entitlement: entitlementRouter,` to the router map (follow the existing sibling entries).

- [ ] **Step 3: Write the router test**

```typescript
// packages/api/src/routers/__tests__/entitlement.router.test.ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../services/entitlement.service', () => ({
  getEntitlements: vi.fn().mockResolvedValue(new Map([['ai_voice_interview', { moduleCode: 'ai_voice_interview', limit: null, unitPrice: 0.15 }]])),
}));
import { entitlementRouter } from '../entitlement';

describe('entitlement.mine', () => {
  it('returns active module codes for the org', async () => {
    const caller = entitlementRouter.createCaller({
      user: { id: 'u1', organizationId: 'org1', roles: [], isPlatformOwner: false, email: 'a@b.c', supabaseUserId: 's1' },
    } as never);
    const res = await caller.mine();
    expect(res.modules).toContain('ai_voice_interview');
  });
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/api/src/routers/__tests__/entitlement.router.test.ts`
Expected: PASS.

- [ ] **Step 5: Add i18n keys for the disabled/upsell state**

In BOTH `packages/i18n/messages/es.json` and `packages/i18n/messages/en.json`, add under a top-level `entitlements` object:
```json
"entitlements": {
  "notIncluded": "No incluido en tu plan",
  "contactSales": "Contactar a ventas para activar"
}
```
(en.json):
```json
"entitlements": {
  "notIncluded": "Not included in your plan",
  "contactSales": "Contact sales to activate"
}
```

- [ ] **Step 6: Gate the AI-interview nav entry**

In the `apps/web` nav/role manifest where the AI-voice-interview link is defined, load `entitlement.mine` (via the existing tRPC client / a `useEntitlements()` hook) and render the AI-interview entry only when `modules.includes('ai_voice_interview')`. Where the manifest supports it, show the disabled state using `entitlements.notIncluded`. Follow the existing role-experience manifest pattern for conditional nav items (the same place role/scope already hides items).

- [ ] **Step 7: Run the local gate**

Run:
```bash
cd packages/db && npx prisma generate --schema=prisma/schema && cd ../..
pnpm --filter @tims/api exec tsc --noEmit
cd apps/web && npx tsc --noEmit && cd ../..
npx vitest run
```
Expected: tsc 0 errors both packages; vitest all green.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/routers/entitlement.ts packages/api/src/root.ts packages/i18n/messages apps/web
git commit -m "feat(entitlements): expose entitlement.mine + hide AI-interview nav when not entitled"
```

---

## Self-Review

- **Spec coverage:** §4 data model → Task 1; §4 catalog/plan → Task 2; §5 resolver/guard/cache/limits → Task 3; §7.4 provision INVU → Task 4; §7.5 migrate #95 → Task 5; §5 UI reflection → Task 6. Admin surface (§6) and metering/invoicing wiring are **intentionally deferred to slice 2** (this slice proves the gate; admin console + full usage-metering are their own plans).
- **Type consistency:** `EffectiveEntitlement` shape is identical in Task 3 (definition), Task 5 (return usage), and Task 6 (map values). `requireEntitlement(orgId, moduleCode)` signature identical across Tasks 3/5. Prisma composite keys (`planCode_moduleCode`, `organizationId_moduleCode`) used consistently in Tasks 2/4.
- **Placeholder scan:** every code step contains complete code; commands have expected output. Task 6 Step 6 references "the existing role-experience manifest pattern" rather than pasting the manifest — that file wasn't extracted; the executor should locate the AI-interview nav entry and mirror the sibling conditional. This is the one spot needing in-repo discovery.
- **Deferred, tracked:** `ai_screening` limit enforcement (`checkLimit`) is wired but only exercised once the AI compliance engine ships; `video_interviews`/`proctoring` modules exist in the catalog but are entitled/used in later slices.
