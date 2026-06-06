import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData, sanitizeInput } from '../pii';

const SYSTEM_PROMPT = `You are an interview debrief assistant for an HR platform.
Summarize an interview from its evaluator scorecards into a structured debrief.

Output format: JSON with the following structure:
{
  "summary": "2-4 sentence narrative of how the interview went, grounded ONLY in the scorecards",
  "keyPoints": ["point1", "point2"],
  "strengths": ["strength1"],
  "concerns": ["concern1"]
}

Rules:
- Base EVERYTHING on the provided scorecards — never invent facts not present in them
- If evaluators disagree, say so explicitly in the summary
- Do NOT output a hire/no-hire recommendation — that decision belongs to humans
- Respond in the same language as the scorecard content (Spanish for Spanish scorecards)
- Keep the summary under 120 words; max 5 items per array`;

const outputSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()).max(5),
  strengths: z.array(z.string()).max(5),
  concerns: z.array(z.string()).max(5),
});

export type InterviewSummaryResult = z.infer<typeof outputSchema>;

// Obviously degraded (rule #4) — never plausible fake content.
const DEGRADED_FALLBACK: InterviewSummaryResult = {
  summary: 'El analisis de IA no pudo completarse. Revise los scorecards manualmente.',
  keyPoints: [],
  strengths: [],
  concerns: ['Analisis automatico no disponible — revision manual requerida'],
};

export interface ScorecardInput {
  evaluatorLabel: string;
  recommendation: string;
  ratings: unknown;
  overallNotes?: string | null;
}

/**
 * Coerce a Prisma Json ratings blob into a bounded Record<string, number>
 * before it reaches a prompt — caps key count/length so crafted key names
 * can't blow the token budget or smuggle semantic instructions at scale.
 */
export function sanitizeRatings(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .slice(0, 20)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
      .map(([k, v]) => [k.slice(0, 80), v]),
  );
}

export async function summarizeInterview(
  orgId: string,
  input: {
    candidateName: string;
    vacancyTitle: string;
    interviewType: string;
    scorecards: ScorecardInput[];
  },
): Promise<{ result: InterviewSummaryResult; model: string }> {
  // Scorecards contain candidate PII + evaluator opinions — registry sets
  // cacheTtlSeconds=0 for interview-summarizer, so this is never cached.
  const { data, model } = await invokeAgent({
    slug: 'interview-summarizer',
    orgId,
    input,
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ candidateName, vacancyTitle, interviewType, scorecards }) => {
      const header = `Candidate: ${sanitizeInput(candidateName)}
Position: ${sanitizeInput(vacancyTitle)}
Interview type: ${sanitizeInput(interviewType)}`;
      const cards = scorecards
        .map(
          (s, i) => `Evaluator ${i + 1} (${sanitizeInput(s.evaluatorLabel)}):
Recommendation: ${sanitizeInput(s.recommendation)}
Ratings: ${sanitizeInput(JSON.stringify(sanitizeRatings(s.ratings)))}
Notes: ${sanitizeInput(s.overallNotes ?? 'None', 500)}`,
        )
        .join('\n\n');
      return `${wrapAsData('interview_context', header)}\n\n${wrapAsData('scorecards', cards)}\n\nSummarize this interview. Return JSON.`;
    },
    schema: outputSchema,
    fallback: () => DEGRADED_FALLBACK,
    maxTokens: 1024,
  });

  return { result: data, model };
}
