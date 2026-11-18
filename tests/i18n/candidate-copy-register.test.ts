import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';

// Pilot decision: candidate-facing copy (careers board, apply form, candidate portal, offer signing
// page) addresses the candidate as "usted" and says "postulación/postularse" — never a mix of tú and
// usted, never "aplicación/aplicar". Staff copy is out of scope (it stays tú). The consent checkbox and
// consent-withdrawal texts are owned by the legal work package and are not part of these sections; the
// candidate privacy notice (`portalPrivacy`) is, because it addresses the candidate directly.

const TU_OR_APLICAR =
  /\b(tu|tus|te|ti|contigo|tienes|puedes|debes|quieres|deseas|estás|eres|ingresa|escribe|recarga|intenta|revisa|contacta|cuéntanos|aplicación|aplicaciones|aplicar|aplica|aplicó|aplicaron|aplicaste|postulaste)\b/i;

function strings(value: unknown, path: string): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => strings(child, `${path}.${key}`));
  }
  return [];
}

const LEGAL_KEYS = new Set([
  'consentCheckboxPrefix',
  'consentCheckboxMiddle',
  'consentPolicyLink',
  'consentCheckboxSuffix',
]);
const portal = Object.fromEntries(Object.entries(es.portal).filter(([key]) => !LEGAL_KEYS.has(key)));
const offerSigning = Object.fromEntries(Object.entries(es.offers).filter(([key]) => key.startsWith('sign')));

const CANDIDATE_SECTIONS: Record<string, unknown> = {
  portal,
  portalDashboard: es.portalDashboard,
  portalPrivacy: es.portalPrivacy,
  'offers.sign*': offerSigning,
};

describe('candidate copy register (usted + postulación)', () => {
  it.each(Object.keys(CANDIDATE_SECTIONS))('%s uses usted and "postulación"', (section) => {
    const offenders = strings(CANDIDATE_SECTIONS[section], section).filter(([, text]) => TU_OR_APLICAR.test(text));
    expect(offenders).toEqual([]);
  });

  // Pilot companies are in more than one country (Costa Rica first, then Guatemala): the apply form's
  // examples name no country, city or dialling code.
  it('uses country-neutral examples in the apply form', () => {
    expect(es.portal.cityCountryPlaceholder).toBe('Ciudad, país');
    expect(es.portal.phonePlaceholder).toBe('Código de país y número');
    expect(JSON.stringify(es.portal)).not.toMatch(/San José|Costa Rica|Bogot|Colombia|\+\d/);
  });
});
