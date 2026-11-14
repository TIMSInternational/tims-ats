// Display-only catalog facts for the AI agents page (no data or API behaviour lives here).
import type { StatusTone } from '../../../../components';

export const MVP_SLUGS = [
  'cv-parser',
  'vacancy-writer',
  'inclusive-language',
  'candidate-screener',
  'candidate-matcher',
  'interview-question-gen',
  'interview-summarizer',
  'assessment-evaluator',
  'pipeline-optimizer',
  'email-composer',
  'offer-letter-gen',
];

/** Filter value → i18n key under t.aiAgents.categories. */
export const CATEGORY_FILTERS = {
  all: 'all',
  mvp: 'mvp',
  'post-mvp': 'postMvp',
  recruitment: 'recruitment',
  interview: 'interview',
  assessment: 'assessment',
  pipeline: 'pipeline',
  talent: 'talent',
  general: 'general',
} as const;

export type CategoryFilter = keyof typeof CATEGORY_FILTERS;

export const STATUS_TONES: Record<string, StatusTone> = {
  active: 'success',
  stub: 'neutral',
  disabled: 'danger',
};

export function formatCache(seconds: number, noCache: string) {
  if (seconds === 0) return noCache;
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}
