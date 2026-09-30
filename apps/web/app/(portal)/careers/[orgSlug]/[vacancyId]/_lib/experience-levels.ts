export type ExperienceLevelKey = 'select' | 'y0' | 'y1' | 'y2' | 'y3' | 'y5' | 'y8' | 'y12';

/** `value` is what the apply form submits (years); `labelKey` indexes `portal.experienceLevels` in i18n. */
export const EXPERIENCE_LEVELS: ReadonlyArray<{ value: string; labelKey: ExperienceLevelKey }> = [
  { value: '', labelKey: 'select' },
  { value: '0', labelKey: 'y0' },
  { value: '1', labelKey: 'y1' },
  { value: '2', labelKey: 'y2' },
  { value: '3', labelKey: 'y3' },
  { value: '5', labelKey: 'y5' },
  { value: '8', labelKey: 'y8' },
  { value: '12', labelKey: 'y12' },
];

export function experienceLevelLabel(value: string, labels: Record<ExperienceLevelKey, string>): string {
  const level = EXPERIENCE_LEVELS.find((l) => l.value === value);
  return level ? labels[level.labelKey] : value;
}
