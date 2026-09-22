import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { LearningKpis } from '../../apps/web/app/(admin)/learning/learning-kpis';
import { LearningPathsPanel } from '../../apps/web/app/(admin)/learning/learning-paths-panel';
import { CourseCatalog } from '../../apps/web/app/(admin)/learning/course-catalog';

describe('Learning dashboard data integrity', () => {
  it('shows only measured KPI values for an empty organization', () => {
    const { container } = render(
      <LearningKpis
        data={{ totalCourses: 0, totalEnrollments: 0, avgProgress: 0, totalCertificates: 0, totalPaths: 0 }}
        loading={false}
        t={en.learning}
      />,
    );

    expect(screen.getByText(en.learning.kpiAvgProgress).parentElement).toHaveTextContent('0%');
    expect(screen.getByText(en.learning.kpiEnrollments).parentElement).toHaveTextContent('0');
    expect(container).not.toHaveTextContent(/\+6|\+18|\+22|31%/);
    expect(container).not.toHaveTextContent(en.learning.kpiGapReduction);
  });

  it('renders average progress as a percentage, not training hours', () => {
    render(
      <LearningKpis
        data={{ totalCourses: 2, totalEnrollments: 4, avgProgress: 37.5, totalCertificates: 1, totalPaths: 1 }}
        loading={false}
        t={en.learning}
      />,
    );

    expect(screen.getByText(en.learning.kpiAvgProgress).parentElement).toHaveTextContent('37.5%');
  });

  it('does not invent paths or assignment progress when none exist', () => {
    const { rerender, container } = render(<LearningPathsPanel paths={[]} loading={false} t={en.learning} />);
    expect(screen.getByText(en.learning.noPaths)).toBeInTheDocument();
    expect(container).not.toHaveTextContent('Liderazgo Operacional');

    rerender(
      <LearningPathsPanel
        paths={[{ id: 'path-1', name: 'Safety', courses: [{ id: 'course-1' }] }]}
        loading={false}
        t={en.learning}
      />,
    );
    expect(screen.getByText('Safety')).toBeInTheDocument();
    expect(container).toHaveTextContent('1 courses');
    expect(container).not.toHaveTextContent(en.learning.peopleAssigned);
  });

  it('shows an honest empty course catalog', () => {
    render(
      <I18nProvider>
        <CourseCatalog courses={[]} loading={false} t={en.learning} />
      </I18nProvider>,
    );
    expect(screen.getByText(en.learning.noCourses)).toBeInTheDocument();
    expect(screen.getByText(en.learning.noCoursesDesc)).toBeInTheDocument();
  });
});
