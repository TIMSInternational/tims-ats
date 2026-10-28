import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData, sanitizeInput } from '../pii';
import { PROTECTED_ATTRIBUTES_RULE, CANDIDATE_LABEL } from '../fairness';

export const CANDIDATE_SCREENER_SYSTEM_PROMPT = `You are a candidate screening assistant for an HR platform.
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
- Score from 0-100 based on profile-requirement fit; use null when there is too little evidence to score
- Be objective and evidence-based
- Consider both hard skills and experience level
- "advance" = strong match, "review" = needs manual review, "reject" = poor fit
- At most 20 matchedSkills and 20 missingSkills, each under 200 characters
- At most 10 strengths and 10 gaps, each under 300 characters
- Keep reasoning under 200 words (and under 2000 characters)

${PROTECTED_ATTRIBUTES_RULE}`;

export const candidateScreenerOutputSchema = z.object({
  // null = "not available" (degraded fallback or insufficient evidence) — never
  // a made-up mid-range number.
  score: z.number().min(0).max(100).nullable(),
  matchedSkills: z.array(z.string().max(200)).max(20),
  missingSkills: z.array(z.string().max(200)).max(20),
  strengths: z.array(z.string().max(300)).max(10),
  gaps: z.array(z.string().max(300)).max(10),
  recommendation: z.enum(['advance', 'review', 'reject']),
  reasoning: z.string().max(2000),
});

export type ScreeningResult = z.infer<typeof candidateScreenerOutputSchema>;

export const SCREENER_FALLBACK: ScreeningResult = {
  score: null,
  matchedSkills: [],
  missingSkills: [],
  strengths: [],
  gaps: ['Unable to analyze — please review manually'],
  recommendation: 'review',
  reasoning: 'AI analysis could not be completed. Manual review recommended.',
};

/**
 * Job-relevant fields only. The candidate's name and contact/demographic data
 * are deliberately NOT part of this type: the prompt refers to "the candidate".
 */
export interface ScreenerCandidateProfile {
  title?: string;
  skills?: string[];
  experience?: number;
}

export interface ScreenerJobRequirements {
  title: string;
  requirements?: string[];
  skills?: string[];
}

/** Build the user message. Exported for tests; reads job-relevant fields only. */
export function buildScreenerMessage(input: {
  candidateProfile: ScreenerCandidateProfile;
  jobRequirements: ScreenerJobRequirements;
}): string {
  const { candidateProfile, jobRequirements } = input;
  const profile = `Candidate: ${CANDIDATE_LABEL}
Title: ${candidateProfile.title ? sanitizeInput(candidateProfile.title, 200) : 'Not specified'}
Skills: ${candidateProfile.skills?.length ? candidateProfile.skills.map((s) => sanitizeInput(s, 100)).join(', ') : 'Not specified'}
Years of experience: ${candidateProfile.experience ?? 'Not specified'}`;
  const reqs = `Position: ${sanitizeInput(jobRequirements.title, 200)}
Requirements: ${jobRequirements.requirements?.join(', ') ?? 'Not specified'}
Required skills: ${jobRequirements.skills?.join(', ') ?? 'Not specified'}`;
  return `${wrapAsData('candidate_profile', profile)}\n\n${wrapAsData('job_requirements', reqs)}\n\nScreen this candidate against the job requirements. Return JSON.`;
}

export async function screenCandidate(
  orgId: string,
  candidateProfile: ScreenerCandidateProfile,
  jobRequirements: ScreenerJobRequirements,
): Promise<{ result: ScreeningResult; model: string }> {
  // Only job-relevant fields reach the prompt (and the input object). The
  // registry sets cacheTtlSeconds=0 for candidate-screener, so nothing is cached.
  const input = {
    candidateProfile: {
      title: candidateProfile.title,
      skills: candidateProfile.skills,
      experience: candidateProfile.experience,
    },
    jobRequirements,
  };
  const { data, model } = await invokeAgent({
    slug: 'candidate-screener',
    orgId,
    input,
    systemPrompt: CANDIDATE_SCREENER_SYSTEM_PROMPT,
    buildUserMessage: buildScreenerMessage,
    schema: candidateScreenerOutputSchema,
    fallback: () => SCREENER_FALLBACK,
    maxTokens: 1024,
  });

  return { result: data, model };
}
