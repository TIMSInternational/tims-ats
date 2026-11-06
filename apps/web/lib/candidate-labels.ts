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

/** The pool types staff pick when they add a candidate by hand; the others are set by the system. */
export const CANDIDATE_STAFF_POOL_TYPES = [
  'active',
  'passive',
  'referral',
  'sourced',
] as const satisfies readonly CandidatePoolType[];
export type CandidateStaffPoolType = (typeof CANDIDATE_STAFF_POOL_TYPES)[number];

export interface CandidatePoolLabels {
  poolApplicant: string;
  poolActive: string;
  poolPassive: string;
  poolReferral: string;
  poolSourced: string;
  poolSilverMedalist: string;
}

/** One-line explanations shown next to the pool label in the create forms' picker. */
export interface CandidatePoolHints {
  poolActiveHint: string;
  poolPassiveHint: string;
  poolReferralHint: string;
  poolSourcedHint: string;
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
  sourceConsulting: string;
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

const POOL_HINT: Record<CandidateStaffPoolType, (l: CandidatePoolHints) => string> = {
  active: (l) => l.poolActiveHint,
  passive: (l) => l.poolPassiveHint,
  referral: (l) => l.poolReferralHint,
  sourced: (l) => l.poolSourcedHint,
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

// Free-text sources found in stored data that no picker offers. Labelled only: they are NOT added to
// CANDIDATE_SOURCES (the filter and picker lists), and the API input stays free text.
const EXTRA_SOURCE_LABEL = {
  consulting: (l: CandidateSourceLabels) => l.sourceConsulting,
} as const;

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

/** The create forms' pool option: the same label the tables show, plus its hint ("Activo — busca empleo activamente"). */
export function candidatePoolOptionLabel(
  poolType: CandidateStaffPoolType,
  labels: CandidatePoolLabels & CandidatePoolHints,
): string {
  return `${candidatePoolLabel(poolType, labels)} — ${POOL_HINT[poolType](labels)}`;
}

export function candidateSourceLabel(source: string | null | undefined, labels: CandidateSourceLabels): string {
  if (!source) return '—';
  const slug = source.trim().toLowerCase();
  if (isKey(SOURCE_LABEL, slug)) return SOURCE_LABEL[slug](labels);
  if (isKey(EXTRA_SOURCE_LABEL, slug)) return EXTRA_SOURCE_LABEL[slug](labels);
  return humanize(source);
}
