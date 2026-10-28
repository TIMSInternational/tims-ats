import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));

import { ApplyModalStep1 } from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal-step1';

const noop = () => undefined;

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
    expect((screen.getByLabelText(p.firstNameLabel) as HTMLInputElement).value).toBe('Ana');
    expect((screen.getByLabelText(p.lastNameLabel) as HTMLInputElement).value).toBe('Pérez');
    expect((screen.getByLabelText(p.emailLabel) as HTMLInputElement).value).toBe('ana@example.com');
    expect((screen.getByLabelText(p.phoneLabel) as HTMLInputElement).value).toBe('123');
    expect((screen.getByLabelText(p.locationLabel) as HTMLInputElement).value).toBe('Lima');
  });
});

vi.mock('../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/cv-upload-field', () => ({
  CvUploadField: () => null,
}));

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
    expect((screen.getByLabelText(p.currentTitleLabel) as HTMLInputElement).value).toBe('Dev');
    expect((screen.getByLabelText(p.currentCompanyLabel) as HTMLInputElement).value).toBe('Acme');
    expect(screen.getByLabelText(p.yearsExpLabel).tagName).toBe('SELECT');
    expect((screen.getByLabelText('LinkedIn') as HTMLInputElement).value).toBe('https://linkedin.com/in/ana');
    expect((screen.getByLabelText(p.coverLetterLabel) as HTMLTextAreaElement).value).toBe('Hola');
  });
});
