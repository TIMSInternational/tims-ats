import { z } from 'zod';
import { invokeAgent, calculateCost } from '../client';
import { checkBudget } from '../budget';
import { logInvocation } from '../logger';
import { resolveAgentId } from '../registry';
import { TRPCError } from '@trpc/server';

const SYSTEM_PROMPT = `You are a CV/resume parser for an HR platform. Extract structured data from CV text.

Output format: JSON with the following structure:
{
  "name": "Full name",
  "email": "email@example.com",
  "phone": "+57 300 123 4567",
  "skills": ["skill1", "skill2"],
  "experience": [
    {"company": "Company Name", "title": "Job Title", "startYear": 2020, "endYear": 2023, "description": "Brief description"}
  ],
  "education": [
    {"institution": "University Name", "degree": "Degree Name", "year": 2020}
  ],
  "languages": ["Spanish (Native)", "English (B2)"],
  "summary": "Brief professional summary"
}

Rules:
- Extract ALL available information
- Normalize phone numbers to international format
- Skills should be individual items, not grouped
- If information is not available, use null
- Parse dates as years (not full dates)`;

const outputSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  skills: z.array(z.string()),
  experience: z.array(z.object({
    company: z.string(),
    title: z.string(),
    startYear: z.number().nullable(),
    endYear: z.number().nullable(),
    description: z.string().nullable(),
  })),
  education: z.array(z.object({
    institution: z.string(),
    degree: z.string(),
    year: z.number().nullable(),
  })),
  languages: z.array(z.string()),
  summary: z.string().nullable(),
});

export type ParsedCVData = z.infer<typeof outputSchema>;

export async function parseCV(
  orgId: string,
  cvText: string,
): Promise<{ data: ParsedCVData; model: string; confidence: number }> {
  const agentId = await resolveAgentId('cv-parser');

  const budget = await checkBudget(orgId, agentId);
  if (!budget.allowed) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'AI budget exceeded for this month' });
  }

  const userMessage = `<cv_text>
${cvText.slice(0, 8000)}
</cv_text>

Parse this CV and extract structured data. Return JSON only.`;

  const result = await invokeAgent('haiku', SYSTEM_PROMPT, userMessage, 2048);
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
      const filledFields = Object.values(parsed).filter((v) => v !== null && (Array.isArray(v) ? v.length > 0 : true)).length;
      const confidence = Math.min(filledFields / 8, 1);
      return { data: parsed, model: result.model, confidence };
    }
  } catch {
    // Fallback
  }

  return {
    data: { name: null, email: null, phone: null, skills: [], experience: [], education: [], languages: [], summary: null },
    model: result.model,
    confidence: 0,
  };
}
