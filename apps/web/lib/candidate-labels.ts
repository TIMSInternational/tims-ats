// One vocabulary for the two candidate slugs staff screens show: how the candidate arrived (`source`) and
// what kind of candidate they are (`poolType`). Both are stored as slugs; every screen renders them through
// these helpers so a raw "portal", "job_board" or "active" never reaches the user, and the pickers, the
// filters and the tables all agree on the same names.
//
// Pure module (no React) so node tests can exercise it. The labels come from i18n `candidates.*`.

export const CANDIDATE_POOL_TYPES = [
  'applicant',
  'active',
  'passive',
  'referral',
  'sourced',
  'silver_medalist',
] as const;
export const CANDIDATE_SOURCES = [
  'portal',
  'manual',
  'linkedin',
  'referral',
  'job_board',
  'university',
  'internal',
  'bulk',
] as const;

export type CandidatePoolType = (typeof CANDIDATE_POOL_TYPES)[number];
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export interface CandidatePoolLabels {
  poolApplicant: string;
  poolActive: string;
  poolPassive: string;
  poolReferral: string;
  poolSourced: string;
  poolSilverMedalist: string;
}

export interface CandidateSourceLabels {
  sourcePortal: string;
  sourceManual: string;
  sourceLinkedin: string;
  sourceReferral: string;
  sourceJobBoard: string;
  sourceUniversity: string;
  sourceInternal: string;
  sourceBulk: string;
}

// Accessors rather than key strings: the label lookup stays type-checked against the i18n shape.
const POOL_LABEL: Record<CandidatePoolType, (l: CandidatePoolLabels) => string> = {
  applicant: (l) => l.poolApplicant,
  active: (l) => l.poolActive,
  passive: (l) => l.poolPassive,
  referral: (l) => l.poolReferral,
  sourced: (l) => l.poolSourced,
  silver_medalist: (l) => l.poolSilverMedalist,
};

const SOURCE_LABEL: Record<CandidateSource, (l: CandidateSourceLabels) => string> = {
  portal: (l) => l.sourcePortal,
  manual: (l) => l.sourceManual,
  linkedin: (l) => l.sourceLinkedin,
  referral: (l) => l.sourceReferral,
  job_board: (l) => l.sourceJobBoard,
  university: (l) => l.sourceUniversity,
  internal: (l) => l.sourceInternal,
  bulk: (l) => l.sourceBulk,
};

/** A slug nobody mapped (an org-specific source, say) still reads as words, never as `snake_case`. */
function humanize(slug: string): string {
  const words = slug.trim().replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isKey<K extends string>(map: Record<K, unknown>, value: string): value is K {
  return Object.prototype.hasOwnProperty.call(map, value);
}

export function candidatePoolLabel(poolType: string | null | undefined, labels: CandidatePoolLabels): string {
  if (!poolType) return '—';
  const slug = poolType.trim().toLowerCase();
  return isKey(POOL_LABEL, slug) ? POOL_LABEL[slug](labels) : humanize(poolType);
}

export function candidateSourceLabel(source: string | null | undefined, labels: CandidateSourceLabels): string {
  if (!source) return '—';
  const slug = source.trim().toLowerCase();
  return isKey(SOURCE_LABEL, slug) ? SOURCE_LABEL[slug](labels) : humanize(source);
}
