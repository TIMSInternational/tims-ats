# Assessment Player — Slice 5: Local Norm Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `AssessmentResult.percentile` (already exists, currently always null) plus two new columns (`band`, `normSampleSize`) with a dynamic, per-org, per-assessment-type percentile/quartile-band computed from real candidate score distributions — never fabricated, never static/external reference data.

**Architecture:** Extend the existing `submitAssessment` write transaction (`candidate-assessment.service.ts`) to compute a norm band inline against the org's other completed non-partial results for the same assessment type, using a new pure function `computeNormBand`. A one-time idempotent backfill script catches up already-completed results. Surfaced on the candidate result screen and the one existing staff-facing UI that shows assessment results (candidate detail page).

**Tech Stack:** TypeScript, Prisma (PostgreSQL), tRPC, vitest, Next.js/React, existing `@tims/shared`/`@tims/db`/`@tims/api` packages.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-01-assessment-player-norm-scoring-design.md` (approved 2026-08-01). Every task below implements a specific section of it — do not deviate from the scoping decisions there (dynamic/local per-org norms, 4-quartile bands, `MIN_SAMPLE_SIZE = 5`, snapshot-at-submit-time, backfill once).
- No `any` types. Strict TypeScript. Zod at every boundary that doesn't already have it (most of this plan touches existing Zod-validated paths).
- Every Prisma query uses explicit `select` — never a bare `findMany`/`findFirst` without one.
- Multi-step DB writes stay inside the existing `runTenantTransaction`/`$transaction` — do not add a second, separate write outside the transaction that already exists in `submitAssessment`.
- TDD: write the failing test first for every pure-function and service-layer change.
- File size limits: no file this plan touches should exceed CLAUDE.md's 300/500-line caps after edits — none will, based on current sizes.

---

### Task 1: Pure function `computeNormBand` + `ScoreBand` type

**Files:**

- Modify: `packages/shared/src/validators/assessment.ts` (currently 188 lines — adding ~35 lines, stays well under any limit)
- Test: `tests/assessment/assessment-scoring.test.ts` (extend existing file)

**Interfaces:**

- Produces: `ScoreBand` type (`'below_average' | 'average' | 'above_average' | 'excellent'`), `MIN_NORM_SAMPLE_SIZE` constant (`5`), `computeNormBand(candidateScore: number, populationScores: number[]): { percentile: number; band: ScoreBand } | null`.
- Consumed by: Task 5 (service layer).

- [ ] **Step 1: Write the failing tests**

Add to `tests/assessment/assessment-scoring.test.ts` (new `describe` block, after the existing `computeResult` block):

```ts
import { computeNormBand, MIN_NORM_SAMPLE_SIZE } from '../../packages/shared/src/validators/assessment';

describe('computeNormBand', () => {
  it('returns null when the population is below MIN_NORM_SAMPLE_SIZE', () => {
    expect(computeNormBand(80, [70, 75, 90, 60])).toBeNull(); // 4 < 5
  });

  it('returns null for an empty population', () => {
    expect(computeNormBand(80, [])).toBeNull();
  });

  it('computes below_average for a score at the bottom of a 5+ population', () => {
    expect(computeNormBand(10, [20, 30, 40, 50, 60])).toEqual({ percentile: 0, band: 'below_average' });
  });

  it('computes excellent for a score at the top of a 5+ population', () => {
    expect(computeNormBand(100, [20, 30, 40, 50, 60])).toEqual({ percentile: 100, band: 'excellent' });
  });

  it('computes average for a score in the middle (25-50th percentile band)', () => {
    // candidate scores 45: 2 of 6 population strictly below (20,30), 0 equal
    // percentile = (2 + 0.5*0) / 6 * 100 = 33.33 -> average band [25,50)
    const result = computeNormBand(45, [20, 30, 50, 60, 70, 80]);
    expect(result?.band).toBe('average');
    expect(result?.percentile).toBeCloseTo(33.33, 1);
  });

  it('computes above_average for a score in the 50-75th percentile band', () => {
    // candidate scores 65: 4 of 6 below (20,30,50,60), percentile = 4/6*100 = 66.67 -> above_average
    const result = computeNormBand(65, [20, 30, 50, 60, 70, 80]);
    expect(result?.band).toBe('above_average');
    expect(result?.percentile).toBeCloseTo(66.67, 1);
  });

  it('splits a tie using the midpoint-rank formula (ties do not favor either side)', () => {
    // candidate scores 50, population has two other 50s among 5 total.
    // countBelow=0 (nothing strictly below 50), countEqual=2 -> (0 + 0.5*2)/5*100 = 20
    const result = computeNormBand(50, [50, 50, 60, 70, 80]);
    expect(result?.percentile).toBeCloseTo(20, 1);
  });

  it('is exactly MIN_NORM_SAMPLE_SIZE at the boundary (5 population members is enough)', () => {
    expect(computeNormBand(50, [10, 20, 30, 40, 60])).not.toBeNull();
  });
});

