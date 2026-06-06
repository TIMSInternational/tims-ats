import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData, sanitizeInput } from '../pii';

const SYSTEM_PROMPT = `You are an interview design assistant for an HR platform.
Generate a structured interview guide tailored to a specific vacancy and candidate.

Output format: JSON with the following structure:
{
  "sections": [
    { "title": "Introduccion", "duration": 5, "questions": ["q1", "q2"] }
  ]
}

Rules:
- 3-5 sections; total duration must fit the interview length given
- Questions must be SPECIFIC to the role's requirements and the candidate's background — no generic filler
- Include at least one section probing the candidate's stated skills against the role
- Behavioral questions must ask for concrete past examples (STAR-style)
- Never include questions about protected characteristics (age, family, religion, health, origin)
- Respond in the same language as the vacancy description (Spanish for Spanish vacancies)
- Max 6 questions per section`;

const outputSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string(),
        duration: z.number().min(1).max(120),
        questions: z.array(z.string()).min(1).max(6),
      }),
    )
    .min(1)
    .max(6),
});

export type InterviewGuideResult = z.infer<typeof outputSchema>;

// Obviously degraded (rule #4) — an empty guide that says why, never canned questions.
const DEGRADED_FALLBACK: InterviewGuideResult = {
  sections: [
    {
      title: 'Guia no disponible',
      duration: 1,
      questions: ['El analisis de IA no pudo completarse — prepare la entrevista manualmente.'],
    },
  ],
};

export async function generateInterviewGuide(
  orgId: string,
  input: {
    vacancyTitle: string;
    vacancyDescription?: string | null;
    interviewType: string;
    durationMinutes: number;
    candidateTitle?: string | null;
    candidateSkills?: string[];
  },
): Promise<{ result: InterviewGuideResult; model: string }> {
  // Includes candidate profile data — registry sets cacheTtlSeconds=0.
  const { data, model } = await invokeAgent({
    slug: 'interview-guide',
    orgId,
    input,
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ vacancyTitle, vacancyDescription, interviewType, durationMinutes, candidateTitle, candidateSkills }) => {
      const vacancy = `Position: ${sanitizeInput(vacancyTitle)}
Description: ${sanitizeInput(vacancyDescription ?? 'Not provided')}`;
      const context = `Interview type: ${sanitizeInput(interviewType)}
Duration: ${durationMinutes} minutes
Candidate current title: ${sanitizeInput(candidateTitle ?? 'Not specified')}
Candidate skills: ${sanitizeInput(candidateSkills?.join(', ') ?? 'Not specified')}`;
      return `${wrapAsData('vacancy', vacancy)}\n\n${wrapAsData('interview_context', context)}\n\nGenerate the interview guide. Return JSON.`;
    },
    schema: outputSchema,
    fallback: () => DEGRADED_FALLBACK,
    maxTokens: 1536,
  });

  return { result: data, model };
}
