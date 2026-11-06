export type Step = 1 | 2 | 3;

// Labels and descriptions are i18n keys under `interviews` (typeX / typeDescX). `online` is a pasted
// Teams/Meet/Zoom meeting: candidates read it as "En línea", never as an in-person interview.
export const INTERVIEW_TYPES = [
  { value: 'phone', icon: '📞', labelKey: 'typePhone', descKey: 'typeDescPhone' },
  { value: 'video', icon: '📹', labelKey: 'typeVideo', descKey: 'typeDescVideo' },
  { value: 'online', icon: '🔗', labelKey: 'typeOnline', descKey: 'typeDescOnline' },
  { value: 'technical', icon: '💻', labelKey: 'typeTechnical', descKey: 'typeDescTechnical' },
  { value: 'cultural', icon: '🤝', labelKey: 'typeCultural', descKey: 'typeDescCultural' },
  { value: 'panel', icon: '👥', labelKey: 'typePanel', descKey: 'typeDescPanel' },
  { value: 'onsite', icon: '🏢', labelKey: 'typeOnsite', descKey: 'typeDescOnsite' },
] as const;

export type InterviewTypeOption = (typeof INTERVIEW_TYPES)[number];

/** i18n key of the location placeholder for a type (an office in San José for on-site, a link for online). */
export function locationPlaceholderKey(type: string) {
  if (type === 'video') return 'scheduleLocationPlaceholderVideo' as const;
  if (type === 'onsite') return 'scheduleLocationPlaceholderOnsite' as const;
  if (type === 'online') return 'scheduleLocationPlaceholderOnline' as const;
  return 'scheduleLocationPlaceholderOther' as const;
}

// Video interviews mint a Daily.co room + candidate join token. Until Daily is configured in a deployment
// (NEXT_PUBLIC_INTERVIEW_VIDEO_ENABLED=true, exact string) the type is not offered, so scheduling never
// produces a candidate dead end. Literal env reference so Next inlines it into the client bundle.
export function isInterviewVideoEnabled(raw: string | undefined = process.env.NEXT_PUBLIC_INTERVIEW_VIDEO_ENABLED): boolean {
  return raw === 'true';
}

export function availableInterviewTypes(videoEnabled: boolean = isInterviewVideoEnabled()): InterviewTypeOption[] {
  return videoEnabled ? [...INTERVIEW_TYPES] : INTERVIEW_TYPES.filter((it) => it.value !== 'video');
}

export function defaultInterviewType(videoEnabled: boolean = isInterviewVideoEnabled()): string {
  return videoEnabled ? 'video' : 'onsite';
}

// The single "Ubicación o enlace" field. Always sent as `location` (the text the recruiter typed, which
// the emails and lists show); when it is an absolute https URL it is ALSO sent as `meetingUrl`, which is
// what the candidate portal turns into a Join button. Non-https links are never promoted.
export function locationPayload(raw: string): { location?: string; meetingUrl?: string } {
  const value = raw.trim();
  if (!value) return {};
  if (/\s/.test(value) || value.length > 2048) return { location: value };
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname) return { location: value, meetingUrl: url.toString() };
  } catch {
    // not a URL — plain location text
  }
  return { location: value };
}

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
