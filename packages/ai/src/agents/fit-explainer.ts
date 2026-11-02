import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData, sanitizeInput } from '../pii';
import { PROTECTED_ATTRIBUTES_RULE, CANDIDATE_LABEL } from '../fairness';

export const FIT_EXPLAINER_SYSTEM_PROMPT = `You are a FIT-score explainer for an HR recruitment platform.
You receive a candidate's deterministic per-dimension FIT breakdown (0-100 scores,
some may be null meaning unavailable data) plus an optional prior LLM screening
judgment, and produce a short narrative explaining the score to a recruiter.

Output format: JSON with the following structure:
{
  "narrative": "3-5 sentence explanation grounded ONLY in the provided scores"
}

Rules:
- Reference the actual dimension scores and names (assessment, interview, experience, education, languages)
- If a dimension is null, say the data is unavailable — never guess a number for it
- Do NOT recommend hire/no-hire — explain the score composition only
- narrative must be under 1200 characters
- Respond in Spanish unless the vacancy title is clearly in another language

${PROTECTED_ATTRIBUTES_RULE}`;

export const fitExplainerOutputSchema = z.object({
  narrative: z.string().max(1200),
});

export type FitExplainerResult = z.infer<typeof fitExplainerOutputSchema>;

const DEGRADED_FALLBACK: FitExplainerResult = {
  narrative: 'No se pudo generar la explicación automática. Revisión manual del desglose recomendada.',
};

export interface FitExplainerInput {
  overallScore: number;
  breakdown: {
    assessment: number | null;
    interview: number | null;
    experience: number | null;
    education: number | null;
    languages: number | null;
    llmJudgment: { score: number | null; recommendation: string; reasoning: string; strengths: string[]; gaps: string[] } | null;
  };
  /**
   * Accepted for call-site compatibility but NEVER sent to the model: the
   * prompt refers to "the candidate" (a name is a proxy for sex/ethnicity).
   */
  candidateName?: string;
  vacancyTitle: string;
}

export async function explainFit(
  orgId: string,
  input: FitExplainerInput,
): Promise<{ result: FitExplainerResult; model: string }> {
  const { data, model } = await invokeAgent({
    slug: 'fit-explainer',
    orgId,
    // candidateName is dropped here so it reaches neither the prompt nor the cache key.
    input: { overallScore: input.overallScore, breakdown: input.breakdown, vacancyTitle: input.vacancyTitle },
    systemPrompt: FIT_EXPLAINER_SYSTEM_PROMPT,
    buildUserMessage: ({ overallScore, breakdown, vacancyTitle }) => {
      const summary = {
        overallScore,
        assessment: breakdown.assessment,
        interview: breakdown.interview,
        experience: breakdown.experience,
        education: breakdown.education,
        languages: breakdown.languages,
      };
      const judgmentBlock = breakdown.llmJudgment
        ? wrapAsData(
            'prior_llm_judgment',
            `recommendation: ${sanitizeInput(breakdown.llmJudgment.recommendation, 50)}\nreasoning: ${sanitizeInput(breakdown.llmJudgment.reasoning, 1000)}\nstrengths: ${breakdown.llmJudgment.strengths.map((s) => sanitizeInput(s, 200)).join(', ')}\ngaps: ${breakdown.llmJudgment.gaps.map((g) => sanitizeInput(g, 200)).join(', ')}`,
          )
        : '';
      const candidateContext = wrapAsData(
        'candidate_context',
        `Candidate: ${CANDIDATE_LABEL}\nRole: ${sanitizeInput(vacancyTitle, 200)}`,
      );
      return `${wrapAsData('fit_scores', JSON.stringify(summary))}\n\n${candidateContext}\n\n${judgmentBlock}\n\nExplain this FIT score. Return JSON.`;
    },
    schema: fitExplainerOutputSchema,
    fallback: () => DEGRADED_FALLBACK,
    maxTokens: 800,
  });

  return { result: data, model };
}
