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

// A markdown heading ("## Responsabilidades", "**Requisitos:**") or a list item ("- …", "1. …").
const SECTION_START = /^\s*(#{1,6}\s|\*\*[^*]+\*\*:?\s*$|[-*•]\s|\d+[.)]\s)/;

/**
 * The AI's formal variant is a full job description: an opening plus its responsibilities, requirements
 * and benefits. "Usar" also fills those sections into their own wizard fields, and the saved description
 * is built from all fields, so keeping the full text in "Sobre el cargo" listed every section twice.
 * Returns only the opening: the text after a leading title heading and before the first section heading
 * or list. When the variant came without sections, the description is kept whole.
 */
export function formalDescriptionIntro(
  description: string,
  sections: { responsibilities: readonly string[]; requirements: readonly string[]; benefits: readonly string[] },
): string {
  const hasSections = sections.responsibilities.length + sections.requirements.length + sections.benefits.length > 0;
  if (!hasSections) return description.trim();
  const lines = description.split('\n');
  let i = 0;
  // Skip blank lines and a leading title ("# Analista financiero" or a bold-only "**Analista financiero**").
  while (i < lines.length && (lines[i]!.trim() === '' || /^\s*(#{1,6}\s|\*\*[^*]+\*\*:?\s*$)/.test(lines[i]!))) i++;
  const intro: string[] = [];
  for (; i < lines.length; i++) {
    if (SECTION_START.test(lines[i]!)) break;
    intro.push(lines[i]!);
  }
  return intro.join('\n').trim();
}

/** "1 posición" / "3 posiciones" (or the English forms) from the active locale's labels. */
export function positionCountLabel(count: number, labels: { positionCountOne: string; positionCountMany: string }): string {
  return count === 1 ? labels.positionCountOne : labels.positionCountMany.replace('{n}', String(count));
}

export const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]';
export const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
export const textareaCls = 'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none';
