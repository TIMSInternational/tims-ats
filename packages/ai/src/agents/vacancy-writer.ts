import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { invokeAgent } from '../invoke';
import { wrapAsData } from '../pii';

const SYSTEM_PROMPT = `You are a professional HR job description writer for a Latin American enterprise HR platform.
Generate compelling, inclusive job descriptions in Spanish, as 3 variants for different publishing channels.

Output format: a single JSON object with this exact structure:
{
  "formal": {
    "description": "Full markdown job description, suitable for a formal job board or company careers page",
    "sections": {
      "responsibilities": ["bullet point 1", "bullet point 2"],
      "requirements": ["requirement 1", "requirement 2"],
      "benefits": ["benefit 1", "benefit 2"]
    }
  },
  "social": {
    "description": "A shorter, punchier version for a LinkedIn/social media post: plain prose (no markdown headers), 2-4 short paragraphs, may include a couple of relevant hashtags"
  },
  "whatsapp": {
    "description": "The shortest, plain-text version for sharing over WhatsApp/messaging apps: a few lines, no markdown, casual but professional tone, easy to forward"
  }
}

Rules:
- Write in professional Spanish appropriate for Colombia/LATAM
- Use gender-neutral language (use "persona candidata" instead of "candidato")
- Include specific, measurable responsibilities in the "formal" variant
- "formal" should be concise but comprehensive; "social" must be noticeably shorter than "formal"; "whatsapp" must be the shortest and use plain text only (no markdown, no bullet symbols)
- Do NOT invent company-specific details not provided in the input
- Length limits: formal description under 8000 characters, social under 3000, whatsapp under 2000; at most 20 items per section, each under 500 characters`;

const outputSchema = z.object({
  formal: z.object({
    description: z.string().max(8000),
    sections: z.object({
      responsibilities: z.array(z.string().max(500)).max(20),
      requirements: z.array(z.string().max(500)).max(20),
      benefits: z.array(z.string().max(500)).max(20),
    }),
  }),
  social: z.object({ description: z.string().max(3000) }),
  whatsapp: z.object({ description: z.string().max(2000) }),
});

export type VacancyDescriptionVariants = z.infer<typeof outputSchema>;

export async function generateVacancyDescription(
  orgId: string,
  title: string,
  context?: string,
): Promise<VacancyDescriptionVariants & { model: string; tokensUsed: number }> {
  const { data, model, inputTokens, outputTokens, degraded } = await invokeAgent({
    slug: 'vacancy-writer',
    orgId,
    input: { title, context: context ?? null },
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ title, context }) => {
      const body = `Title: ${title}${context ? `\nAdditional context: ${context}` : ''}`;
      return `${wrapAsData('job_data', body)}\n\nGenerate the 3 variants (formal, social, whatsapp) of a professional job description for this position.`;
    },
    schema: outputSchema,
    // Never surfaced: a degraded result is turned into an error below, so raw
    // (possibly oversized or JSON) model text or an empty timeout result can
    // never be offered to the recruiter as a description to apply.
    fallback: () => ({
      formal: { description: '', sections: { responsibilities: [], requirements: [], benefits: [] } },
      social: { description: '' },
      whatsapp: { description: '' },
    }),
    // 3 variants in one call need more headroom than the old single-variant call.
    maxTokens: 3072,
  });

  if (degraded) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'No se pudo generar la descripción con IA. Intenta de nuevo.',
    });
  }

  return { ...data, model, tokensUsed: inputTokens + outputTokens };
}
