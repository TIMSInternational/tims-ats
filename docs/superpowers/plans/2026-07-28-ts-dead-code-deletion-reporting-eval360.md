# TS Dead-Code Deletion: reporting (recruitment-analytics) + evaluation360 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the two TS tRPC routers whose C# replacements are fully live in prod
(`recruitmentAnalyticsRouter` / `evaluation360Router`), strip the now-dead tRPC fallback branches
from their two FE wrapper files, and fix every test/tooling file that would otherwise break —
without touching the service/repository layer underneath either domain.

**Architecture:** Both domains are migration cutover surfaces: an FE hook (`apps/web/lib/platform-api/*.ts`)
that used to call either a tRPC procedure or a C# HTTP endpoint depending on a `NEXT_PUBLIC_*_VIA_CSHARP`
flag. All three relevant flags (`NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP`,
`NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP`, `NEXT_PUBLIC_EVALUATION360_WRITE_VIA_CSHARP`) are
confirmed `"true"` in the live Vercel production environment (verified via `vercel env pull` on
2026-07-28), so the tRPC branch is unreachable dead code. This plan removes it.

**Tech Stack:** TypeScript (strict), tRPC, Zod, TanStack Query, Vitest, Prisma (untouched).

## Global Constraints

- Do NOT touch `packages/api/src/services/recruitment-analytics.service.ts`,
  `packages/api/src/services/evaluation360.service.ts`,
  `packages/api/src/repositories/recruitment-analytics.repository.ts`,
  `packages/api/src/repositories/evaluation360.repository.ts`, `packages/api/src/services/evaluation360-aggregate.ts`,
  or any of their dedicated test files (`tests/recruitment-analytics/service.test.ts`,
  `tests/evaluation360/evaluation360-service.test.ts`, `tests/evaluation360/evaluation360-repository.test.ts`,
  `tests/evaluation360/evaluation360-aggregate*.test.ts`, `tests/db/evaluation360-schema.test.ts`,
  `tests/access/evaluation360-grants.test.ts`, `tests/access/access-fixtures.test.ts`). This is a
  deliberate scope boundary (Federico's explicit choice) — they stay as an orphaned-but-harmless
  rollback safety net.
- Do NOT touch `scripts/parity/write-surfaces.ts`, `scripts/parity/write-surfaces.test.ts`, or
  `scripts/parity/checks/writes.ts` — verified they never reference `tsProcedure` or the TS router;
  write-side parity checks hit the C# service directly and compare org-A/org-B/DB-readback, not TS output.
- Do NOT touch `scripts/parity/seed.ts`'s `eval-cycle-staff`/`eval-cycle-self` `ResourcePair` entries —
  they become orphaned once the `evaluation360` read surface is removed from `surfaces.ts`, but removing
  them is unforced scope creep into a 2000+ line file; leaving them is harmless (nothing calls them once
  their only consumer, the by-id endpoints in `surfaces.ts`, is gone). Note this as an accepted follow-up,
  not a task in this plan.
- Every task must leave `pnpm --filter @tims/api exec tsc --noEmit` and `cd apps/web && npx tsc --noEmit`
  clean, and the touched vitest files passing, before moving to the next task.
- No `any`. No new `.passthrough()`/`z.any()`. Follow existing file conventions exactly (Spanish user-facing
  Zod messages, `'use client'` headers, etc.).

---

### Task 1: Relocate `submitRatingsInput` to `packages/shared`

The evaluation360 router (deleted in Task 3) currently owns the `submitRatingsInput` Zod schema
(exactly-6-ratings-one-per-competency validation). One test,
`tests/evaluation360/evaluation360-router-self-service.test.ts`, imports it directly by name — it
tests a real business rule, not router wiring, so it's worth preserving independent of the router's
existence. Relocate the schema to `packages/shared/src/validators/` (the existing home for
cross-cutting Zod schemas — see `packages/shared/src/validators/{auth,user,organization,assessment}.ts`)
and repoint the test's import. The router keeps its own local copy for now; Task 3 deletes it
along with the router.

**Files:**

- Create: `packages/shared/src/validators/evaluation360.ts`
- Modify: `packages/shared/src/validators/index.ts`
- Modify: `packages/shared/src/constants/eval360.ts:1-3` (stale comment)
- Modify: `tests/evaluation360/evaluation360-router-self-service.test.ts:1-4` (import only, for now)

**Interfaces:**

- Produces: `submitRatingsInput` (Zod schema, `z.infer` shape `{ assignmentId: string; ratings: Array<{ competencyKey: Eval360Competency; rating: number; comment?: string }> }`) exported from `@tims/shared`.

- [ ] **Step 1: Create the relocated validator**

Create `packages/shared/src/validators/evaluation360.ts`:

```typescript
import { z } from 'zod';
import { EVAL360_COMPETENCIES } from '../constants/eval360';

const ratingInput = z.object({
  competencyKey: z.enum(EVAL360_COMPETENCIES),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(5000).optional(),
});

export const submitRatingsInput = z.object({
  assignmentId: z.string().uuid(),
  ratings: z
    .array(ratingInput)
    .length(6)
    .refine(
      (arr) => new Set(arr.map((r) => r.competencyKey)).size === 6,
      'Debe calificar las 6 competencias exactamente una vez',
    ),
});
```

- [ ] **Step 2: Export it from the validators barrel**

In `packages/shared/src/validators/index.ts`, add a line (keep alphabetical-ish grouping consistent
with the existing four lines):

```typescript
export * from './assessment';
export * from './auth';
export * from './evaluation360';
export * from './organization';
export * from './user';
```

- [ ] **Step 3: Fix the now-stale comment in constants/eval360.ts**

In `packages/shared/src/constants/eval360.ts:1-3`, the comment says validation happens "at the zod
boundary in the router layer" — that's no longer accurate once the schema lives in `validators/`.
Replace:

```typescript
// 360 Evaluation (Sprint 1.7) — FRESH competency set (decision B: no DB Competency
// table). Rating scale for each competency is Int 1-5 (validated at the zod
// boundary in the router layer, not here).
```

with:

```typescript
// 360 Evaluation (Sprint 1.7) — FRESH competency set (decision B: no DB Competency
// table). Rating scale for each competency is Int 1-5 (validated at the zod
// boundary in validators/evaluation360.ts, not here).
```

- [ ] **Step 4: Repoint the test's import (nothing else in the file changes yet)**

In `tests/evaluation360/evaluation360-router-self-service.test.ts:4`, change:

```typescript
import { submitRatingsInput } from '../../packages/api/src/routers/evaluation360';
```

to:

```typescript
import { submitRatingsInput } from '@tims/shared';
```

- [ ] **Step 5: Run the test to verify it still passes**

Run: `npx vitest run tests/evaluation360/evaluation360-router-self-service.test.ts`
Expected: all tests PASS (the router still has its own local `submitRatingsInput` copy at this
point — untouched — and the relocated one in `@tims/shared` is byte-identical, so behavior is
unchanged either way).

- [ ] **Step 6: Type-check packages/shared and packages/api**

Run: `pnpm --filter @tims/shared exec tsc --noEmit && pnpm --filter @tims/api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/validators/evaluation360.ts packages/shared/src/validators/index.ts \
  packages/shared/src/constants/eval360.ts tests/evaluation360/evaluation360-router-self-service.test.ts
git commit -m "refactor(evaluation360): relocate submitRatingsInput to packages/shared"
```

---

### Task 2: Delete the `recruitment-analytics` (reporting) TS surface

`NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP` is confirmed `true` in prod. Delete the router, strip the FE
wrapper's dead tRPC branch, and fix the two places that reference the router by source text or by
`tsProcedure` string.

**Files:**

- Delete: `packages/api/src/routers/recruitment-analytics.ts`
- Modify: `packages/api/src/root.ts:7,64`
- Delete: `tests/access/scope-wiring-analytics.test.ts`
- Modify: `scripts/parity/surfaces.ts` (the `reporting: {...}` block)
- Modify: `scripts/parity/surfaces.test.ts` (lines 43-88, and the `reporting` reference inside the
  Tier-2 by-id test — reporting has no by-id endpoints, so only the two whole-`it` blocks need removal)
- Modify: `apps/web/lib/platform-api/reporting.ts` (full rewrite)

**Interfaces:**

- Consumes: nothing new.
- Produces: `useReportingKpis`, `useReportingFunnel`, `useReportingSourceBreakdown`, `useReportingTrend`,
  `useReportingLostByDelay`, `useReportingRecruiterSla`, `ReportingPeriod` — same exported names/signatures
  as before, so every FE call site (`/recruitment/analytics` page components) needs zero changes.

- [ ] **Step 1: Delete the router file**

```bash
git rm packages/api/src/routers/recruitment-analytics.ts
```

- [ ] **Step 2: Remove its registration from root.ts**

In `packages/api/src/root.ts:7`, delete the import line:

```typescript
import { recruitmentAnalyticsRouter } from './routers/recruitment-analytics';
```

In `packages/api/src/root.ts:64`, delete the appRouter entry:

```typescript
  recruitmentAnalytics: recruitmentAnalyticsRouter,
```

- [ ] **Step 3: Delete the router-source-text security test**

`tests/access/scope-wiring-analytics.test.ts` is entirely static assertions against
`packages/api/src/routers/recruitment-analytics.ts`'s source text (every procedure calls
`requireOrgScope`). With the router gone there's nothing left to assert against — the guard itself
has no other independent test to preserve (unlike evaluation360, whose `requireOrgScope` behavioral
test lives in a file that also covers something else — see Task 3).

