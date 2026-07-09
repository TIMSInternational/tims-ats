# Entitlements Usage Metering + Invoicing (Slice 2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform owner preview a company's metered per-module usage for a period and generate a draft invoice, priced from the entitlement layer.

**Architecture:** Extend the entitlement service/repository stack with a metering aggregator + billing computation, generalize the existing `ai-interview-billing.ts` + `getAiInterviewBillingPreview` precedent, add a draft-invoice creation service, and expose a `platform/usage-billing.ts` router + a usage-billing panel on the org-detail billing section. No schema change (reuses `Invoice.status='draft'` + `periodStart/periodEnd`, which already exist).

**Tech Stack:** Next.js 15 App Router, tRPC, Prisma (PostgreSQL/Supabase), Tailwind 4, TypeScript strict, Vitest (mock-based).

## Global Constraints

- **Branch:** `feat/entitlements-usage-billing` (off `main` 632ab5c). Never commit to `main`.
- **Layering:** Router (Zod validate, NO `db` import except best-effort audit, no business logic) → Service (logic, no tRPC types except TRPCError) → Repository (only layer importing `db`). Do NOT extend the layering-violating `platform/invoices.ts` router; put invoice-from-usage creation in a new service.
- **Price source of truth = entitlement layer.** Billing unit price = `OrgEntitlement.effectiveUnitPrice` (from `getOrgEntitlementsAdmin`, = `unitPrice ?? Module.defaultUnitPrice`). NEVER read `AiAgentOrgConfig.billableUsdPerMinute` or the stored `aiAgentUsageLog.billableUsd` for the new billing.
- **Overage model:** `billableQty = (limit == null) ? qty : Math.max(0, qty − limit)`. This is 2b's own rule; do NOT reuse `checkLimit` (its `null` means unlimited-gating, the opposite).
- **Metered modules with a usage source (only these two):** `ai_voice_interview` (unit minutes, agent slug `ai-voice-interview`, qty = `Σ(latencyMs)/60000`) and `ai_screening` (unit screenings, agent slug `candidate-screener`, qty = `count`). `video_interviews`/`proctoring` are out of scope (no usage source).
- **Reuse `ceilUsd`** from `packages/api/src/services/ai-interview-billing.ts` for all USD rounding (import it; do not re-implement).
- **Currency:** USD only (create invoices with `currency: 'USD'`). No CRC/multi-currency.
- **No `any`.** Explicit Prisma `select`. **No hardcoded user-facing strings** — i18n keys in BOTH `en.json` + `es.json` (identical sets). File-size limits: ≤300 lines/component, ≤500/router, ≤300/service.
- **Tests are MOCK-BASED** (CI has no Postgres → live-DB tests fail P1001). Under `tests/**/*.test.ts`. Mock objects referenced inside a `vi.mock` factory MUST be wrapped in `vi.hoisted(() => ({...}))` (this repo's vitest 4.1.7 hoists factories above `const`).
- **Merge-gate** (NOT full `vitest run` — hangs on DB-integration): `cd packages/db && npx prisma generate --schema=prisma/schema` → `pnpm --filter @tims/api exec tsc --noEmit` → `cd apps/web && npx tsc --noEmit` → `npx vitest run tests/access tests/entitlements`.
- **Auth:** `platformProcedure` (`packages/api/src/routers/platform/_common.ts`) = platform-owner only; every mutation does an IDOR `organizationExists(orgId)` check (import from `packages/api/src/repositories/entitlement.repository.ts`) → `NOT_FOUND`.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do NOT push (controller ships in Task 6).

**Existing signatures to reuse (do not change):**
- `ai-interview-billing.ts`: `ceilUsd(value: number): number`; type `InvoiceLine = { description: string; quantity: number; unitPrice: number }`.
- `entitlement.service.ts`: `getOrgEntitlementsAdmin(orgId): Promise<AdminEntitlement[]>` where `AdminEntitlement = { moduleCode; name; kind; metered; unit: string|null; enabled; source: string|null; limit: number|null; unitPrice: number|null; effectiveUnitPrice: number|null }`.
- `entitlement.repository.ts`: `organizationExists(orgId): Promise<boolean>`.
- Prisma `AiAgentUsageLog`: `agentId, organizationId, costUsd, billableUsd, inputTokens, outputTokens, latencyMs, cached, createdAt`, relation `agent` (→ `AiAgent.slug`). `Invoice`: `invoiceNumber (autoincrement), organizationId, amount, subtotal?, taxRate?, currency (default USD), status (InvoiceStatus: draft|pending|paid|void), invoiceDate (default now), periodStart?, periodEnd?, ...`, relation `lineItems`. `InvoiceLineItem`: `invoiceId, description, quantity (default 1), unitPrice, total, sortOrder`.

---

### Task 1: Module→usage mapping + repository aggregator + service `getModuleUsage`

**Files:**
- Create: `packages/api/src/services/usage-metering.service.ts` (mapping + `getModuleUsage`)
- Modify: `packages/api/src/repositories/entitlement.repository.ts` (add `getModuleUsageQuantity`)
- Test: `tests/entitlements/usage-metering.service.test.ts`, `tests/entitlements/usage-metering.repository.test.ts`

**Interfaces:**
- Produces:
  - `METERED_MODULE_USAGE: Record<string, { agentSlugs: string[]; unit: string; aggregate: 'count' | 'durationMinutes' }>` — exactly two entries (`ai_voice_interview`, `ai_screening`).
  - Repo `getModuleUsageQuantity(orgId: string, agentSlugs: string[], aggregate: 'count' | 'durationMinutes', periodStart: Date, periodEnd: Date): Promise<number>`
  - Service `getModuleUsage(orgId: string, moduleCode: string, periodStart: Date, periodEnd: Date): Promise<{ quantity: number; unit: string } | null>` (null for unmapped modules)

- [ ] **Step 1: Write the failing repository test**

Create `tests/entitlements/usage-metering.repository.test.ts`. Mock `@tims/db` (use `vi.hoisted`). Assert `count` uses `db.aiAgentUsageLog.count` with `where.agent.slug.in = agentSlugs` + org + `createdAt` range; `durationMinutes` uses `aggregate({ _sum: { latencyMs } })` and divides by 60000.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockDb = vi.hoisted(() => ({
  aiAgentUsageLog: { count: vi.fn(), aggregate: vi.fn() },
}));
vi.mock('@tims/db', () => ({ db: mockDb }));
import { getModuleUsageQuantity } from '../../packages/api/src/repositories/entitlement.repository';

beforeEach(() => { vi.clearAllMocks(); });

describe('getModuleUsageQuantity', () => {
  const start = new Date('2026-07-01T00:00:00Z');
  const end = new Date('2026-07-31T23:59:59Z');

  it('count aggregate: counts rows for the mapped slugs in range', async () => {
    mockDb.aiAgentUsageLog.count.mockResolvedValue(42);
    const n = await getModuleUsageQuantity('org-1', ['candidate-screener'], 'count', start, end);
    expect(n).toBe(42);
    const arg = mockDb.aiAgentUsageLog.count.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      organizationId: 'org-1',
      agent: { slug: { in: ['candidate-screener'] } },
      createdAt: { gte: start, lte: end },
    });
  });

  it('durationMinutes aggregate: sums latencyMs and divides by 60000', async () => {
    mockDb.aiAgentUsageLog.aggregate.mockResolvedValue({ _sum: { latencyMs: 600000 } }); // 10 min
    const n = await getModuleUsageQuantity('org-1', ['ai-voice-interview'], 'durationMinutes', start, end);
    expect(n).toBe(10);
  });

  it('durationMinutes with no usage returns 0 (null _sum)', async () => {
    mockDb.aiAgentUsageLog.aggregate.mockResolvedValue({ _sum: { latencyMs: null } });
    const n = await getModuleUsageQuantity('org-1', ['ai-voice-interview'], 'durationMinutes', start, end);
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, verify fail**

Run: `npx vitest run tests/entitlements/usage-metering.repository.test.ts` → FAIL (function not exported).

- [ ] **Step 3: Implement `getModuleUsageQuantity`**

Append to `packages/api/src/repositories/entitlement.repository.ts`:

```typescript
export async function getModuleUsageQuantity(
  orgId: string,
  agentSlugs: string[],
  aggregate: 'count' | 'durationMinutes',
  periodStart: Date,
  periodEnd: Date,
): Promise<number> {
  const where = {
    organizationId: orgId,
    agent: { slug: { in: agentSlugs } },
    createdAt: { gte: periodStart, lte: periodEnd },
  };
  if (aggregate === 'count') {
    return db.aiAgentUsageLog.count({ where });
  }
  const agg = await db.aiAgentUsageLog.aggregate({ where, _sum: { latencyMs: true } });
  return (agg._sum.latencyMs ?? 0) / 60000;
}
```

- [ ] **Step 4: Write the failing service test**

Create `tests/entitlements/usage-metering.service.test.ts`. Mock the repository. Assert the mapping drives the call; unmapped module → `null`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../packages/api/src/repositories/entitlement.repository', () => ({
  getModuleUsageQuantity: vi.fn(),
}));
import * as repo from '../../packages/api/src/repositories/entitlement.repository';
import { getModuleUsage, METERED_MODULE_USAGE } from '../../packages/api/src/services/usage-metering.service';

