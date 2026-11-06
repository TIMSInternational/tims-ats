import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import { APPLICATION_CONSENT_TEXT_VERSION } from '../../packages/shared/src/constants/application-consent';

// The candidate privacy notice and the staff data-requests queue cited Colombia's Ley 1581 de 2012 and the
// SIC for EVERY organization, while pilot companies are in Costa Rica and Guatemala. Until each country's
// counsel-approved text exists, the copy names no law, no authority and no legal deadline.
const COUNTRY_LAW = /Ley\s|\bLaw\b|1581|Colombia|Superintenden|Industria y Comercio|Industry and Commerce/;

describe('country-neutral legal copy', () => {
  it.each([
    ['es', es],
    ['en', en],
  ] as const)('%s: the privacy notice and the data-requests queue cite no specific law', (_locale, dict) => {
    for (const [key, text] of Object.entries(dict.portalPrivacy)) {
      expect(`${key}: ${text}`).not.toMatch(COUNTRY_LAW);
    }
    expect(dict.dataSubjectRequests.subtitle).not.toMatch(COUNTRY_LAW);
    expect(dict.dataSubjectRequests.dueDateNote).not.toMatch(COUNTRY_LAW);
  });

  it('still tells the candidate their rights and where to exercise them', () => {
    expect(es.portalPrivacy.rightsBody).toContain('legislación de protección de datos aplicable');
    expect(es.portalPrivacy.rightsBody).toMatch(/acceso.*rectificación.*supresión.*retirar/);
    expect(es.portalPrivacy.rightsBody).toContain('comuníquese con la organización');
    expect(en.portalPrivacy.rightsBody).toContain('applicable data protection law');
  });

  it('presents the computed due date as an estimate, never as the legal deadline', () => {
    expect(es.dataSubjectRequests.dueDateNote).toContain('No es un plazo legal');
    expect(en.dataSubjectRequests.dueDateNote).toContain('not a legal deadline');
  });

  // The consent version identifies the sentence AND the notice it links to (application-consent.ts).
  it('versions the notice change: new applications record a new consent text version', () => {
    expect(APPLICATION_CONSENT_TEXT_VERSION).not.toBe('portal-apply-2026-09-29');
  });
});
