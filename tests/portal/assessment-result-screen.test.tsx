import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { AssessmentResultScreen } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/assessments/[assignmentId]/_components/assessment-result-screen';

function renderResult(props: React.ComponentProps<typeof AssessmentResultScreen>) {
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <AssessmentResultScreen {...props} />
    </I18nProvider>,
  );
}

describe('AssessmentResultScreen', () => {
  it('renders the rounded score', () => {
    renderResult({ normalizedScore: 82.4, hasPending: false });
    expect(screen.getByText(/82%/)).toBeInTheDocument();
  });

  it('renders the pending-review notice honestly when hasPending is true', () => {
    renderResult({ normalizedScore: 50, hasPending: true });
    expect(screen.getByText(en.assessmentPlayer.resultPendingNotice)).toBeInTheDocument();
  });

  it('does not render the pending-review notice when hasPending is false', () => {
    renderResult({ normalizedScore: 100, hasPending: false });
    expect(screen.queryByText(en.assessmentPlayer.resultPendingNotice)).not.toBeInTheDocument();
  });

  it('never fabricates a score when normalizedScore is null (all-essay, nothing auto-graded yet)', () => {
    renderResult({ normalizedScore: null, hasPending: true });
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText(en.assessmentPlayer.resultPendingNotice)).toBeInTheDocument();
  });
});