beforeEach(() => { vi.clearAllMocks(); });

it('maps ai_voice_interview to minutes via the ai-voice-interview slug', async () => {
  vi.mocked(repo.getModuleUsageQuantity).mockResolvedValue(120);
  const out = await getModuleUsage('org-1', 'ai_voice_interview', new Date(0), new Date(1));
  expect(out).toEqual({ quantity: 120, unit: 'minutes' });
  expect(repo.getModuleUsageQuantity).toHaveBeenCalledWith('org-1', ['ai-voice-interview'], 'durationMinutes', expect.any(Date), expect.any(Date));
});

it('maps ai_screening to screenings via candidate-screener count', async () => {
  vi.mocked(repo.getModuleUsageQuantity).mockResolvedValue(5);
  const out = await getModuleUsage('org-1', 'ai_screening', new Date(0), new Date(1));
  expect(out).toEqual({ quantity: 5, unit: 'screenings' });
  expect(repo.getModuleUsageQuantity).toHaveBeenCalledWith('org-1', ['candidate-screener'], 'count', expect.any(Date), expect.any(Date));
});

it('returns null for an unmapped module', async () => {
  const out = await getModuleUsage('org-1', 'vacancies', new Date(0), new Date(1));
  expect(out).toBeNull();
  expect(repo.getModuleUsageQuantity).not.toHaveBeenCalled();
});

