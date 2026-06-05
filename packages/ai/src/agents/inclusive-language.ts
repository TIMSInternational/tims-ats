import { z } from 'zod';
import { invokeAgent, calculateCost } from '../client';
import { checkBudget } from '../budget';
import { logInvocation } from '../logger';
import { resolveAgentId } from '../registry';
import { TRPCError } from '@trpc/server';

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
  const agentId = await resolveAgentId('inclusive-language');

  const budget = await checkBudget(orgId, agentId);
  if (!budget.allowed) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'AI budget exceeded for this month' });
  }

  const userMessage = `<text_to_review>
${text}
</text_to_review>

Analyze this job description for inclusive language. Return JSON.`;

  const result = await invokeAgent('haiku', SYSTEM_PROMPT, userMessage, 1024);
  const cost = calculateCost('haiku', result.inputTokens, result.outputTokens);

  await logInvocation({
    agentId,
    organizationId: orgId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: cost,
    latencyMs: result.latencyMs,
    model: result.model,
    success: true,
  });

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = outputSchema.parse(JSON.parse(jsonMatch[0]));
      return { ...parsed, model: result.model };
    }
  } catch {
    // Fallback
  }

  return { score: 75, suggestions: [], model: result.model };
}
