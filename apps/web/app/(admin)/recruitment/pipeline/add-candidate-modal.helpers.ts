export type Step = 1 | 2 | 3;
export type ProcessStep = 'idle' | 'creating' | 'applying';

// Stored source slugs, in picker order. Labels: lib/candidate-labels.ts (i18n candidates.source*).
// Pool types come from the same module (CANDIDATE_STAFF_POOL_TYPES), so the forms and the tables agree.
export const SOURCES = ['manual', 'linkedin', 'referral', 'portal', 'job_board', 'university', 'internal'] as const;

// Stored years of experience, with their label key under i18n pipeline.experienceLevels.
export const EXPERIENCE_LEVELS = [
  { value: '0', labelKey: 'none' },
  { value: '1', labelKey: 'one' },
  { value: '2', labelKey: 'two' },
  { value: '3', labelKey: 'threeFour' },
  { value: '5', labelKey: 'fiveSeven' },
  { value: '8', labelKey: 'eightTen' },
  { value: '12', labelKey: 'tenPlus' },
] as const;