it('exposes exactly the two usage-bearing modules', () => {
  expect(Object.keys(METERED_MODULE_USAGE).sort()).toEqual(['ai_screening', 'ai_voice_interview']);
});
```

- [ ] **Step 5: Implement the service**

Create `packages/api/src/services/usage-metering.service.ts`:

```typescript
import { getModuleUsageQuantity } from '../repositories/entitlement.repository';

// The only two metered modules with a real usage source today (Slice 2b).
// video_interviews / proctoring have no usage source and are intentionally absent.
export const METERED_MODULE_USAGE: Record<
  string,
  { agentSlugs: string[]; unit: string; aggregate: 'count' | 'durationMinutes' }
> = {
  ai_voice_interview: { agentSlugs: ['ai-voice-interview'], unit: 'minutes', aggregate: 'durationMinutes' },
  // One screening = one candidate-screener invocation; cv-parser (CV parsing) is
  // intentionally excluded to avoid double-counting.
  ai_screening: { agentSlugs: ['candidate-screener'], unit: 'screenings', aggregate: 'count' },
};

export async function getModuleUsage(
  orgId: string,
  moduleCode: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ quantity: number; unit: string } | null> {
  const desc = METERED_MODULE_USAGE[moduleCode];
  if (!desc) return null;
  const quantity = await getModuleUsageQuantity(orgId, desc.agentSlugs, desc.aggregate, periodStart, periodEnd);
  return { quantity, unit: desc.unit };
}
```

- [ ] **Step 6: Run tests + tsc, commit**

Run: `npx vitest run tests/entitlements/usage-metering.repository.test.ts tests/entitlements/usage-metering.service.test.ts` → PASS. `pnpm --filter @tims/api exec tsc --noEmit` → 0.

```bash
git add packages/api/src/services/usage-metering.service.ts packages/api/src/repositories/entitlement.repository.ts tests/entitlements/usage-metering.repository.test.ts tests/entitlements/usage-metering.service.test.ts
git commit -m "feat(billing): module->usage mapping + aiAgentUsageLog aggregator (slice 2b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Billing computation + invoice-line shaping

**Files:**
- Create: `packages/api/src/services/usage-billing.service.ts` (`computeUsageBilling`, `buildUsageInvoiceLines`)
- Test: `tests/entitlements/usage-billing.compute.test.ts`

