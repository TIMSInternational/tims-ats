'use client';

import { useI18n } from '../../../../../lib/i18n';
import { useCan } from '../../../../../lib/permissions';
import { useVacancyAssessments } from '../../../../../lib/platform-api/vacancy-assessments';
import {
  isProviderAssessmentsStaffEnabled,
  useProviderCatalog,
} from '../../../../../lib/platform-api/assessment-providers-staff';
import { VacancyAssessmentsForm } from './vacancy-assessments-form';
import { ErrorState, Skeleton } from '../../../../../components';

// The editor's data: the stored array (with its version) and the assignable catalog, with loading and error states.
export function VacancyAssessmentsPanel({ vacancyId }: { vacancyId: string }) {
  const { t } = useI18n();
  const can = useCan();
  const stored = useVacancyAssessments(vacancyId);
  const catalog = useProviderCatalog(vacancyId);

  const body = () => {
    if (stored.isLoading)
      return (
        <div aria-busy="true" className="space-y-3">
          <span className="sr-only">{t.vacancyAssessments.loading}</span>
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      );
    if (stored.isError || !stored.data) {
      return <ErrorState size="compact" title={t.vacancyAssessments.loadError} onRetry={() => void stored.refetch()} />;
    }
    return (
      <VacancyAssessmentsForm
        // A new stored version (a save, or another editor's change) resets the form to it.
        key={stored.data.version}
        vacancyId={vacancyId}
        stored={stored.data}
        catalog={catalog.data?.connected ? catalog.data.instruments : []}
        catalogState={
          !isProviderAssessmentsStaffEnabled() || (catalog.data && !catalog.data.connected)
            ? 'not_connected'
            : catalog.isError
              ? 'unavailable'
              : 'ok'
        }
        canEdit={can('vacancy', 'update')}
      />
    );
  };

  return (
    <section
      aria-labelledby="vacancy-assessments-title"
      className="rounded-xl bg-white p-4 shadow-card md:p-5"
      data-testid="vacancy-assessments"
    >
      <h3 id="vacancy-assessments-title" className="mb-1 text-subheading font-semibold text-brand">
        {t.vacancyAssessments.title}
      </h3>
      <p className="mb-4 text-callout text-secondary">{t.vacancyAssessments.description}</p>
      {body()}
    </section>
  );
}
