import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));

import { ApplyModalStep1 } from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal-step1';

const noop = () => undefined;
/** The visible label of an optional field: "Phone (optional)". */
const optional = (label: string) => `${label} (${en.common.optional})`;

describe('apply form step 1 accessibility', () => {
  it('associates every visible label with its input', () => {
    render(
      <ApplyModalStep1
        firstName="Ana"
        setFirstName={noop}
        lastName="Pérez"
        setLastName={noop}
        email="ana@example.com"
        setEmail={noop}
        phone="123"
        setPhone={noop}
        location="Lima"
        setLocation={noop}
      />,
    );
    const p = en.portal;
    // The three required fields carry `required` (no "*" read aloud); the two optional ones say "(optional)".
    for (const [label, value] of [[p.firstNameLabel, 'Ana'], [p.lastNameLabel, 'Pérez'], [p.emailLabel, 'ana@example.com']] as const) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.value).toBe(value);
      expect(input).toBeRequired();
    }
    expect((screen.getByLabelText(optional(p.phoneLabel)) as HTMLInputElement).value).toBe('123');
    expect((screen.getByLabelText(optional(p.locationLabel)) as HTMLInputElement).value).toBe('Lima');
    expect(screen.getByLabelText(optional(p.phoneLabel))).not.toBeRequired();
  });
});

import { ApplyModalStep2 } from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal-step2';

describe('apply form step 2 accessibility', () => {
  it('associates every visible label with its control', () => {
    render(
      <ApplyModalStep2
        currentTitle="Dev"
        setCurrentTitle={noop}
        currentCompany="Acme"
        setCurrentCompany={noop}
        yearsExperience=""
        setYearsExperience={noop}
        linkedinUrl="https://linkedin.com/in/ana"
        setLinkedinUrl={noop}
        coverLetter="Hola"
        setCoverLetter={noop}
        cvFile={null}
        cvError={null}
        cvUploading={false}
        onCvFileChange={noop}
        onCvRemove={noop}
      />,
    );
    const p = en.portal;
    // Every step-2 field is optional, and its label says so.
    expect((screen.getByLabelText(optional(p.currentTitleLabel)) as HTMLInputElement).value).toBe('Dev');
    expect((screen.getByLabelText(optional(p.currentCompanyLabel)) as HTMLInputElement).value).toBe('Acme');
    expect(screen.getByLabelText(optional(p.yearsExpLabel)).tagName).toBe('SELECT');
    expect((screen.getByLabelText(optional(p.linkedinLabel)) as HTMLInputElement).value).toBe('https://linkedin.com/in/ana');
    expect((screen.getByLabelText(optional(p.coverLetterLabel)) as HTMLTextAreaElement).value).toBe('Hola');
    expect((screen.getByLabelText(p.cvLabel) as HTMLInputElement).type).toBe('file');
  });

  it('names the selected-CV group with the CV label once a file is chosen', () => {
    render(
      <ApplyModalStep2
        currentTitle=""
        setCurrentTitle={noop}
        currentCompany=""
        setCurrentCompany={noop}
        yearsExperience=""
        setYearsExperience={noop}
        linkedinUrl=""
        setLinkedinUrl={noop}
        coverLetter=""
        setCoverLetter={noop}
        cvFile={new File(['x'], 'cv.pdf', { type: 'application/pdf' })}
        cvError={null}
        cvUploading={false}
        onCvFileChange={noop}
        onCvRemove={noop}
      />,
    );
    expect(screen.getByRole('group', { name: en.portal.cvLabel })).toHaveTextContent('cv.pdf');
  });
});
