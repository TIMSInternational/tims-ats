import React from 'react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import {
  ACTIVE_APPLICATION_CONSENT_VARIANT,
  APPLICATION_CONSENT_TEXT,
  APPLICATION_CONSENT_TEXTS,
  APPLICATION_CONSENT_TEXT_VERSION,
  APPLICATION_CONSENT_VERSIONS,
  LEY_8968_NOTICE_TEXT_FINAL,
  renderApplicationConsentText,
  resolveApplicationConsentVariant,
} from '../../packages/shared/src/constants/application-consent';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { PrivacyNoticeLey8968 } from '../../apps/web/app/(portal)/careers/[orgSlug]/privacy/privacy-notice-ley-8968';

// The Costa Rica (Ley N.° 8968) consent sentence and candidate notice are a second, versioned variant next to
// the country-neutral default. They stay OFF until (1) the approved text replaces the draft — undecided values
// are [PENDIENTE: …] markers — and LEY_8968_NOTICE_TEXT_FINAL is set, and (2) the operator sets
// NEXT_PUBLIC_LEY_8968_NOTICE_ENABLED=true. Neither alone publishes anything.

const catalogues = { es, en } as const;
const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');
const MARKER = /\[PENDIENTE: [^\]]+\]/g;

function ley8968Copy(locale: keyof typeof catalogues): string {
  const c = catalogues[locale];
  return JSON.stringify([c.portalLey8968Consent, c.portalPrivacyLey8968, c.dataSubjectRequestsLey8968]);
}

beforeEach(() => localStorage.clear());

describe('Ley N.° 8968 notice', () => {
  it.each(['ES', 'EN'] as const)('%s: renders every section, naming the organization', async (locale) => {
    localStorage.setItem('tims-locale', locale);
    const pp = catalogues[locale === 'ES' ? 'es' : 'en'].portalPrivacyLey8968;
    render(
      <I18nProvider>
        <PrivacyNoticeLey8968 orgName="Acme S.A." orgSlug="acme" contactEmail="privacidad@acme.example" />
      </I18nProvider>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: pp.title })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      pp.controllerHeading,
      pp.dataHeading,
      pp.purposeHeading,
      pp.aiHeading,
      pp.transferHeading,
      pp.retentionHeading,
      pp.rightsHeading,
      pp.exerciseHeading,
    ]);
    for (const body of [pp.aiBody, pp.transferBody, pp.retentionBody, pp.rightsBody]) {
      expect(screen.getByText(body)).toBeTruthy();
    }
    const exercise = screen.getByRole('heading', { level: 2, name: pp.exerciseHeading }).closest('section');
    expect(exercise?.textContent).toContain(pp.exerciseBody.replace('{email}', 'privacidad@acme.example'));
    expect(screen.getAllByText('Acme S.A.').length).toBeGreaterThan(0);
  });

  // The notice is shared by every organization: a mailbox typed into the catalogue would show on every
  // tenant's notice. The contact is interpolated per organization instead (see privacy-contact-per-org.test).
  it.each(['es', 'en'] as const)('%s: the shared text names no mailbox; the contact is a {email} slot', (locale) => {
    const pp = catalogues[locale].portalPrivacyLey8968;
    expect(JSON.stringify(pp)).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(pp.exerciseBody.split('{email}')).toHaveLength(2);
    expect(pp.exerciseBodyNoContact).not.toMatch(/\{email\}|@/);
  });

  it.each(['es', 'en'] as const)('%s: cites Ley N.° 8968 and PRODHAB, never Colombian law', (locale) => {
    const copy = ley8968Copy(locale);
    expect(copy).toMatch(/8968/);
    expect(catalogues[locale].portalPrivacyLey8968.rightsBody).toMatch(/PRODHAB/);
    expect(copy).not.toMatch(/1581|1377|Superintenden|Industria y Comercio|Industry and Commerce|Colombia/i);
    expect(copy).not.toMatch(/15 días hábiles|15 business days/);
  });

  it('es: the notice and the consent sentence address the candidate as usted, never tú', () => {
    expect(JSON.stringify([es.portalPrivacyLey8968, es.portalLey8968Consent])).not.toMatch(
      /\b(tú|tu|tus|te|ti|puedes|debes|quieres|entregas|adjuntas|eres|postulaste|recarga|intenta|espera|escribe)\b/i,
    );
    expect(JSON.stringify(es.portalPrivacyLey8968)).not.toMatch(/\baplicaci[oó]n\b/i);
  });
});