**Interfaces:**
- Consumes: `getOrgEntitlementsAdmin` (entitlement.service), `getModuleUsage` + `METERED_MODULE_USAGE` (usage-metering.service), `ceilUsd` + `InvoiceLine` (ai-interview-billing.ts).
- Produces:
  - types `UsageLine = { moduleCode: string; name: string; unit: string; quantity: number; includedQty: number; billableQty: number; unitPrice: number; amountUsd: number }` and `UsageBillingPreview = { lines: UsageLine[]; subtotalUsd: number }`.
  - `computeUsageBilling(orgId: string, periodStart: Date, periodEnd: Date): Promise<UsageBillingPreview>`
  - `buildUsageInvoiceLines(preview: UsageBillingPreview): InvoiceLine[]`

- [ ] **Step 1: Write the failing test**

Create `tests/entitlements/usage-billing.compute.test.ts`. Mock `getOrgEntitlementsAdmin` + `getModuleUsage`. Cover: overage (`ai_screening` qty 6000, limit 5000, price 0.5 → billable 1000 → $500), all-usage (`ai_voice_interview` qty 120, limit null, price 0.15 → $18), zero usage → amount 0, disabled/non-metered/unmapped skipped, uses `effectiveUnitPrice`, `ceilUsd` rounding, `buildUsageInvoiceLines` drops zero-amount lines and uses quantity 1.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../packages/api/src/services/entitlement.service', () => ({ getOrgEntitlementsAdmin: vi.fn() }));
vi.mock('../../packages/api/src/services/usage-metering.service', async (orig) => ({
  ...(await orig()), getModuleUsage: vi.fn(),
}));
import * as ent from '../../packages/api/src/services/entitlement.service';
import * as meter from '../../packages/api/src/services/usage-metering.service';
import { computeUsageBilling, buildUsageInvoiceLines } from '../../packages/api/src/services/usage-billing.service';

const start = new Date('2026-07-01'); const end = new Date('2026-07-31');
function ent1(over: Partial<Record<string, unknown>> = {}) {
  return { moduleCode: 'ai_screening', name: 'Filtro IA', kind: 'core', metered: true, unit: 'screenings',
           enabled: true, source: 'plan', limit: 5000, unitPrice: null, effectiveUnitPrice: 0.5, ...over };
}
beforeEach(() => { vi.clearAllMocks(); });

it('bills only overage for a module with a limit', async () => {
  vi.mocked(ent.getOrgEntitlementsAdmin).mockResolvedValue([ent1()] as never);
  vi.mocked(meter.getModuleUsage).mockResolvedValue({ quantity: 6000, unit: 'screenings' });
  const p = await computeUsageBilling('org-1', start, end);
  expect(p.lines[0]).toMatchObject({ quantity: 6000, includedQty: 5000, billableQty: 1000, unitPrice: 0.5, amountUsd: 500 });
  expect(p.subtotalUsd).toBe(500);
});

it('bills all usage when limit is null (voice minutes)', async () => {
  vi.mocked(ent.getOrgEntitlementsAdmin).mockResolvedValue([
    { moduleCode: 'ai_voice_interview', name: 'Voz', kind: 'addon', metered: true, unit: 'minutes',
      enabled: true, source: 'addon', limit: null, unitPrice: 0.15, effectiveUnitPrice: 0.15 },
  ] as never);
  vi.mocked(meter.getModuleUsage).mockResolvedValue({ quantity: 120, unit: 'minutes' });
  const p = await computeUsageBilling('org-1', start, end);
  expect(p.lines[0]).toMatchObject({ billableQty: 120, amountUsd: 18 });
});

it('skips disabled / non-metered / unmapped modules', async () => {
  vi.mocked(ent.getOrgEntitlementsAdmin).mockResolvedValue([
    ent1({ enabled: false }),
    { moduleCode: 'vacancies', name: 'Vac', kind: 'core', metered: false, unit: null, enabled: true, source: 'plan', limit: null, unitPrice: null, effectiveUnitPrice: null },
  ] as never);
  vi.mocked(meter.getModuleUsage).mockResolvedValue({ quantity: 100, unit: 'x' });
  const p = await computeUsageBilling('org-1', start, end);
  expect(p.lines).toHaveLength(0);
});

