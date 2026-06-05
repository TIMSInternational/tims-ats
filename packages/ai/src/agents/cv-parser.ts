import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData } from '../pii';

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

const EMPTY_CV: ParsedCVData = {
  name: null, email: null, phone: null, skills: [], experience: [], education: [], languages: [], summary: null,
};

export async function parseCV(
  orgId: string,
  cvText: string,
): Promise<{ data: ParsedCVData; model: string; confidence: number }> {
  // CV text contains candidate PII — the registry sets cacheTtlSeconds=0 for
  // cv-parser, so invokeAgent never caches raw input here.
  const { data, model } = await invokeAgent({
    slug: 'cv-parser',
    orgId,
    input: { cvText: cvText.slice(0, 8000) },
    systemPrompt: SYSTEM_PROMPT,
    buildUserMessage: ({ cvText }) =>
      `${wrapAsData('cv_text', cvText)}\n\nParse this CV and extract structured data. Return JSON only.`,
    schema: outputSchema,
    fallback: () => EMPTY_CV,
    maxTokens: 2048,
  });

  const filledFields = Object.values(data).filter(
    (v) => v !== null && (Array.isArray(v) ? v.length > 0 : true),
  ).length;
  const confidence = Math.min(filledFields / 8, 1);

  return { data, model, confidence };
}
