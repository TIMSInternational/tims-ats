'use client';

import { useI18n } from '../../../../../lib/i18n';
import { useCan } from '../../../../../lib/permissions';
import { useVacancyAssessments } from '../../../../../lib/platform-api/vacancy-assessments';
import {
  isProviderAssessmentsStaffEnabled,
  useProviderCatalog,
} from '../../../../../lib/platform-api/assessment-providers-staff';
import { VacancyAssessmentsForm } from './vacancy-assessments-form';

// The editor's data: the stored array (with its version) and the assignable catalog, with loading and error states.
export function VacancyAssessmentsPanel({ vacancyId }: { vacancyId: string }) {
  const { t } = useI18n();
  const can = useCan();
  const stored = useVacancyAssessments(vacancyId);
  const catalog = useProviderCatalog(vacancyId);

  const body = () => {
    if (stored.isLoading) return <p className="text-[12px] text-[#8B8B8B]">{t.vacancyAssessments.loading}</p>;
    if (stored.isError || !stored.data) {
      return (
        <p role="alert" className="text-[12px] text-[#B42318]">
          {t.vacancyAssessments.loadError}
        </p>
      );
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
      className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
      data-testid="vacancy-assessments"
    >
      <h3 id="vacancy-assessments-title" className="text-[14px] font-semibold text-[#1F114C] mb-1">
        {t.vacancyAssessments.title}
      </h3>
      <p className="text-[11px] text-[#8B8B8B] mb-4">{t.vacancyAssessments.description}</p>
      {body()}
    </section>
  );
}
