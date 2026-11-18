// Pure message helpers shared by every locale (no React), so node tests can exercise them.

/** Fills `{name}` placeholders: formatMessage('Paso {current} de {total}', { current: 2, total: 3 }). */
export function formatMessage(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}

/** One/other forms chosen by Intl.PluralRules, so "1 día / 2 días" is never hand-rolled per page. */
export interface PluralForms {
  readonly one: string;
  readonly other: string;
}

/**
 * pluralize(n, { one: '{count} día', other: '{count} días' }, 'ES') → "1 día", "2 días".
 * `{count}` in either form is replaced with the number formatted for the locale.
 */
export function pluralize(count: number, forms: PluralForms, locale: 'ES' | 'EN' = 'ES'): string {
  const tag = locale === 'ES' ? 'es' : 'en';
  const form = new Intl.PluralRules(tag).select(count) === 'one' ? forms.one : forms.other;
  return formatMessage(form, { count: new Intl.NumberFormat(tag).format(count) });
}
