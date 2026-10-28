import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData, sanitizeInput } from '../pii';
import { PROTECTED_ATTRIBUTES_RULE } from '../fairness';

export const INTERVIEW_FIT_SCORE_SYSTEM_PROMPT = `You are a candidate-fit evaluator for an HR platform.
Analyze a recorded interview transcript to produce a structured fit score.

Output format: JSON with the following structure:
{
  "score": 72,
  "rationale": "2-5 sentence explanation grounded in the transcript"
}

Scoring rubric (0–100):
- 80–100: Exceptional fit — candidate demonstrates strong alignment with role and clear competency evidence
- 60–79:  Good fit — solid responses with minor gaps
- 40–59:  Moderate fit — some relevant experience but notable concerns
- 20–39:  Weak fit — significant gaps or poor communication
- 0–19:   Very poor fit — little to no demonstrated alignment

Rules:
- Score ONLY on evidence present in the transcript — never infer or assume
- Cite specific transcript moments in the rationale (e.g. "When asked about X, the candidate said Y")
- If the transcript is empty or too short to evaluate, return score null with a rationale explaining insufficiency
- Do NOT recommend hire/no-hire — score and evidence only
- Respond in the same language as the transcript content
- rationale must be under 2000 characters

${PROTECTED_ATTRIBUTES_RULE}`;

export const fitScoreOutputSchema = z.object({
  // null = "not available" (degraded fallback or too little evidence) — never a
  // made-up number that would read as a real score.
  score: z.number().int().min(0).max(100).nullable(),
  rationale: z.string().max(2000),
});

export type FitScoreResult = z.infer<typeof fitScoreOutputSchema>;

export const FIT_SCORE_FALLBACK: FitScoreResult = {
  score: null,
  rationale: 'El análisis automático no pudo completarse. Revisión manual requerida.',
};

export interface FitScoreInput {
  transcriptText: string;
  roleTitle?: string;
  guideQuestions?: string;
}

export async function scoreInterviewFit(
  orgId: string,
  input: FitScoreInput,
): Promise<{ result: FitScoreResult; model: string }> {
  const { data, model } = await invokeAgent({
    slug: 'interview-fit-score',
    orgId,
    input,
    systemPrompt: INTERVIEW_FIT_SCORE_SYSTEM_PROMPT,
    buildUserMessage: ({ transcriptText, roleTitle, guideQuestions }) => {
      const contextParts: string[] = [];
      if (roleTitle) {
        contextParts.push(`Role: ${sanitizeInput(roleTitle)}`);
      }
      if (guideQuestions) {
        contextParts.push(`Guide questions: ${sanitizeInput(guideQuestions, 1000)}`);
      }
      const contextBlock =
        contextParts.length > 0
          ? `${wrapAsData('interview_context', contextParts.join('\n'))}\n\n`
          : '';
      return `${contextBlock}${wrapAsData('transcript', sanitizeInput(transcriptText, 20_000))}\n\nScore this interview transcript. Return JSON.`;
    },
    schema: fitScoreOutputSchema,
    fallback: () => FIT_SCORE_FALLBACK,
    maxTokens: 1024,
  });

  return { result: data, model };
}
