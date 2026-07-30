import { TRPCError } from '@trpc/server';
import { runWithTenant, runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';
import { candidateAssessmentRepo, candidateAssessmentWriteRepo } from '../repositories/candidate-assessment.repository';
import { candidatePortalRepo } from '../repositories/candidate-portal.repository';
import { resolveOrg } from './candidate-portal.service';
import { scoreChoice, computeResult, type AnswerInput, type GradedAnswer } from '@tims/shared';

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
        tx,
        org.id,
        assignment.assessmentTypeId,
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
            selected,
            question.correctOptionIds as string[],
            question.points,
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
};
