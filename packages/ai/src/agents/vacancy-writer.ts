import { z } from 'zod';
import { invokeAgent, calculateCost } from '../client';
import { checkBudget } from '../budget';
import { logInvocation } from '../logger';
import { resolveAgentId } from '../registry';
import { TRPCError } from '@trpc/server';

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
  const agentId = await resolveAgentId('vacancy-writer');

  // Budget check
  const budget = await checkBudget(orgId, agentId);
  if (!budget.allowed) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'AI budget exceeded for this month' });
  }

  const userMessage = `<job_data>
Title: ${title}
${context ? `Additional context: ${context}` : ''}
</job_data>

Generate a professional job description for this position.`;

  const result = await invokeAgent('sonnet', SYSTEM_PROMPT, userMessage, 2048);
  const cost = calculateCost('sonnet', result.inputTokens, result.outputTokens);

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

  // Parse output — fallback to raw text if JSON parsing fails
  let description = result.text;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = outputSchema.parse(JSON.parse(jsonMatch[0]));
      description = parsed.description;
    }
  } catch {
    // Use raw text as fallback
  }

  return {
    description,
    model: result.model,
    tokensUsed: result.inputTokens + result.outputTokens,
  };
}
