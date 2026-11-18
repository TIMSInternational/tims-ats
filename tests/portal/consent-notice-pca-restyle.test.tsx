import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The candidate's full-text sheet shows the ATS notice through the SHARED AssessmentConsentNotice (one versioned legal
// text for the staff dialog and the portal), restyled for the PCA sheet by CONSENT_NOTICE_CLASSES' descendant selectors
// (provider-consent-styles.ts). Those selectors only cover the classes and the shape the shared component has today. If
// this test fails, the shared component changed: check the candidate sheet still reads in the PCA look and update
// CONSENT_NOTICE_CLASSES with it, then this list.

vi.mock('../../apps/web/lib/i18n', async (original) => {
  const { default: en } = await import('../../apps/web/lib/i18n/en.json');
  return {
    ...(await original<typeof import('../../apps/web/lib/i18n')>()),
    useI18n: () => ({ t: en, locale: 'EN' }),
  };
});

import { AssessmentConsentNotice } from '../../apps/web/components/assessment-consent-notice';
import { CONSENT_NOTICE_CLASSES } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-consent-styles';

/** Every class the untitled notice carries, all of which the candidate sheet's restyle accounts for. */
const RESTYLED_CLASSES = [
  'font-semibold',
  'leading-relaxed',
  'list-disc',
  'max-w-prose',
  'pl-5',
  'sm:text-body',
  'space-y-2',
  'text-base',
  'text-caption',
  'text-primary',
  'text-secondary',
  'text-subheading',
];

describe('the shared ATS notice inside the candidate PCA sheet', () => {
  it('still has the classes and the shape CONSENT_NOTICE_CLASSES restyles', () => {
    render(
      <div className={CONSENT_NOTICE_CLASSES}>
        <AssessmentConsentNotice orgName="Acme" vacancyTitle="Analyst" instruments={['LIA']} titled={false} />
      </div>,
    );
    const notice = screen.getByTestId('assessment-consent-notice');
    expect(notice.tagName).toBe('SECTION');

    const classes = new Set<string>();
    for (const el of [notice, ...notice.querySelectorAll('*')]) el.classList.forEach((c) => classes.add(c));
    expect([...classes].sort()).toEqual(RESTYLED_CLASSES);

    // [&_h3] restyles every heading; [&_section>div] spaces the three sections; [&_section>p:last-child] is the version.
    expect(notice.querySelectorAll('h3')).toHaveLength(4);
    expect(notice.querySelectorAll(':scope > div > h3')).toHaveLength(3);
    const version = notice.lastElementChild;
    expect(version?.tagName).toBe('P');
    expect(version?.className).toBe('text-caption text-secondary');
  });

  it('the restyle names the parts it overrides', () => {
    for (const selector of ['[&_section]:', '[&_h3]:', '[&_section>div]:', '[&_section>p:last-child]:']) {
      expect(CONSENT_NOTICE_CLASSES, selector).toContain(selector);
    }
  });
});