describe('MIN_NORM_SAMPLE_SIZE', () => {
  it('is 5', () => {
    expect(MIN_NORM_SAMPLE_SIZE).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/assessment/assessment-scoring.test.ts`
Expected: FAIL — `computeNormBand` and `MIN_NORM_SAMPLE_SIZE` are not exported yet.

- [ ] **Step 3: Write the minimal implementation**

Append to `packages/shared/src/validators/assessment.ts` (after the `computeResult` function, before the "Candidate submit input" section comment):

```ts
// ---------------------------------------------------------------------------
// Assessment Player Slice 5 — local norm scoring (dynamic, per-org, per-type).
// See docs/superpowers/specs/2026-08-01-assessment-player-norm-scoring-design.md.
// Pure, TDD-first (no DB/network) — mirrors scoreChoice/computeResult above.
// ---------------------------------------------------------------------------

export type ScoreBand = 'below_average' | 'average' | 'above_average' | 'excellent';

// Below this many OTHER completed results, a percentile is statistically
// meaningless — return null (honest N/D) rather than a number computed off
// too few data points.
export const MIN_NORM_SAMPLE_SIZE = 5;

export interface NormBandResult {
  percentile: number;
  band: ScoreBand;
}

function bandForPercentile(percentile: number): ScoreBand {
  if (percentile < 25) return 'below_average';
  if (percentile < 50) return 'average';
  if (percentile < 75) return 'above_average';
  return 'excellent';
}

/**
 * Percentile rank of `candidateScore` within `populationScores` (every OTHER
 * completed non-partial result for the same org + assessment type), using the
 * standard midpoint-rank formula so ties don't arbitrarily favor either side.
 * Returns null below MIN_NORM_SAMPLE_SIZE — an honest "not enough data yet",
 * never a fabricated number.
 */
export function computeNormBand(candidateScore: number, populationScores: number[]): NormBandResult | null {
  if (populationScores.length < MIN_NORM_SAMPLE_SIZE) return null;

  let countBelow = 0;
  let countEqual = 0;
  for (const score of populationScores) {
    if (score < candidateScore) countBelow++;
    else if (score === candidateScore) countEqual++;
  }
  const percentile = ((countBelow + 0.5 * countEqual) / populationScores.length) * 100;
  return { percentile, band: bandForPercentile(percentile) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/assessment/assessment-scoring.test.ts`
Expected: PASS, all new + existing tests in this file green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/validators/assessment.ts tests/assessment/assessment-scoring.test.ts
git commit -m "feat(assessment): add computeNormBand pure function for local norm scoring"
```

---

### Task 2: Schema migration — `ScoreBand` enum + `band`/`normSampleSize` columns

**Files:**

- Modify: `packages/db/prisma/schema/assessment.prisma`
- Create: `packages/db/prisma/migrations/20260801000000_assessment_norm_scoring/migration.sql`

**Interfaces:**

- Produces: `AssessmentResult.band` (nullable enum column), `AssessmentResult.normSampleSize` (nullable int column). `percentile` column already exists (no change needed).
- Consumed by: Task 3 (Prisma select typing), Task 4 (repository writes/reads).

- [ ] **Step 1: Edit the Prisma schema**

In `packages/db/prisma/schema/assessment.prisma`, add a new enum right after the existing `QuestionType` enum (line 96, before `model AssessmentQuestion`):

```prisma
enum ScoreBand {
  below_average
  average
  above_average
  excellent
}
```

Then modify the `AssessmentResult` model (currently lines 54-72) — add two fields after `percentile`:

```prisma
model AssessmentResult {
  id              String     @id @default(uuid()) @db.Uuid
  organizationId  String     @map("organization_id") @db.Uuid
  assignmentId    String     @unique @map("assignment_id") @db.Uuid
  rawScore        Float?     @map("raw_score")
  normalizedScore Float?     @map("normalized_score")
  percentile      Float?
  band            ScoreBand?
  normSampleSize  Int?       @map("norm_sample_size")
  breakdown       Json?
  interpretation  Json?
  modelVersion    String?    @map("model_version")
  scoredAt        DateTime   @default(now()) @map("scored_at")
  createdAt       DateTime   @default(now()) @map("created_at")
  updatedAt       DateTime   @updatedAt @map("updated_at")

  assignment AssessmentAssignment @relation(fields: [assignmentId], references: [id])

  @@index([organizationId])
  @@map("assessment_results")
}
```

- [ ] **Step 2: Write the migration SQL**

Create `packages/db/prisma/migrations/20260801000000_assessment_norm_scoring/migration.sql`:

```sql
-- Assessment Player Slice 5 — local norm scoring.
-- Adds ScoreBand enum + band/norm_sample_size columns to assessment_results.
-- Additive, idempotent (safe to re-run). No RLS change needed — the table
-- already has RLS enabled (assessment_results existed since 20260610200000).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ScoreBand') THEN
    CREATE TYPE "ScoreBand" AS ENUM ('below_average', 'average', 'above_average', 'excellent');
  END IF;
END $$;

ALTER TABLE "assessment_results"
  ADD COLUMN IF NOT EXISTS "band" "ScoreBand",
  ADD COLUMN IF NOT EXISTS "norm_sample_size" INTEGER;
```

- [ ] **Step 3: Apply the migration locally and regenerate the client**

Run: `cd packages/db && npx prisma db push --schema prisma/schema`
Expected: schema pushed, no errors, output confirms `assessment_results` table updated.

Run: `cd packages/db && npx prisma generate`
Expected: Prisma client regenerated with `ScoreBand` enum and the two new `AssessmentResult` fields.

- [ ] **Step 4: Verify the type check passes**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: PASS (no existing code references the new fields yet, so nothing should break).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema/assessment.prisma packages/db/prisma/migrations/20260801000000_assessment_norm_scoring/
git commit -m "feat(db): add ScoreBand enum + band/normSampleSize columns to AssessmentResult"
```

---

### Task 3: Access classification + `AssessmentResultRow` type

**Files:**

- Modify: `packages/api/src/access/classification.ts:88-98` (the `assessmentResult` entry)
- Modify: `packages/api/src/routers/assessment.ts:23-33` (the `AssessmentResultRow` interface)
- Test: `tests/access/select-for.test.ts` (extend existing file — this is the real unit-test home for `selectFor`/classification.ts; `tests/access/scope-wiring-assessment.test.ts` is a different, source-text-grep test for router-level scope wiring and is NOT touched by this task)

**Interfaces:**

- Consumes: `ScoreBand` type from Task 1 (`@tims/shared`).
- Produces: `selectFor(roles, 'assessmentResult')` now includes `band`/`normSampleSize` for the same roles as `percentile`. `AssessmentResultRow.band?: ScoreBand | null` and `.normSampleSize?: number | null`.

- [ ] **Step 1: Write the failing test**

Add to `tests/access/select-for.test.ts`, inside the existing `describe('selectFor — builds a Prisma select from visible fields', ...)` block, alongside the existing `assessmentResult` assertions (after the `'assessmentResult anchors include assignmentId but not userId'` test, currently lines 39-43):

```ts
it('band + normSampleSize selected for the same roles as percentile (recruiter/hr_admin), not for an unlisted role', () => {
  expect(selectFor(['recruiter'], 'assessmentResult').band).toBe(true);
  expect(selectFor(['recruiter'], 'assessmentResult').normSampleSize).toBe(true);
  expect(selectFor(['hr_admin'], 'assessmentResult').band).toBe(true);
  expect(selectFor(['leader'], 'assessmentResult').band).toBeUndefined();
  expect(selectFor(['leader'], 'assessmentResult').normSampleSize).toBeUndefined();
});
```

(`'leader'` is deliberately used as the "should NOT see it" case — `LEADER` is not in `percentile`'s role list in `classification.ts`, so it's the correct negative fixture; matches the existing file's role-string convention exactly, e.g. `selectFor(['super_admin'], ...)`, `selectFor(['hr_admin'], ...)` on lines 6/12/17/23/28/29.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/access/select-for.test.ts`
Expected: FAIL — `band`/`normSampleSize` not yet in the classification matrix, so `selectFor(...).band` is `undefined` for every role including `recruiter`/`hr_admin`.

- [ ] **Step 3: Register the new fields in classification.ts**

In `packages/api/src/access/classification.ts`, modify the `assessmentResult.fields` block (currently lines 90-97):

```ts
  assessmentResult: {
    dataClass: 'restricted',
    fields: {
      breakdown: { dataClass: 'restricted', roles: [SUPER, EXTERNAL] },
      rawScore: { dataClass: 'restricted', roles: [SUPER, EXTERNAL] },
      normalizedScore: { dataClass: 'confidential', roles: [SUPER, HR, HRBP, RECRUITER, EMPLOYEE, EXTERNAL] },
      percentile: { dataClass: 'confidential', roles: [SUPER, HR, HRBP, RECRUITER, EMPLOYEE, EXTERNAL] },
      band: { dataClass: 'confidential', roles: [SUPER, HR, HRBP, RECRUITER, EMPLOYEE, EXTERNAL] },
      normSampleSize: { dataClass: 'confidential', roles: [SUPER, HR, HRBP, RECRUITER, EMPLOYEE, EXTERNAL] },
      interpretation: { dataClass: 'confidential', roles: [SUPER, HR, HRBP, RECRUITER, EMPLOYEE, EXTERNAL] },
      modelVersion: { dataClass: 'internal', roles: [SUPER, HR, EXTERNAL] },
    },
  },
```

(`band`/`normSampleSize` get the exact same roles as `percentile` — same comparative-context sensitivity tier, per the design spec.)

- [ ] **Step 4: Update the `AssessmentResultRow` interface**

In `packages/api/src/routers/assessment.ts`, modify the interface (currently lines 23-33):

```ts
import type { ScoreBand } from '@tims/shared';

interface AssessmentResultRow {
  id: string;
  organizationId: string;
  assignmentId: string;
  normalizedScore?: number | null;
  percentile?: number | null;
  band?: ScoreBand | null;
  normSampleSize?: number | null;
  interpretation?: string | null;
  // restricted — present ONLY when selectFor included them (super_admin):
  rawScore?: number | null;
  breakdown?: unknown;
}
```

(Add the `import type { ScoreBand } from '@tims/shared';` alongside the existing `@tims/shared` import at the top of the file if one already exists — check line 6-11 first and merge into that import statement rather than adding a second one.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/access/select-for.test.ts`
Expected: PASS.

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/access/classification.ts packages/api/src/routers/assessment.ts tests/access/select-for.test.ts
git commit -m "feat(assessment): register band/normSampleSize in the field-level access matrix"
```

---

### Task 4: Repository — population-score query + extend result upsert + candidate select

**Files:**

- Modify: `packages/api/src/repositories/candidate-assessment.repository.ts`
- Test: `tests/assessment/candidate-assessment-repository.test.ts` (extend existing file — read it first to copy its `tenantDb`/`tx` mocking pattern exactly)

**Interfaces:**

- Consumes: `ScoreBand` type from Task 1.
- Produces: `candidateAssessmentWriteRepo.listOtherNormalizedScoresInTx(tx, organizationId, assessmentTypeId, excludeAssignmentId): Promise<number[]>`. Extended `upsertResultInTx` signature (adds `percentile`, `band`, `normSampleSize` to its `data` param, all optional/nullable). Extended `assignmentSummarySelect` (adds `percentile`... already there... plus `band`, `normSampleSize` to the nested `result.select`).
- Consumed by: Task 5 (service layer).

- [ ] **Step 1: Read the existing repository test file's mocking pattern**

Run: `head -40 tests/assessment/candidate-assessment-repository.test.ts`

Note how `tenantDb`/`Prisma.TransactionClient` are mocked (this file tests the repo directly against a mocked Prisma client, distinct from the service-level test in Task 5 which mocks the repo itself). Copy this exact mock shape for the new test below.

- [ ] **Step 2: Write the failing tests**

Add to `tests/assessment/candidate-assessment-repository.test.ts` (following whatever mock setup Step 1 found):

```ts
describe('candidateAssessmentWriteRepo.listOtherNormalizedScoresInTx', () => {
  it('selects only normalizedScore for other non-partial completed results, same org+type, excluding self', async () => {
    const mockTx = {
      assessmentResult: {
        findMany: vi.fn().mockResolvedValue([{ normalizedScore: 70 }, { normalizedScore: 85 }]),
      },
    };
    const scores = await candidateAssessmentWriteRepo.listOtherNormalizedScoresInTx(
      mockTx as never,
      'org-1',
      'type-1',
      'assignment-self',
    );
    expect(scores).toEqual([70, 85]);
    expect(mockTx.assessmentResult.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        normalizedScore: { not: null },
        assignmentId: { not: 'assignment-self' },
        assignment: { assessmentTypeId: 'type-1', status: 'completed' },
        breakdown: { path: ['pendingManual'], equals: [] },
      },
      select: { normalizedScore: true },
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/assessment/candidate-assessment-repository.test.ts`
Expected: FAIL — `listOtherNormalizedScoresInTx` is not defined.

- [ ] **Step 4: Implement the repository changes**

In `packages/api/src/repositories/candidate-assessment.repository.ts`:

(a) Extend `assignmentSummarySelect` (currently lines 17-28) — add `band` and `normSampleSize` to the nested `result.select`:

```ts
  result: { select: { normalizedScore: true, percentile: true, band: true, normSampleSize: true, breakdown: true } },
```

(b) Extend `upsertResultInTx`'s `data` parameter and both `create`/`update` blocks (currently lines 177-202):

```ts
  upsertResultInTx(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      assignmentId: string;
      rawScore: number;
      normalizedScore: number;
      breakdown: Prisma.InputJsonValue;
      percentile?: number | null;
      band?: import('@tims/shared').ScoreBand | null;
      normSampleSize?: number | null;
    },
  ) {
    return tx.assessmentResult.upsert({
      where: { assignmentId: data.assignmentId },
      create: {
        organizationId: data.organizationId,
        assignmentId: data.assignmentId,
        rawScore: data.rawScore,
        normalizedScore: data.normalizedScore,
        breakdown: data.breakdown,
        percentile: data.percentile ?? null,
        band: data.band ?? null,
        normSampleSize: data.normSampleSize ?? null,
      },
      update: {
        rawScore: data.rawScore,
        normalizedScore: data.normalizedScore,
        breakdown: data.breakdown,
        percentile: data.percentile ?? null,
        band: data.band ?? null,
        normSampleSize: data.normSampleSize ?? null,
      },
    });
  },
```

(Use a top-of-file `import type { ScoreBand } from '@tims/shared';` instead of the inline `import()` type shown above — the inline form here is just to show the exact type; place a real import statement near the existing `import type { Prisma } from '@tims/db';` line at the top of the file and reference `ScoreBand` directly.)

(c) Add the new method to `candidateAssessmentWriteRepo` (after `findQuestionsWithAnswerKeyInTx`, before `upsertResponseInTx`):

```ts
  // Population for norm-band computation: every OTHER completed, non-partial
  // result for the SAME org + assessment type. `breakdown: { path: ['pendingManual'],
  // equals: [] }` filters to non-partial (no essay questions pending) — an
  // essay-containing assessment's result never enters the population until a
  // future essay-scoring pass empties pendingManual. Explicit select — only
  // the one numeric field a candidate never sees attributed to anyone else.
  listOtherNormalizedScoresInTx(
    tx: Prisma.TransactionClient,
    organizationId: string,
    assessmentTypeId: string,
    excludeAssignmentId: string,
  ): Promise<number[]> {
    return tx.assessmentResult
      .findMany({
        where: {
          organizationId,
          normalizedScore: { not: null },
          assignmentId: { not: excludeAssignmentId },
          assignment: { assessmentTypeId, status: 'completed' },
          breakdown: { path: ['pendingManual'], equals: [] },
        },
        select: { normalizedScore: true },
      })
      .then((rows) => rows.map((r) => r.normalizedScore!));
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/assessment/candidate-assessment-repository.test.ts`
Expected: PASS.

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/repositories/candidate-assessment.repository.ts tests/assessment/candidate-assessment-repository.test.ts
git commit -m "feat(assessment): add norm-band population query + extend result upsert"
```

---

### Task 5: Service — wire `computeNormBand` into `submitAssessment`

**Files:**

- Modify: `packages/api/src/services/candidate-assessment.service.ts`
- Test: `tests/assessment/candidate-assessment-service.test.ts` (extend existing file)

**Interfaces:**

- Consumes: `computeNormBand`/`MIN_NORM_SAMPLE_SIZE` (Task 1), `listOtherNormalizedScoresInTx`/extended `upsertResultInTx` (Task 4).
- Produces: `submitAssessment`'s transaction now also computes and stores percentile/band/normSampleSize when the result is non-partial. `AssignmentResultSummary` interface gains `band`/`normSampleSize`; `getMyAssessments`'s DTO includes them.

- [ ] **Step 1: Write the failing tests**

Add to `tests/assessment/candidate-assessment-service.test.ts`'s `submitAssessment` describe block (mock `candidateAssessmentWriteRepo.listOtherNormalizedScoresInTx` in the top-of-file `vi.mock` block first — add it to the existing mocked shape alongside `upsertResultInTx`):

```ts
// In the top vi.mock('../../packages/api/src/repositories/candidate-assessment.repository', ...) block,
// add to candidateAssessmentWriteRepo: listOtherNormalizedScoresInTx: vi.fn(),

it('computes and stores a norm band when the population meets MIN_NORM_SAMPLE_SIZE and the result is non-partial', async () => {
  vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
    id: ASSIGNMENT_ID,
    status: 'in_progress',
    expiresAt: null,
    assessmentTypeId: 'type-1',
  } as never);
  vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
    id: ASSIGNMENT_ID,
    status: 'in_progress',
    expiresAt: null,
    assessmentTypeId: 'type-1',
  } as never);
  vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([SINGLE_CHOICE_Q] as never);
  vi.mocked(candidateAssessmentWriteRepo.listOtherNormalizedScoresInTx).mockResolvedValue([20, 30, 40, 50, 60]);
  vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 1 } as never);

  await candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
    { questionId: 'q1', selectedOptionIds: ['b'] },
  ]);

  // Candidate scores 100 (normalizedScore for a correct single_choice answer),
  // population [20,30,40,50,60] -> percentile 100, band 'excellent'.
  expect(candidateAssessmentWriteRepo.upsertResultInTx).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ percentile: 100, band: 'excellent', normSampleSize: 5 }),
  );
});

it('stores a null percentile/band/normSampleSize=0 when the population is below MIN_NORM_SAMPLE_SIZE', async () => {
  vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
    id: ASSIGNMENT_ID,
    status: 'in_progress',
    expiresAt: null,
    assessmentTypeId: 'type-1',
  } as never);
  vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
    id: ASSIGNMENT_ID,
    status: 'in_progress',
    expiresAt: null,
    assessmentTypeId: 'type-1',
  } as never);
  vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([SINGLE_CHOICE_Q] as never);
  vi.mocked(candidateAssessmentWriteRepo.listOtherNormalizedScoresInTx).mockResolvedValue([20, 30]);
  vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 1 } as never);

  await candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
    { questionId: 'q1', selectedOptionIds: ['b'] },
  ]);

  expect(candidateAssessmentWriteRepo.upsertResultInTx).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ percentile: null, band: null, normSampleSize: 2 }),
  );
});

it('never queries the population or stores a band when the result is partial (has a pending essay)', async () => {
  vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
    id: ASSIGNMENT_ID,
    status: 'in_progress',
    expiresAt: null,
    assessmentTypeId: 'type-1',
  } as never);
  vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
    id: ASSIGNMENT_ID,
    status: 'in_progress',
    expiresAt: null,
    assessmentTypeId: 'type-1',
  } as never);
  vi.mocked(candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx).mockResolvedValue([
    SINGLE_CHOICE_Q,
    FREE_TEXT_Q,
  ] as never);
  vi.mocked(candidateAssessmentWriteRepo.completeAssignmentInTx).mockResolvedValue({ count: 1 } as never);

  await candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
    { questionId: 'q1', selectedOptionIds: ['b'] },
    { questionId: 'q2', freeText: 'my essay' },
  ]);

  expect(candidateAssessmentWriteRepo.listOtherNormalizedScoresInTx).not.toHaveBeenCalled();
  expect(candidateAssessmentWriteRepo.upsertResultInTx).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ percentile: null, band: null, normSampleSize: null }),
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/assessment/candidate-assessment-service.test.ts`
Expected: FAIL — `submitAssessment` doesn't call `listOtherNormalizedScoresInTx` or pass percentile/band/normSampleSize yet.

- [ ] **Step 3: Implement the service changes**

In `packages/api/src/services/candidate-assessment.service.ts`:

(a) Add the import (alongside the existing `scoreChoice, computeResult` import on line 7):

```ts
import { scoreChoice, computeResult, computeNormBand, type AnswerInput, type GradedAnswer } from '@tims/shared';
```

(b) In `submitAssessment`, after the existing `const { rawScore, normalizedScore, hasPending } = computeResult(graded);` line (currently line 246) and before the `upsertResultInTx` call (currently line 249), insert:

```ts
const { rawScore, normalizedScore, hasPending } = computeResult(graded);
const autoScored = graded.filter((g) => g.isCorrect !== null).length;

// Norm band: only for a NON-partial result (no essay questions pending —
// hasPending false). An essay-containing assessment stays partial until a
// future essay-scoring pass, so it never enters or draws from the
// population — this is an honest consequence of the existing
// partial/pending design, not a gap (see the design spec's "Out of scope").
let percentile: number | null = null;
let band: import('@tims/shared').ScoreBand | null = null;
let normSampleSize: number | null = null;
if (!hasPending) {
  const population = await candidateAssessmentWriteRepo.listOtherNormalizedScoresInTx(
    tx,
    org.id,
    assignment.assessmentTypeId,
    assignmentId,
  );
  normSampleSize = population.length;
  const normResult = computeNormBand(normalizedScore, population);
  if (normResult) {
    percentile = normResult.percentile;
    band = normResult.band;
  }
}

await candidateAssessmentWriteRepo.upsertResultInTx(tx, {
  organizationId: org.id,
  assignmentId,
  rawScore,
  normalizedScore,
  breakdown: { autoScored, pendingManual },
  percentile,
  band,
  normSampleSize,
});
```

(Replace the old bare `await candidateAssessmentWriteRepo.upsertResultInTx(tx, { organizationId: org.id, assignmentId, rawScore, normalizedScore, breakdown: { autoScored, pendingManual } });` call entirely with the block above — don't leave both.)

Use a real top-of-file `import type { ScoreBand } from '@tims/shared';` instead of the inline `import()` shown, matching Task 4's note.

(c) Extend `AssignmentResultSummary` (currently lines 36-40) and `withPendingFlag` (currently lines 42-49):

```ts
interface AssignmentResultSummary {
  normalizedScore: number | null;
  percentile: number | null;
  band: import('@tims/shared').ScoreBand | null;
  normSampleSize: number | null;
  breakdown: Prisma.JsonValue | null;
}
```

`withPendingFlag`'s destructuring already spreads `...resultRest` after pulling out `breakdown`, so `band`/`normSampleSize` pass through automatically once the type above includes them and the repository select (Task 4a) returns them — no other change needed in `withPendingFlag` itself.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/assessment/candidate-assessment-service.test.ts`
Expected: PASS, all new + existing tests in this file green.

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/candidate-assessment.service.ts tests/assessment/candidate-assessment-service.test.ts
git commit -m "feat(assessment): compute + store norm band on non-partial submitAssessment"
```

---

### Task 6: Backfill script

**Files:**

- Create: `packages/db/prisma/backfill-assessment-norms.ts`
- Test: `tests/assessment/backfill-assessment-norms.test.ts` (new file)

**Interfaces:**

- Consumes: `computeNormBand` (Task 1), the `AssessmentResult`/`AssessmentAssignment` Prisma models (Task 2).
- Produces: a standalone script runnable via `pnpm --filter @tims/db exec tsx prisma/backfill-assessment-norms.ts [--apply]`.

- [ ] **Step 1: Write the failing test**

Create `tests/assessment/backfill-assessment-norms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeBackfillPlan } from '../../packages/db/prisma/backfill-assessment-norms';

describe('computeBackfillPlan', () => {
  it('computes a percentile/band for each non-partial result using every OTHER non-partial result in the same org+type', () => {
    const results = [
      { assignmentId: 'a1', assessmentTypeId: 't1', normalizedScore: 20, hasPending: false },
      { assignmentId: 'a2', assessmentTypeId: 't1', normalizedScore: 40, hasPending: false },
      { assignmentId: 'a3', assessmentTypeId: 't1', normalizedScore: 60, hasPending: false },
      { assignmentId: 'a4', assessmentTypeId: 't1', normalizedScore: 80, hasPending: false },
      { assignmentId: 'a5', assessmentTypeId: 't1', normalizedScore: 100, hasPending: false },
    ];
    const plan = computeBackfillPlan(results);
    expect(plan).toHaveLength(5);
    // a1 (score 20) vs population [40,60,80,100] (4, below MIN_NORM_SAMPLE_SIZE=5) -> null
    expect(plan.find((p) => p.assignmentId === 'a1')).toMatchObject({
      percentile: null,
      band: null,
      normSampleSize: 4,
    });
  });

  it('skips partial results entirely (never computes a band, never counts them in others population)', () => {
    const results = [
      { assignmentId: 'a1', assessmentTypeId: 't1', normalizedScore: 20, hasPending: true },
      { assignmentId: 'a2', assessmentTypeId: 't1', normalizedScore: 40, hasPending: false },
    ];
    const plan = computeBackfillPlan(results);
    expect(plan.find((p) => p.assignmentId === 'a1')).toBeUndefined();
  });

  it('never mixes populations across different assessment types', () => {
    const results = [
      { assignmentId: 'a1', assessmentTypeId: 't1', normalizedScore: 20, hasPending: false },
      { assignmentId: 'a2', assessmentTypeId: 't2', normalizedScore: 20, hasPending: false },
    ];
    const plan = computeBackfillPlan(results);
    expect(plan.find((p) => p.assignmentId === 'a1')).toMatchObject({ normSampleSize: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/assessment/backfill-assessment-norms.test.ts`
Expected: FAIL — the file doesn't exist yet.

- [ ] **Step 3: Write the script**

Create `packages/db/prisma/backfill-assessment-norms.ts`:

```ts
/**
 * packages/db/prisma/backfill-assessment-norms.ts
 *
 * One-time, idempotent catch-up for Assessment Player Slice 5 (local norm
 * scoring, docs/superpowers/specs/2026-08-01-assessment-player-norm-scoring-design.md).
 * Computes band/percentile for every already-completed, non-partial
 * AssessmentResult using TODAY's full population per org + assessment type —
 * a one-off catch-up, not a re-run of point-in-time history (see spec's
 * "Backfill" section). Safe to re-run: deterministically overwrites.
 *
 * Usage:
 *   pnpm --filter @tims/db exec tsx prisma/backfill-assessment-norms.ts           # DRY-RUN (default)
 *   pnpm --filter @tims/db exec tsx prisma/backfill-assessment-norms.ts --apply   # write to DB
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { computeNormBand, type ScoreBand } from '@tims/shared';

const db = new PrismaClient();
const APPLY = process.argv.includes('--apply');

interface ResultRow {
  assignmentId: string;
  assessmentTypeId: string;
  normalizedScore: number;
  hasPending: boolean;
}

interface BackfillPlanRow {
  assignmentId: string;
  percentile: number | null;
  band: ScoreBand | null;
  normSampleSize: number;
}

function hasPendingManual(breakdown: Prisma.JsonValue | null): boolean {
  if (breakdown === null || typeof breakdown !== 'object' || Array.isArray(breakdown)) return false;
  const pendingManual = (breakdown as Record<string, unknown>).pendingManual;
  return Array.isArray(pendingManual) && pendingManual.length > 0;
}

/**
 * Pure planning function (no DB/network) — given every completed result
 * across every org, groups by (organizationId is implicit in caller's query
 * scoping — see main() below) + assessmentTypeId, and computes each
 * non-partial result's band against every OTHER non-partial result in the
 * SAME assessmentTypeId. Exported for the unit test above.
 */
export function computeBackfillPlan(results: ResultRow[]): BackfillPlanRow[] {
  const nonPartial = results.filter((r) => !r.hasPending);
  const byType = new Map<string, ResultRow[]>();
  for (const r of nonPartial) {
    const list = byType.get(r.assessmentTypeId) ?? [];
    list.push(r);
    byType.set(r.assessmentTypeId, list);
  }

  const plan: BackfillPlanRow[] = [];
  for (const r of nonPartial) {
    const sameType = byType.get(r.assessmentTypeId) ?? [];
    const population = sameType.filter((other) => other.assignmentId !== r.assignmentId).map((o) => o.normalizedScore);
    const normResult = computeNormBand(r.normalizedScore, population);
    plan.push({
      assignmentId: r.assignmentId,
      percentile: normResult?.percentile ?? null,
      band: normResult?.band ?? null,
      normSampleSize: population.length,
    });
  }
  return plan;
}

async function main() {
  console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  const orgs = await db.organization.findMany({ select: { id: true, slug: true } });
  console.log(`Found ${orgs.length} organization(s)\n`);

  let totalUpdated = 0;

  for (const org of orgs) {
    const results = await db.assessmentResult.findMany({
      where: { organizationId: org.id, normalizedScore: { not: null } },
      select: {
        assignmentId: true,
        normalizedScore: true,
        breakdown: true,
        assignment: { select: { assessmentTypeId: true, status: true } },
      },
    });

    const rows: ResultRow[] = results
      .filter((r) => r.assignment.status === 'completed')
      .map((r) => ({
        assignmentId: r.assignmentId,
        assessmentTypeId: r.assignment.assessmentTypeId,
        normalizedScore: r.normalizedScore!,
        hasPending: hasPendingManual(r.breakdown),
      }));

    const plan = computeBackfillPlan(rows);
    console.log(`  [${org.slug}] ${plan.length} non-partial result(s) to update`);
    totalUpdated += plan.length;

    if (!APPLY) continue;

    for (const row of plan) {
      await db.assessmentResult.update({
        where: { assignmentId: row.assignmentId },
        data: { percentile: row.percentile, band: row.band, normSampleSize: row.normSampleSize },
      });
    }
  }

  console.log(`\nmode=${APPLY ? 'APPLY' : 'DRY-RUN'} orgs=${orgs.length} total-rows=${totalUpdated}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/assessment/backfill-assessment-norms.test.ts`
Expected: PASS.

Run: `pnpm --filter @tims/api exec tsc --noEmit` (the script lives under `packages/db` but imports `@tims/shared` — verify no cross-package type errors)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/backfill-assessment-norms.ts tests/assessment/backfill-assessment-norms.test.ts
git commit -m "feat(db): one-time backfill script for assessment norm scoring"
```

---

### Task 7: i18n keys for band labels + "not enough data" state

**Files:**

- Modify: `apps/web/lib/i18n/en.json` (around line 3503-3507, the `resultTitle`/`resultScoreLabel`/etc. block)
- Modify: `apps/web/lib/i18n/es.json` (same keys, Spanish)

**Interfaces:**

- Produces: `t.assessmentPlayer.bandLabels.{below_average,average,above_average,excellent}`, `t.assessmentPlayer.resultPercentileLabel`, `t.assessmentPlayer.resultNoNormData`.
- Consumed by: Task 8 (candidate result screen), Task 9 (staff surfacing).

- [ ] **Step 1: Add English keys**

In `apps/web/lib/i18n/en.json`, after the existing `"resultSummary"` key (line 3506), add:

```json
    "resultPercentileLabel": "Better than {percentile}% of candidates who took this assessment",
    "resultNoNormData": "Not enough data yet to compare against other candidates",
    "bandLabels": {
      "below_average": "Below average",
      "average": "Average",
      "above_average": "Above average",
      "excellent": "Excellent"
    },
```

- [ ] **Step 2: Add matching Spanish keys**

Find the equivalent block in `apps/web/lib/i18n/es.json` (same key path, search for `"resultSummary"` there) and add the Spanish equivalents in the same position:

```json
    "resultPercentileLabel": "Mejor que el {percentile}% de los candidatos que tomaron esta evaluacion",
    "resultNoNormData": "Aun no hay suficientes datos para comparar con otros candidatos",
    "bandLabels": {
      "below_average": "Por debajo del promedio",
      "average": "Promedio",
      "above_average": "Por encima del promedio",
      "excellent": "Excelente"
    },
```

- [ ] **Step 3: Verify the i18n type-check / lint gate passes**

Run: `pnpm eslint apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json` (if these are lint-checked as JSON; otherwise skip to the next command)
Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS — confirms both JSON files still parse and the i18n type inference (if the project generates a typed `t` object from the JSON shape) doesn't break on the new nested `bandLabels` object.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json
git commit -m "feat(i18n): add band label + percentile copy for assessment norm scoring"
```

---

### Task 8: Candidate result screen surfacing

**Files:**

- Modify: `apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-result-screen.tsx`
- Modify: `apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-player-shell.tsx` (the call site, around line 69-72)
- Test: `tests/portal/assessment-result-screen.test.tsx` (extend existing file)

**Interfaces:**

- Consumes: `t.assessmentPlayer.bandLabels`/`resultPercentileLabel`/`resultNoNormData` (Task 7); `band`/`normSampleSize`/`percentile` now present on `assignment.result` (Task 5's DTO change flows through `getMyAssessments`).

- [ ] **Step 1: Update the 4 existing tests' calls for the new required props, and write the failing tests**

The existing file (`tests/portal/assessment-result-screen.test.tsx`) renders via a local `renderResult` helper:

```tsx
function renderResult(props: React.ComponentProps<typeof AssessmentResultScreen>) {
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <AssessmentResultScreen {...props} />
    </I18nProvider>,
  );
}
```

Its 4 existing tests all call `renderResult({ normalizedScore, hasPending })` only. Since Step 4 below makes `band`/`percentile`/`normSampleSize` required (non-optional) props — matching this codebase's existing style of explicit required props over hidden defaults — **every existing call must be updated** to pass them, or those 4 tests fail to type-check. Update all 4 existing calls to add `band: null, percentile: null, normSampleSize: null` (none of the existing 4 tests are about norm bands, so `null` is the correct "not applicable" value for all of them):

```tsx
it('renders the rounded score', () => {
  renderResult({ normalizedScore: 82.4, hasPending: false, band: null, percentile: null, normSampleSize: null });
  expect(screen.getByText(/82%/)).toBeInTheDocument();
});

it('renders the pending-review notice honestly when hasPending is true', () => {
  renderResult({ normalizedScore: 50, hasPending: true, band: null, percentile: null, normSampleSize: null });
  expect(screen.getByText(en.assessmentPlayer.resultPendingNotice)).toBeInTheDocument();
});

it('does not render the pending-review notice when hasPending is false', () => {
  renderResult({ normalizedScore: 100, hasPending: false, band: null, percentile: null, normSampleSize: null });
  expect(screen.queryByText(en.assessmentPlayer.resultPendingNotice)).not.toBeInTheDocument();
});

it('never fabricates a score when normalizedScore is null (all-essay, nothing auto-graded yet)', () => {
  renderResult({ normalizedScore: null, hasPending: true, band: null, percentile: null, normSampleSize: null });
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  expect(screen.getByText(en.assessmentPlayer.resultPendingNotice)).toBeInTheDocument();
});
```

Then add 3 new tests using the same `renderResult` helper:

```tsx
it('shows the band label and percentile when both are present', () => {
  renderResult({ normalizedScore: 80, hasPending: false, band: 'above_average', percentile: 66.7, normSampleSize: 12 });
  expect(screen.getByText(en.assessmentPlayer.bandLabels.above_average)).toBeInTheDocument();
  expect(screen.getByText(/67/)).toBeInTheDocument(); // Math.round(66.7) = 67
});

it('shows the "not enough data" message when band is null but the result is non-partial', () => {
  renderResult({ normalizedScore: 80, hasPending: false, band: null, percentile: null, normSampleSize: 2 });
  expect(screen.getByText(en.assessmentPlayer.resultNoNormData)).toBeInTheDocument();
});

it('shows no band/percentile/no-data UI at all when hasPending is true (partial result)', () => {
  renderResult({ normalizedScore: 80, hasPending: true, band: null, percentile: null, normSampleSize: null });
  expect(screen.queryByText(en.assessmentPlayer.resultNoNormData)).not.toBeInTheDocument();
  expect(screen.queryByText(en.assessmentPlayer.bandLabels.above_average)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/portal/assessment-result-screen.test.tsx`
Expected: FAIL — `AssessmentResultScreen` doesn't accept `band`/`percentile`/`normSampleSize` props yet (TypeScript error on the updated existing calls too, since the prop doesn't exist on the component's current type).

- [ ] **Step 3: Implement the component changes**

Replace `apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-result-screen.tsx` in full:

```tsx
'use client';

import { useI18n } from '../../../../../../../../lib/i18n';

type ScoreBand = 'below_average' | 'average' | 'above_average' | 'excellent';

interface AssessmentResultScreenProps {
  normalizedScore: number | null;
  hasPending: boolean;
  band: ScoreBand | null;
  percentile: number | null;
  normSampleSize: number | null;
}

export function AssessmentResultScreen({
  normalizedScore,
  hasPending,
  band,
  percentile,
  normSampleSize,
}: AssessmentResultScreenProps) {
  const { t } = useI18n();
  const roundedScore = normalizedScore !== null ? Math.round(normalizedScore) : null;
  const roundedPercentile = percentile !== null ? Math.round(percentile) : null;

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full text-center space-y-4">
        <h1 className="text-lg font-semibold text-[#1F114C]">{t.assessmentPlayer.resultTitle}</h1>
        {roundedScore !== null && (
          <p className="text-3xl font-bold text-[#1F114C]">
            {t.assessmentPlayer.resultScoreLabel} {roundedScore}%
          </p>
        )}
        {!hasPending && band !== null && roundedPercentile !== null && (
          <p className="text-[13px] font-medium text-[#1F114C]">
            {t.assessmentPlayer.bandLabels[band]} —{' '}
            {t.assessmentPlayer.resultPercentileLabel.replace('{percentile}', String(roundedPercentile))}
          </p>
        )}
        {!hasPending && band === null && normSampleSize !== null && (
          <p className="text-[13px] text-[#8B8B8B]">{t.assessmentPlayer.resultNoNormData}</p>
        )}
        {hasPending && (
          <p className="text-[13px] text-[#B45309] bg-[#FFFBEB] rounded-xl p-3">
            {t.assessmentPlayer.resultPendingNotice}
          </p>
        )}
        <p className="text-[13px] text-[#585858]">{t.assessmentPlayer.resultSummary}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update the call site**

In `assessment-player-shell.tsx`, modify the `<AssessmentResultScreen ... />` invocation (currently lines 69-72):

```tsx
<AssessmentResultScreen
  normalizedScore={assignment.result?.normalizedScore ?? null}
  hasPending={assignment.result?.hasPending ?? false}
  band={assignment.result?.band ?? null}
  percentile={assignment.result?.percentile ?? null}
  normSampleSize={assignment.result?.normSampleSize ?? null}
/>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/portal/assessment-result-screen.test.tsx`
Expected: PASS.

Run: `cd apps/web && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(portal\)/careers/\[orgSlug\]/dashboard/assessments/\[assignmentId\]/_components/assessment-result-screen.tsx apps/web/app/\(portal\)/careers/\[orgSlug\]/dashboard/assessments/\[assignmentId\]/_components/assessment-player-shell.tsx tests/portal/assessment-result-screen.test.tsx
git commit -m "feat(assessment-player): surface norm band + percentile on the candidate result screen"
```

---

### Task 9: Staff surfacing — candidate detail page

**Files:**

- Modify: `packages/api/src/repositories/candidate.repository.ts:118` (the `assessmentAssignments.result.select` block)
- Modify: `apps/web/app/(admin)/recruitment/candidates/[id]/assessment-results.tsx`
- Test: create `tests/portal/assessment-results-staff.test.tsx` (verified no existing test file covers this component — `find tests -iname "*assessment-results*"` returns nothing)

**Interfaces:**

- Consumes: `t.assessmentPlayer.bandLabels` (Task 7, reused — no new staff-specific i18n keys needed).
- Note: this candidate-detail path selects result fields directly (not through `selectFor`/classification.ts) and deliberately omits restricted fields per its existing comment (lines 111-117) — `band`/`normSampleSize`/`percentile` are `confidential` tier (same as `normalizedScore`, which this path already selects unconditionally), so adding them here follows the exact same existing precedent, not a new exception.

- [ ] **Step 1: Write the failing test**

Create `tests/portal/assessment-results-staff.test.tsx`, following the exact same `I18nProvider` wrapping pattern verified in `tests/portal/assessment-result-screen.test.tsx` (Task 8) — `AssessmentResults` also calls `useI18n()`, so a bare `render()` without the provider would throw:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { AssessmentResults } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/assessment-results';

function renderResults(props: React.ComponentProps<typeof AssessmentResults>) {
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <AssessmentResults {...props} />
    </I18nProvider>,
  );
}

describe('AssessmentResults staff surfacing — norm band', () => {
  it('shows the band label next to the score when present', () => {
    renderResults({
      assignments: [
        {
          id: 'a1',
          status: 'completed',
          assignedAt: new Date(),
          completedAt: new Date(),
          assessmentType: { id: 't1', name: 'Logic Test', code: 'logic' },
          result: { id: 'r1', normalizedScore: 80, band: 'above_average', percentile: 66.7, normSampleSize: 12 },
        },
      ],
      fitScores: [],
    });
    expect(screen.getByText(en.assessmentPlayer.bandLabels.above_average)).toBeInTheDocument();
  });

  it('renders no band label when band is null (no norm data yet)', () => {
    renderResults({
      assignments: [
        {
          id: 'a1',
          status: 'completed',
          assignedAt: new Date(),
          completedAt: new Date(),
          assessmentType: { id: 't1', name: 'Logic Test', code: 'logic' },
          result: { id: 'r1', normalizedScore: 80, band: null, percentile: null, normSampleSize: 2 },
        },
      ],
      fitScores: [],
    });
    expect(screen.queryByText(en.assessmentPlayer.bandLabels.above_average)).not.toBeInTheDocument();
    expect(screen.queryByText(en.assessmentPlayer.bandLabels.below_average)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/portal/assessment-results-staff.test.tsx`
Expected: FAIL — the `Assignment` interface doesn't have `band`/`percentile`/`normSampleSize` yet, and nothing renders them.

- [ ] **Step 3: Extend the repository select**

In `packages/api/src/repositories/candidate.repository.ts`, modify line 118:

```ts
        result: { select: { id: true, normalizedScore: true, percentile: true, band: true, normSampleSize: true } },
```

- [ ] **Step 4: Extend the component**

In `apps/web/app/(admin)/recruitment/candidates/[id]/assessment-results.tsx`:

(a) Extend the `Assignment` interface's `result` type (currently line 15):

```ts
  result: {
    id: string;
    rawScore?: number | null;
    normalizedScore: number | null;
    percentile?: number | null;
    band?: 'below_average' | 'average' | 'above_average' | 'excellent' | null;
    normSampleSize?: number | null;
    breakdown?: unknown;
  } | null;
```

(b) In the `assignments.map` render block (currently around lines 122-140), after the existing normalizedScore progress-bar block and before the `BreakdownGrid` render, add:

```tsx
{
  a.result?.band != null && (
    <p className="text-[11px] font-medium text-[#1F114C] mt-1">{t.assessmentPlayer.bandLabels[a.result.band]}</p>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/portal/assessment-results-staff.test.tsx` (or resolved filename)
Expected: PASS.

Run: `cd apps/web && npx tsc --noEmit`
Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/repositories/candidate.repository.ts "apps/web/app/(admin)/recruitment/candidates/[id]/assessment-results.tsx" tests/portal/assessment-results-staff.test.tsx
git commit -m "feat(assessment): surface norm band on the staff candidate-detail page"
```

---

## Final verification (after all 9 tasks)

- [ ] Run the full local verify gate: `/gate` (tsc api+web, vitest, code-quality greps, build, gitleaks)
- [ ] Confirm no leftover references to the old 4-argument `AssessmentResultScreen` call signature anywhere else in the codebase: `grep -rn "AssessmentResultScreen" apps/web --include="*.tsx"`
- [ ] Confirm `docs/REMAINING-WORK.md`'s Assessment Player Tier-3 entry is updated to reflect this slice shipping (small doc PR, same pattern as prior slices' truth-ups).
