import { z } from 'zod';

// The Survey.questions column is Prisma `Json`, so the tRPC output types it as
// JsonValue — the array shape is NOT inferred. Re-declare the authoritative
// question schema (mirrors createSurvey's Zod in packages/api .../engagement.ts)
// and parse the JsonValue with it, so the take form has a typed, validated
// question list instead of an `any`-cast.
export const surveyQuestionSchema = z.object({
  text: z.string().min(1).max(500),
  type: z.enum(['scale', 'text', 'multiple_choice', 'yes_no']),
  options: z.array(z.string().max(200)).optional(),
  required: z.boolean().default(true),
  category: z.string().max(100).optional(),
});

export type SurveyQuestion = z.infer<typeof surveyQuestionSchema>;

const surveyQuestionsSchema = z.array(surveyQuestionSchema);

// Typed guard over the raw JsonValue. Returns [] for any malformed payload so the
// modal can fall back to an "empty" state rather than throwing on a bad shape.
export function parseSurveyQuestions(raw: unknown): SurveyQuestion[] {
  const parsed = surveyQuestionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

// An answer is a number (scale) or a string (text / multiple_choice / yes_no),
// matching submitSurveyResponse's input (z.union([z.string(), z.number()])).
export type SurveyAnswer = string | number;
