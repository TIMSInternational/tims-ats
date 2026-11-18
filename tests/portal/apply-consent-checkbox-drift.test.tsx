import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { renderApplicationConsentText } from '../../packages/shared/src/constants/application-consent';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { ApplyConsentCheckbox } from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-consent-checkbox';

// #313: the server hashes renderApplicationConsentText(locale, controller) as the text the candidate was SHOWN.
// This renders the real checkbox and compares its label's textContent, so markup changes (spacing, an extra
// element) that alter what the candidate reads fail here — not only i18n string drift.

beforeEach(() => localStorage.clear());

describe.each(['ES', 'EN'] as const)('apply consent checkbox (%s)', (locale) => {
  // The Ley N.° 8968 variant (off by default) has its own versioned sentence; it must match its server copy too.
  it('reads exactly the Ley 8968 sentence when that variant is shown', async () => {
    localStorage.setItem('tims-locale', locale);
    const { container, findByRole } = render(
      <I18nProvider>
        <ApplyConsentCheckbox
          controllerName="Acme S.A."
          privacyHref="/careers/acme/privacy"
          checked
          onChange={() => {}}
          disabled={false}
          variant="ley8968"
        />
      </I18nProvider>,
    );
    await findByRole('checkbox');
    const label = container.querySelector('label span');
    const expected = renderApplicationConsentText(locale === 'ES' ? 'es' : 'en', 'Acme S.A.', 'ley8968');
    await expect.poll(() => label?.textContent).toBe(expected);
  });

  it('reads exactly the canonical sentence the server hashes', async () => {
    localStorage.setItem('tims-locale', locale);
    const { container, findByRole } = render(
      <I18nProvider>
        <ApplyConsentCheckbox controllerName="Acme S.A.S." privacyHref="/careers/acme/privacy" checked onChange={() => {}} disabled={false} />
      </I18nProvider>,
    );
    await findByRole('checkbox');
    const label = container.querySelector('label span');
    const expected = renderApplicationConsentText(locale === 'ES' ? 'es' : 'en', 'Acme S.A.S.');
    await expect.poll(() => label?.textContent).toBe(expected);
  });
});
