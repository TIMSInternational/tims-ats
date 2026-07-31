# Candidate Pool Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake `candidate.pool.export` stub (fabricated `downloadUrl`, zero scope
filtering) and its disconnected frontend button (a pure client-side toast, no network call)
with a real, scope-safe CSV export.

**Architecture:** Repository → Service → Router (existing clean-architecture pattern). The
service builds a CSV string synchronously using the existing hardened `csvCell`/`csvRow`
helpers (`packages/shared/src/csv.ts`) and returns it directly in the tRPC response — no S3, no
background job, matching the proven `platform.exportAgentsCsv` pattern
(`packages/api/src/routers/platform/ai-agents.ts:245-262`). The frontend wraps the returned
string in a `Blob` and triggers a browser download, matching
`apps/web/app/(admin)/platform/ai-agents/page.tsx`'s `handleExport`.

**Tech Stack:** tRPC, Prisma, Zod, React (Next.js App Router), vitest.

## Global Constraints

- No `any` types. Strict TypeScript.
- Every Prisma query: explicit `select`, tenant-scoped (`organizationId` + `scopeWhere`
  AND-composed, never object-spread).
- Bound all inputs: string `.max()`, array `.max()`.
- CSV cells MUST go through `csvCell`/`csvRow` (formula-injection defense, CWE-1236) — never
  hand-join with `.join(',')`.
- Row cap: **5000**. Truncation must be surfaced to the caller, never silent.
- `pnpm --filter @tims/api exec tsc --noEmit`, `apps/web`'s `npx tsc --noEmit`, and
  `npx vitest run` must all pass before any commit that finishes a task.

---

### Task 1: Repository — `findForExport`

**Files:**

- Modify: `packages/api/src/repositories/candidate.repository.ts`
- Test: `tests/candidate/pool-export.test.ts` (new)

**Interfaces:**

- Produces: `candidateRepository.findForExport(orgId: string, scopeWhere:
Prisma.CandidateWhereInput, filters: { poolType?: string; tags?: string[] }, limit: number):
Promise<Array<{ firstName: string; lastName: string; email: string; phone: string | null;
source: string; poolType: string; currentTitle: string | null; currentCompany: string | null;
yearsExperience: number | null; location: string | null; tags: { tag: string }[]; createdAt:
Date }>>`

- [ ] **Step 1: Write the failing test**

Add to `tests/candidate/pool-export.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const candidateFindMany = vi.fn();

vi.mock('@tims/db', () => ({
  tenantDb: {
    candidate: {
      findMany: (...args: unknown[]) => candidateFindMany(...args),
    },
  },
}));

import { candidateRepository } from '../../packages/api/src/repositories/candidate.repository';

describe('candidateRepository.findForExport', () => {
  beforeEach(() => {
    candidateFindMany.mockReset();
    candidateFindMany.mockResolvedValue([]);
  });

  it('composes organizationId, deletedAt: null, and scopeWhere via AND (never spread)', async () => {
    const scopeWhere = { __marker: 'scope-fragment' };
    await candidateRepository.findForExport('org-1', scopeWhere as never, {}, 5000);

    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.where.AND).toContainEqual({ organizationId: 'org-1', deletedAt: null });
    expect(call.where.AND).toContainEqual(scopeWhere);
  });

  it('adds a poolType filter clause only when provided', async () => {
    await candidateRepository.findForExport('org-1', {} as never, { poolType: 'active' }, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.where.AND).toContainEqual({ poolType: 'active' });
  });

  it('adds a tags filter clause only when provided', async () => {
    await candidateRepository.findForExport('org-1', {} as never, { tags: ['vip'] }, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.where.AND).toContainEqual({ tags: { some: { tag: { in: ['vip'] } } } });
  });

  it('requests one extra row beyond the limit (truncation detection)', async () => {
    await candidateRepository.findForExport('org-1', {} as never, {}, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.take).toBe(5001);
  });

  it('selects only the export columns (no full-record leak)', async () => {
    await candidateRepository.findForExport('org-1', {} as never, {}, 5000);
    const call = candidateFindMany.mock.calls[0]?.[0];
    expect(call.select).toEqual({
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      source: true,
      poolType: true,
      currentTitle: true,
      currentCompany: true,
      yearsExperience: true,
      location: true,
      tags: { select: { tag: true } },
      createdAt: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/candidate/pool-export.test.ts`
