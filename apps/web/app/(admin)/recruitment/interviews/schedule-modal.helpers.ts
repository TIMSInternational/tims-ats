export type Step = 1 | 2 | 3;

// Labels and descriptions are i18n keys under `interviews` (typeX / typeDescX). `online` is a pasted
// Teams/Meet/Zoom meeting: candidates read it as "En línea", never as an in-person interview.
export const INTERVIEW_TYPES = [
  { value: 'phone', labelKey: 'typePhone', descKey: 'typeDescPhone' },
  { value: 'video', labelKey: 'typeVideo', descKey: 'typeDescVideo' },
  { value: 'online', labelKey: 'typeOnline', descKey: 'typeDescOnline' },
  { value: 'technical', labelKey: 'typeTechnical', descKey: 'typeDescTechnical' },
  { value: 'cultural', labelKey: 'typeCultural', descKey: 'typeDescCultural' },
  { value: 'panel', labelKey: 'typePanel', descKey: 'typeDescPanel' },
  { value: 'onsite', labelKey: 'typeOnsite', descKey: 'typeDescOnsite' },
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

// Labels are i18n keys under `interviews` ("1,5 h" in Spanish, "1.5 hr" in English).
export const DURATIONS = [
  { value: 15, labelKey: 'duration15' },
  { value: 30, labelKey: 'duration30' },
  { value: 45, labelKey: 'duration45' },
  { value: 60, labelKey: 'duration60' },
  { value: 90, labelKey: 'duration90' },
  { value: 120, labelKey: 'duration120' },
] as const;

/** i18n keys (under `interviews`) of the three wizard steps. */
export const STEP_LABEL_KEYS = ['scheduleStepWho', 'scheduleStepWhen', 'scheduleStepEvaluators'] as const;
