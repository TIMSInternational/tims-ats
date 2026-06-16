// Render a min-5-suppressible aggregate value. Suppressed (1..4 population) → the
// N/D label (k-anonymity, Wave 2.5 slice 6). 0 is a real value (empty, not sensitive).
// null/undefined with no suppression = not-yet-loaded → an em-dash placeholder.

// Em-dash shown when a value is absent / not yet loaded (not suppressed, not 0).
// A presentational glyph, not translatable i18n copy — named so the magic
// character is discoverable from call sites.
export const PLACEHOLDER = '—';

export function suppressedValue(
  value: number | null | undefined,
  suppressed: boolean,
  ndLabel: string,
): string {
  if (suppressed) return ndLabel;
  return value == null ? PLACEHOLDER : String(value);
}
