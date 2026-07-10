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
}

export type Step = 1 | 2 | 3;

export const CONTRACT_TYPES = [
  { value: 'indefinido', label: 'Termino indefinido' },
  { value: 'termino_fijo', label: 'Termino fijo' },
  { value: 'obra_labor', label: 'Obra o labor' },
  { value: 'prestacion', label: 'Prestacion de servicios' },
  { value: 'temporal', label: 'Temporal' },
  { value: 'practicas', label: 'Practicas / Pasantia' },
];

export const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]';
export const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
export const textareaCls = 'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none';
