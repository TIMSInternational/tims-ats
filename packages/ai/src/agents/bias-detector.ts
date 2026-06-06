import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData, sanitizeInput } from '../pii';
import { sanitizeRatings, type ScorecardInput } from './interview-summarizer';

const SYSTEM_PROMPT = `You are an interview-fairness auditor for an HR platform.
Analyze evaluator scorecards for signals of evaluation bias.

Output format: JSON with the following structure:
{
  "biasIndicators": [
    { "type": "halo_effect", "severity": "low", "description": "why" }
  ],
  "overallRisk": "low",
  "recommendations": ["rec1"]
}

Bias types to check: halo_effect, horn_effect, similarity_bias, leniency_severity,
contrast_effect, language_bias (subjective/appearance/protected-class language in notes),
inconsistency (rating-recommendation mismatch, evaluator disagreement without explanation).

Rules:
- severity and overallRisk: one of "none", "low", "medium", "high"
- Only report indicators with concrete evidence FROM THE SCORECARDS — cite the signal in the description
- If evidence is insufficient to assess a type, omit it (do NOT assert absence of bias you cannot verify)
- overallRisk must reflect the strongest credible indicator found
- Respond in the same language as the scorecard content
- Max 6 indicators, max 4 recommendations`;

const severityEnum = z.enum(['none', 'low', 'medium', 'high']);

// 'unknown' is reserved for the degraded fallback — the prompt only offers the
// model none/low/medium/high, so a fabricated "unknown" can't mask a real risk.
const outputSchema = z.object({
  biasIndicators: z
    .array(
      z.object({
        type: z.string(),
        severity: severityEnum,
        description: z.string(),
      }),
    )
    .max(6),
  overallRisk: z.enum(['none', 'low', 'medium', 'high', 'unknown']),
  recommendations: z.array(z.string()).max(4),
});

// Model output OR a degraded shape whose overallRisk is 'unknown' —
// NEVER a fabricated "low risk" (false compliance assurance).
export type BiasAnalysisResult = z.infer<typeof outputSchema>;

const DEGRADED_FALLBACK: BiasAnalysisResult = {
  biasIndicators: [],
  overallRisk: 'unknown',
  recommendations: ['Analisis automatico no disponible — revise los scorecards manualmente.'],
};

export async function detectScorecardBias(
  orgId: string,
  input: { vacancyTitle: string; scorecards: ScorecardInput[] },
): Promise<{ result: BiasAnalysisResult; model: string }> {
  // Scorecards contain candidate PII + evaluator opinions — registry sets
  // cacheTtlSeconds=0 for bias-detector, so this is never cached.
  const { data, model } = await invokeAgent({
    slug: 'bias-detector',
    orgId,
    input,
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ vacancyTitle, scorecards }) => {
      const cards = scorecards
        .map(
          (s, i) => `Evaluator ${i + 1} (${sanitizeInput(s.evaluatorLabel)}):
Recommendation: ${sanitizeInput(s.recommendation)}
Ratings: ${sanitizeInput(JSON.stringify(sanitizeRatings(s.ratings)))}
Notes: ${sanitizeInput(s.overallNotes ?? 'None', 500)}`,
        )
        .join('\n\n');
      return `${wrapAsData('position', sanitizeInput(vacancyTitle))}\n\n${wrapAsData('scorecards', cards)}\n\nAnalyze these scorecards for evaluation bias. Return JSON.`;
    },
    schema: outputSchema,
    fallback: () => DEGRADED_FALLBACK,
    maxTokens: 1024,
  });

  return { result: data, model };
}
