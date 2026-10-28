import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData } from '../pii';

export const INCLUSIVE_LANGUAGE_SYSTEM_PROMPT = `You are an inclusive language reviewer for job descriptions in Spanish.
Analyze the text for gendered, biased, or exclusionary language and suggest improvements.

Output format: JSON with the following structure:
{
  "score": 85,
  "suggestions": [
    {
      "original": "the problematic phrase",
      "suggestion": "the inclusive alternative",
      "reason": "why this change improves inclusivity"
    }
  ]
}

Rules:
- Score from 0-100 where 100 is perfectly inclusive
- Focus on gender-neutral language for Spanish (e.g., "candidato" → "persona candidata")
- Flag age-biased terms (e.g., "joven y dinamico")
- Flag ability-biased terms
- Be constructive, not prescriptive
- Maximum 10 suggestions
- Keep "original", "suggestion" and "reason" each under 500 characters; quote only the problematic phrase, not a whole paragraph`;

export const inclusiveLanguageOutputSchema = z.object({
  // null = "not available" (degraded fallback) — never a made-up default score.
  score: z.number().min(0).max(100).nullable(),
  suggestions: z.array(z.object({
    original: z.string().max(500),
    suggestion: z.string().max(500),
    reason: z.string().max(500),
  })).max(10),
});

export async function checkInclusiveLanguage(
  orgId: string,
  text: string,
): Promise<{ score: number | null; suggestions: Array<{ original: string; suggestion: string; reason: string }>; model: string }> {
  const { data, model } = await invokeAgent({
    slug: 'inclusive-language',
    orgId,
    input: { text },
    systemPrompt: INCLUSIVE_LANGUAGE_SYSTEM_PROMPT,
    buildUserMessage: ({ text }) =>
      `${wrapAsData('text_to_review', text)}\n\nAnalyze this job description for inclusive language. Return JSON.`,
    schema: inclusiveLanguageOutputSchema,
    fallback: () => ({ score: null, suggestions: [] }),
    maxTokens: 1024,
  });

  return { score: data.score, suggestions: data.suggestions, model };
}
