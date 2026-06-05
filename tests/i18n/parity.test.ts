import { describe, it, expect } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

// Guards against i18n drift: every key present in one locale must exist in the
// other (so no string silently falls back to the wrong language). Structure must
// match exactly — same nested key paths in es and en.

function keyPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('i18n es/en parity', () => {
  const esKeys = new Set(keyPaths(es));
  const enKeys = new Set(keyPaths(en));

  it('every es key exists in en', () => {
    expect([...esKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it('every en key exists in es', () => {
    expect([...enKeys].filter((k) => !esKeys.has(k))).toEqual([]);
  });

  it('has the dei module group in both locales', () => {
    expect(esKeys.has('dei.kpiGenderRatio')).toBe(true);
    expect(enKeys.has('dei.kpiGenderRatio')).toBe(true);
  });
});
