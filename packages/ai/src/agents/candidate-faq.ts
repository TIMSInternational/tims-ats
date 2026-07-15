import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData } from '../pii';

const SYSTEM_PROMPT = `You are the candidate-facing FAQ assistant for TIMS ATS.
Answer questions about the candidate's own application process using ONLY the supplied candidate portal context.

Output format: JSON only, with this exact shape:
{
  "answer": "short, helpful answer in the same language as the candidate question",
  "sources": ["applications", "interviews"]
}

Rules:
- Never mention other candidates, internal notes, evaluator opinions, AI scores, recruiter-only workflow, or hidden data.
- If the context does not contain enough information, say that the recruiting team should confirm it.
- Do not invent dates, interview links, offer terms, stages, or application outcomes.
- Keep the answer concise and candidate-friendly.
- sources must contain only these labels when relevant: profile, applications, interviews, offers.`;

const outputSchema = z.object({
  answer: z.string().min(1).max(1200),
  sources: z.array(z.enum(['profile', 'applications', 'interviews', 'offers'])).max(4),
});

export interface CandidateFaqContext {
  organizationName: string;
  candidateName: string;
  applications: Array<{
    id: string;
    vacancyTitle: string;
    companyName: string | null;
    status: string;
    currentStage: string | null;
    appliedAt: string;
  }>;
  upcomingInterviews: Array<{
    vacancyTitle: string;
    type: string;
    status: string;
    scheduledAt: string;
    durationMinutes: number | null;
    location: string | null;
    hasJoinLink: boolean;
  }>;
  offers: Array<{
    vacancyTitle: string;
    companyName: string | null;
    status: string;
    salary: number;
    currency: string;
    startDate: string;
    contractType: string;
    expiresAt: string | null;
    signable: boolean;
  }>;
}

export interface CandidateFaqAnswer {
  answer: string;
  sources: Array<'profile' | 'applications' | 'interviews' | 'offers'>;
  model: string;
}

const fallbackAnswer =
  "I couldn't generate a reliable answer from your portal context. Please contact the recruiting team to confirm.";

export async function answerCandidateFaq(
  orgId: string,
  input: { question: string; context: CandidateFaqContext },
): Promise<CandidateFaqAnswer> {
  const { data, model } = await invokeAgent({
    slug: 'candidate-faq',
    orgId,
    input,
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ question, context }) => {
      const contextJson = JSON.stringify(context);
      return [
        wrapAsData('candidate_question', question),
        wrapAsData('candidate_portal_context_json', contextJson),
        'Answer the candidate question using only the candidate_portal_context_json. Return JSON only.',
      ].join('\n\n');
    },
    schema: outputSchema,
    fallback: () => ({ answer: fallbackAnswer, sources: [] }),
    maxTokens: 900,
  });

  return { answer: data.answer, sources: data.sources, model };
}
