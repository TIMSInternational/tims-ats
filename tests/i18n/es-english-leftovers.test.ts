import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';

// Pilot copy audit: Spanish staff navigation showed English module names ("Talent Pool", "Analytics",
// "Talent", "Agregar a Pool", "Tipo de Pool", candidate type "Plata"). Brand terms (FIT Score, Pipeline,
// LinkedIn) are deliberate and out of scope.
const LEFTOVER = /\b(Analytics|Talent|Pool|Pools|Silver|Plata|Score Promedio)\b/;

function strings(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => strings(child, `${path}.${key}`));
  }
  return [];
}

describe('Spanish staff navigation and labels carry no English module names', () => {
  it.each(['sidebar', 'platformSidebar', 'breadcrumbs', 'talentPool', 'candidates', 'succession', 'teamIntel', 'analytics', 'dei', 'interviews'] as const)(
    '%s',
    (section) => {
      const offenders = strings(es[section], section).filter(([, text]) => LEFTOVER.test(text));
      expect(offenders).toEqual([]);
    },
  );
});
