import { tenantDb } from '@tims/db';
import type { Prisma } from '@tims/db';
import type { ScoreBand } from '@tims/shared';

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
  // breakdown is selected ONLY so candidateAssessmentService.getMyAssessments can derive
  // hasPending (Wave 1.5a slice 3) — it is stripped before the DTO leaves the service,
  // never returned to the client as raw JSON.
  result: { select: { normalizedScore: true, percentile: true, band: true, normSampleSize: true, breakdown: true } },
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

  // Idempotent: only flips assigned -> in_progress, and only sets startedAt on
  // that FIRST transition. The conditional updateMany's WHERE clause is the
  // guard — it matches 0 rows when the assignment is already in_progress (or
  // completed), so a repeat call (e.g. a candidate's page refresh) never
  // touches startedAt again. Same non-repudiation reasoning as upsertConsent
  // above: only the first event counts as the timing record (review finding
  // #2 — an unconditional update() here reset startedAt on every re-entry).
  async markStarted(assignmentId: string) {
    const result = await tenantDb.assessmentAssignment.updateMany({
      where: { id: assignmentId, status: 'assigned' },
      data: { status: 'in_progress', startedAt: new Date() },
    });
    if (result.count > 0) {
      return { id: assignmentId, status: 'in_progress' as const };
    }
    // Already in_progress (or completed) — return current state without
    // touching startedAt.
    return tenantDb.assessmentAssignment.findUniqueOrThrow({
      where: { id: assignmentId },
      select: { id: true, status: true },
    });
  },
};

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
  //
  // isActive: true MUST match findQuestionsForType's filter exactly. Staff
  // deactivate (never hard-delete) a question once it has submitted responses,
  // to preserve answer history. If grading ignored isActive, a deactivated
  // question would still be graded (scored 0 via scoreChoice([], ...)) and
  // still contribute its points to computeResult's denominator — silently
  // deflating every subsequent candidate's score on that assessment type, and
  // letting a deactivated question be accepted as a valid submission target
  // when it should be rejected as question_not_in_assessment (review finding #1).
  findQuestionsWithAnswerKeyInTx(tx: Prisma.TransactionClient, organizationId: string, assessmentTypeId: string) {
    return tx.assessmentQuestion.findMany({
      where: { organizationId, assessmentTypeId, isActive: true },
      select: { id: true, type: true, correctOptionIds: true, points: true },
    });
  },

  // Norm-band counts for every OTHER completed, non-partial result in the SAME
  // org + assessment type. `breakdown: { path: ['pendingManual'], equals: [] }`
  // filters to non-partial (no essay questions pending) — an essay-containing
  // assessment's result never enters the population until a future
  // essay-scoring pass empties pendingManual (same predicate as before).
  //
  // Issue #16: this used to be a `findMany` that materialized the ENTIRE
  // population into a JS array inside submitAssessment's open write
  // transaction just to rank one candidate — O(n) memory held for the
  // duration of a live write tx, not the "cheap aggregate" the design spec
  // claimed. Replaced with COUNT queries: O(1) memory regardless of
  // population size. `countBelow`/`countEqual` feed computeNormBandFromCounts'
  // exact same midpoint-rank formula computeNormBand used to compute from the
  // array; `sampleSize` is the population size itself, needed for both the
  // MIN_NORM_SAMPLE_SIZE gate and the percentile denominator — it cannot be
  // derived from countBelow+countEqual alone (that pair never sees rows ABOVE
  // the candidate's score), so a third count against the same WHERE clause
  // (unfiltered by score) is unavoidable. Same WHERE scope as before, no
  // behavior change for callers — just no full-population fetch.
  getNormCountsInTx(
    tx: Prisma.TransactionClient,
    organizationId: string,
    assessmentTypeId: string,
    excludeAssignmentId: string,
    candidateScore: number,
  ): Promise<{ countBelow: number; countEqual: number; sampleSize: number }> {
    const baseWhere: Prisma.AssessmentResultWhereInput = {
      organizationId,
      normalizedScore: { not: null },
      assignmentId: { not: excludeAssignmentId },
      assignment: { assessmentTypeId, status: 'completed' },
      breakdown: { path: ['pendingManual'], equals: [] },
    };
    return Promise.all([
      tx.assessmentResult.count({ where: { ...baseWhere, normalizedScore: { lt: candidateScore } } }),
      tx.assessmentResult.count({ where: { ...baseWhere, normalizedScore: candidateScore } }),
      tx.assessmentResult.count({ where: baseWhere }),
    ]).then(([countBelow, countEqual, sampleSize]) => ({ countBelow, countEqual, sampleSize }));
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
      percentile?: number | null;
      band?: ScoreBand | null;
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

  // Conditional write is the ACTUAL double-submit race guard (the early
  // findAssignmentInTx check above is not, under READ COMMITTED — see
  // review finding #1). The WHERE clause only matches a still-in_progress
  // row; a losing concurrent submit's updateMany blocks on the winner's row
  // lock, then re-evaluates this predicate against the now-committed
  // 'completed' row and matches 0 rows. Callers must check `count`.
  //
  // organizationId + candidateId are included even though this write is
  // currently only reachable after ownership was already verified earlier in
  // the same transaction (findAssignmentInTx). This is the transaction's
  // actual authoritative guard, so it must be independently IDOR-safe, not
  // merely correct-by-surrounding-context — same double-scoping pattern as
  // findAssignmentInTx/findAssignmentsForCandidate/findOwnedAssignment above
  // (review finding #3).
  completeAssignmentInTx(
    tx: Prisma.TransactionClient,
    organizationId: string,
    candidateId: string,
    assignmentId: string,
  ) {
    return tx.assessmentAssignment.updateMany({
      where: { id: assignmentId, organizationId, candidateId, status: 'in_progress' },
      data: { status: 'completed', completedAt: new Date() },
    });
  },
};
