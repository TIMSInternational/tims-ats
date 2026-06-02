import { z } from 'zod';
import { invokeAgent, calculateCost } from '../client';
import { checkBudget } from '../budget';
import { logInvocation } from '../logger';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

const SYSTEM_PROMPT = `You are a candidate screening assistant for an HR platform.
Compare a candidate's profile against job requirements and provide a screening assessment.

Output format: JSON with the following structure:
{
  "score": 82,
  "matchedSkills": ["skill1", "skill2"],
  "missingSkills": ["skill3"],
  "strengths": ["strength1", "strength2"],
  "gaps": ["gap1"],
  "recommendation": "advance" | "review" | "reject",
  "reasoning": "Brief explanation of the assessment"
}

Rules:
- Score from 0-100 based on profile-requirement fit
- Be objective and evidence-based
- Consider both hard skills and experience level
- "advance" = strong match, "review" = needs manual review, "reject" = poor fit
- Keep reasoning under 200 words`;

const outputSchema = z.object({
  score: z.number().min(0).max(100),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  recommendation: z.enum(['advance', 'review', 'reject']),
  reasoning: z.string(),
});

export type ScreeningResult = z.infer<typeof outputSchema>;

export async function screenCandidate(
  orgId: string,
  candidateProfile: { name: string; title?: string; skills?: string[]; experience?: number },
  jobRequirements: { title: string; requirements?: string[]; skills?: string[] },
): Promise<{ result: ScreeningResult; model: string }> {
  const agentSlug = 'candidate-screener';
  const agent = await db.aiAgent.findFirst({ where: { slug: agentSlug }, select: { id: true } });
  const agentId = agent?.id ?? agentSlug;

  const budget = await checkBudget(orgId, agentId);
  if (!budget.allowed) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'AI budget exceeded for this month' });
  }

  const userMessage = `<candidate_profile>
Name: ${candidateProfile.name}
Title: ${candidateProfile.title ?? 'Not specified'}
Skills: ${candidateProfile.skills?.join(', ') ?? 'Not specified'}
Years of experience: ${candidateProfile.experience ?? 'Not specified'}
</candidate_profile>

<job_requirements>
Position: ${jobRequirements.title}
Requirements: ${jobRequirements.requirements?.join(', ') ?? 'Not specified'}
Required skills: ${jobRequirements.skills?.join(', ') ?? 'Not specified'}
</job_requirements>

Screen this candidate against the job requirements. Return JSON.`;

  const result = await invokeAgent('sonnet', SYSTEM_PROMPT, userMessage, 1024);
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

  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = outputSchema.parse(JSON.parse(jsonMatch[0]));
      return { result: parsed, model: result.model };
    }
  } catch {
    // Fallback
  }

  return {
    result: {
      score: 50,
      matchedSkills: [],
      missingSkills: [],
      strengths: [],
      gaps: ['Unable to analyze — please review manually'],
      recommendation: 'review',
      reasoning: 'AI analysis could not be completed. Manual review recommended.',
    },
    model: result.model,
  };
}