it('buildUsageInvoiceLines drops zero-amount lines, quantity always 1', () => {
  const lines = buildUsageInvoiceLines({ subtotalUsd: 18, lines: [
    { moduleCode: 'ai_voice_interview', name: 'Voz', unit: 'minutes', quantity: 120, includedQty: 0, billableQty: 120, unitPrice: 0.15, amountUsd: 18 },
    { moduleCode: 'ai_screening', name: 'Filtro', unit: 'screenings', quantity: 10, includedQty: 5000, billableQty: 0, unitPrice: 0.5, amountUsd: 0 },
  ] });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ quantity: 1, unitPrice: 18 });
  expect(lines[0].description).toContain('120');
});
```

- [ ] **Step 2: Run test, verify fail** — `npx vitest run tests/entitlements/usage-billing.compute.test.ts` → FAIL.

- [ ] **Step 3: Implement the service**

Create `packages/api/src/services/usage-billing.service.ts`:

```typescript
import { getOrgEntitlementsAdmin } from './entitlement.service';
import { getModuleUsage, METERED_MODULE_USAGE } from './usage-metering.service';
import { ceilUsd, type InvoiceLine } from './ai-interview-billing';

export type UsageLine = {
  moduleCode: string; name: string; unit: string; quantity: number;
  includedQty: number; billableQty: number; unitPrice: number; amountUsd: number;
};
export type UsageBillingPreview = { lines: UsageLine[]; subtotalUsd: number };

export async function computeUsageBilling(
  orgId: string, periodStart: Date, periodEnd: Date,
): Promise<UsageBillingPreview> {
  const entitlements = await getOrgEntitlementsAdmin(orgId);
  const lines: UsageLine[] = [];
  for (const e of entitlements) {
    if (!e.enabled || !e.metered || !METERED_MODULE_USAGE[e.moduleCode]) continue;
    const usage = await getModuleUsage(orgId, e.moduleCode, periodStart, periodEnd);
    if (!usage) continue;
    const quantity = usage.quantity;
    const includedQty = e.limit ?? 0;
    const billableQty = e.limit == null ? quantity : Math.max(0, quantity - e.limit);
    const unitPrice = e.effectiveUnitPrice ?? 0;
    const amountUsd = ceilUsd(billableQty * unitPrice);
    lines.push({ moduleCode: e.moduleCode, name: e.name, unit: usage.unit, quantity, includedQty, billableQty, unitPrice, amountUsd });
  }
  const subtotalUsd = ceilUsd(lines.reduce((s, l) => s + l.amountUsd, 0));
  return { lines, subtotalUsd };
}

export function buildUsageInvoiceLines(preview: UsageBillingPreview): InvoiceLine[] {
  return preview.lines
    .filter((l) => l.amountUsd > 0)
    .map((l) => ({
      description: `${l.name}: ${l.billableQty} ${l.unit} × $${l.unitPrice} (${l.includedQty} incl.)`,
      quantity: 1,
      unitPrice: l.amountUsd,
    }));
}
```

- [ ] **Step 4: Run tests + tsc, commit**

Run tests → PASS; `pnpm --filter @tims/api exec tsc --noEmit` → 0.
```bash
git add packages/api/src/services/usage-billing.service.ts tests/entitlements/usage-billing.compute.test.ts
git commit -m "feat(billing): usage billing computation + invoice-line shaping (slice 2b)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Draft-invoice creation service

**Files:**
- Modify: `packages/api/src/services/usage-billing.service.ts` (add `createUsageInvoice` + `findDraftInvoiceForPeriod`)
- Modify: `packages/api/src/repositories/entitlement.repository.ts` (add `createDraftInvoice`, `findDraftInvoiceForPeriod` — repository owns `db`)
- Test: `tests/entitlements/usage-billing.invoice.test.ts`

> NOTE: put the Prisma writes in the repository (only `db` layer); the service orchestrates. Read `packages/api/src/routers/platform/invoices.ts:101-133` first for the exact nested `lineItems: { create: [...] }` shape + `total`/`sortOrder` computation to mirror.

**Interfaces:**
- Produces:
  - Repo `findDraftInvoiceForPeriod(orgId: string, periodStart: Date, periodEnd: Date): Promise<{ id: string } | null>`
  - Repo `createDraftInvoice(args: { orgId: string; periodStart: Date; periodEnd: Date; subtotalUsd: number; lines: InvoiceLine[] }): Promise<{ invoiceId: string; invoiceNumber: number }>`
  - Service `createUsageInvoice(orgId, periodStart, periodEnd, preview): Promise<{ invoiceId: string; invoiceNumber: number }>`

