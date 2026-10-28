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

/** "1 posición" / "3 posiciones" (or the English forms) from the active locale's labels. */
export function positionCountLabel(count: number, labels: { positionCountOne: string; positionCountMany: string }): string {
  return count === 1 ? labels.positionCountOne : labels.positionCountMany.replace('{n}', String(count));
}

export const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]';
export const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
export const textareaCls = 'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none';