```bash
git rm tests/access/scope-wiring-analytics.test.ts
```

- [ ] **Step 4: Remove the `reporting` surface from the parity harness**

In `scripts/parity/surfaces.ts`, delete the entire `reporting: { ... }` block — starting at the
`// ── reporting ──...` comment (immediately after the `succession` surface's closing `},`) and
ending at the `},` that closes the `reporting` object, immediately before the `'billing-usage': {`
entry. This removes ~55 lines including the leading comment block explaining the RBAC grounding —
delete that comment too, it documents a surface that no longer exists in the registry.

- [ ] **Step 5: Fix surfaces.test.ts**

In `scripts/parity/surfaces.test.ts`, delete these two entire `it(...)` blocks (lines 43-65 and
67-88 in the pre-edit file):

```typescript
it('reporting has the six recruitment-analytics reads under one flag + org-scope RBAC (super_admin/hr_admin 200, hrbp 403)', () => {
  // ... (entire block)
});

it('reporting bakes ?period=30D into csharpPath AND tsProcedure input for the three period endpoints', () => {
  // ... (entire block)
});
```

Reporting has no by-id endpoints, so the Tier-2 by-id test (`'every Tier-2 by-id endpoint sets
idScopeKey...'`) needs no change for this domain — leave it for now, Task 3 edits its evaluation360
entries.

- [ ] **Step 6: Rewrite the FE wrapper — C#-only**

Replace the full content of `apps/web/lib/platform-api/reporting.ts` with:

```typescript
'use client';

// C#-only recruitment-analytics reads. The TS tRPC router
// (packages/api/src/routers/recruitment-analytics.ts) has been deleted —
// NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP is true in every environment and there is no TS
// fallback left to route to. Types below are hand-declared (previously derived from
// inferRouterOutputs<AppRouter>) since the router no longer exists to infer from.

import { useQuery } from '@tanstack/react-query';
import { platformGet } from './client';

// The period enum — identical to the deleted tRPC `periodInput` z.enum AND the C# AllowedPeriods.
export type ReportingPeriod = '7D' | '30D' | '90D' | '6M' | '1Y';

// The C# minimal-API OpenAPI contract types every integer/double as `number | string` (a
// number-as-string read artifact) and every nullable numeric as `null | number | string`.
// These coercers restore the exact `number` / `number | null` shape the FE expects.
const num = (v: number | string): number => Number(v);
const numOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v));

export interface ReportingKpis {
  period: ReportingPeriod;
  timeToFillDays: number | null;
  timeToHireDays: number | null;
  hires: number;
  offersSent: number;
  offersAccepted: number;
  offerAcceptRatePct: number | null;
  totalApplications: number;
  lostByDelay: number;
}

export interface ReportingFunnelStage {
  name: string;
  count: number;
  pctOfMax: number;
}

export interface ReportingFunnel {
  stages: ReportingFunnelStage[];
  totalApplications: number;
  totalHired: number;
  conversionPct: number | null;
}

export interface ReportingSourceBreakdownRow {
  source: string;
  applications: number;
  hires: number;
}

export interface ReportingTrendBucket {
  year: number;
  month: number;
  count: number;
}

export interface ReportingLostByDelayItem {
  stageName: string;
  slaDays: number;
  lostCount: number;
  avgDaysOver: number;
}

export interface ReportingLostByDelay {
  total: number;
  items: ReportingLostByDelayItem[];
}

export interface ReportingRecruiterSlaRow {
  name: string;
  vacancies: number;
  candidates: number;
  avgTtfDays: number | null;
  slaCompliancePct: number | null;
}

/** Recruitment-analytics KPI row. GET /reporting/kpis?period=… */
export function useReportingKpis(period: ReportingPeriod) {
  return useQuery<ReportingKpis>({
    queryKey: ['platform-api', 'reporting', 'kpis', period],
    queryFn: async () => {
      const raw = await platformGet('/reporting/kpis', { period });
      return {
        period: raw.period as ReportingPeriod,
        timeToFillDays: numOrNull(raw.timeToFillDays),
        timeToHireDays: numOrNull(raw.timeToHireDays),
        hires: num(raw.hires),
        offersSent: num(raw.offersSent),
        offersAccepted: num(raw.offersAccepted),
        offerAcceptRatePct: numOrNull(raw.offerAcceptRatePct),
        totalApplications: num(raw.totalApplications),
        lostByDelay: num(raw.lostByDelay),
      };
    },
  });
}

/** Current org-wide funnel (3 call sites: analytics-funnel + both dashboards). GET /reporting/funnel. */
export function useReportingFunnel() {
  return useQuery<ReportingFunnel>({
    queryKey: ['platform-api', 'reporting', 'funnel'],
    queryFn: async () => {
      const raw = await platformGet('/reporting/funnel');
      return {
        stages: raw.stages.map((s) => ({
          name: s.name,
          count: num(s.count),
          pctOfMax: num(s.pctOfMax),
        })),
        totalApplications: num(raw.totalApplications),
        totalHired: num(raw.totalHired),
        conversionPct: numOrNull(raw.conversionPct),
      };
    },
  });
}

/** Applications + hires per source, top 6 (period-relative). GET /reporting/source-breakdown?period=…. */
export function useReportingSourceBreakdown(period: ReportingPeriod) {
  return useQuery<ReportingSourceBreakdownRow[]>({
    queryKey: ['platform-api', 'reporting', 'source-breakdown', period],
    queryFn: async () => {
      const raw = await platformGet('/reporting/source-breakdown', { period });
      return raw.map((s) => ({
        source: s.source,
        applications: num(s.applications),
        hires: num(s.hires),
      }));
    },
  });
}

/** Applications per month, last 6 UTC calendar months (oldest-first). GET /reporting/trend. */
export function useReportingTrend() {
  return useQuery<ReportingTrendBucket[]>({
    queryKey: ['platform-api', 'reporting', 'trend'],
    queryFn: async () => {
      const raw = await platformGet('/reporting/trend');
      return raw.map((b) => ({
        year: num(b.year),
        month: num(b.month),
        count: num(b.count),
      }));
    },
  });
}

/** Candidates rejected while overdue on their stage SLA (period-relative). GET /reporting/lost-by-delay?period=…. */
export function useReportingLostByDelay(period: ReportingPeriod) {
  return useQuery<ReportingLostByDelay>({
    queryKey: ['platform-api', 'reporting', 'lost-by-delay', period],
    queryFn: async () => {
      const raw = await platformGet('/reporting/lost-by-delay', { period });
      return {
        total: num(raw.total),
        items: raw.items.map((i) => ({
          stageName: i.stageName,
          slaDays: num(i.slaDays),
          lostCount: num(i.lostCount),
          avgDaysOver: num(i.avgDaysOver),
        })),
      };
    },
  });
}

/** Per-recruiter workload + SLA compliance. GET /reporting/recruiter-sla. */
export function useReportingRecruiterSla() {
  return useQuery<ReportingRecruiterSlaRow[]>({
    queryKey: ['platform-api', 'reporting', 'recruiter-sla'],
    queryFn: async () => {
      const raw = await platformGet('/reporting/recruiter-sla');
      return raw.map((r) => ({
        name: r.name,
        vacancies: num(r.vacancies),
        candidates: num(r.candidates),
        avgTtfDays: numOrNull(r.avgTtfDays),
        slaCompliancePct: numOrNull(r.slaCompliancePct),
      }));
    },
  });
}
```

- [ ] **Step 7: Type-check + run the surviving tests**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: no errors (root.ts and the deleted router file compile clean).

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (reporting.ts no longer references `trpc`, `AppRouter`, or `inferRouterOutputs`).

Run: `npx vitest run scripts/parity/surfaces.test.ts tests/reporting tests/recruitment-analytics`
Expected: all PASS. `tests/access/scope-wiring-analytics.test.ts` should report "no test files found"
if referenced directly — confirm it's gone: `test -f tests/access/scope-wiring-analytics.test.ts && echo STILL THERE || echo deleted`.

- [ ] **Step 8: Commit**

```bash
git add -A -- packages/api/src/root.ts scripts/parity/surfaces.ts scripts/parity/surfaces.test.ts \
  apps/web/lib/platform-api/reporting.ts
git add packages/api/src/routers/recruitment-analytics.ts tests/access/scope-wiring-analytics.test.ts
git commit -m "refactor(reporting): delete dead TS recruitment-analytics router + fallback"
```

---

### Task 3: Delete the `evaluation360` TS surface (read + write)

Both `NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP` and `NEXT_PUBLIC_EVALUATION360_WRITE_VIA_CSHARP`
are confirmed `true` in prod. Same shape as Task 2, but touches both read and write hooks, and two
test files need surgery rather than outright deletion (Task 1 already relocated the one schema
worth preserving).

**Files:**

- Delete: `packages/api/src/routers/evaluation360.ts`
- Modify: `packages/api/src/root.ts:35,92`
- Modify: `tests/access/scope-wiring-evaluation360.test.ts` (prune to the behavioral describe only)
- Modify: `tests/evaluation360/evaluation360-router-self-service.test.ts` (prune router-wiring describe)
- Modify: `scripts/parity/surfaces.ts` (the `evaluation360: {...}` block)
- Modify: `scripts/parity/surfaces.test.ts` (lines 90-117 and 119-146)
- Modify: `apps/web/lib/platform-api/evaluation360.ts` (full rewrite)

**Interfaces:**

- Consumes: `submitRatingsInput` from `@tims/shared` (Task 1) — used only by the test, not by the
  wrapper or router (both are being deleted).
- Produces: `useEvaluation360ListCycles`, `useEvaluation360CycleProgress`, `useEvaluation360MyRaterTasks`,
  `useEvaluation360MyReport`, `useEvaluation360MyReportCycles`, `useEvaluation360CreateCycle`,
  `useEvaluation360OpenCycle`, `useEvaluation360CloseCycle`, `useEvaluation360PublishCycle`,
  `useEvaluation360AssignRaters`, `useEvaluation360SubmitRatings` — same exported names/signatures as
  before, so every FE call site (`create-cycle-form.tsx`, `cycle-row.tsx`, `assign-raters-form.tsx`,
  `rater-task-card.tsx`, the cycles/reports pages) needs zero changes.

- [ ] **Step 1: Delete the router file**

```bash
git rm packages/api/src/routers/evaluation360.ts
```

- [ ] **Step 2: Remove its registration from root.ts**

In `packages/api/src/root.ts:35`, delete the import line:

```typescript
import { evaluation360Router } from './routers/evaluation360';
```

In `packages/api/src/root.ts:92`, delete the appRouter entry:

```typescript
  evaluation360: evaluation360Router,
```

- [ ] **Step 3: Prune `scope-wiring-evaluation360.test.ts` to the behavioral describe only**

Replace the full content of `tests/access/scope-wiring-evaluation360.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { requireOrgScope } from '../../packages/api/src/access/org-gate';
import type { AccessContext } from '../../packages/api/src/access/types';

// Fix wave (CRITICAL scope-escalation fix), Sprint 1.7 Slice 2 — evaluation360 admin
// procedures used to be org-admin operations gated by requireOrgScope(ctx.access) as the
// first statement in every resolver (permissionProcedure only checks a grant EXISTS for
// module+action, it does NOT enforce scope). The TS evaluation360 router has since been
// deleted (C# cutover complete, NEXT_PUBLIC_EVALUATION360_READ/WRITE_VIA_CSHARP both true) —
// static source-text wiring assertions against that file no longer apply (see git history for
// the original router-wiring test if the C# equivalent ever needs auditing). What remains here
// is requireOrgScope's own behavior, which is still live production code shared across every
// TS router that calls it.

describe('requireOrgScope — behavioral (own/team/unit FORBIDDEN, company/organization pass)', () => {
  const ctxWith = (scope: AccessContext['scope']): AccessContext => ({
    allowed: true,
    scope,
    roles: ['employee'],
    anchors: null,
  });

  it.each(['own', 'team', 'unit'] as const)('throws FORBIDDEN for scope=%s', (scope) => {
    expect.assertions(1);
    try {
      requireOrgScope(ctxWith(scope));
    } catch (err) {
      expect((err as { code?: string }).code).toBe('FORBIDDEN');
    }
  });

  it.each(['company', 'organization'] as const)('does not throw for scope=%s', (scope) => {
    expect(() => requireOrgScope(ctxWith(scope))).not.toThrow();
  });
});
```

- [ ] **Step 4: Prune `evaluation360-router-self-service.test.ts` to the zod + access-wiring describes**

Replace the full content of `tests/evaluation360/evaluation360-router-self-service.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { submitRatingsInput } from '@tims/shared';

// Sprint 1.7 Slice 3 — evaluation360 self-service rating submission input (zod). The TS
// evaluation360 router that used to own this schema has been deleted (C# cutover complete);
// the schema itself moved to packages/shared/src/validators/evaluation360.ts since it encodes
// a real business rule (exactly 6 ratings, one per competency) worth keeping under test
// independent of which stack enforces it at the API boundary.

const ROOT = join(__dirname, '..', '..');

const SIX_RATINGS = [
  { competencyKey: 'leadership' as const, rating: 4 },
  { competencyKey: 'communication' as const, rating: 4 },
  { competencyKey: 'collaboration' as const, rating: 4 },
  { competencyKey: 'execution' as const, rating: 4 },
  { competencyKey: 'adaptability' as const, rating: 4 },
  { competencyKey: 'integrity' as const, rating: 4 },
];

describe('submitRatingsInput (zod)', () => {
  const ASSIGNMENT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('accepts exactly 6 ratings, one per competency, rating 1-5, optional bounded comment', () => {
    const result = submitRatingsInput.safeParse({
      assignmentId: ASSIGNMENT_ID,
      ratings: SIX_RATINGS.map((r) => ({ ...r, comment: 'ok' })),
    });
    expect(result.success).toBe(true);
  });

  it('rejects 5 ratings (missing one competency)', () => {
    const result = submitRatingsInput.safeParse({
      assignmentId: ASSIGNMENT_ID,
      ratings: SIX_RATINGS.slice(0, 5),
    });
    expect(result.success).toBe(false);
  });

  it('rejects 6 ratings with a duplicate competencyKey (even though length is 6)', () => {
    const dupRatings = [...SIX_RATINGS.slice(0, 5), { competencyKey: 'leadership' as const, rating: 3 }];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: dupRatings });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown competencyKey', () => {
    const badRatings = [...SIX_RATINGS.slice(0, 5), { competencyKey: 'not_a_competency', rating: 3 }];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: badRatings });
    expect(result.success).toBe(false);
  });

  it('rejects a rating outside 1-5', () => {
    const badRatings = [...SIX_RATINGS.slice(0, 5), { competencyKey: 'integrity' as const, rating: 6 }];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: badRatings });
    expect(result.success).toBe(false);
  });

  it('rejects a comment over 5000 chars', () => {
    const badRatings = [
      ...SIX_RATINGS.slice(0, 5),
      { competencyKey: 'integrity' as const, rating: 3, comment: 'x'.repeat(5001) },
    ];
    const result = submitRatingsInput.safeParse({ assignmentId: ASSIGNMENT_ID, ratings: badRatings });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid assignmentId', () => {
    const result = submitRatingsInput.safeParse({ assignmentId: 'not-a-uuid', ratings: SIX_RATINGS });
    expect(result.success).toBe(false);
  });
});

describe('evaluation360 access wiring — raterAssignment identity-anchoring', () => {
  // Fix wave (Important — RBAC over-restriction, opus): rater self-service is IDENTITY-anchored
  // (raterUserId/subjectUserId === ctx.user.id), not an RBAC grant. raterAssignment must stay
  // OUT of the scope system entirely — registering it as a ScopedEntity would let
  // assertScoped/scopeWhereFor resolve an org-scoped caller's (super_admin/hr_admin) where-clause
  // to `{}`, letting an admin submit/read on behalf of another rater (forged 360 feedback).
  it('raterAssignment is not registered as a ScopedEntity (no assertScoped delegate) — confirms identity-anchoring is the only guard, by design', () => {
    const entityPolicies = readFileSync(join(ROOT, 'packages/api/src/access/entity-policies.ts'), 'utf8');
    const scopedProbe = readFileSync(join(ROOT, 'packages/api/src/access/scoped-probe.ts'), 'utf8');
    expect(entityPolicies).not.toMatch(/raterAssignment/);
    expect(scopedProbe).not.toMatch(/raterAssignment/);
  });
});
```

- [ ] **Step 5: Remove the `evaluation360` surface from the parity harness**

In `scripts/parity/surfaces.ts`, delete the entire `evaluation360: { ... }` block — starting at the
`// ── evaluation360 ──...` comment (immediately after the `team-intel` surface's closing `},`) and
ending at the `},` that closes the `evaluation360` object, immediately before the `// ── nine-box
──...` comment. This removes the full block including its 6-line explanatory comment.

- [ ] **Step 6: Fix surfaces.test.ts**

In `scripts/parity/surfaces.test.ts`, in the `'the four read surfaces are registered...'` test
(around line 90-117), delete these lines:

```typescript
expect(SURFACES['evaluation360'].flag).toBe('Platform__Evaluation360ReadEnabled');
expect(SURFACES['evaluation360'].endpoints.map((e) => e.name).sort()).toEqual([
  'cycle-progress',
  'cycles',
  'my-rater-tasks',
  'my-report',
  'my-report-cycles',
]);
```

and change the loop right after it from:

```typescript
    for (const key of ['compensation', 'evaluation360', 'ninebox', 'succession']) {
```

to:

```typescript
    for (const key of ['compensation', 'ninebox', 'succession']) {
```

In the `'every Tier-2 by-id endpoint sets idScopeKey...'` test, delete these two lines from the
`expected` map:

```typescript
      'evaluation360/cycle-progress': 'eval-cycle-staff',
      'evaluation360/my-report': 'eval-cycle-self',
```

and change the final count assertion from:

```typescript
expect(byIdCount).toBe(9);
```

to:

```typescript
expect(byIdCount).toBe(7);
```

(9 by-id endpoints minus the 2 evaluation360 ones removed above.)

- [ ] **Step 7: Rewrite the FE wrapper — C#-only, reads and writes**

Replace the full content of `apps/web/lib/platform-api/evaluation360.ts` with:

```typescript
'use client';

// C#-only evaluation360 hooks. The TS tRPC router (packages/api/src/routers/evaluation360.ts)
// has been deleted — NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP and
// NEXT_PUBLIC_EVALUATION360_WRITE_VIA_CSHARP are both true in every environment and there is no
// TS fallback left to route to. Types below are hand-declared (previously derived from
// inferRouterOutputs<AppRouter>) since the router no longer exists to infer from.

import { useMutation, useQuery } from '@tanstack/react-query';
import { EVAL360_COMPETENCIES, type Eval360Competency, type RaterRelationshipValue } from '@tims/shared';
import { platformGet, platformPost } from './client';

// Mirrors the Prisma `ReviewCycleStatus` enum (packages/db/prisma/schema/evaluation360.prisma).
type CycleStatus = 'draft' | 'open' | 'closed' | 'published';

export interface EvaluationCycle {
  id: string;
  name: string;
  status: CycleStatus;
  opensAt: Date | null;
  closesAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface CycleProgressRow {
  relationship: RaterRelationshipValue;
  total: number;
  submitted: number;
}

export interface CycleProgress {
  cycleId: string;
  progress: CycleProgressRow[];
}

export interface RaterTask {
  assignmentId: string;
  cycleId: string;
  cycleName: string;
  relationship: RaterRelationshipValue;
  subject: { firstName: string; lastName: string };
  competencies: readonly Eval360Competency[];
}

export interface ReportBucket {
  relationship: RaterRelationshipValue;
  raterCount: number;
  competencies: Array<{ competencyKey: Eval360Competency; average: number }>;
  comments: string[] | null;
}

export interface MyReport {
  cycleId: string;
  cycleName: string;
  buckets: ReportBucket[];
}

export interface MyReportCycle {
  cycleId: string;
  cycleName: string;
  publishedAt: Date | null;
}

// The C# minimal-API OpenAPI contract types every int32/double as `number | string` (a
// number-as-string read artifact); coerce back to the `number` the FE expects.
const num = (v: number | string): number => Number(v);

// DateTime fields serialize as canonical Node-ISO strings, nullable dates as JSON null.
// Reconstruct real Date objects to match the FE's existing Date-object expectations.
const toDate = (v: unknown): Date => new Date(v as string);
const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

/**
 * STAFF: the org's review cycles, newest first.
 * GET /evaluation360/cycles (ISO date strings rebuilt into Date objects, status DB-enum string
 * narrowed to CycleStatus).
 */
export function useEvaluation360ListCycles() {
  return useQuery<EvaluationCycle[]>({
    queryKey: ['platform-api', 'evaluation360', 'cycles'],
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/cycles');
      return raw.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status as CycleStatus,
        opensAt: toDateOrNull(c.opensAt),
        closesAt: toDateOrNull(c.closesAt),
        publishedAt: toDateOrNull(c.publishedAt),
        createdAt: toDate(c.createdAt),
      }));
    },
  });
}

/**
 * STAFF: per-relationship submitted/total assignment counts for a cycle (fixed relationship order,
 * every relationship present). An unknown cycle → 404 (isError).
 * GET /evaluation360/cycles/{cycleId}/progress (integer counts coerced to number).
 */
export function useEvaluation360CycleProgress(cycleId: string) {
  return useQuery<CycleProgress>({
    queryKey: ['platform-api', 'evaluation360', 'cycle-progress', cycleId],
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/cycles/{cycleId}/progress', undefined, { cycleId });
      return {
        cycleId: raw.cycleId,
        progress: raw.progress.map((row) => ({
          relationship: row.relationship as RaterRelationshipValue,
          total: num(row.total),
          submitted: num(row.submitted),
        })),
      };
    },
  });
}

/**
 * SELF-SERVICE: the caller's pending rater assignments in open cycles, each with the subject's
 * display name and the fixed 360 competency set.
 * GET /evaluation360/my/rater-tasks. `competencies` returns the shared EVAL360_COMPETENCIES tuple.
 */
export function useEvaluation360MyRaterTasks() {
  return useQuery<RaterTask[]>({
    queryKey: ['platform-api', 'evaluation360', 'my-rater-tasks'],
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/my/rater-tasks');
      return raw.map((task) => ({
        assignmentId: task.assignmentId,
        cycleId: task.cycleId,
        cycleName: task.cycleName,
        relationship: task.relationship as RaterRelationshipValue,
        subject: { firstName: task.subject.firstName, lastName: task.subject.lastName },
        // Fixed, ordered set — returning the shared const preserves the exact readonly-tuple shape.
        competencies: EVAL360_COMPETENCIES,
      }));
    },
  });
}

/**
 * SELF-SERVICE: the caller's anonymized 360 report for one PUBLISHED cycle (buckets are the output
 * of the shared min-3 anonymity kernel; only shown buckets are ever present). A not-published /
 * not-a-subject cycle → 404 (isError).
 * GET /evaluation360/my/reports/{cycleId}. raterCount + per-competency averages coerced to number;
 * comments (null for peer/direct_report, string[] for self/manager) preserved; bucket order kept.
 */
export function useEvaluation360MyReport(cycleId: string) {
  return useQuery<MyReport>({
    queryKey: ['platform-api', 'evaluation360', 'my-report', cycleId],
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/my/reports/{cycleId}', undefined, { cycleId });
      return {
        cycleId: raw.cycleId,
        cycleName: raw.cycleName,
        buckets: raw.buckets.map((bucket) => ({
          relationship: bucket.relationship as RaterRelationshipValue,
          raterCount: num(bucket.raterCount),
          competencies: bucket.competencies.map((c) => ({
            competencyKey: c.competencyKey as Eval360Competency,
            average: num(c.average),
          })),
          comments: bucket.comments,
        })),
      };
    },
  });
}

/**
 * SELF-SERVICE: the PUBLISHED cycles the caller is a subject of (drives the "My Reports" list).
 * GET /evaluation360/my/report-cycles (publishedAt ISO string rebuilt into a Date, preserving null).
 */
export function useEvaluation360MyReportCycles() {
  return useQuery<MyReportCycle[]>({
    queryKey: ['platform-api', 'evaluation360', 'my-report-cycles'],
    queryFn: async () => {
      const raw = await platformGet('/evaluation360/my/report-cycles');
      return raw.map((c) => ({
        cycleId: c.cycleId,
        cycleName: c.cycleName,
        publishedAt: toDateOrNull(c.publishedAt),
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Writes — the TS evaluation360 router (and its trpc mutations) no longer exist; every hook below
// calls the C# service directly. Error messages are byte-identical between stacks (verified
// against Evaluation360WriteEndpoints.cs's message constants), so a shared `err.message` toast
// works unchanged. Consumers already invalidate the `['platform-api','evaluation360',...]` query
// keys themselves post-success (see create-cycle-form.tsx) — this file only supplies the mutation.
// ---------------------------------------------------------------------------

interface MutationOptions {
  onSuccess?: () => void;
  onError?: (err: { message: string }) => void;
  onSettled?: () => void;
}

function useCSharpMutation<TInput>(
  mutationFn: (input: TInput) => Promise<unknown>,
  options: MutationOptions | undefined,
) {
  return useMutation({
    mutationFn,
    onSuccess: options?.onSuccess,
    onError: (err: unknown) => options?.onError?.(err instanceof Error ? err : { message: 'Unknown error' }),
    onSettled: options?.onSettled,
  });
}

/** STAFF: create a cycle (1 call site: create-cycle-form.tsx). */
export function useEvaluation360CreateCycle(options?: MutationOptions) {
  return useCSharpMutation(
    (input: { name: string }) => platformPost('/evaluation360/cycles', { name: input.name }),
    options,
  );
}

/** STAFF: open a cycle (1 call site: cycle-row.tsx). */
export function useEvaluation360OpenCycle(options?: MutationOptions) {
  return useCSharpMutation(
    (input: { cycleId: string }) => platformPost('/evaluation360/cycles/{id}/open', undefined, { id: input.cycleId }),
    options,
  );
}

/** STAFF: close a cycle (1 call site: cycle-row.tsx). */
export function useEvaluation360CloseCycle(options?: MutationOptions) {
  return useCSharpMutation(
    (input: { cycleId: string }) => platformPost('/evaluation360/cycles/{id}/close', undefined, { id: input.cycleId }),
    options,
  );
}

/** STAFF: publish a cycle (1 call site: cycle-row.tsx). */
export function useEvaluation360PublishCycle(options?: MutationOptions) {
  return useCSharpMutation(
    (input: { cycleId: string }) =>
      platformPost('/evaluation360/cycles/{id}/publish', undefined, { id: input.cycleId }),
    options,
  );
}

interface RaterAssignmentInputShape {
  subjectUserId: string;
  raterUserId: string;
  relationship: string;
}

/** STAFF: assign raters to a cycle (1 call site: assign-raters-form.tsx). */
export function useEvaluation360AssignRaters(options?: MutationOptions) {
  return useCSharpMutation(
    (input: { cycleId: string; assignments: RaterAssignmentInputShape[] }) =>
      platformPost('/evaluation360/cycles/{id}/raters', { assignments: input.assignments }, { id: input.cycleId }),
    options,
  );
}

interface RatingInputShape {
  competencyKey: string;
  rating: number;
  comment?: string;
}

/** SELF-SERVICE: submit ratings for a rater assignment (1 call site: rater-task-card.tsx). */
export function useEvaluation360SubmitRatings(options?: MutationOptions) {
  return useCSharpMutation(
    (input: { assignmentId: string; ratings: RatingInputShape[] }) =>
      platformPost('/evaluation360/assignments/{id}/ratings', { ratings: input.ratings }, { id: input.assignmentId }),
    options,
  );
}
```

- [ ] **Step 8: Type-check + run the surviving tests**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: no errors.

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (evaluation360.ts no longer references `trpc`, `AppRouter`, or `inferRouterOutputs`).

Run: `npx vitest run scripts/parity/surfaces.test.ts tests/access/scope-wiring-evaluation360.test.ts tests/evaluation360`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add -A -- packages/api/src/root.ts scripts/parity/surfaces.ts scripts/parity/surfaces.test.ts \
  apps/web/lib/platform-api/evaluation360.ts tests/access/scope-wiring-evaluation360.test.ts \
  tests/evaluation360/evaluation360-router-self-service.test.ts
git add packages/api/src/routers/evaluation360.ts
git commit -m "refactor(evaluation360): delete dead TS router + fallback (read + write)"
```

---

### Task 4: Full-repo verification + dangling-reference sweep

**Files:** none (verification only).

- [ ] **Step 1: Full type-check**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Run: `cd apps/web && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all PASS, no failures introduced (per [[feedback_verify_full_suite_before_merge]] — tsc
alone is not sufficient, a prior regression slipped through when only tsc was checked).

- [ ] **Step 3: Dangling-reference grep sweep**

```bash
grep -rn "recruitmentAnalyticsRouter\|evaluation360Router" packages/ apps/ --include="*.ts" --include="*.tsx"
grep -rn "trpc\.recruitmentAnalytics\|trpc\.evaluation360" apps/ --include="*.ts" --include="*.tsx"
grep -rn "RouterOutput\['recruitmentAnalytics'\]\|RouterOutput\['evaluation360'\]" apps/ --include="*.ts"
grep -rn "routers/recruitment-analytics\|routers/evaluation360" packages/ tests/ scripts/ --include="*.ts"
```

Expected: no matches (the last grep should only match the deleted files' own former paths in
comments you intentionally kept, if any — check each hit).

- [ ] **Step 4: Build check**

Run: `cd apps/web && npx next build` (or the project's standard `/gate` build step)
Expected: succeeds — confirms no dead import breaks the production bundle.

- [ ] **Step 5: Final commit (if Step 3 required fixes)**

Only if Step 3 surfaced anything needing a fix — otherwise this task has no commit of its own,
Tasks 1-3 already committed everything.

---

## Post-plan follow-ups (not part of this plan, noted for memory)

- `scripts/parity/seed.ts`'s `eval-cycle-staff` / `eval-cycle-self` `ResourcePair` entries are now
  fully orphaned (nothing references them once `surfaces.ts`'s evaluation360 by-id endpoints are
  gone). Harmless, low-priority cleanup if ever revisited.
- The three now-unused Vercel env vars (`NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP`,
  `NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP`, `NEXT_PUBLIC_EVALUATION360_WRITE_VIA_CSHARP`) can stay
  set to `true` in prod indefinitely (harmless — nothing reads them anymore since the wrappers no
  longer branch on them) or be removed from Vercel for tidiness; either is fine, not urgent.