describe('publishing guard', () => {
  const markers = (locale: keyof typeof catalogues) => ley8968Copy(locale).match(MARKER) ?? [];

  // Delete the markers only with the approved text, and set LEY_8968_NOTICE_TEXT_FINAL in the same change.
  it('LEY_8968_NOTICE_TEXT_FINAL is true exactly when no [PENDIENTE: …] marker remains (es and en)', () => {
    const hasMarkers = markers('es').length + markers('en').length > 0;
    expect(LEY_8968_NOTICE_TEXT_FINAL).toBe(!hasMarkers);
  });

  it('while the draft is not final, the flag alone publishes nothing', () => {
    expect(resolveApplicationConsentVariant('true', false)).toBe('default');
  });

  it('with the final text, only the exact string "true" turns the variant on', () => {
    expect(resolveApplicationConsentVariant('true', true)).toBe('ley8968');
    for (const value of [undefined, '', 'false', '1', 'TRUE', ' true', 'yes']) {
      expect(resolveApplicationConsentVariant(value, true), String(value)).toBe('default');
    }
  });

  it('this build (flag unset) shows the default variant', () => {
    expect(ACTIVE_APPLICATION_CONSENT_VARIANT).toBe('default');
    expect(APPLICATION_CONSENT_TEXT_VERSION).toBe('portal-apply-2026-11-06');
    expect(APPLICATION_CONSENT_TEXT).toBe(APPLICATION_CONSENT_TEXTS.default);
  });
});

describe('application consent versions', () => {
  // Stored evidence names the text by version: a version's wording must never change in place. The default
  // version is the one candidates accept today; the Ley 8968 draft may change until it is first published,
  // and then needs a new version id for any change (update both pins deliberately, never one silently).
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
  const PINNED: Record<string, string> = {
    // The digest of origin/main's APPLICATION_CONSENT_TEXT before the Ley 8968 variant existed.
    'portal-apply-2026-11-06': 'b9b47aa5b4d77347953ed07740d782d1b1201d26f39f65a31161e955d4baf155',
    'portal-apply-2026-11-cr': '77b2b1210802383723e24609ce8750f85526dc339ae6523490f166e1b18280e0',
  };

  it.each(['default', 'ley8968'] as const)('%s: the wording is the one pinned to its version', (variant) => {
    expect(digest(APPLICATION_CONSENT_TEXTS[variant])).toBe(PINNED[APPLICATION_CONSENT_VERSIONS[variant]]);
  });

  it('the two variants have different versions and different sentences', () => {
    expect(APPLICATION_CONSENT_VERSIONS.default).not.toBe(APPLICATION_CONSENT_VERSIONS.ley8968);
    expect(renderApplicationConsentText('es', 'Acme', 'ley8968')).not.toBe(
      renderApplicationConsentText('es', 'Acme', 'default'),
    );
  });

  it.each(['es', 'en'] as const)('%s: the Ley 8968 server copy equals the portalLey8968Consent strings', (locale) => {
    expect(APPLICATION_CONSENT_TEXTS.ley8968[locale]).toEqual(catalogues[locale].portalLey8968Consent);
  });
});

describe('response deadline: staff reminder matches the Ley 8968 notice', () => {
  const WORDS: Record<number, string> = { 3: 'tres', 5: 'cinco', 10: 'diez', 15: 'quince' };
  const WORDS_EN: Record<number, string> = { 3: 'three', 5: 'five', 10: 'ten', 15: 'fifteen' };

  it('the C# Ley8968 deadline equals the response time the notice and the staff note state', () => {
    const source = read('services/Tims.Platform/src/Tims.Application/CandidateConsent/DataSubjectRequestDeadline.cs');
    const match = /Ley8968 = new\((\d+), CostaRicaOffset/.exec(source);
    expect(match).not.toBeNull();
    const days = Number(match?.[1]);
    expect(es.portalPrivacyLey8968.exerciseBody).toContain(`${WORDS[days]} días hábiles`);
    expect(es.portalPrivacyLey8968.exerciseBodyNoContact).toContain(`${WORDS[days]} días hábiles`);
    expect(en.portalPrivacyLey8968.exerciseBody).toContain(`${WORDS_EN[days]} business days`);
    expect(en.portalPrivacyLey8968.exerciseBodyNoContact).toContain(`${WORDS_EN[days]} business days`);
    expect(es.dataSubjectRequestsLey8968.dueDateNote).toContain(`${days} días hábiles`);
    expect(en.dataSubjectRequestsLey8968.dueDateNote).toContain(`${days} business days`);
  });
});