- [ ] **Step 1: Write the failing test** — mock the repo; assert `createUsageInvoice` builds lines from the preview and calls `createDraftInvoice` with `status`-agnostic args (subtotal + lines); assert the repo `createDraftInvoice` (unit-tested against a mocked `db.invoice.create`) sets `status:'draft'`, `periodStart/End`, `subtotal`, `amount = subtotal`, `currency:'USD'`, and nested line items with `total = quantity*unitPrice` + `sortOrder`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mockDb = vi.hoisted(() => ({ invoice: { create: vi.fn(), findFirst: vi.fn() } }));
vi.mock('@tims/db', () => ({ db: mockDb }));
import { createDraftInvoice, findDraftInvoiceForPeriod } from '../../packages/api/src/repositories/entitlement.repository';

beforeEach(() => { vi.clearAllMocks(); });

it('createDraftInvoice writes a draft with period + nested line totals', async () => {
  mockDb.invoice.create.mockResolvedValue({ id: 'inv-1', invoiceNumber: 7 });
  const res = await createDraftInvoice({
    orgId: 'org-1', periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-07-31'),
    subtotalUsd: 18, lines: [{ description: 'Voz: 120 minutes', quantity: 1, unitPrice: 18 }],
  });
  expect(res).toEqual({ invoiceId: 'inv-1', invoiceNumber: 7 });
  const arg = mockDb.invoice.create.mock.calls[0][0];
  expect(arg.data).toMatchObject({ organizationId: 'org-1', status: 'draft', currency: 'USD', subtotal: 18, amount: 18 });
  expect(arg.data.periodStart).toEqual(new Date('2026-07-01'));
  expect(arg.data.lineItems.create[0]).toMatchObject({ description: 'Voz: 120 minutes', quantity: 1, unitPrice: 18, total: 18, sortOrder: 0 });
});

