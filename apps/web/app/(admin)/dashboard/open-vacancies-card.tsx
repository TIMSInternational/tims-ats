'use client';

import { useI18n } from '../../../lib/i18n';

interface OpenVacanciesCardProps {
  totalOpen: number;
}

/**
 * Shows the organization's real count of open vacancies, as reported by
 * `vacancy.getDashboardKpis`. It deliberately renders no per-dimension
 * breakdown: there is no endpoint that groups vacancies by country, city,
 * unit or leader yet, and the card must never show figures it cannot source.
 */
export function OpenVacanciesCard({ totalOpen }: OpenVacanciesCardProps) {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  return (
    <section
      aria-labelledby="open-vacancies-card-title"
      className="w-full md:flex-[35] bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
    >
      <h2 id="open-vacancies-card-title" className="text-base font-semibold text-[#1F114C] mb-3">
        {rd.openVacancies}
      </h2>
      <div className="flex flex-col items-center py-4">
        <div className="w-[120px] h-[120px] rounded-full border-[16px] border-[#1F114C] flex items-center justify-center">
          <span data-testid="open-vacancies-total" className="text-xl font-bold text-[#1F114C]">
            {totalOpen}
          </span>
        </div>
        <span className="text-[11px] text-[#585858] mt-2">{rd.totalVacancies}</span>
      </div>
    </section>
  );
}

export function OpenVacanciesCardSkeleton() {
  return (
    <div className="w-full md:flex-[35] bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)] animate-pulse">
      <div className="h-5 w-40 bg-gray-200 rounded mb-3" />
      <div className="flex justify-center py-4">
        <div className="w-[120px] h-[120px] rounded-full bg-gray-200" />
      </div>
    </div>
  );
}
