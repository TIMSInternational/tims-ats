import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData, sanitizeInput } from '../pii';

const SYSTEM_PROMPT = `You are a FIT-score explainer for an HR recruitment platform.
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
- Respond in Spanish unless the candidate/vacancy names suggest otherwise`;

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
    llmJudgment: { score: number; recommendation: string; reasoning: string; strengths: string[]; gaps: string[] } | null;
  };
  candidateName: string;
  vacancyTitle: string;
}

export async function explainFit(
  orgId: string,
  input: FitExplainerInput,
): Promise<{ result: FitExplainerResult; model: string }> {
  const { data, model } = await invokeAgent({
    slug: 'fit-explainer',
    orgId,
    input,
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ overallScore, breakdown, candidateName, vacancyTitle }) => {
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
        `Candidate: ${sanitizeInput(candidateName, 200)}\nRole: ${sanitizeInput(vacancyTitle, 200)}`,
      );
      return `${wrapAsData('fit_scores', JSON.stringify(summary))}\n\n${candidateContext}\n\n${judgmentBlock}\n\nExplain this FIT score. Return JSON.`;
    },
    schema: fitExplainerOutputSchema,
    fallback: () => DEGRADED_FALLBACK,
    maxTokens: 800,
  });

  return { result: data, model };
}
