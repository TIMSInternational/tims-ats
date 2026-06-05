import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData } from '../pii';

const SYSTEM_PROMPT = `You are an inclusive language reviewer for job descriptions in Spanish.
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
- Maximum 10 suggestions`;

const outputSchema = z.object({
  score: z.number().min(0).max(100),
  suggestions: z.array(z.object({
    original: z.string(),
    suggestion: z.string(),
    reason: z.string(),
  })).max(10),
});

export async function checkInclusiveLanguage(
  orgId: string,
  text: string,
): Promise<{ score: number; suggestions: Array<{ original: string; suggestion: string; reason: string }>; model: string }> {
  const { data, model } = await invokeAgent({
    slug: 'inclusive-language',
    orgId,
    input: { text },
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ text }) =>
      `${wrapAsData('text_to_review', text)}\n\nAnalyze this job description for inclusive language. Return JSON.`,
    schema: outputSchema,
    fallback: () => ({ score: 75, suggestions: [] }),
    maxTokens: 1024,
  });

  return { score: data.score, suggestions: data.suggestions, model };
}
