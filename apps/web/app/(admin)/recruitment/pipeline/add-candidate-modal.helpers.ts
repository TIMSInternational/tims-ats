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
