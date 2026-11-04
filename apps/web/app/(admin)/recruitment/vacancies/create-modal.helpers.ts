export interface VacancyFormData {
  title: string;
  description?: string;
  // AI-generated "social"/"whatsapp" variants (vacancy-writer agent), set only
  // when the user picks "Use this" for that variant in Step 2 — otherwise omitted.
  socialDescription?: string;
  whatsappDescription?: string;
  positions: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  contractType?: string;
  location?: string;
  remotePolicy?: 'onsite' | 'remote' | 'hybrid';
  salary?: { min?: number; max?: number; currency: string; period: 'monthly' | 'yearly' };
  settings?: { slaTargetDays?: number; autoPublish?: boolean; requireApproval?: boolean };
  // Org placement: what leader (team) / unit-scoped approvals are anchored on server-side.
  businessUnitId?: string;
  teamId?: string;
  /** The vacancy's assignee (shown as "Hiring manager"); counts as in-scope for its approvals. */
  assignedTo?: string;
}

export type Step = 1 | 2 | 3;

/** Stored contract-type values. Their labels live in i18n `portal.contractTypes` — one source for both surfaces. */
export const CONTRACT_TYPES = ['indefinido', 'termino_fijo', 'obra_labor', 'prestacion', 'temporal', 'practicas'] as const;

type FormalSections = { responsibilities: readonly string[]; requirements: readonly string[]; benefits: readonly string[] };

// Headings of the three sections "Usar" also copies into their own wizard fields (es + en).
const STRUCTURED_HEADINGS: Array<{ key: keyof FormalSections; re: RegExp }> = [
  { key: 'responsibilities', re: /^(responsabilidades|funciones|responsibilities)\b/i },
  { key: 'requirements', re: /^(requisitos|requerimientos|requirements)\b/i },
  { key: 'benefits', re: /^(beneficios|lo que ofrecemos|qu[eé] ofrecemos|ofrecemos|benefits)\b/i },
];

/** The heading text of a markdown heading ("## Requisitos"), a bold-only line ("**Requisitos:**") or a
 *  short plain label line ("Requisitos:"); null for any other line. */
function headingText(line: string): string | null {
  const trimmed = line.trim();
  const md = /^#{1,6}\s+(.+)$/.exec(trimmed);
  if (md) return md[1]!.replace(/[*:]+/g, '').trim();
  const bold = /^\*\*([^*]+)\*\*:?$/.exec(trimmed);
  if (bold) return bold[1]!.replace(/:$/, '').trim();
  const label = /^([^-*•\d][^:]{0,58}):$/.exec(trimmed);
  return label ? label[1]!.trim() : null;
}

/**
 * The AI's formal variant is a full job description: an opening, maybe other sections ("Sobre la empresa"),
 * and its responsibilities, requirements and benefits. "Usar" also copies those three into their own wizard
 * fields, and the saved description is built from all fields, so keeping the full text in "Sobre el cargo"
 * listed them twice (F-6). This drops ONLY the sections whose content was copied into a field (a heading
 * that names one of the three AND a non-empty array for it); every other heading and its text is kept.
 */
export function withoutCopiedSections(description: string, sections: FormalSections): string {
  const kept: string[] = [];
  let dropping = false;
  for (const line of description.split('\n')) {
    const heading = headingText(line);
    if (heading !== null) {
      const structured = STRUCTURED_HEADINGS.find((h) => h.re.test(heading));
      dropping = !!structured && sections[structured.key].length > 0;
    }
    if (!dropping) kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** "1 posición" / "3 posiciones" (or the English forms) from the active locale's labels. */
export function positionCountLabel(count: number, labels: { positionCountOne: string; positionCountMany: string }): string {
  return count === 1 ? labels.positionCountOne : labels.positionCountMany.replace('{n}', String(count));
}

export const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]';
export const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
export const textareaCls = 'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none';
