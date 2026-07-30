# Assessment Player Slice 2 — Candidate Take Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the candidate-facing backend for taking an assigned assessment — `candidatePortal.getMyAssessments/startAssessment/getAssessmentQuestions/submitAssessment` — with atomic auto-scoring on submit, per `docs/WAVE-1.5a-ASSESSMENT-PLAYER.md` (approved 2026-06-10).

**Architecture:** Router (`candidate-portal.ts`, `candidateProcedure`) → Service (`candidate-assessment.service.ts`) → Repository (`candidate-assessment.repository.ts`), mirroring the existing candidate-portal pattern exactly (`resolveOrg` → `runWithTenant` → repo). Pure grading logic (`scoreChoice`/`computeResult`) lives in `@tims/shared`, TDD-first, no DB/network — mirroring `validateQuestionCoherence` in the same file. `submitAssessment` needs real multi-step atomicity (grade N responses + upsert result + mark assignment completed, all-or-nothing); a new `runTenantTransaction` helper in `packages/db` provides this, because the existing `tenantDb` extension cannot (see Global Constraints).

**Tech Stack:** tRPC, Prisma 6.8.2, Zod, Vitest.

## Global Constraints

- No `any` type; no `z.any()`/`.passthrough()`; explicit `select` on every Prisma read (CLAUDE.md).
- Every candidate endpoint: `candidateProcedure`, `orgSlug` input, identity from `ctx.supabaseAuth.email` — NEVER a client-supplied email/candidateId (IDOR).
- `getAssessmentQuestions` NEVER selects/returns `correctOptionIds` to the candidate.
- All string/array inputs bounded (`.max(...)`).
- Files: kebab-case. Services/repos: `*.service.ts`/`*.repository.ts`. Max 300 lines/service file, 500/router file.
- Error messages: Spanish prose for ownership/not-found (matches every existing candidate-portal and `assessment.ts` message, e.g. `'Asignacion no encontrada'`); stable snake_case codes for business-state conflicts (matches `assessment-question.service.ts`'s `'question_has_responses'` convention — Slice 3 FE will match on these).
- **Prisma limitation (verified, [prisma/prisma#17948](https://github.com/prisma/prisma/issues/17948)):** `tenantDb.$transaction(async (tx) => {...})` does NOT give atomicity — `tenantDb`'s `$allOperations` extension gives every individual query its own self-contained mini-transaction (via `db.$transaction([SET LOCAL ROLE, set_config, query(args)])` on the closed-over base `db`, not on the caller's `tx`), so each `tx.model.op()` call inside an outer `tenantDb.$transaction()` still commits independently. Never use `tenantDb.$transaction()` for a multi-step atomic write. Use the new `runTenantTransaction(orgId, fn)` (Task 1) instead, which opens ONE interactive transaction on the base `db` client and sets the RLS role/GUC as its first statements.

---

### Task 1: `runTenantTransaction` helper (packages/db)

**Files:**

- Modify: `packages/db/src/tenant-client.ts`
- Modify: `packages/db/src/index.ts`
- Test: `tests/db/tenant-transaction.test.ts` (new)

**Interfaces:**

- Produces: `runTenantTransaction<T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>`, exported from `@tims/db`.

- [ ] **Step 1: Write the failing tests**

Create `tests/db/tenant-transaction.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTx = { $executeRaw: vi.fn().mockResolvedValue(1) };
const mockDb = { $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockTx)) };

vi.mock('../../packages/db/src/client', () => ({ db: mockDb }));

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockTx));
});

describe('runTenantTransaction', () => {
  it('sets RLS role + org GUC as the first two statements, then runs fn on the SAME tx, when RLS is enforced', async () => {
    vi.stubEnv('RLS_ENFORCED', 'true');
    vi.stubEnv('NODE_ENV', 'test');
    const { runTenantTransaction } = await import('../../packages/db/src/tenant-client');

    const fn = vi.fn().mockResolvedValue('result');
    const result = await runTenantTransaction('org-1', fn);

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledWith(mockTx);
    expect(result).toBe('result');
    vi.unstubAllEnvs();
  });

  it('skips SET LOCAL ROLE and runs fn directly outside production when RLS is not enforced', async () => {
    vi.stubEnv('RLS_ENFORCED', 'false');
    vi.stubEnv('NODE_ENV', 'test');
    const { runTenantTransaction } = await import('../../packages/db/src/tenant-client');

    const fn = vi.fn().mockResolvedValue('result');
    await runTenantTransaction('org-1', fn);

    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledWith(mockTx);
    vi.unstubAllEnvs();
  });

  it('fails closed in production when RLS is not enforced', async () => {
    vi.stubEnv('RLS_ENFORCED', 'false');
    vi.stubEnv('NODE_ENV', 'production');
    const { runTenantTransaction } = await import('../../packages/db/src/tenant-client');

    await expect(runTenantTransaction('org-1', vi.fn())).rejects.toThrow(/RLS_ENFORCED must be "true" in production/);
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/tenant-transaction.test.ts`
Expected: FAIL — `runTenantTransaction is not a function` / module has no export.

- [ ] **Step 3: Implement `runTenantTransaction`**

In `packages/db/src/tenant-client.ts`, add after the existing `tenantDb` export (imports already present: `db`, `getTenantOrgId`, `assertRlsEnforced`; add a type-only `Prisma` import):

```ts
import type { Prisma } from '@prisma/client';
```

Append to the file:

```ts
// Interactive-transaction counterpart to tenantDb. tenantDb's $allOperations
// extension gives each individual query its OWN self-contained mini-transaction
// (SET LOCAL ROLE + set_config + that one query, batched via db.$transaction on
// the closed-over base `db`) — composing it with an outer $transaction does NOT
// make multiple writes atomic, because each nested tenantDb.* call still commits
// independently (documented Prisma limitation: client extensions in interactive
// transactions are bound to the base client, prisma/prisma#17948). Call sites
// that need several writes to succeed or fail together (e.g. Wave 1.5a
// submitAssessment: grade N responses + upsert the result + mark the assignment
// completed) must use this instead: it sets the RLS role/GUC ONCE as the first
// statements of a single interactive transaction, then hands the SAME
// transactional client to fn() so every write inside shares that one atomic
// boundary. RLS_ENFORCED is read at call time (not module load) so it composes
// with vi.stubEnv in tests without needing vi.resetModules().
export function runTenantTransaction<T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    const rlsEnforced = process.env.RLS_ENFORCED === 'true';
    if (!rlsEnforced) {
      assertRlsEnforced(process.env.NODE_ENV, rlsEnforced);
      return fn(tx);
    }
    await tx.$executeRaw`SET LOCAL ROLE app_tenant`;
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
    return fn(tx);
  });
}
```

In `packages/db/src/index.ts`, change:

```ts
export { tenantDb } from './tenant-client';
export type { TenantDb } from './tenant-client';
```

to:

```ts
export { tenantDb, runTenantTransaction } from './tenant-client';
export type { TenantDb } from './tenant-client';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db/tenant-transaction.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check and commit**

Run: `pnpm --filter @tims/db exec tsc --noEmit`
Expected: no errors.

```bash
git add packages/db/src/tenant-client.ts packages/db/src/index.ts tests/db/tenant-transaction.test.ts
git commit -m "feat(db): add runTenantTransaction for real multi-step atomic writes under RLS"
```

---

### Task 2: Pure scoring functions + candidate-facing schemas (packages/shared)

**Files:**

- Modify: `packages/shared/src/validators/assessment.ts`
- Test: `tests/assessment/assessment-scoring.test.ts` (new)

**Interfaces:**

- Consumes: nothing new (pure module).
- Produces:
  - `scoreChoice(selectedOptionIds: string[], correctOptionIds: string[], points: number): { isCorrect: boolean; pointsAwarded: number }`
  - `GradedAnswer = { isCorrect: boolean | null; pointsAwarded: number | null; points: number }`
  - `computeResult(graded: GradedAnswer[]): { rawScore: number; normalizedScore: number; hasPending: boolean }`
  - `answerInputSchema` (Zod), `AnswerInput` type, `submitAssessmentAnswersSchema` (Zod, bounded array)

- [ ] **Step 1: Write the failing tests**

Create `tests/assessment/assessment-scoring.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  scoreChoice,
  computeResult,
  answerInputSchema,
  submitAssessmentAnswersSchema,
} from '../../packages/shared/src/validators/assessment';

describe('scoreChoice', () => {
  it('awards full points on exact set match (single_choice)', () => {
    expect(scoreChoice(['b'], ['b'], 5)).toEqual({ isCorrect: true, pointsAwarded: 5 });
  });

  it('is order-independent for multi_choice', () => {
    expect(scoreChoice(['b', 'a'], ['a', 'b'], 10)).toEqual({ isCorrect: true, pointsAwarded: 10 });
  });

  it('awards zero on a partial multi_choice match (no partial credit)', () => {
    expect(scoreChoice(['a'], ['a', 'b'], 10)).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });

  it('awards zero on an extra incorrect selection', () => {
    expect(scoreChoice(['a', 'b', 'c'], ['a', 'b'], 10)).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });

  it('awards zero on an empty selection', () => {
    expect(scoreChoice([], ['a'], 5)).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });
});

describe('computeResult', () => {
  it('sums raw score and normalizes over the auto-scorable subset only', () => {
    const result = computeResult([
      { isCorrect: true, pointsAwarded: 5, points: 5 },
      { isCorrect: false, pointsAwarded: 0, points: 5 },
    ]);
    expect(result).toEqual({ rawScore: 5, normalizedScore: 50, hasPending: false });
  });

  it('excludes free_text (null) questions from the normalized-score denominator', () => {
    const result = computeResult([
      { isCorrect: true, pointsAwarded: 5, points: 5 },
      { isCorrect: null, pointsAwarded: null, points: 20 },
    ]);
    expect(result).toEqual({ rawScore: 5, normalizedScore: 100, hasPending: true });
  });

  it('returns 0 normalizedScore (not NaN) when everything is pending', () => {
    const result = computeResult([{ isCorrect: null, pointsAwarded: null, points: 20 }]);
    expect(result).toEqual({ rawScore: 0, normalizedScore: 0, hasPending: true });
  });
});

describe('answerInputSchema / submitAssessmentAnswersSchema', () => {
  it('accepts a choice answer and a free-text answer', () => {
    expect(
      answerInputSchema.parse({ questionId: '11111111-1111-1111-1111-111111111111', selectedOptionIds: ['a'] }),
    ).toBeTruthy();
    expect(
      answerInputSchema.parse({ questionId: '11111111-1111-1111-1111-111111111111', freeText: 'my essay' }),
    ).toBeTruthy();
  });

  it('rejects a submission with zero answers', () => {
    expect(() => submitAssessmentAnswersSchema.parse([])).toThrow();
  });

  it('rejects free text over the bound', () => {
    expect(() =>
      answerInputSchema.parse({
        questionId: '11111111-1111-1111-1111-111111111111',
        freeText: 'x'.repeat(20001),
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/assessment/assessment-scoring.test.ts`
Expected: FAIL — named exports don't exist yet.

- [ ] **Step 3: Implement**

Append to `packages/shared/src/validators/assessment.ts` (after the existing `validateQuestionCoherence` function, reusing the file's existing `questionOptionSchema`-style bound constants):

```ts
// ---------------------------------------------------------------------------
// Candidate-facing take-flow (Wave 1.5a slice 2). Pure grading logic first
// (TDD, no DB/network) — mirrors validateQuestionCoherence above.
// ---------------------------------------------------------------------------

export interface ScoreChoiceResult {
  isCorrect: boolean;
  pointsAwarded: number;
}

/**
 * Order-independent set-equality between the candidate's selected option ids
 * and the question's correct option ids. Full credit or zero — no partial
 * credit for multi_choice (a simpler bar than staff authoring coherence).
 */
export function scoreChoice(
  selectedOptionIds: string[],
  correctOptionIds: string[],
  points: number,
): ScoreChoiceResult {
  const selected = new Set(selectedOptionIds);
  const correct = new Set(correctOptionIds);
  const isCorrect = selected.size === correct.size && [...selected].every((id) => correct.has(id));
  return { isCorrect, pointsAwarded: isCorrect ? points : 0 };
}

export interface GradedAnswer {
  // null for free_text — ungraded, never fabricated (rule #4).
  isCorrect: boolean | null;
  pointsAwarded: number | null;
  points: number;
}

export interface ComputeResultOutput {
  rawScore: number;
  normalizedScore: number;
  hasPending: boolean;
}

/**
 * Aggregates a submitted attempt's per-question grades into a result summary.
 * normalizedScore is raw/maxAutoPoints*100 over the AUTO-SCORABLE subset only
 * (free_text questions are excluded from the denominator, not scored 0) — an
 * all-essay assessment must not show 0% just because nothing was auto-graded.
 */
export function computeResult(graded: GradedAnswer[]): ComputeResultOutput {
  const autoScored = graded.filter((g) => g.pointsAwarded !== null);
  const rawScore = autoScored.reduce((sum, g) => sum + (g.pointsAwarded ?? 0), 0);
  const maxAutoPoints = autoScored.reduce((sum, g) => sum + g.points, 0);
  const normalizedScore = maxAutoPoints > 0 ? (rawScore / maxAutoPoints) * 100 : 0;
  const hasPending = graded.some((g) => g.isCorrect === null);
  return { rawScore, normalizedScore, hasPending };
}

// ---------------------------------------------------------------------------
// Candidate submit input (Zod). Full type-coherence (must supply
// selectedOptionIds for a choice question, freeText for free_text) needs the
// DB question type and is enforced server-side in the service, not here —
// same split as staff authoring's validateQuestionCoherence vs createQuestionSchema.
// ---------------------------------------------------------------------------

const MAX_ANSWERS_PER_SUBMIT = 200;
const MAX_FREE_TEXT = 20000;

export const answerInputSchema = z.object({
  questionId: z.string().uuid(),
  selectedOptionIds: z.array(z.string().min(1).max(64)).max(MAX_OPTIONS).optional(),
  freeText: z.string().max(MAX_FREE_TEXT).optional(),
});
export type AnswerInput = z.infer<typeof answerInputSchema>;

export const submitAssessmentAnswersSchema = z.array(answerInputSchema).min(1).max(MAX_ANSWERS_PER_SUBMIT);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/assessment/assessment-scoring.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Type-check and commit**

Run: `pnpm --filter @tims/shared exec tsc --noEmit` (or the repo's shared package check command if named differently — confirm via `packages/shared/package.json` scripts)
Expected: no errors.

```bash
git add packages/shared/src/validators/assessment.ts tests/assessment/assessment-scoring.test.ts
git commit -m "feat(shared): add scoreChoice/computeResult pure grading functions + candidate answer schema"
```

---

### Task 3: Candidate assessment repository (read side)

**Files:**

- Create: `packages/api/src/repositories/candidate-assessment.repository.ts`

**Interfaces:**

- Consumes: `tenantDb`, `Prisma` from `@tims/db`.
- Produces:
  - `candidateAssessmentRepo.findAssignmentsForCandidate(organizationId, candidateId)`
  - `candidateAssessmentRepo.findOwnedAssignment(organizationId, candidateId, assignmentId)`
  - `candidateAssessmentRepo.findQuestionsForType(organizationId, assessmentTypeId)` — candidate-safe DTO, no `correctOptionIds`
  - `candidateAssessmentRepo.upsertConsent(data)` — idempotent (empty `update`, never overwrites a first acceptance)
  - `candidateAssessmentRepo.markStarted(assignmentId)`

No dedicated repo unit test — covered by the Task 4/5 service tests (repo mocked) and the Task 8 static-source security assertions, matching the existing convention (`assessment-question.repository.ts`/`candidate-portal.repository.ts` have no direct tests).

- [ ] **Step 1: Implement the repository**

Create `packages/api/src/repositories/candidate-assessment.repository.ts`:

```ts
import { tenantDb } from '@tims/db';
import type { Prisma } from '@tims/db';

// Candidate-safe question DTO. Deliberately omits correctOptionIds — the staff
// authoring repo (assessment-question.repository.ts) selects it, this one never
// does (Wave 1.5a slice 2 invariant: getAssessmentQuestions must never leak the
// answer key).
const candidateQuestionSelect = {
  id: true,
  order: true,
  type: true,
  prompt: true,
  options: true,
  points: true,
} satisfies Prisma.AssessmentQuestionSelect;

const assignmentSummarySelect = {
  id: true,
  status: true,
  startedAt: true,
  completedAt: true,
  expiresAt: true,
  assessmentType: { select: { id: true, name: true, duration: true } },
  result: { select: { normalizedScore: true, percentile: true } },
} satisfies Prisma.AssessmentAssignmentSelect;

export const candidateAssessmentRepo = {
  // Every assignment for this candidate, newest first — mirrors
  // candidatePortalRepo.findApplications's "empty is a valid state" shape.
  findAssignmentsForCandidate(organizationId: string, candidateId: string) {
    return tenantDb.assessmentAssignment.findMany({
      where: { organizationId, candidateId },
      select: assignmentSummarySelect,
      orderBy: { assignedAt: 'desc' },
    });
  },

  // Ownership probe — scoped by BOTH candidateId and organizationId (IDOR
  // defense, same pattern as findApplicationDetail in candidate-portal.repository.ts).
  findOwnedAssignment(organizationId: string, candidateId: string, assignmentId: string) {
    return tenantDb.assessmentAssignment.findFirst({
      where: { id: assignmentId, organizationId, candidateId },
      select: { id: true, status: true, expiresAt: true, assessmentTypeId: true },
    });
  },

  findQuestionsForType(organizationId: string, assessmentTypeId: string) {
    return tenantDb.assessmentQuestion.findMany({
      where: { organizationId, assessmentTypeId, isActive: true },
      orderBy: { order: 'asc' },
      select: candidateQuestionSelect,
    });
  },

  // Idempotent: `update: {}` is a deliberate no-op on repeat — never overwrite
  // an existing consent's agreedAt/ip/ua on a retried/idempotent startAssessment
  // call, only the FIRST acceptance counts as the non-repudiation record. This
  // is why the repo has no separate findConsent check-first — the upsert IS
  // the idempotency guard.
  upsertConsent(data: {
    organizationId: string;
    assignmentId: string;
    candidateId: string;
    textVersion: string;
    ipAddress: string | null;
    userAgent: string | null;
  }) {
    return tenantDb.assessmentConsent.upsert({
      where: { assignmentId: data.assignmentId },
      // Non-repudiation: never overwrite an existing consent's agreedAt/ip/ua on
      // a retried/idempotent startAssessment call — only the first acceptance counts.
      update: {},
      create: {
        organizationId: data.organizationId,
        assignmentId: data.assignmentId,
        candidateId: data.candidateId,
        consentType: 'habeas_data',
        textVersion: data.textVersion,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
      select: { id: true },
    });
  },

  // Idempotent: only flips assigned -> in_progress; a retry while already
  // in_progress or completed is a caller-level idempotency/guard concern
  // (handled in the service), not this write's.
  markStarted(assignmentId: string) {
    return tenantDb.assessmentAssignment.update({
      where: { id: assignmentId },
      data: { status: 'in_progress', startedAt: new Date() },
      select: { id: true, status: true },
    });
  },
};
```

- [ ] **Step 2: Type-check and commit**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: no errors (service/router don't exist yet, so this file alone must compile standalone — run `npx tsc --noEmit packages/api/src/repositories/candidate-assessment.repository.ts --esModuleInterop --skipLibCheck` if the full package check fails on unrelated missing pieces; otherwise the full package check is fine since this is purely additive).

```bash
git add packages/api/src/repositories/candidate-assessment.repository.ts
git commit -m "feat(assessment): candidate-assessment repository (read + consent + start)"
```

---

### Task 4: `getMyAssessments` + `startAssessment` service

**Files:**

- Modify: `packages/api/src/services/candidate-portal.service.ts` (export `resolveOrg`)
- Create: `packages/api/src/services/candidate-assessment.service.ts`
- Test: `tests/assessment/candidate-assessment-service.test.ts` (new)

**Interfaces:**

- Consumes: `candidateAssessmentRepo` (Task 3), `candidatePortalRepo.findActiveCandidate` (existing), `resolveOrg` (existing, now exported), `runWithTenant` (`@tims/db`).
- Produces:
  - `candidateAssessmentService.getMyAssessments(email, orgSlug): Promise<AssignmentSummary[]>`
  - `candidateAssessmentService.startAssessment(email, orgSlug, assignmentId, consentAccepted, ipAddress, userAgent): Promise<{ id: string; status: string }>`

- [ ] **Step 1: Export `resolveOrg`**

In `packages/api/src/services/candidate-portal.service.ts`, change:

```ts
async function resolveOrg(orgSlug: string) {
```

to:

```ts
// Exported for reuse by candidate-assessment.service.ts (same org-resolution
// contract every candidate-portal endpoint needs).
export async function resolveOrg(orgSlug: string) {
```

- [ ] **Step 2: Write the failing tests**

Create `tests/assessment/candidate-assessment-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../packages/api/src/repositories/candidate-assessment.repository', () => ({
  candidateAssessmentRepo: {
    findAssignmentsForCandidate: vi.fn(),
    findOwnedAssignment: vi.fn(),
    findQuestionsForType: vi.fn(),
    upsertConsent: vi.fn(),
    markStarted: vi.fn(),
  },
}));
vi.mock('../../packages/api/src/repositories/candidate-portal.repository', () => ({
  candidatePortalRepo: {
    findOrgBySlug: vi.fn(),
    findActiveCandidate: vi.fn(),
  },
}));
vi.mock('@tims/db', () => ({ runWithTenant: (_o: string, f: () => unknown) => f() }));

import { candidateAssessmentService } from '../../packages/api/src/services/candidate-assessment.service';
import { candidateAssessmentRepo } from '../../packages/api/src/repositories/candidate-assessment.repository';
import { candidatePortalRepo } from '../../packages/api/src/repositories/candidate-portal.repository';

const ORG = { id: 'org-1', name: 'TIMS', isActive: true };
const EMAIL = 'candidate@example.com';
const SLUG = 'tims';
const ASSIGNMENT_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(candidatePortalRepo.findOrgBySlug).mockResolvedValue(ORG as never);
});

describe('candidateAssessmentService.getMyAssessments', () => {
  it('throws NOT_FOUND for a missing/inactive org', async () => {
    vi.mocked(candidatePortalRepo.findOrgBySlug).mockResolvedValue(null);
    await expect(candidateAssessmentService.getMyAssessments(EMAIL, SLUG)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('returns an empty list when the session email has no candidate at this org', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue(null);
    expect(await candidateAssessmentService.getMyAssessments(EMAIL, SLUG)).toEqual([]);
    expect(candidateAssessmentRepo.findAssignmentsForCandidate).not.toHaveBeenCalled();
  });

  it("returns the candidate's assignments", async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findAssignmentsForCandidate).mockResolvedValue([{ id: 'a1' }] as never);
    expect(await candidateAssessmentService.getMyAssessments(EMAIL, SLUG)).toEqual([{ id: 'a1' }]);
  });
});

describe('candidateAssessmentService.startAssessment', () => {
  it('rejects when consentAccepted is not true, before any write', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    await expect(
      candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, false, null, null),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'consent_required' });
    expect(candidateAssessmentRepo.upsertConsent).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when the assignment is not owned by this candidate', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue(null);
    await expect(
      candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, true, null, null),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects an expired assignment', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'assigned',
      expiresAt: new Date('2020-01-01'),
      assessmentTypeId: 'type-1',
    } as never);
    await expect(
      candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, true, null, null),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'assignment_expired' });
    expect(candidateAssessmentRepo.markStarted).not.toHaveBeenCalled();
  });

  it('rejects a completed/cancelled assignment (out of {assigned, in_progress})', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'completed',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    await expect(
      candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, true, null, null),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'assignment_not_startable' });
  });

  it('records consent then marks in_progress on first start', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'assigned',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentRepo.markStarted).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
    } as never);

    const result = await candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, true, '1.2.3.4', 'ua');

    expect(candidateAssessmentRepo.upsertConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId: ASSIGNMENT_ID,
        candidateId: 'cand-1',
        ipAddress: '1.2.3.4',
        userAgent: 'ua',
      }),
    );
    expect(candidateAssessmentRepo.markStarted).toHaveBeenCalledWith(ASSIGNMENT_ID);
    expect(result).toEqual({ id: ASSIGNMENT_ID, status: 'in_progress' });
  });

  it('is idempotent when already in_progress — re-marks started without erroring', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentRepo.markStarted).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
    } as never);

    const result = await candidateAssessmentService.startAssessment(EMAIL, SLUG, ASSIGNMENT_ID, true, null, null);
    expect(result.status).toBe('in_progress');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/assessment/candidate-assessment-service.test.ts`
Expected: FAIL — `candidate-assessment.service` module not found.

- [ ] **Step 4: Implement the service (getMyAssessments + startAssessment only — submitAssessment/getAssessmentQuestions land in Tasks 5-6)**

Create `packages/api/src/services/candidate-assessment.service.ts`:

```ts
import { TRPCError } from '@trpc/server';
import { runWithTenant } from '@tims/db';
import { candidateAssessmentRepo } from '../repositories/candidate-assessment.repository';
import { candidatePortalRepo } from '../repositories/candidate-portal.repository';
import { resolveOrg } from './candidate-portal.service';

// Versioned Habeas-Data data-processing consent text identifier (non-repudiation
// record). The actual legal text lives in the Slice 3 FE i18n bundle; the server
// only needs a stable version id to prove which text the candidate agreed to.
const HABEAS_DATA_CONSENT_VERSION = 'habeas-data-assessment-v1';

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() < Date.now();
}

const STARTABLE_STATUSES = new Set(['assigned', 'in_progress']);

export const candidateAssessmentService = {
  // An authenticated email with no Candidate record at this org is a valid
  // state (empty list, not an error) — matches getMyApplications.
  async getMyAssessments(email: string, orgSlug: string) {
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) return [];
      return candidateAssessmentRepo.findAssignmentsForCandidate(org.id, candidate.id);
    });
  },

  async startAssessment(
    email: string,
    orgSlug: string,
    assignmentId: string,
    consentAccepted: boolean,
    ipAddress: string | null,
    userAgent: string | null,
  ) {
    if (!consentAccepted) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'consent_required' });
    }
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }
      const assignment = await candidateAssessmentRepo.findOwnedAssignment(org.id, candidate.id, assignmentId);
      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }
      if (isExpired(assignment.expiresAt)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_expired' });
      }
      if (!STARTABLE_STATUSES.has(assignment.status)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_not_startable' });
      }

      // Idempotent: record consent on first start only (upsertConsent no-ops on
      // repeat), then (re)confirm in_progress either way.
      await candidateAssessmentRepo.upsertConsent({
        organizationId: org.id,
        assignmentId,
        candidateId: candidate.id,
        textVersion: HABEAS_DATA_CONSENT_VERSION,
        ipAddress,
        userAgent,
      });
      return candidateAssessmentRepo.markStarted(assignmentId);
    });
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/assessment/candidate-assessment-service.test.ts`
Expected: PASS (9 tests). Note: `getAssessmentQuestions`/`submitAssessment` tests are added in Tasks 5-6 to this same file.

- [ ] **Step 6: Type-check and commit**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: no errors.

```bash
git add packages/api/src/services/candidate-portal.service.ts packages/api/src/services/candidate-assessment.service.ts tests/assessment/candidate-assessment-service.test.ts
git commit -m "feat(assessment): getMyAssessments + startAssessment candidate service"
```

---

### Task 5: `getAssessmentQuestions` service

**Files:**

- Modify: `packages/api/src/services/candidate-assessment.service.ts`
- Modify: `tests/assessment/candidate-assessment-service.test.ts`

**Interfaces:**

- Produces: `candidateAssessmentService.getAssessmentQuestions(email, orgSlug, assignmentId): Promise<CandidateQuestionDto[]>` — DTO never includes `correctOptionIds`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/assessment/candidate-assessment-service.test.ts`:

```ts
describe('candidateAssessmentService.getAssessmentQuestions', () => {
  it('throws NOT_FOUND when the assignment is not owned by this candidate', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue(null);
    await expect(candidateAssessmentService.getAssessmentQuestions(EMAIL, SLUG, ASSIGNMENT_ID)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects when the assignment has not been started', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'assigned',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    await expect(candidateAssessmentService.getAssessmentQuestions(EMAIL, SLUG, ASSIGNMENT_ID)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'assignment_not_in_progress',
    });
  });

  it('rejects an expired in_progress assignment', async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: new Date('2020-01-01'),
      assessmentTypeId: 'type-1',
    } as never);
    await expect(candidateAssessmentService.getAssessmentQuestions(EMAIL, SLUG, ASSIGNMENT_ID)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'assignment_expired',
    });
  });

  it("returns the assessment type's questions without correctOptionIds", async () => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    const questions = [
      { id: 'q1', order: 0, type: 'single_choice', prompt: 'p', options: [{ id: 'a', label: 'A' }], points: 1 },
    ];
    vi.mocked(candidateAssessmentRepo.findQuestionsForType).mockResolvedValue(questions as never);

    const result = await candidateAssessmentService.getAssessmentQuestions(EMAIL, SLUG, ASSIGNMENT_ID);

    expect(result).toEqual(questions);
    expect(JSON.stringify(result)).not.toContain('correctOptionIds');
    expect(candidateAssessmentRepo.findQuestionsForType).toHaveBeenCalledWith('org-1', 'type-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/assessment/candidate-assessment-service.test.ts`
Expected: FAIL — `getAssessmentQuestions` is not a function.

- [ ] **Step 3: Implement**

In `packages/api/src/services/candidate-assessment.service.ts`, add to the exported `candidateAssessmentService` object (after `startAssessment`):

```ts
  async getAssessmentQuestions(email: string, orgSlug: string, assignmentId: string) {
    const org = await resolveOrg(orgSlug);
    return runWithTenant(org.id, async () => {
      const candidate = await candidatePortalRepo.findActiveCandidate(org.id, email);
      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }
      const assignment = await candidateAssessmentRepo.findOwnedAssignment(org.id, candidate.id, assignmentId);
      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }
      if (assignment.status !== 'in_progress') {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_not_in_progress' });
      }
      if (isExpired(assignment.expiresAt)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_expired' });
      }
      return candidateAssessmentRepo.findQuestionsForType(org.id, assignment.assessmentTypeId);
    });
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/assessment/candidate-assessment-service.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Type-check and commit**

Run: `pnpm --filter @tims/api exec tsc --noEmit`

```bash
git add packages/api/src/services/candidate-assessment.service.ts tests/assessment/candidate-assessment-service.test.ts
git commit -m "feat(assessment): getAssessmentQuestions candidate service (never leaks correctOptionIds)"
```

---

### Task 6: Transactional write repo functions + atomic `submitAssessment`

**Files:**

- Modify: `packages/api/src/repositories/candidate-assessment.repository.ts`
- Modify: `packages/api/src/services/candidate-assessment.service.ts`
- Modify: `tests/assessment/candidate-assessment-service.test.ts`

**Interfaces:**

- Consumes: `runTenantTransaction` (Task 1), `scoreChoice`/`computeResult`/`AnswerInput` (Task 2).
- Produces:
  - `candidateAssessmentRepo.findAssignmentInTx(tx, organizationId, candidateId, assignmentId)`
  - `candidateAssessmentRepo.findQuestionsWithAnswerKeyInTx(tx, organizationId, assessmentTypeId)`
  - `candidateAssessmentRepo.upsertResponseInTx(tx, data)`
  - `candidateAssessmentRepo.upsertResultInTx(tx, data)`
  - `candidateAssessmentRepo.completeAssignmentInTx(tx, assignmentId)`
  - `candidateAssessmentService.submitAssessment(email, orgSlug, assignmentId, answers): Promise<{ rawScore: number; normalizedScore: number; hasPending: boolean }>`

- [ ] **Step 1: Add the tx-bound repo functions**

Append to `packages/api/src/repositories/candidate-assessment.repository.ts` (add `Prisma.TransactionClient` to the existing `import type { Prisma } from '@tims/db';`, already present):

```ts
export const candidateAssessmentWriteRepo = {
  // Re-probed INSIDE the transaction (not just before it) to close the
  // double-submit race: two concurrent submitAssessment calls must not both
  // pass the outer pre-check and both write.
  findAssignmentInTx(tx: Prisma.TransactionClient, organizationId: string, candidateId: string, assignmentId: string) {
    return tx.assessmentAssignment.findFirst({
      where: { id: assignmentId, organizationId, candidateId },
      select: { id: true, status: true, expiresAt: true, assessmentTypeId: true },
    });
  },

  // Answer-key select is ONLY ever used inside the write transaction, never
  // returned to the candidate — the read-side findQuestionsForType above is the
  // candidate-facing DTO and never selects correctOptionIds.
  findQuestionsWithAnswerKeyInTx(tx: Prisma.TransactionClient, organizationId: string, assessmentTypeId: string) {
    return tx.assessmentQuestion.findMany({
      where: { organizationId, assessmentTypeId },
      select: { id: true, type: true, correctOptionIds: true, points: true },
    });
  },

  upsertResponseInTx(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      assignmentId: string;
      questionId: string;
      selectedOptionIds: Prisma.InputJsonValue | null;
      freeText: string | null;
      isCorrect: boolean | null;
      pointsAwarded: number | null;
    },
  ) {
    return tx.assessmentResponse.upsert({
      where: { assignmentId_questionId: { assignmentId: data.assignmentId, questionId: data.questionId } },
      create: {
        organizationId: data.organizationId,
        assignmentId: data.assignmentId,
        questionId: data.questionId,
        selectedOptionIds: data.selectedOptionIds ?? undefined,
        freeText: data.freeText,
        isCorrect: data.isCorrect,
        pointsAwarded: data.pointsAwarded,
        submittedAt: new Date(),
      },
      update: {
        selectedOptionIds: data.selectedOptionIds ?? undefined,
        freeText: data.freeText,
        isCorrect: data.isCorrect,
        pointsAwarded: data.pointsAwarded,
        submittedAt: new Date(),
      },
    });
  },

  upsertResultInTx(
    tx: Prisma.TransactionClient,
    data: {
      organizationId: string;
      assignmentId: string;
      rawScore: number;
      normalizedScore: number;
      breakdown: Prisma.InputJsonValue;
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
      },
      update: {
        rawScore: data.rawScore,
        normalizedScore: data.normalizedScore,
        breakdown: data.breakdown,
      },
    });
  },

  completeAssignmentInTx(tx: Prisma.TransactionClient, assignmentId: string) {
    return tx.assessmentAssignment.update({
      where: { id: assignmentId },
      data: { status: 'completed', completedAt: new Date() },
    });
  },
};
```

- [ ] **Step 2: Write the failing service tests**

Append to `tests/assessment/candidate-assessment-service.test.ts`. This needs `runTenantTransaction` mocked to hand back a fixed `tx` stub, plus the new `candidateAssessmentWriteRepo` mocked:

```ts
vi.mock('../../packages/api/src/repositories/candidate-assessment.repository', async () => {
  const actual = await vi.importActual<
    typeof import('../../packages/api/src/repositories/candidate-assessment.repository')
  >('../../packages/api/src/repositories/candidate-assessment.repository');
  return {
    ...actual,
    candidateAssessmentRepo: {
      findAssignmentsForCandidate: vi.fn(),
      findOwnedAssignment: vi.fn(),
      findQuestionsForType: vi.fn(),
      upsertConsent: vi.fn(),
      markStarted: vi.fn(),
    },
    candidateAssessmentWriteRepo: {
      findAssignmentInTx: vi.fn(),
      findQuestionsWithAnswerKeyInTx: vi.fn(),
      upsertResponseInTx: vi.fn(),
      upsertResultInTx: vi.fn(),
      completeAssignmentInTx: vi.fn(),
    },
  };
});
vi.mock('@tims/db', () => ({
  runWithTenant: (_o: string, f: () => unknown) => f(),
  runTenantTransaction: (_o: string, f: (tx: unknown) => unknown) => f({}),
}));

import { candidateAssessmentWriteRepo } from '../../packages/api/src/repositories/candidate-assessment.repository';

const SINGLE_CHOICE_Q = { id: 'q1', type: 'single_choice', correctOptionIds: ['b'], points: 5 };
const FREE_TEXT_Q = { id: 'q2', type: 'free_text', correctOptionIds: [], points: 20 };

describe('candidateAssessmentService.submitAssessment', () => {
  beforeEach(() => {
    vi.mocked(candidatePortalRepo.findActiveCandidate).mockResolvedValue({ id: 'cand-1' } as never);
  });

  it('throws NOT_FOUND when the assignment is not owned (pre-check)', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue(null);
    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'q1', selectedOptionIds: ['b'] },
      ]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a double-submit against an already-completed assignment (pre-check)', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'completed',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'q1', selectedOptionIds: ['b'] },
      ]),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'assignment_already_completed' });
    expect(candidateAssessmentWriteRepo.findAssignmentInTx).not.toHaveBeenCalled();
  });

  it('rejects a double-submit caught only inside the transaction (race)', async () => {
    vi.mocked(candidateAssessmentRepo.findOwnedAssignment).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'in_progress',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    vi.mocked(candidateAssessmentWriteRepo.findAssignmentInTx).mockResolvedValue({
      id: ASSIGNMENT_ID,
      status: 'completed',
      expiresAt: null,
      assessmentTypeId: 'type-1',
    } as never);
    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'q1', selectedOptionIds: ['b'] },
      ]),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'assignment_already_completed' });
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).not.toHaveBeenCalled();
  });

  it("rejects a questionId that does not belong to the assignment's assessmentTypeId", async () => {
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
    ] as never);
    await expect(
      candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
        { questionId: 'not-in-type', selectedOptionIds: ['b'] },
      ]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'question_not_in_assessment' });
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).not.toHaveBeenCalled();
  });

  it('auto-scores MCQ, leaves free_text ungraded, and completes the assignment atomically', async () => {
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

    const result = await candidateAssessmentService.submitAssessment(EMAIL, SLUG, ASSIGNMENT_ID, [
      { questionId: 'q1', selectedOptionIds: ['b'] },
      { questionId: 'q2', freeText: 'my essay' },
    ]);

    expect(candidateAssessmentWriteRepo.upsertResponseInTx).toHaveBeenCalledTimes(2);
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ questionId: 'q1', isCorrect: true, pointsAwarded: 5 }),
    );
    expect(candidateAssessmentWriteRepo.upsertResponseInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ questionId: 'q2', isCorrect: null, pointsAwarded: null, freeText: 'my essay' }),
    );
    expect(candidateAssessmentWriteRepo.upsertResultInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ rawScore: 5, normalizedScore: 100 }),
    );
    expect(candidateAssessmentWriteRepo.completeAssignmentInTx).toHaveBeenCalledWith({}, ASSIGNMENT_ID);
    expect(result).toEqual({ rawScore: 5, normalizedScore: 100, hasPending: true });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/assessment/candidate-assessment-service.test.ts`
Expected: FAIL — `submitAssessment` is not a function / `candidateAssessmentWriteRepo` has no export.

- [ ] **Step 4: Implement `submitAssessment`**

In `packages/api/src/services/candidate-assessment.service.ts`:

- Change the `@tims/db` import to also pull `runTenantTransaction`:

```ts
import { runWithTenant, runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';
```

- Change the repo import to also pull the write repo and add the shared imports:

```ts
import { candidateAssessmentRepo, candidateAssessmentWriteRepo } from '../repositories/candidate-assessment.repository';
import { scoreChoice, computeResult, type AnswerInput, type GradedAnswer } from '@tims/shared';
```

- Add to the exported `candidateAssessmentService` object (after `getAssessmentQuestions`):

```ts
  async submitAssessment(email: string, orgSlug: string, assignmentId: string, answers: AnswerInput[]) {
    const org = await resolveOrg(orgSlug);
    const candidate = await runWithTenant(org.id, () => candidatePortalRepo.findActiveCandidate(org.id, email));
    if (!candidate) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
    }
    // Outer pre-check: fail fast on an obviously-invalid attempt before opening
    // a write transaction. The SAME check is repeated inside the transaction
    // below (findAssignmentInTx) to close the double-submit race — two
    // concurrent submits must not both pass this pre-check and both write.
    const preCheck = await runWithTenant(org.id, () =>
      candidateAssessmentRepo.findOwnedAssignment(org.id, candidate.id, assignmentId),
    );
    if (!preCheck) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
    }
    if (preCheck.status === 'completed') {
      throw new TRPCError({ code: 'CONFLICT', message: 'assignment_already_completed' });
    }
    if (preCheck.status !== 'in_progress') {
      throw new TRPCError({ code: 'CONFLICT', message: 'assignment_not_in_progress' });
    }
    if (isExpired(preCheck.expiresAt)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'assignment_expired' });
    }

    return runTenantTransaction(org.id, async (tx) => {
      const assignment = await candidateAssessmentWriteRepo.findAssignmentInTx(tx, org.id, candidate.id, assignmentId);
      if (!assignment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Asignacion no encontrada' });
      }
      if (assignment.status === 'completed') {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_already_completed' });
      }
      if (assignment.status !== 'in_progress') {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_not_in_progress' });
      }
      if (isExpired(assignment.expiresAt)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_expired' });
      }

      const questions = await candidateAssessmentWriteRepo.findQuestionsWithAnswerKeyInTx(
        tx, org.id, assignment.assessmentTypeId,
      );
      const questionsById = new Map(questions.map((q) => [q.id, q]));

      for (const answer of answers) {
        if (!questionsById.has(answer.questionId)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'question_not_in_assessment' });
        }
      }

      const graded: GradedAnswer[] = [];
      const pendingManual: string[] = [];
      for (const answer of answers) {
        const question = questionsById.get(answer.questionId)!;
        if (question.type === 'free_text') {
          await candidateAssessmentWriteRepo.upsertResponseInTx(tx, {
            organizationId: org.id,
            assignmentId,
            questionId: question.id,
            selectedOptionIds: null,
            freeText: answer.freeText ?? '',
            isCorrect: null,
            pointsAwarded: null,
          });
          graded.push({ isCorrect: null, pointsAwarded: null, points: question.points });
          pendingManual.push(question.id);
        } else {
          const selected = answer.selectedOptionIds ?? [];
          const { isCorrect, pointsAwarded } = scoreChoice(
            selected, question.correctOptionIds as string[], question.points,
          );
          await candidateAssessmentWriteRepo.upsertResponseInTx(tx, {
            organizationId: org.id,
            assignmentId,
            questionId: question.id,
            selectedOptionIds: selected as Prisma.InputJsonValue,
            freeText: null,
            isCorrect,
            pointsAwarded,
          });
          graded.push({ isCorrect, pointsAwarded, points: question.points });
        }
      }

      const { rawScore, normalizedScore, hasPending } = computeResult(graded);
      const autoScored = graded.filter((g) => g.isCorrect !== null).length;

      await candidateAssessmentWriteRepo.upsertResultInTx(tx, {
        organizationId: org.id,
        assignmentId,
        rawScore,
        normalizedScore,
        breakdown: { autoScored, pendingManual },
      });
      await candidateAssessmentWriteRepo.completeAssignmentInTx(tx, assignmentId);

      return { rawScore, normalizedScore, hasPending };
    });
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/assessment/candidate-assessment-service.test.ts`
Expected: PASS (18 tests total).

- [ ] **Step 6: Full check and commit**

Run: `pnpm --filter @tims/api exec tsc --noEmit && npx vitest run tests/assessment/ tests/db/`
Expected: all green.

```bash
git add packages/api/src/repositories/candidate-assessment.repository.ts packages/api/src/services/candidate-assessment.service.ts tests/assessment/candidate-assessment-service.test.ts
git commit -m "feat(assessment): atomic submitAssessment — auto-scores MCQ, leaves essays pending, closes the double-submit race"
```

---

### Task 7: Wire the 4 procedures into `candidatePortalRouter`

**Files:**

- Modify: `packages/api/src/routers/candidate-portal.ts`

**Interfaces:**

- Consumes: `candidateAssessmentService` (Tasks 4-6), `submitAssessmentAnswersSchema` (`@tims/shared`).
- Produces: `candidatePortal.getMyAssessments`, `candidatePortal.startAssessment`, `candidatePortal.getAssessmentQuestions`, `candidatePortal.submitAssessment` (tRPC procedures).

- [ ] **Step 1: Implement**

In `packages/api/src/routers/candidate-portal.ts`:

- Add imports (after the existing `candidatePortalService` import):

```ts
import { candidateAssessmentService } from '../services/candidate-assessment.service';
import { submitAssessmentAnswersSchema } from '@tims/shared';
```

- Add to the `candidatePortalRouter` object, after `askFaq`:

```ts
  // The signed-in candidate's assessment assignments at this org.
  getMyAssessments: candidateProcedure
    .input(z.object({ orgSlug }))
    .query(({ ctx, input }) =>
      candidateAssessmentService.getMyAssessments(ctx.supabaseAuth.email, input.orgSlug),
    ),

  // Accept the Habeas-Data consent and move an assignment into in_progress.
  // Idempotent if already in_progress.
  startAssessment: candidateProcedure
    .input(z.object({ orgSlug, assignmentId: z.string().uuid(), consentAccepted: z.boolean() }))
    .mutation(({ ctx, input }) =>
      candidateAssessmentService.startAssessment(
        ctx.supabaseAuth.email,
        input.orgSlug,
        input.assignmentId,
        input.consentAccepted,
        ctx.headers.get('x-forwarded-for') || ctx.headers.get('x-real-ip'),
        ctx.headers.get('user-agent'),
      ),
    ),

  // Questions for an in_progress assignment. NEVER includes correctOptionIds.
  getAssessmentQuestions: candidateProcedure
    .input(z.object({ orgSlug, assignmentId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      candidateAssessmentService.getAssessmentQuestions(ctx.supabaseAuth.email, input.orgSlug, input.assignmentId),
    ),

  // Atomic: grades every answer, upserts the result, marks the assignment
  // completed — all inside one transaction (candidate-assessment.service.ts).
  submitAssessment: candidateProcedure
    .input(z.object({ orgSlug, assignmentId: z.string().uuid(), answers: submitAssessmentAnswersSchema }))
    .mutation(({ ctx, input }) =>
      candidateAssessmentService.submitAssessment(
        ctx.supabaseAuth.email, input.orgSlug, input.assignmentId, input.answers,
      ),
    ),
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full existing candidate-portal test suite (regression check)**

Run: `npx vitest run tests/portal/`
Expected: PASS — no existing candidate-portal test should break (Task 8 adds new assertions to this same file next).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routers/candidate-portal.ts
git commit -m "feat(assessment): wire candidate take-flow procedures into candidatePortalRouter"
```

---

### Task 8: Static-source security assertions

**Files:**

- Modify: `tests/portal/candidate-procedure.test.ts`

**Interfaces:**

- Consumes: nothing new — reads the same files this test already reads (`ROUTER`, plus new `SERVICE`/`REPO` reads for the assessment files), matching its existing regex-assertion style.

- [ ] **Step 1: Write the assertions**

In `tests/portal/candidate-procedure.test.ts`, add two new `const` reads near the top (after the existing `REPO` line):

```ts
const ASSESSMENT_SERVICE = read('packages/api/src/services/candidate-assessment.service.ts');
const ASSESSMENT_REPO = read('packages/api/src/repositories/candidate-assessment.repository.ts');
```

Append a new `describe` block at the end of the file:

```ts
describe('candidate assessment take-flow — security invariants (Wave 1.5a slice 2)', () => {
  it('every new candidate-portal assessment endpoint uses candidateProcedure', () => {
    for (const name of ['getMyAssessments', 'startAssessment', 'getAssessmentQuestions', 'submitAssessment']) {
      const slice = ROUTER.slice(ROUTER.indexOf(`${name}:`));
      expect(slice).toMatch(/candidateProcedure/);
    }
  });

  it('never accepts a client-supplied candidateId or email on the assessment endpoints', () => {
    const slice = ROUTER.slice(ROUTER.indexOf('getMyAssessments:'));
    expect(slice).not.toMatch(/candidateId:\s*z\./);
    expect(slice).not.toMatch(/email:\s*z\./);
  });

  it('getAssessmentQuestions repo select never includes correctOptionIds', () => {
    const candidateSelect = ASSESSMENT_REPO.slice(
      ASSESSMENT_REPO.indexOf('candidateQuestionSelect'),
      ASSESSMENT_REPO.indexOf('assignmentSummarySelect'),
    );
    expect(candidateSelect).not.toContain('correctOptionIds');
  });

  it('the answer-key select is confined to the *InTx helpers (never returned to the candidate)', () => {
    expect(ASSESSMENT_REPO).toContain('findQuestionsWithAnswerKeyInTx');
    // Only the tx-bound (write-path) function may select correctOptionIds.
    const answerKeySlice = ASSESSMENT_REPO.slice(ASSESSMENT_REPO.indexOf('findQuestionsWithAnswerKeyInTx'));
    expect(answerKeySlice.slice(0, 300)).toContain('correctOptionIds');
  });

  it('every assessment repo read is scoped by BOTH organizationId and candidateId (IDOR)', () => {
    expect(ASSESSMENT_REPO).toMatch(
      /findOwnedAssignment\([^)]*\)\s*\{\s*return\s+tenantDb\.assessmentAssignment\.findFirst\(\{\s*where:\s*\{[^}]*organizationId[^}]*candidateId/s,
    );
  });

  it('submitAssessment uses runTenantTransaction, never tenantDb.$transaction (Prisma #17948)', () => {
    expect(ASSESSMENT_SERVICE).toContain('runTenantTransaction');
    expect(ASSESSMENT_SERVICE).not.toMatch(/tenantDb\.\$transaction/);
  });

  it('submitAssessment re-checks assignment status INSIDE the transaction (closes the double-submit race)', () => {
    const submitSlice = ASSESSMENT_SERVICE.slice(ASSESSMENT_SERVICE.indexOf('async submitAssessment'));
    expect(submitSlice).toContain('findAssignmentInTx');
    expect(submitSlice).toMatch(/assignment_already_completed/);
  });

  it("submitAssessment validates every questionId belongs to the assignment's assessmentTypeId before writing", () => {
    const submitSlice = ASSESSMENT_SERVICE.slice(ASSESSMENT_SERVICE.indexOf('async submitAssessment'));
    const validateIdx = submitSlice.indexOf('question_not_in_assessment');
    const firstWriteIdx = submitSlice.indexOf('upsertResponseInTx(tx');
    expect(validateIdx).toBeGreaterThan(0);
    expect(firstWriteIdx).toBeGreaterThan(validateIdx);
  });

  it('free_text answers are never auto-graded (no fabricated AI/auto score — rule #4)', () => {
    const submitSlice = ASSESSMENT_SERVICE.slice(ASSESSMENT_SERVICE.indexOf('async submitAssessment'));
    const freeTextBranch = submitSlice.slice(submitSlice.indexOf("question.type === 'free_text'"));
    expect(freeTextBranch.slice(0, 400)).toMatch(/isCorrect:\s*null/);
    expect(freeTextBranch.slice(0, 400)).toMatch(/pointsAwarded:\s*null/);
  });

  it('all submitAssessment inputs are bounded (answers array + freeText + selectedOptionIds)', () => {
    const SHARED_ASSESSMENT = read('packages/shared/src/validators/assessment.ts');
    expect(SHARED_ASSESSMENT).toMatch(
      /submitAssessmentAnswersSchema\s*=\s*z\.array\(answerInputSchema\)\.min\(1\)\.max\(/,
    );
    expect(SHARED_ASSESSMENT).toMatch(/freeText:\s*z\.string\(\)\.max\(/);
    expect(SHARED_ASSESSMENT).toMatch(/selectedOptionIds:\s*z\.array\(z\.string\(\)\.min\(1\)\.max\(64\)\)\.max\(/);
  });
});
```

- [ ] **Step 2: Run the full test file**

Run: `npx vitest run tests/portal/candidate-procedure.test.ts`
Expected: PASS — all new + existing assertions green.

- [ ] **Step 3: Full regression pass**

Run: `pnpm --filter @tims/api exec tsc --noEmit && cd apps/web && npx tsc --noEmit && cd ../.. && npx vitest run`
Expected: full monorepo type-check + test suite green (this is the same bar as `/gate`; run `/gate` itself if available in this session for the complete local verify, including the code-quality greps and gitleaks).

- [ ] **Step 4: Commit**

```bash
git add tests/portal/candidate-procedure.test.ts
git commit -m "test(assessment): static-source security assertions for the candidate take-flow (IDOR, no answer-key leak, real atomicity, double-submit race)"
```

---

## Explicitly out of scope for this plan

- Slice 3 (Player UI — consent gate, navigator, timer, MCQ/essay inputs, result screen, i18n) and Slice 4 (`/me` integration) per the design doc's own slice boundaries.
- The pre-existing `vacancy/approvals.ts` atomicity bug found while researching this plan — logged separately, not fixed here (see memory `project-vacancy-approval-transaction-bug-2026-07-29`).
- `assessment.getExplainability` stays `NOT_IMPLEMENTED` (Wave 3, per the design doc).
