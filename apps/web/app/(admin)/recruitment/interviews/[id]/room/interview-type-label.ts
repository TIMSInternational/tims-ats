import type { useI18n } from '../../../../../../lib/i18n';

type Translations = ReturnType<typeof useI18n>['t'];

const TYPE_KEYS = {
  phone: 'typePhone',
  video: 'typeVideo',
  panel: 'typePanel',
  onsite: 'typeOnsite',
  technical: 'typeTechnical',
  cultural: 'typeCultural',
} as const;

/** Localized interview type; unknown stored values fall back to the raw string. */
export function interviewTypeLabel(t: Translations, type: string): string {
  const key = (TYPE_KEYS as Record<string, (typeof TYPE_KEYS)[keyof typeof TYPE_KEYS]>)[type];
  return key ? t.interviews[key] : type;
}
