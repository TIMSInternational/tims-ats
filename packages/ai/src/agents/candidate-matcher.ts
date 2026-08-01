import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData, sanitizeInput } from '../pii';

const SYSTEM_PROMPT = `You are a candidate-vacancy matching assistant for an HR/ATS platform.
You receive a candidate's profile (title, skills, years of experience) and a bounded list of
this organization's currently open vacancies (id + title only), and recommend which of those
vacancies best fit the candidate, plus short next-step actions for a recruiter.

Output format: JSON with the following structure:
{
  "recommendedVacancies": [
    { "vacancyId": "<one of the provided vacancy ids, copied exactly>", "matchScore": 0-100 }
  ],
  "suggestedActions": ["short next-step action", "..."]
}

Rules:
- ONLY use vacancy ids from the provided list — never invent an id or reference a vacancy
  that was not given to you
- Order recommendedVacancies by matchScore descending; omit vacancies with a poor fit rather
  than padding the list
- recommendedVacancies must contain at most 10 items
- matchScore reflects how well the candidate's title/skills/experience fit that vacancy's
  title alone — be conservative when little signal is available
- suggestedActions must contain between 1 and 5 short, concrete recruiter actions (e.g.
  "Schedule technical assessment"), grounded only in the given profile/vacancy data
- Do NOT fabricate candidate history, employers, or vacancy details you were not given
- Respond in Spanish unless the candidate/vacancy names suggest otherwise`;

export const candidateMatcherOutputSchema = z.object({
  recommendedVacancies: z
    .array(
      z.object({
        vacancyId: z.string().max(100),
        matchScore: z.number().min(0).max(100),
      }),
    )
    .max(10),
  suggestedActions: z.array(z.string().max(200)).max(5),
});

export type CandidateMatcherResult = z.infer<typeof candidateMatcherOutputSchema>;

const DEGRADED_FALLBACK: CandidateMatcherResult = {
  recommendedVacancies: [],
  suggestedActions: ['No se pudo generar un match automatico. Revision manual de vacantes abiertas recomendada.'],
};

export interface CandidateMatcherVacancy {
  id: string;
  title: string;
}

export interface CandidateMatcherInput {
  candidateProfile: {
    name: string;
    title?: string;
    skills?: string[];
    experience?: number;
  };
  /** Bounded, tenant-scoped, currently-open vacancies — the ONLY valid recommendation targets. */
  vacancies: CandidateMatcherVacancy[];
}

export async function matchCandidate(
  orgId: string,
  input: CandidateMatcherInput,
): Promise<{ result: CandidateMatcherResult; model: string }> {
  // Candidate profile + open-vacancy titles are org-internal HR data — the registry
  // sets cacheTtlSeconds=900 (short) since the open-vacancy set changes slowly
  // within a session but should never be cached across candidates for long.
  const { data, model } = await invokeAgent({
    slug: 'candidate-matcher',
    orgId,
    input,
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ candidateProfile, vacancies }) => {
      const profile = `Name: ${sanitizeInput(candidateProfile.name, 200)}
Title: ${candidateProfile.title ? sanitizeInput(candidateProfile.title, 200) : 'Not specified'}
Skills: ${candidateProfile.skills?.length ? candidateProfile.skills.map((s) => sanitizeInput(s, 100)).join(', ') : 'Not specified'}
Years of experience: ${candidateProfile.experience ?? 'Not specified'}`;

      const vacancyList = vacancies
        .map((v) => `- id: ${sanitizeInput(v.id, 100)} | title: ${sanitizeInput(v.title, 200)}`)
        .join('\n');

      return `${wrapAsData('candidate_profile', profile)}\n\n${wrapAsData('open_vacancies', vacancyList || 'No open vacancies available.')}\n\nRecommend the best-fit open vacancies for this candidate and suggest next-step actions. Return JSON.`;
    },
    schema: candidateMatcherOutputSchema,
    fallback: () => DEGRADED_FALLBACK,
    maxTokens: 800,
  });

  return { result: data, model };
}
