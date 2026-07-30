import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { AssessmentBackLink } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-back-link';

function renderLink(orgSlug: string) {
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <AssessmentBackLink orgSlug={orgSlug} />
    </I18nProvider>,
  );
}

describe('AssessmentBackLink', () => {
  it('renders a translated link to the org-scoped dashboard route', () => {
    renderLink('tims');
    const link = screen.getByRole('link', { name: en.assessmentPlayer.backToDashboard });
    expect(link).toHaveAttribute('href', '/careers/tims/dashboard');
  });

  it('scopes the href to whichever orgSlug is passed', () => {
    renderLink('acme');
    expect(screen.getByRole('link')).toHaveAttribute('href', '/careers/acme/dashboard');
  });
});
