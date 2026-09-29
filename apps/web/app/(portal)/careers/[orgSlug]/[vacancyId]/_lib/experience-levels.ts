// Labels are i18n keys under `portal` (es/en) — never hardcoded copy.
export const EXPERIENCE_LEVELS = [
  { value: '', labelKey: 'expSelect' },
  { value: '0', labelKey: 'expNone' },
  { value: '1', labelKey: 'exp1' },
  { value: '2', labelKey: 'exp2' },
  { value: '3', labelKey: 'exp3to4' },
  { value: '5', labelKey: 'exp5to7' },
  { value: '8', labelKey: 'exp8to10' },
  { value: '12', labelKey: 'exp10plus' },
] as const;
