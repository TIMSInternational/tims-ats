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
