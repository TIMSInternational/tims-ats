import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData } from '../pii';

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

const REVIEW_FALLBACK: ScreeningResult = {
  score: 50,
  matchedSkills: [],
  missingSkills: [],
  strengths: [],
  gaps: ['Unable to analyze — please review manually'],
  recommendation: 'review',
  reasoning: 'AI analysis could not be completed. Manual review recommended.',
};

export async function screenCandidate(
  orgId: string,
  candidateProfile: { name: string; title?: string; skills?: string[]; experience?: number },
  jobRequirements: { title: string; requirements?: string[]; skills?: string[] },
): Promise<{ result: ScreeningResult; model: string }> {
  // Candidate profile contains PII — the registry sets cacheTtlSeconds=0 for
  // candidate-screener, so invokeAgent never caches raw input here.
  const { data, model } = await invokeAgent({
    slug: 'candidate-screener',
    orgId,
    input: { candidateProfile, jobRequirements },
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ candidateProfile, jobRequirements }) => {
      const profile = `Name: ${candidateProfile.name}
Title: ${candidateProfile.title ?? 'Not specified'}
Skills: ${candidateProfile.skills?.join(', ') ?? 'Not specified'}
Years of experience: ${candidateProfile.experience ?? 'Not specified'}`;
      const reqs = `Position: ${jobRequirements.title}
Requirements: ${jobRequirements.requirements?.join(', ') ?? 'Not specified'}
Required skills: ${jobRequirements.skills?.join(', ') ?? 'Not specified'}`;
      return `${wrapAsData('candidate_profile', profile)}\n\n${wrapAsData('job_requirements', reqs)}\n\nScreen this candidate against the job requirements. Return JSON.`;
    },
    schema: outputSchema,
    fallback: () => REVIEW_FALLBACK,
    maxTokens: 1024,
  });

  return { result: data, model };
}
