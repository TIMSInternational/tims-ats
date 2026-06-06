import { TRPCError } from '@trpc/server';
import {
  summarizeInterview,
  generateInterviewGuide,
  detectScorecardBias,
  type ScorecardInput,
} from '@tims/ai';
import { interviewAiRepository } from '../repositories/interview-ai.repository';

/** Coerce an unknown JSON value into a clean string[] (skills can be Json/null). */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

type InterviewForAi = NonNullable<
  Awaited<ReturnType<typeof interviewAiRepository.findInterviewForAi>>
>;

function toScorecardInputs(interview: InterviewForAi): ScorecardInput[] {
  return interview.scorecards.map((s) => ({
    evaluatorLabel: `${s.evaluator.firstName} ${s.evaluator.lastName}`,
    recommendation: s.recommendation,
    ratings: s.ratings,
    overallNotes: s.overallNotes,
  }));
}

// ---------------------------------------------------------------------------
// Interview AI service — interview-domain entry points that call AI (rule #7:
// AI/PII work lives behind a dedicated service). Every call goes through the
// gated @tims/ai agents (budget → cache → PII → bedrock → validate → log);
// this layer never talks to the model directly (rule #2). Ownership is
// verified BEFORE any AI spend.
// ---------------------------------------------------------------------------

export const interviewAiService = {
  /** Role+candidate-tailored interview guide via the gated interview-guide agent. */
  async generateGuide(orgId: string, interviewId: string) {
    const interview = await interviewAiRepository.findInterviewForAi(orgId, interviewId);
    if (!interview) throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });

    const { result, model } = await generateInterviewGuide(orgId, {
      vacancyTitle: interview.vacancy.title,
      vacancyDescription: interview.vacancy.description,
      interviewType: interview.type,
      durationMinutes: interview.duration,
      candidateTitle: interview.candidate.currentTitle,
      candidateSkills: toStringArray(interview.candidate.skills),
    });

    return { interviewId, sections: result.sections, model };
  },

  /**
   * Real scorecard-grounded summary via the gated interview-summarizer agent.
   * Requires at least one scorecard — there is nothing honest to summarize
   * before evaluators submit (rule #4).
   */
  async generateSummary(orgId: string, interviewId: string) {
    const interview = await interviewAiRepository.findInterviewForAi(orgId, interviewId);
    if (!interview) throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
    if (interview.scorecards.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No hay scorecards para resumir — los evaluadores deben enviar sus evaluaciones primero',
      });
    }

    const { result, model } = await summarizeInterview(orgId, {
      candidateName: `${interview.candidate.firstName} ${interview.candidate.lastName}`,
      vacancyTitle: interview.vacancy.title,
      interviewType: interview.type,
      scorecards: toScorecardInputs(interview),
    });

    return interviewAiRepository.upsertSummary(orgId, interviewId, result, model);
  },

  /**
   * Real bias analysis via the gated bias-detector agent. Requires scorecards;
   * a degraded model response surfaces as overallRisk 'unknown' — never a
   * fabricated "low risk" (false compliance assurance).
   */
  async detectBias(orgId: string, interviewId: string) {
    const interview = await interviewAiRepository.findInterviewForAi(orgId, interviewId);
    if (!interview) throw new TRPCError({ code: 'NOT_FOUND', message: 'Entrevista no encontrada' });
    if (interview.scorecards.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No hay scorecards para analizar — los evaluadores deben enviar sus evaluaciones primero',
      });
    }

    const { result, model } = await detectScorecardBias(orgId, {
      vacancyTitle: interview.vacancy.title,
      scorecards: toScorecardInputs(interview),
    });

    return {
      interviewId,
      scorecardsAnalyzed: interview.scorecards.length,
      biasIndicators: result.biasIndicators,
      overallRisk: result.overallRisk,
      recommendations: result.recommendations,
      model,
    };
  },
};
