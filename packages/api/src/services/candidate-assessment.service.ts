import { TRPCError } from '@trpc/server';
import { runWithTenant, runTenantTransaction } from '@tims/db';
import type { Prisma } from '@tims/db';
import { candidateAssessmentRepo, candidateAssessmentWriteRepo } from '../repositories/candidate-assessment.repository';
import { candidatePortalRepo } from '../repositories/candidate-portal.repository';
import { resolveOrg } from './candidate-portal.service';
import { isExpired } from './candidate-assessment-lifecycle.service';
import {
  scoreChoice,
  computeResult,
  computeNormBandFromCounts,
  type AnswerInput,
  type GradedAnswer,
  type ScoreBand,
} from '@tims/shared';

// ---------------------------------------------------------------------------
// Candidate Assessment Service — the single-transaction submitAssessment write
// flow. List/start/questions lifecycle now lives in
// candidate-assessment-lifecycle.service.ts (split per CLAUDE.md's 300-line
// service cap — this method can't be split further, it's one atomic tx).
// ---------------------------------------------------------------------------

export const candidateAssessmentService = {
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

      // Up-front validation pass over the SUBMITTED answers — membership
      // (every questionId belongs to this assessment type) and per-type
      // coherence (a choice question needs selectedOptionIds, a free_text
      // question needs freeText, never both) are both checked here, before
      // any write, so a bad answer never leaves partial writes to roll back
      // (review finding #4 — the schema comment promised this is enforced
      // server-side; nothing previously did).
      for (const answer of answers) {
        const question = questionsById.get(answer.questionId);
        if (!question) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'question_not_in_assessment' });
        }
        const hasFreeText = typeof answer.freeText === 'string' && answer.freeText.length > 0;
        const hasSelected = Array.isArray(answer.selectedOptionIds) && answer.selectedOptionIds.length > 0;
        const mismatch =
          (question.type !== 'free_text' && hasFreeText && !hasSelected) ||
          (question.type === 'free_text' && hasSelected);
        if (mismatch) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'answer_type_mismatch' });
        }
      }

      // Grade by iterating the QUESTION SET, not the submitted answers array
      // (review finding #2). Iterating `answers` let a duplicate questionId
      // double-count the score and let an unanswered question simply vanish
      // from both numerator and denominator (a 1-of-10 submission scored
      // 100%). A Map naturally resolves a duplicate submitted questionId to
      // its LAST occurrence — that's an accepted simple resolution, not a bug.
      const answersByQuestionId = new Map(answers.map((a) => [a.questionId, a]));

      const graded: GradedAnswer[] = [];
      const pendingManual: string[] = [];
      for (const question of questions) {
        const answer = answersByQuestionId.get(question.id);
        if (question.type === 'free_text') {
          await candidateAssessmentWriteRepo.upsertResponseInTx(tx, {
            organizationId: org.id,
            assignmentId,
            questionId: question.id,
            selectedOptionIds: null,
            freeText: answer?.freeText ?? '',
            isCorrect: null,
            pointsAwarded: null,
          });
          graded.push({ isCorrect: null, pointsAwarded: null, points: question.points });
          pendingManual.push(question.id);
        } else {
          // Unanswered choice question: score via scoreChoice([], ...) — an
          // empty selection naturally scores 0/incorrect, no special-casing,
          // and it still lands in computeResult's denominator.
          const selected = answer?.selectedOptionIds ?? [];
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

      // Norm band: only for a NON-partial result (no essay questions pending —
      // hasPending false). An essay-containing assessment stays partial until a
      // future essay-scoring pass, so it never enters or draws from the
      // population — this is an honest consequence of the existing
      // partial/pending design, not a gap (see the design spec's "Out of scope").
      let percentile: number | null = null;
      let band: ScoreBand | null = null;
      let normSampleSize: number | null = null;
      if (!hasPending) {
        const { countBelow, countEqual, sampleSize } = await candidateAssessmentWriteRepo.getNormCountsInTx(
          tx,
          org.id,
          assignment.assessmentTypeId,
          assignmentId,
          normalizedScore,
        );
        normSampleSize = sampleSize;
        const normResult = computeNormBandFromCounts(countBelow, countEqual, sampleSize);
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

      // Conditional final write — the ACTUAL double-submit race guard
      // (review finding #1). A losing concurrent submit's updateMany matches
      // 0 rows once the winner has committed; throwing here rolls back this
      // entire transaction (the response upserts + result upsert above),
      // so the loser leaves zero trace, not partial data.
      const completion = await candidateAssessmentWriteRepo.completeAssignmentInTx(
        tx,
        org.id,
        candidate.id,
        assignmentId,
      );
      if (completion.count === 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'assignment_already_completed' });
      }

      return { rawScore, normalizedScore, hasPending };
    });
  },
};