it('findDraftInvoiceForPeriod filters by org, draft status, and period', async () => {
  mockDb.invoice.findFirst.mockResolvedValue(null);
  const r = await findDraftInvoiceForPeriod('org-1', new Date('2026-07-01'), new Date('2026-07-31'));
  expect(r).toBeNull();
  const arg = mockDb.invoice.findFirst.mock.calls[0][0];
  expect(arg.where).toMatchObject({ organizationId: 'org-1', status: 'draft' });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `createDraftInvoice` + `findDraftInvoiceForPeriod` in the repository (use `InvoiceStatus.draft` from `@prisma/client`; mirror `invoices.ts` line-item `create` mapping with `total: li.quantity * li.unitPrice, sortOrder: i`), and `createUsageInvoice` in the service (call `buildUsageInvoiceLines(preview)` then `createDraftInvoice`). Import `InvoiceStatus` from `@prisma/client`.
- [ ] **Step 4: Run tests + tsc, commit** (`feat(billing): draft usage-invoice creation service (slice 2b)`).

---

### Task 4: Platform router `usage-billing.ts` + mount

**Files:**
- Create: `packages/api/src/routers/platform/usage-billing.ts`
- Modify: `packages/api/src/routers/platform/index.ts` (add to `mergeRouters`)
- Test: `tests/entitlements/usage-billing.router.test.ts`

> Read `packages/api/src/routers/platform/entitlements.ts` (Slice 2a) for the exact `platformProcedure` + `assertOrg`(IDOR) + best-effort-audit pattern to mirror, and its `router`/imports.

**Interfaces:**
- Consumes: `platformProcedure` (`./_common`), `organizationExists` (entitlement.repository), `computeUsageBilling` + `createUsageInvoice` + repo `findDraftInvoiceForPeriod` (via service) (usage-billing.service).
- Produces: router `usageBillingRouter` with `getUsageBillingPreview` (query) + `generateUsageInvoice` (mutation), merged into the platform router.

- [ ] **Step 1: Write the failing tests** (mirror `tests/entitlements/entitlement.admin-router.test.ts` caller setup): non-owner → FORBIDDEN; owner + missing org → NOT_FOUND; `generateUsageInvoice` when preview has zero billable lines → BAD_REQUEST (mock `computeUsageBilling` to return empty); duplicate draft (mock `findDraftInvoiceForPeriod` → existing) → CONFLICT; happy path calls `createUsageInvoice`; audit rejection tolerated.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement the router** (all `platformProcedure`):

```typescript
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { db } from '@tims/db';
import { router } from '../../trpc';
import { platformProcedure } from './_common';
import { organizationExists, findDraftInvoiceForPeriod } from '../../repositories/entitlement.repository';
import { computeUsageBilling, createUsageInvoice } from '../../services/usage-billing.service';

function monthDefaults(periodStart?: Date, periodEnd?: Date): { start: Date; end: Date } {
  const end = periodEnd ?? new Date();
  const start = periodStart ?? new Date(end.getFullYear(), end.getMonth(), 1);
  return { start, end };
}
async function assertOrg(orgId: string): Promise<void> {
  if (!(await organizationExists(orgId))) throw new TRPCError({ code: 'NOT_FOUND', message: 'organization_not_found' });
}

export const usageBillingRouter = router({
  getUsageBillingPreview: platformProcedure
    .input(z.object({ orgId: z.string().uuid(), periodStart: z.date().optional(), periodEnd: z.date().optional() }))
    .query(async ({ input }) => {
      await assertOrg(input.orgId);
      const { start, end } = monthDefaults(input.periodStart, input.periodEnd);
      return computeUsageBilling(input.orgId, start, end);
    }),

  generateUsageInvoice: platformProcedure
    .input(z.object({ orgId: z.string().uuid(), periodStart: z.date(), periodEnd: z.date() }))
    .mutation(async ({ ctx, input }) => {
      await assertOrg(input.orgId);
      const preview = await computeUsageBilling(input.orgId, input.periodStart, input.periodEnd);
      if (preview.lines.every((l) => l.amountUsd <= 0)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'no_billable_usage' });
      }
      const dup = await findDraftInvoiceForPeriod(input.orgId, input.periodStart, input.periodEnd);
      if (dup) throw new TRPCError({ code: 'CONFLICT', message: 'draft_invoice_exists' });
      const res = await createUsageInvoice(input.orgId, input.periodStart, input.periodEnd, preview);
      await db.auditLog.create({ data: {
        organizationId: input.orgId, action: 'entitlement_usage_invoiced', entity: 'invoice',
        entityId: res.invoiceId, actorId: ctx.user.id,
        metadata: { periodStart: input.periodStart, periodEnd: input.periodEnd, subtotalUsd: preview.subtotalUsd },
      } }).catch(() => {});
      return res;
    }),
});
```

> Verify the `auditLog` field names against the real `AuditLog` model + Slice-2a's `entitlements.ts` usage (the same `action`/`entity`/`entityId`/`organizationId`/`actorId`/`metadata` shape). `createUsageInvoice` must be exported from the service; if the router needs `findDraftInvoiceForPeriod`, import it from the repository (a read used for a guard — acceptable, like `organizationExists`), OR expose it through the service. Keep entitlement/billing logic out of the router.

- [ ] **Step 4: Mount** in `packages/api/src/routers/platform/index.ts` (`mergeRouters(..., usageBillingRouter)`).
- [ ] **Step 5: Run tests + tsc, commit** (`feat(billing): usage-billing platform router (preview + generate draft) (slice 2b)`).

---

### Task 5: UI usage-billing panel + i18n

**Files:**
- Modify: `apps/web/app/(admin)/platform/organizations/[id]/sections/billing-section.tsx` (add Usage-billing panel; extract a subcomponent if it would exceed 300 lines)
- Modify: `apps/web/lib/i18n/en.json` + `es.json` (new `usageBilling` namespace)

**Interfaces:**
- Consumes: `trpc.platform.getUsageBillingPreview.useQuery({ orgId, periodStart, periodEnd })`, `trpc.platform.generateUsageInvoice.useMutation()`.

- [ ] **Step 1: Read the template** `billing-section.tsx` (query + loading/error/empty branches + toast + `utils.platform.getOrgInvoices.invalidate()`), and `sections/entitlements-section.tsx` (Slice 2a) for the confirm-gated mutation + i18n conventions.
- [ ] **Step 2: Add `usageBilling` i18n keys** to BOTH `en.json` + `es.json` (identical): `title`, `periodLabel`, `moduleCol`, `usageCol`, `includedCol`, `billableCol`, `unitPriceCol`, `amountCol`, `subtotal`, `generate`, `generateConfirm`, `generated`, `noUsage`, `emptyPeriod`.
- [ ] **Step 3: Implement the panel** — a period picker (two `type=month`/date inputs; default to the current month) → `getUsageBillingPreview` table (module name, `quantity` + `unit`, `includedQty`, `billableQty`, `$unitPrice`, `$amountUsd`) + subtotal row → a "Generate draft invoice" button (`window.confirm(t.usageBilling.generateConfirm)` → `generateUsageInvoice.mutate`, `onSuccess` → `utils.platform.getOrgInvoices.invalidate()` + toast `t.usageBilling.generated`, `onError` → `toast(err.message, {type:'error'})`). Handle `isLoading`→Skeleton, `isError`→ErrorState, empty preview → `t.usageBilling.noUsage`. No hardcoded strings. Keep the file ≤300 lines (extract `UsageBillingPanel` into its own file if needed).
- [ ] **Step 4: Verify** — `cd apps/web && npx tsc --noEmit` → 0; `npx vitest run tests/security/i18n-no-hardcoded-strings.test.ts` → PASS (or manual key-parity check if it needs a DB). Commit (`feat(billing): org-detail usage-billing panel + i18n (slice 2b)`).

---

### Task 6: Whole-branch review + gate + ship

**Files:** none.

- [ ] **Step 1: Full merge-gate** — `cd packages/db && npx prisma generate --schema=prisma/schema`; `pnpm --filter @tims/api exec tsc --noEmit`; `cd apps/web && npx tsc --noEmit`; `npx vitest run tests/access tests/entitlements`. All green. (Do NOT run full `vitest run`.)
- [ ] **Step 2: Whole-branch review** — dispatch an opus whole-branch reviewer AND a `codex:codex-rescue` adversarial pass over `git diff main..HEAD`. Focus: price source is `effectiveUnitPrice` (never `AiAgentOrgConfig`/stored `billableUsd`); overage math (`limit==null → all`, else `max(0,qty−limit)`); `generateUsageInvoice` re-derives server-side + IDOR + zero-billable BAD_REQUEST + duplicate CONFLICT; draft status + periods set; numeric Zod bounds (guard against non-finite/oversized like Slice 2a's Codex findings); layering; i18n parity; no hardcoded strings. Fold Critical/Important into ONE fix subagent; re-gate.
- [ ] **Step 3: PR + squash-merge** — `git push -u origin feat/entitlements-usage-billing`; `gh pr create --base main ...`; after CI green (admin-merge past the billing trap only on a 3-4s fail): `gh pr merge <n> --squash --admin`. No prod DDL, no seed. Delete branch. Confirm Vercel prod deploy + smoke `platform.getUsageBillingPreview` → 401 (mounted).

---

## Self-Review

**Spec coverage:** module→usage mapping + aggregator (T1) ✓ · `getModuleUsage` null for unmapped (T1) ✓ · billing computation w/ overage-vs-all + effectiveUnitPrice + ceilUsd (T2) ✓ · line shaping quantity-1 (T2) ✓ · draft invoice + periods, no email (T3) ✓ · preview + generate router, IDOR, server re-derive, zero-billable BAD_REQUEST, duplicate CONFLICT, audit (T4) ✓ · UI panel + i18n parity (T5) ✓ · review/ship, no DDL (T6) ✓ · out-of-scope (video/proctoring/cron/CRC/checkLimit/PDF) excluded ✓.

**Placeholder scan:** No TBD/TODO. T3/T4/T5 give concrete code or name the exact template file + lines to mirror (invoices.ts:101-133 line-item shape; entitlements.ts audit shape; billing-section.tsx). T3 body references the mirrored pattern rather than repeating 30 lines of nested-create — acceptable since the exact source lines are cited.

**Type consistency:** `getModuleUsageQuantity(orgId, agentSlugs, aggregate, start, end): number` (T1) → `getModuleUsage(...): {quantity, unit}|null` (T1) → consumed by `computeUsageBilling` (T2). `UsageBillingPreview`/`UsageLine` (T2) → consumed by `buildUsageInvoiceLines` (T2), `createUsageInvoice` (T3), router (T4), UI (T5). `InvoiceLine {description,quantity,unitPrice}` reused from ai-interview-billing.ts throughout. `createUsageInvoice(orgId,start,end,preview)` (T3) matches the router call (T4). `findDraftInvoiceForPeriod` repo fn (T3) used by router (T4).
