import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';

// Candidate-facing and sign-in copy is the first thing a new company's applicants see.
// These unaccented spellings all shipped once; keep them out of the public sections.
// Only words whose unaccented form is not itself correct Spanish belong here — e.g. `esta`
// ("esta evaluación" vs "no está lista") and `tu` (possessive vs pronoun) cannot be listed.
const MISSPELLINGS =
  /\b(ano|anos|contrasena|contrasenas|sesion|aplicacion|seleccion|ubicacion|busqueda|informacion|confirmacion|dias|traves|cientificas|postulacion|revisara|contactara|maximo|limite|hibrido|telefono|aplico|evaluacion|ocurrio|estan|leido|terminos|atras|aqui|podras|dara|proximos|salio|comunicate|asigno|recopilara|politica|proteccion|revision|sera|conversacion|divulgacion|microfono|transcripcion|valido|accion|aceptacion|pondra)\b/i;

function strings(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => strings(child, `${path}.${key}`));
  }
  return [];
}

// The public offer-signing page (/offers/sign/[token]) reads the `offers.sign*` keys; the rest of
// `offers` is staff-side copy.
const offerSigning = Object.fromEntries(Object.entries(es.offers).filter(([key]) => key.startsWith('sign')));

const PUBLIC_SECTIONS: Record<string, unknown> = {
  auth: es.auth,
  portal: es.portal,
  portalAuth: es.portalAuth,
  portalDashboard: es.portalDashboard,
  assessmentPlayer: es.assessmentPlayer,
  aiInterview: es.aiInterview,
  'offers.sign*': offerSigning,
};

describe('public Spanish copy', () => {
  it('covers the offer-signing keys (guard against the filter silently matching nothing)', () => {
    expect(Object.keys(offerSigning).length).toBeGreaterThan(10);
  });

  it.each(Object.keys(PUBLIC_SECTIONS))('%s has no unaccented misspellings', (section) => {
    const offenders = strings(PUBLIC_SECTIONS[section], section).filter(([, text]) => MISSPELLINGS.test(text));
    expect(offenders).toEqual([]);
  });

  it('opens Spanish questions with ¿', () => {
    const questions = Object.entries(PUBLIC_SECTIONS)
      .flatMap(([section, value]) => strings(value, section))
      .filter(([, text]) => text.trim().endsWith('?') && !text.includes('¿'));
    expect(questions).toEqual([]);
  });
});