Expected: FAIL — `candidateRepository.findForExport is not a function`

- [ ] **Step 3: Write the implementation**

Add to `packages/api/src/repositories/candidate.repository.ts`, inside the
`export const candidateRepository = { ... }` object literal (add as a new method, comma-separated
from the existing methods — do not touch anything else in the file):

```typescript
  async findForExport(
    orgId: string,
    scopeWhere: Prisma.CandidateWhereInput,
    filters: { poolType?: string; tags?: string[] },
    limit: number,
  ) {
    const filterClause: Prisma.CandidateWhereInput = {};
    if (filters.poolType) filterClause.poolType = filters.poolType;
    if (filters.tags && filters.tags.length > 0) {
      filterClause.tags = { some: { tag: { in: filters.tags } } };
    }

    return db.candidate.findMany({
      where: {
        AND: [
          { organizationId: orgId, deletedAt: null },
          scopeWhere as Prisma.CandidateWhereInput,
          filterClause,
        ],
      },
      take: limit + 1,
      orderBy: { createdAt: 'desc' },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        source: true,
        poolType: true,
        currentTitle: true,
        currentCompany: true,
        yearsExperience: true,
        location: true,
        tags: { select: { tag: true } },
        createdAt: true,
      },
    });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/candidate/pool-export.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/repositories/candidate.repository.ts tests/candidate/pool-export.test.ts
git commit -m "feat(candidate): add findForExport repository method for pool export"
```

---

### Task 2: Service — `exportPool`

**Files:**

- Modify: `packages/api/src/services/candidate.service.ts`
- Test: `tests/candidate/pool-export.test.ts` (extend, same file as Task 1)

**Interfaces:**

- Consumes: `candidateRepository.findForExport(orgId, scopeWhere, filters, limit)` (Task 1) —
  returns the row shape defined there.
- Consumes: `csvRow(values: Array<string | null | undefined>): string` from
  `packages/shared/src/csv.ts` (existing, already tested).
- Produces: `candidateService.exportPool(orgId: string, scopeWhere: Prisma.CandidateWhereInput,
input: { poolType?: string; tags?: string[] }): Promise<{ csv: string; count: number;
truncated: boolean }>`

- [ ] **Step 1: Write the failing test**

Add to the top of `tests/candidate/pool-export.test.ts` (before the repository `describe`
block), extending the existing `@tims/db` mock and adding a new one for the shared package:

```typescript
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({
  candidateRepository: {
    findForExport: vi.fn(),
  },
}));
```

Then append a new `describe` block at the end of the file:

