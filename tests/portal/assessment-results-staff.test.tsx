import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { AssessmentResults } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/assessment-results';

function renderResults(props: React.ComponentProps<typeof AssessmentResults>) {
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <AssessmentResults {...props} />
    </I18nProvider>,
  );
}

describe('AssessmentResults staff surfacing — norm band', () => {
  it('shows the band label next to the score when present', () => {
    renderResults({
      assignments: [
        {
          id: 'a1',
          status: 'completed',
          assignedAt: new Date(),
          completedAt: new Date(),
          assessmentType: { id: 't1', name: 'Logic Test', code: 'logic' },
          result: { id: 'r1', normalizedScore: 80, band: 'above_average', percentile: 66.7, normSampleSize: 12 },
        },
      ],
      fitScores: [],
    });
    expect(screen.getByText(en.assessmentPlayer.bandLabels.above_average)).toBeInTheDocument();
  });

  it('renders no band label when band is null (no norm data yet)', () => {
    renderResults({
      assignments: [
        {
          id: 'a1',
          status: 'completed',
          assignedAt: new Date(),
          completedAt: new Date(),
          assessmentType: { id: 't1', name: 'Logic Test', code: 'logic' },
          result: { id: 'r1', normalizedScore: 80, band: null, percentile: null, normSampleSize: 2 },
        },
      ],
      fitScores: [],
    });
    expect(screen.queryByText(en.assessmentPlayer.bandLabels.above_average)).not.toBeInTheDocument();
    expect(screen.queryByText(en.assessmentPlayer.bandLabels.below_average)).not.toBeInTheDocument();
  });
});
