import { z } from 'zod';
import { invokeAgent } from '../invoke';
import { wrapAsData } from '../pii';

export const CV_PARSER_SYSTEM_PROMPT = `You are a CV/resume parser for an HR platform. Extract structured data from CV text.

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
- Parse dates as years (not full dates)
- Length limits: at most 100 skills, 30 experience entries, 20 education entries and 20 languages
- Field limits: name, company, title, institution and degree under 200 characters; email under 320; phone under 50; each skill and language under 100; each experience description and the summary under 2000`;

export const cvParserOutputSchema = z.object({
  name: z.string().max(200).nullable(),
  email: z.string().max(320).nullable(),
  phone: z.string().max(50).nullable(),
  skills: z.array(z.string().max(100)).max(100),
  experience: z.array(z.object({
    company: z.string().max(200),
    title: z.string().max(200),
    startYear: z.number().nullable(),
    endYear: z.number().nullable(),
    description: z.string().max(2000).nullable(),
  })).max(30),
  education: z.array(z.object({
    institution: z.string().max(200),
    degree: z.string().max(200),
    year: z.number().nullable(),
  })).max(20),
  languages: z.array(z.string().max(100)).max(20),
  summary: z.string().max(2000).nullable(),
});

export type ParsedCVData = z.infer<typeof cvParserOutputSchema>;

const EMPTY_CV: ParsedCVData = {
  name: null,
  email: null,
  phone: null,
  skills: [],
  experience: [],
  education: [],
  languages: [],
  summary: null,
};

export async function parseCV(
  orgId: string,
  cvText: string,
): Promise<{ data: ParsedCVData; model: string; confidence: number }> {
  // CV text contains candidate PII — the registry sets cacheTtlSeconds=0 for
  // cv-parser, so invokeAgent never caches raw input here.
  const { data, model, validated } = await invokeAgent({
    slug: 'cv-parser',
    orgId,
    input: { cvText: cvText.slice(0, 8000) },
    systemPrompt: CV_PARSER_SYSTEM_PROMPT,
    buildUserMessage: ({ cvText }) =>
      `${wrapAsData('cv_text', cvText)}\n\nParse this CV and extract structured data. Return JSON only.`,
    schema: cvParserOutputSchema,
    fallback: () => EMPTY_CV,
    maxTokens: 2048,
  });

  // A malformed model response is metered but is not a parsed CV. Leaving the
  // document unparsed allows the durable retry path to recover it later.
  if (!validated) throw new Error('CV parser returned invalid structured output');

  const filledFields = Object.values(data).filter((v) => v !== null && (Array.isArray(v) ? v.length > 0 : true)).length;
  const confidence = Math.min(filledFields / 8, 1);

  return { data, model, confidence };
}
