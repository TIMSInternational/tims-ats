export type Step = 1 | 2 | 3;

export const INTERVIEW_TYPES = [
  { value: 'phone', label: 'Telefonica', icon: '📞', desc: 'Llamada rapida de screening' },
  { value: 'video', label: 'Videoconferencia', icon: '📹', desc: 'Entrevista por Daily.co / Meet' },
  { value: 'technical', label: 'Tecnica', icon: '💻', desc: 'Evaluacion de habilidades tecnicas' },
  { value: 'cultural', label: 'Cultural', icon: '🤝', desc: 'Fit cultural y valores' },
  { value: 'panel', label: 'Panel', icon: '👥', desc: 'Multiples evaluadores simultaneos' },
  { value: 'onsite', label: 'Presencial', icon: '🏢', desc: 'Entrevista en oficina' },
];

export const DURATIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hora' },
  { value: 90, label: '1.5 horas' },
  { value: 120, label: '2 horas' },
];

export const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]';
export const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
export const textareaCls = 'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none';

export const stepLabels = ['Candidato y vacante', 'Tipo y horario', 'Evaluadores y notas'];