```typescript
import { candidateService } from '../../packages/api/src/services/candidate.service';
import { candidateRepository } from '../../packages/api/src/repositories/candidate.repository';

const findForExportMock = candidateRepository.findForExport as ReturnType<typeof vi.fn>;

describe('candidateService.exportPool', () => {
  beforeEach(() => {
    findForExportMock.mockReset();
  });

  it('builds a CSV header + one row per candidate', async () => {
    findForExportMock.mockResolvedValue([
      {
        firstName: 'Ana',
        lastName: 'Diaz',
        email: 'ana@x.com',
        phone: '555-1',
        source: 'referral',
        poolType: 'active',
        currentTitle: 'Engineer',
        currentCompany: 'Acme',
        yearsExperience: 5,
        location: 'Bogota',
        tags: [{ tag: 'vip' }, { tag: 'senior' }],
        createdAt: new Date('2026-01-01'),
      },
    ]);

    const result = await candidateService.exportPool('org-1', {} as never, {});

    expect(result.count).toBe(1);
    expect(result.truncated).toBe(false);
    const lines = result.csv.split('\n');
    expect(lines[0]).toContain('First Name');
    expect(lines[1]).toContain('"Ana"');
    expect(lines[1]).toContain('"vip; senior"');
  });

  it('caps at 5000 rows and marks truncated when the repository returns 5001', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      firstName: `F${i}`,
      lastName: 'L',
      email: `e${i}@x.com`,
      phone: null,
      source: 's',
      poolType: 'active',
      currentTitle: null,
      currentCompany: null,
      yearsExperience: null,
      location: null,
      tags: [],
      createdAt: new Date(),
    }));
    findForExportMock.mockResolvedValue(rows);

    const result = await candidateService.exportPool('org-1', {} as never, {});

    expect(result.count).toBe(5000);
    expect(result.truncated).toBe(true);
    expect(result.csv.split('\n').length).toBe(5001); // header + 5000 rows
  });

  it('does not mark truncated at exactly 5000 rows', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({
      firstName: `F${i}`,
      lastName: 'L',
      email: `e${i}@x.com`,
      phone: null,
      source: 's',
      poolType: 'active',
      currentTitle: null,
      currentCompany: null,
      yearsExperience: null,
      location: null,
      tags: [],
      createdAt: new Date(),
    }));
    findForExportMock.mockResolvedValue(rows);

    const result = await candidateService.exportPool('org-1', {} as never, {});

    expect(result.count).toBe(5000);
    expect(result.truncated).toBe(false);
  });

  it('neutralizes a formula-injection field (CWE-1236)', async () => {
    findForExportMock.mockResolvedValue([
      {
        firstName: 'Ana',
        lastName: 'Diaz',
        email: 'ana@x.com',
        phone: null,
        source: 's',
        poolType: 'active',
        currentTitle: null,
        currentCompany: '=SUM(A1:A10)',
        yearsExperience: null,
        location: null,
        tags: [],
        createdAt: new Date(),
      },
    ]);

    const result = await candidateService.exportPool('org-1', {} as never, {});

    expect(result.csv).toContain('"\'=SUM(A1:A10)"');
  });

  it('passes poolType/tags input through to the repository as filters', async () => {
    findForExportMock.mockResolvedValue([]);
    await candidateService.exportPool('org-1', {} as never, { poolType: 'active', tags: ['vip'] });

    expect(findForExportMock).toHaveBeenCalledWith('org-1', {}, { poolType: 'active', tags: ['vip'] }, 5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/candidate/pool-export.test.ts`
Expected: FAIL — `candidateService.exportPool is not a function`

- [ ] **Step 3: Write the implementation**

Add to `packages/api/src/services/candidate.service.ts`. First add the import at the top of the
file (alongside the existing imports):

```typescript
import { csvRow } from '@tims/shared';
```

Then add this method inside the `export const candidateService = { ... }` object literal:

```typescript
  async exportPool(
    orgId: string,
    scopeWhere: Prisma.CandidateWhereInput,
    input: { poolType?: string; tags?: string[] },
  ) {
    const LIMIT = 5000;
    const rows = await candidateRepository.findForExport(orgId, scopeWhere, input, LIMIT);
    const truncated = rows.length > LIMIT;
    const page = truncated ? rows.slice(0, LIMIT) : rows;

    const header = csvRow([
      'First Name', 'Last Name', 'Email', 'Phone', 'Source', 'Pool Type',
      'Current Title', 'Current Company', 'Years Experience', 'Location', 'Tags', 'Created At',
    ]);
    const lines = page.map((c) =>
      csvRow([
        c.firstName, c.lastName, c.email, c.phone, c.source, c.poolType,
        c.currentTitle, c.currentCompany,
        c.yearsExperience == null ? '' : String(c.yearsExperience),
        c.location,
        c.tags.map((t) => t.tag).join('; '),
        c.createdAt.toISOString(),
      ]),
    );

    return { csv: [header, ...lines].join('\n'), count: page.length, truncated };
  },
```

