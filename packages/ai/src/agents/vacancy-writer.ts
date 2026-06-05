import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData } from '../pii';

const SYSTEM_PROMPT = `You are a professional HR job description writer for a Latin American enterprise HR platform.
Generate compelling, inclusive job descriptions in Spanish.

Output format: JSON with the following structure:
{
  "description": "Full markdown job description",
  "sections": {
    "responsibilities": ["bullet point 1", "bullet point 2"],
    "requirements": ["requirement 1", "requirement 2"],
    "benefits": ["benefit 1", "benefit 2"]
  }
}

Rules:
- Write in professional Spanish appropriate for Colombia/LATAM
- Use gender-neutral language (use "persona candidata" instead of "candidato")
- Include specific, measurable responsibilities
- Be concise but comprehensive
- Do NOT invent company-specific details not provided in the input`;

const outputSchema = z.object({
  description: z.string(),
  sections: z.object({
    responsibilities: z.array(z.string()),
    requirements: z.array(z.string()),
    benefits: z.array(z.string()),
  }),
});

export async function generateVacancyDescription(
  orgId: string,
  title: string,
  context?: string,
): Promise<{ description: string; model: string; tokensUsed: number }> {
  const { data, model, inputTokens, outputTokens } = await invokeAgent({
    slug: 'vacancy-writer',
    orgId,
    input: { title, context: context ?? null },
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ title, context }) => {
      const body = `Title: ${title}${context ? `\nAdditional context: ${context}` : ''}`;
      return `${wrapAsData('job_data', body)}\n\nGenerate a professional job description for this position.`;
    },
    schema: outputSchema,
    // Job descriptions are non-PII prose — if the model returns un-parseable
    // text, the raw text is still a usable description.
    fallback: (raw) => ({ description: raw, sections: { responsibilities: [], requirements: [], benefits: [] } }),
    maxTokens: 2048,
  });

  return { description: data.description, model, tokensUsed: inputTokens + outputTokens };
}
