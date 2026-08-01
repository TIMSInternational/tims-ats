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
    renderResult({ normalizedScore: 82.4, hasPending: false, band: null, percentile: null, normSampleSize: null });
    expect(screen.getByText(/82%/)).toBeInTheDocument();
  });

  it('renders the pending-review notice honestly when hasPending is true', () => {
    renderResult({ normalizedScore: 50, hasPending: true, band: null, percentile: null, normSampleSize: null });
    expect(screen.getByText(en.assessmentPlayer.resultPendingNotice)).toBeInTheDocument();
  });

  it('does not render the pending-review notice when hasPending is false', () => {
    renderResult({ normalizedScore: 100, hasPending: false, band: null, percentile: null, normSampleSize: null });
    expect(screen.queryByText(en.assessmentPlayer.resultPendingNotice)).not.toBeInTheDocument();
  });

  it('never fabricates a score when normalizedScore is null (all-essay, nothing auto-graded yet)', () => {
    renderResult({ normalizedScore: null, hasPending: true, band: null, percentile: null, normSampleSize: null });
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText(en.assessmentPlayer.resultPendingNotice)).toBeInTheDocument();
  });

  it('shows the band label and percentile when both are present', () => {
    renderResult({
      normalizedScore: 80,
      hasPending: false,
      band: 'above_average',
      percentile: 66.7,
      normSampleSize: 12,
    });
    expect(screen.getByText(en.assessmentPlayer.bandLabels.above_average)).toBeInTheDocument();
    expect(screen.getByText(/67/)).toBeInTheDocument(); // Math.round(66.7) = 67
  });

  it('shows the "not enough data" message when band is null but the result is non-partial', () => {
    renderResult({ normalizedScore: 80, hasPending: false, band: null, percentile: null, normSampleSize: 2 });
    expect(screen.getByText(en.assessmentPlayer.resultNoNormData)).toBeInTheDocument();
  });

  it('shows no band/percentile/no-data UI at all when hasPending is true (partial result)', () => {
    renderResult({ normalizedScore: 80, hasPending: true, band: null, percentile: null, normSampleSize: null });
    expect(screen.queryByText(en.assessmentPlayer.resultNoNormData)).not.toBeInTheDocument();
    expect(screen.queryByText(en.assessmentPlayer.bandLabels.above_average)).not.toBeInTheDocument();
  });
});
