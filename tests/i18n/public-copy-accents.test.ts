import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';

// Candidate-facing and sign-in copy is the first thing a new company's applicants see.
// These unaccented spellings all shipped once; keep them out of the public sections.
const MISSPELLINGS =
  /\b(ano|anos|contrasena|contrasenas|sesion|aplicacion|seleccion|ubicacion|busqueda|informacion|confirmacion|dias|traves|cientificas|postulacion|revisara|contactara|maximo|limite|hibrido|telefono|aplico)\b/i;

function strings(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => strings(child, `${path}.${key}`));
  }
  return [];
}

describe('public Spanish copy', () => {
  it.each(['auth', 'portal', 'portalAuth', 'portalDashboard'] as const)(
    '%s has no unaccented misspellings',
    (section) => {
      const offenders = strings(es[section], section).filter(([, text]) => MISSPELLINGS.test(text));
      expect(offenders).toEqual([]);
    },
  );

  it('opens Spanish questions with ¿', () => {
    const questions = [...strings(es.auth, 'auth'), ...strings(es.portalDashboard, 'portalDashboard')].filter(
      ([, text]) => text.trim().endsWith('?') && !text.includes('¿'),
    );
    expect(questions).toEqual([]);
  });
});
