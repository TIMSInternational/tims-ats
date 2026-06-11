import { z } from 'zod';

// Question types mirror the Prisma `QuestionType` enum (packages/db). Kept in
// sync by value so Zod validates router input before it ever reaches Prisma.
export const QUESTION_TYPES = ['single_choice', 'multi_choice', 'free_text'] as const;
export const questionTypeEnum = z.enum(QUESTION_TYPES);
export type QuestionType = (typeof QUESTION_TYPES)[number];

// Bounds. Authoring is staff-facing but still untrusted input.
const MAX_OPTIONS = 20;
const MAX_OPTION_LABEL = 500;
const MAX_PROMPT = 5000;
const MAX_POINTS = 1000;

export const questionOptionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(MAX_OPTION_LABEL),
});
export type QuestionOption = z.infer<typeof questionOptionSchema>;

const questionBodySchema = z.object({
  type: questionTypeEnum,
  prompt: z.string().min(1).max(MAX_PROMPT),
  options: z.array(questionOptionSchema).max(MAX_OPTIONS).default([]),
  correctOptionIds: z.array(z.string().min(1).max(64)).max(MAX_OPTIONS).default([]),
  points: z.number().int().min(1).max(MAX_POINTS).default(1),
  order: z.number().int().min(0).max(10000).default(0),
});

export const createQuestionSchema = questionBodySchema.extend({
  assessmentTypeId: z.string().uuid(),
});
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

export const updateQuestionSchema = questionBodySchema.extend({
  id: z.string().uuid(),
  isActive: z.boolean().optional(),
});
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

export const listQuestionsSchema = z.object({
  assessmentTypeId: z.string().uuid(),
  includeInactive: z.boolean().default(false),
});

export const deleteQuestionSchema = z.object({
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Pure cross-field coherence (TDD-first, no DB/network).
// ---------------------------------------------------------------------------

export type QuestionCoherenceErrorCode =
  | 'free_text_no_options'
  | 'free_text_no_correct'
  | 'choice_needs_options'
  | 'duplicate_option_ids'
  | 'single_needs_one_correct'
  | 'multi_needs_correct'
  | 'correct_not_in_options'
  | 'duplicate_correct_ids';

export type QuestionCoherenceResult =
  | { valid: true }
  | { valid: false; code: QuestionCoherenceErrorCode };

interface QuestionCoherenceInput {
  type: QuestionType;
  options: { id: string; label: string }[];
  correctOptionIds: string[];
}

const MIN_CHOICE_OPTIONS = 2;

/**
 * Validates that a question's type, options, and correct-answer ids are mutually
 * consistent. Order-independent set logic; returns the first violation found.
 */
export function validateQuestionCoherence(input: QuestionCoherenceInput): QuestionCoherenceResult {
  const { type, options, correctOptionIds } = input;

  const optionIds = options.map((o) => o.id);
  if (new Set(optionIds).size !== optionIds.length) {
    return { valid: false, code: 'duplicate_option_ids' };
  }

  if (type === 'free_text') {
    if (options.length > 0) return { valid: false, code: 'free_text_no_options' };
    if (correctOptionIds.length > 0) return { valid: false, code: 'free_text_no_correct' };
    return { valid: true };
  }

  if (options.length < MIN_CHOICE_OPTIONS) {
    return { valid: false, code: 'choice_needs_options' };
  }

  if (new Set(correctOptionIds).size !== correctOptionIds.length) {
    return { valid: false, code: 'duplicate_correct_ids' };
  }

  const optionIdSet = new Set(optionIds);
  if (!correctOptionIds.every((id) => optionIdSet.has(id))) {
    return { valid: false, code: 'correct_not_in_options' };
  }

  if (type === 'single_choice' && correctOptionIds.length !== 1) {
    return { valid: false, code: 'single_needs_one_correct' };
  }

  if (type === 'multi_choice' && correctOptionIds.length < 1) {
    return { valid: false, code: 'multi_needs_correct' };
  }

  return { valid: true };
}