(`packages/shared/src/index.ts` already has `export * from './csv';` — confirmed, no barrel
change needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/candidate/pool-export.test.ts`
Expected: PASS (10 tests total: 5 from Task 1 + 5 from this task)

- [ ] **Step 5: Type-check**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/candidate.service.ts tests/candidate/pool-export.test.ts
git commit -m "feat(candidate): add exportPool service — real CSV generation with 5000-row cap"
```

---

### Task 3: Router — rewrite `export` procedure

**Files:**

- Modify: `packages/api/src/routers/candidate/pool.ts`
- Test: `tests/candidate/pool-export.test.ts` (extend)

**Interfaces:**

- Consumes: `candidateService.exportPool(orgId, scopeWhere, input)` (Task 2) — returns `{csv,
count, truncated}`.
- Consumes: `scopeWhereFor('candidate', ctx.access, ctx.user.id)` (existing, already imported
  in this file).
- Consumes: `logPlatformExport(ctx, {resource, count, format, truncated})` from
  `packages/api/src/access/security-audit.ts` (existing).
- Produces (tRPC output): `{ csv: string; count: number; truncated: boolean; format: 'csv' }`

- [ ] **Step 1: Write the failing test**

Append to `tests/candidate/pool-export.test.ts`. Add these two imports to the top of the file
alongside the existing ones (Task 1's `import { describe, it, expect, vi, beforeEach } from
'vitest';` line):

```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';
```

Then append the new `describe` block:

```typescript
describe('candidate.pool.export router (source text checks)', () => {
  const src = readFileSync(resolve(__dirname, '../../packages/api/src/routers/candidate/pool.ts'), 'utf8');

  it('narrows the format input to csv only (drops the unfulfilled xlsx promise)', () => {
    expect(src).toMatch(/format:\s*z\.literal\('csv'\)/);
    expect(src).not.toContain("z.enum(['csv', 'xlsx'])");
  });

  it('applies scope filtering (the old stub applied none)', () => {
    expect(src).toContain("scopeWhereFor('candidate', ctx.access, ctx.user.id)");
  });

  it('calls the real service and logs the export', () => {
    expect(src).toContain('candidateService.exportPool');
    expect(src).toContain('logPlatformExport');
    expect(src).not.toContain('stub_generated');
    expect(src).not.toContain('storage.tims.app');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/candidate/pool-export.test.ts`
Expected: FAIL — the 3 new assertions fail against the current stub source

- [ ] **Step 3: Write the implementation**

Replace the entire `export` procedure in `packages/api/src/routers/candidate/pool.ts` (the
whole file's current content is shown below with the changed procedure — only `export` changes,
`addToPool` and `getPoolStats` stay exactly as-is):

```typescript
import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { candidateService } from '../../services/candidate.service';
import { scopeWhereFor, assertScoped } from '../../access';
import { logPlatformExport } from '../../access/security-audit';

export const candidatePoolRouter = router({
  addToPool: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        poolType: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateService.addToPool(ctx.user.organizationId, input.candidateId, input.poolType);
    }),

  getPoolStats: permissionProcedure('candidate', 'read').query(async ({ ctx }) => {
    const scopeWhere = await scopeWhereFor('candidate', ctx.access, ctx.user.id);
    return candidateService.getPoolStats(ctx.user.organizationId, scopeWhere);
  }),

  export: permissionProcedure('candidate', 'read')
    .input(
      z.object({
        format: z.literal('csv').default('csv'),
        poolType: z.string().max(100).optional(),
        tags: z.array(z.string().max(100)).max(50).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scopeWhere = await scopeWhereFor('candidate', ctx.access, ctx.user.id);
      const result = await candidateService.exportPool(ctx.user.organizationId, scopeWhere, {
        poolType: input.poolType,
        tags: input.tags,
      });
      logPlatformExport(ctx, {
        resource: 'candidate_pool',
        count: result.count,
        format: 'csv',
        truncated: result.truncated,
      });
      return { ...result, format: 'csv' as const };
    }),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/candidate/pool-export.test.ts`
Expected: PASS (13 tests total)

- [ ] **Step 5: Type-check both packages**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors in either (the frontend's `format: z.enum(['csv','xlsx'])` input caller, if
any, would break here — Task 4 handles the one real frontend caller)

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routers/candidate/pool.ts tests/candidate/pool-export.test.ts
git commit -m "fix(candidate): replace fake pool export stub with real scoped CSV export"
```

---

### Task 4: Frontend — wire the real export button

**Files:**

- Modify: `apps/web/app/(admin)/recruitment/talent-pools/page.tsx`
- Modify: `apps/web/lib/i18n/en.json`
- Modify: `apps/web/lib/i18n/es.json`

**Interfaces:**

- Consumes: `trpc.candidate.pool.export` tRPC procedure (Task 3) — input `{ format: 'csv',
poolType?: string, tags?: string[] }`, output `{ csv: string, count: number, truncated:
boolean, format: 'csv' }`.

- [ ] **Step 1: Add the new i18n keys**

In `apps/web/lib/i18n/en.json`, inside the `talentPool` object, add these two keys right after
`"exportStarted": "Export started",` (keep `exportStarted` — no longer used by this page but
harmless to leave; do not delete keys other code might reference):

```json
    "exportTruncated": "Export capped at {count} rows",
```

In `apps/web/lib/i18n/es.json`, inside the `talentPool` object, add at the same position:

```json
    "exportTruncated": "Exportacion limitada a {count} filas",
```

- [ ] **Step 2: Verify the JSON is still valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/web/lib/i18n/es.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Replace `handleExport` in the page**

In `apps/web/app/(admin)/recruitment/talent-pools/page.tsx`, replace this line:

```typescript
const handleExport = () => toast(t.talentPool.exportStarted);
```

with:

```typescript
const exportMutation = trpc.candidate.pool.export.useMutation();
const handleExport = async () => {
  try {
    const result = await exportMutation.mutateAsync({
      format: 'csv',
      poolType: filters.poolTypes.length === 1 ? filters.poolTypes[0] : undefined,
    });
    const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `candidates-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    if (result.truncated) {
      toast(t.talentPool.exportTruncated.replace('{count}', String(result.count)), { type: 'info' });
    } else {
      toast(`${t.talentPool.export}: ${result.count}`, { type: 'success' });
    }
  } catch {
    toast(t.common.error, { type: 'error' });
  }
};
```

- [ ] **Step 4: Type-check the web app**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (confirms `trpc.candidate.pool.export` resolves with the new input/output
shape from Task 3)

- [ ] **Step 5: Manual smoke test**

Run: `cd apps/web && pnpm dev`, navigate to the Talent Pools page (`/recruitment/talent-pools`),
click "Export". Confirm:

- A `candidates-YYYY-MM-DD.csv` file downloads
- Opening it shows a header row + one row per visible candidate
- A candidate whose Current Company starts with `=` (if any test data has one) shows up
  prefixed with a `'` in the opened file, not executed as a formula

- [ ] **Step 6: Full verification gate**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Run: `cd apps/web && npx tsc --noEmit`
Run: `npx vitest run`
Expected: all clean (ignore the pre-existing, confirmed-flaky
`tests/vacancy/update-role-family.test.ts` timeout if it reappears in isolation-passes)

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(admin)/recruitment/talent-pools/page.tsx" apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json
git commit -m "feat(candidate): wire talent-pools export button to the real CSV export"
```
