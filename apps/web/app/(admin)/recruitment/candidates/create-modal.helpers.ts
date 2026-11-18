export type Step = 1 | 2 | 3;

// Stored source slugs, in picker order. Labels: lib/candidate-labels.ts (i18n candidates.source*).
// Pool types come from the same module (CANDIDATE_STAFF_POOL_TYPES), so the forms and the tables agree.
export const SOURCES = ['manual', 'linkedin', 'referral', 'portal', 'job_board', 'university', 'internal'] as const;

/** Experience bands for the picker; the label is an i18n key under `candidates`. */
export const EXPERIENCE_LEVELS = [
  { value: 0, labelKey: 'experienceNone' },
  { value: 1, labelKey: 'experience1' },
  { value: 2, labelKey: 'experience2' },
  { value: 3, labelKey: 'experience3to4' },
  { value: 5, labelKey: 'experience5to7' },
  { value: 8, labelKey: 'experience8to10' },
  { value: 12, labelKey: 'experience10Plus' },
] as const;

export type ExperienceLabelKey = (typeof EXPERIENCE_LEVELS)[number]['labelKey'];

/** A selectable row in the wizard's choice groups: the whole row is the label (≥ 44px on touch). */
export const CHOICE_CARD_CLASSES =
  'flex min-h-9 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-body transition-colors pointer-coarse:min-h-11 has-[:checked]:border-brand has-[:checked]:bg-brand-tint has-[:checked]:font-medium has-[:checked]:text-brand border-border text-primary hover:bg-surface';

export const LEGEND_CLASSES = 'mb-2 text-subheading font-semibold text-primary';

interface CreateErrorCopy {
  emailTaken: string;
  createErrorForbidden: string;
  createErrorInvalid: string;
  createError: string;
}

/** The message for a failed create, by tRPC error code: the same words in the toast and in the dialog. */
export function createErrorMessage(code: string | undefined, copy: CreateErrorCopy): string {
  if (code === 'CONFLICT') return copy.emailTaken;
  if (code === 'FORBIDDEN') return copy.createErrorForbidden;
  if (code === 'BAD_REQUEST') return copy.createErrorInvalid;
  return copy.createError;
}
