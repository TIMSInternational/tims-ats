export type Step = 1 | 2 | 3;
export type ProcessStep = 'idle' | 'creating' | 'applying';

export const SOURCES = [
  { value: 'manual', label: 'Ingreso manual' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'referral', label: 'Referido' },
  { value: 'portal', label: 'Portal' },
  { value: 'job_board', label: 'Job Board' },
  { value: 'university', label: 'Universidad' },
  { value: 'internal', label: 'Interno / Transferencia' },
];

export const POOL_TYPES = [
  { value: 'active', label: 'Activo — busca empleo' },
  { value: 'passive', label: 'Pasivo — no busca activamente' },
  { value: 'referral', label: 'Referido por empleado' },
  { value: 'sourced', label: 'Sourced — contactado directamente' },
];

export const EXPERIENCE_LEVELS = [
  { value: '0', label: 'Sin experiencia' },
  { value: '1', label: '1 ano' },
  { value: '2', label: '2 anos' },
  { value: '3', label: '3-4 anos' },
  { value: '5', label: '5-7 anos' },
  { value: '8', label: '8-10 anos' },
  { value: '12', label: '10+ anos' },
];

export const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] disabled:opacity-50 disabled:bg-[#FAFAFA]';
export const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
export const textareaCls = 'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none disabled:opacity-50';

export const STEP_LABELS = ['Datos personales', 'Perfil profesional', 'Fuente y aplicacion'];

// #315: candidate.create now refuses an email that canonically (trim + lowercase) matches an
// existing candidate with a tRPC CONFLICT ("Ya existe un candidato con este email") BEFORE the
// insert, so the old Prisma P2002 "Unique constraint" message never reaches the client. Key on
// the tRPC code; keep the legacy substrings for a server that still surfaces raw P2002 text.
export function isDuplicateCandidateError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'data' in err) {
    const data = (err as { data?: unknown }).data;
    if (typeof data === 'object' && data !== null && (data as { code?: unknown }).code === 'CONFLICT') {
      return true;
    }
  }
  const msg = err instanceof Error ? err.message : '';
  return msg.includes('Unique constraint') || msg.includes('unique') || msg.includes('already exists');
}

// candidate.search is a case-insensitive CONTAINS over name/email/title/company, so its top hit
// for "ana@x.com" can be "juana@x.com". Only reuse a row whose email canonically equals the one
// typed; never fall back to "first result".
//
// When legacy case/padding duplicates of one person exist (`ANA@x.com` and `ana@x.com`), prefer the
// row stored in CANONICAL form, which is the row the careers portal resolves for that person
// (pickCanonicalEmailMatch: byte-identical to the lowercase session email, then canonical). Picking
// the first variant in search order (most recently updated) could attach the application to a row
// the candidate's own dashboard never shows (tier-1 review). With no canonical row, the portal picks
// the OLDEST variant; search rows carry no createdAt, so that last tier is not reproduced here.
export function pickExistingCandidateId(
  rows: readonly { id: string; email: string }[],
  typedEmail: string,
): string | null {
  const canonical = typedEmail.trim().toLowerCase();
  if (canonical.length === 0) return null;
  const matches = rows.filter((r) => r.email.trim().toLowerCase() === canonical);
  return (matches.find((r) => r.email === canonical) ?? matches[0])?.id ?? null;
}
