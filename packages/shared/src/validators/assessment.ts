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

export type QuestionCoherenceResult = { valid: true } | { valid: false; code: QuestionCoherenceErrorCode };

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

// ---------------------------------------------------------------------------
// Candidate-facing take-flow (Wave 1.5a slice 2). Pure grading logic first
// (TDD, no DB/network) — mirrors validateQuestionCoherence above.
// ---------------------------------------------------------------------------

export interface ScoreChoiceResult {
  isCorrect: boolean;
  pointsAwarded: number;
}

/**
 * Order-independent set-equality between the candidate's selected option ids
 * and the question's correct option ids. Full credit or zero — no partial
 * credit for multi_choice (a simpler bar than staff authoring coherence).
 */
export function scoreChoice(
  selectedOptionIds: string[],
  correctOptionIds: string[],
  points: number,
): ScoreChoiceResult {
  const selected = new Set(selectedOptionIds);
  const correct = new Set(correctOptionIds);
  const isCorrect = selected.size === correct.size && [...selected].every((id) => correct.has(id));
  return { isCorrect, pointsAwarded: isCorrect ? points : 0 };
}

export interface GradedAnswer {
  // null for free_text — ungraded, never fabricated (rule #4).
  isCorrect: boolean | null;
  pointsAwarded: number | null;
  points: number;
}

export interface ComputeResultOutput {
  rawScore: number;
  normalizedScore: number;
  hasPending: boolean;
}

/**
 * Aggregates a submitted attempt's per-question grades into a result summary.
 * normalizedScore is raw/maxAutoPoints*100 over the AUTO-SCORABLE subset only
 * (free_text questions are excluded from the denominator, not scored 0) — an
 * all-essay assessment must not show 0% just because nothing was auto-graded.
 */
export function computeResult(graded: GradedAnswer[]): ComputeResultOutput {
  const autoScored = graded.filter((g) => g.pointsAwarded !== null);
  const rawScore = autoScored.reduce((sum, g) => sum + g.pointsAwarded!, 0);
  const maxAutoPoints = autoScored.reduce((sum, g) => sum + g.points, 0);
  const normalizedScore = maxAutoPoints > 0 ? (rawScore / maxAutoPoints) * 100 : 0;
  const hasPending = graded.some((g) => g.isCorrect === null);
  return { rawScore, normalizedScore, hasPending };
}

// ---------------------------------------------------------------------------
// Candidate submit input (Zod). Full type-coherence (must supply
// selectedOptionIds for a choice question, freeText for free_text) needs the
// DB question type and is enforced server-side in the service, not here —
// same split as staff authoring's validateQuestionCoherence vs createQuestionSchema.
// ---------------------------------------------------------------------------

const MAX_ANSWERS_PER_SUBMIT = 200;
const MAX_FREE_TEXT = 20000;

export const answerInputSchema = z.object({
  questionId: z.string().uuid(),
  selectedOptionIds: z.array(z.string().min(1).max(64)).max(MAX_OPTIONS).optional(),
  freeText: z.string().max(MAX_FREE_TEXT).optional(),
});
export type AnswerInput = z.infer<typeof answerInputSchema>;

export const submitAssessmentAnswersSchema = z.array(answerInputSchema).min(1).max(MAX_ANSWERS_PER_SUBMIT);
