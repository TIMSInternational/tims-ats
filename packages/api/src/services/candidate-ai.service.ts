import { TRPCError } from '@trpc/server';
import { parseCV as parseCVAgent, screenCandidate as screenCandidateAgent } from '@tims/ai';
import { candidateRepository } from '../repositories/candidate.repository';
import { candidateAiRepository } from '../repositories/candidate-ai.repository';
import { fitEngineService } from './fit-engine.service';

/** Coerce an unknown JSON value into a clean string[] (skills can be Json/null). */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

// ---------------------------------------------------------------------------
// Candidate AI service — the candidate-domain entry points that call AI.
//
// Kept separate from candidate.service.ts because (a) it touches AI + PII, which
// CLAUDE.md §7 / rule #7 require to live behind a dedicated service, and (b) the
// core service is already at the 300-line limit. Every call here goes through
// the gated @tims/ai agents (budget → cache → PII → bedrock → validate → log);
// this layer never imports the AI SDK or talks to the model directly (rule #2).
// ---------------------------------------------------------------------------

export const candidateAiService = {
  /**
   * Parse CV text into structured candidate data via the gated cv-parser agent.
   *
   * Operates on TEXT the caller provides. Staff paste text by hand; the public
   * apply flow (portalApplicationService.processCvUpload) extracts it from an
   * uploaded PDF/DOCX via S3 first. When a documentId is given, the parse
   * result is persisted to that document. When a candidateId is given, the
   * parsed education/languages are additionally promoted onto the Candidate
   * row so the FIT Engine's experience/education/languages dimensions can
   * read them.
   */
  async parseCV(orgId: string, text: string, documentId?: string, candidateId?: string) {
    // Verify document ownership BEFORE spending an AI call on it.
    if (documentId) {
      const doc = await candidateRepository.findDocument(orgId, documentId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
    }

    const { data, model, confidence } = await parseCVAgent(orgId, text);

    const parsedData = {
      name: data.name,
      email: data.email,
      phone: data.phone,
      skills: data.skills,
      experience: data.experience,
      education: data.education,
      languages: data.languages,
      summary: data.summary,
      confidence,
      modelVersion: model,
      parsed: true,
    };

    if (documentId) {
      await candidateRepository.updateDocumentParsedData(documentId, parsedData);
    }

    if (candidateId) {
      await candidateRepository.updateCandidateParsedFields(orgId, candidateId, {
        education: data.education,
        languages: data.languages,
      });
    }

    return parsedData;
  },

  /**
   * Screen a candidate against a vacancy via the gated candidate-screener agent,
   * then delegate to fitEngineService.computeFitScore — the single writer of the
   * candidate↔vacancy FitScore — passing the screener's result as narrative-only
   * llmJudgment context (never part of the weighted score math). Both candidate
   * and vacancy records are loaded org-scoped and verified to exist before any
   * AI spend.
   */
  async screenCandidate(orgId: string, candidateId: string, vacancyId: string) {
    const [candidate, vacancy] = await Promise.all([
      candidateAiRepository.getCandidateProfile(orgId, candidateId),
      candidateAiRepository.getVacancyForScreening(orgId, vacancyId),
    ]);
    if (!candidate) throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' });
    if (!vacancy) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vacante no encontrada' });

    const settings = (vacancy.settings ?? {}) as { skills?: unknown; requirements?: unknown };

    const { result, model } = await screenCandidateAgent(
      orgId,
      {
        name: `${candidate.firstName} ${candidate.lastName}`,
        title: candidate.currentTitle ?? undefined,
        skills: toStringArray(candidate.skills),
        experience: candidate.yearsExperience ?? undefined,
      },
      {
        title: vacancy.title,
        requirements: toStringArray(settings.requirements).concat(vacancy.description ? [vacancy.description] : []),
        skills: toStringArray(settings.skills),
      },
    );

    const fit = await fitEngineService.computeFitScore(orgId, candidateId, vacancyId, {
      llmJudgment: {
        score: result.score,
        recommendation: result.recommendation,
        reasoning: result.reasoning,
        strengths: result.strengths,
        gaps: result.gaps,
      },
    });

    return { ...result, model, fitScoreId: fit.fitScoreId, overallScore: fit.overallScore, isPartial: fit.isPartial };
  },
};
