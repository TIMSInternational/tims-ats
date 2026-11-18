import type { useI18n } from '../../../../lib/i18n';

type T = ReturnType<typeof useI18n>['t'];

/**
 * One neutral categorical set for every DEI chart (charts.md › Color): the navy chart ramp, never
 * blue-for-men / pink-for-women. Legends always carry the word and the value, so colour is never alone.
 */
export const GENDER_BAR: Record<string, string> = {
  male: 'bg-chart-1',
  female: 'bg-chart-3',
  non_binary: 'bg-chart-4',
  undisclosed: 'bg-chart-5',
};

export const GENDER_FALLBACK_BAR = 'bg-chart-5';

/** Ordinal ramp, dark → light, for age bands and nationality rows. */
export const RAMP = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'] as const;

export function genderLabel(t: T, g: string): string {
  return g === 'male'
    ? t.dei.genderMale
    : g === 'female'
      ? t.dei.genderFemale
      : g === 'non_binary'
        ? t.dei.genderNonBinary
        : g === 'undisclosed'
          ? t.dei.genderUndisclosed
          : g;
}

/** Card chrome shared by the DEI panels. */
export const DEI_CARD = 'rounded-xl border border-border bg-white p-4 shadow-card md:p-5';
export const DEI_CARD_TITLE = 'mb-3 text-heading font-semibold text-brand';
