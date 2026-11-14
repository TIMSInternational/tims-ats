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
      className="w-full rounded-xl bg-white p-5 shadow-card md:flex-[35]"
    >
      <h2 id="open-vacancies-card-title" className="mb-3 text-heading font-semibold text-brand">
        {rd.openVacancies}
      </h2>
      {/* A plain numeral: a full ring around any value read as a complete gauge, even at 0. */}
      <div className="flex flex-col items-center py-4">
        <span
          data-testid="open-vacancies-total"
          className="font-display text-display font-bold tabular-nums text-primary"
        >
          {totalOpen}
        </span>
        <span className="mt-1 text-callout text-secondary">{rd.totalVacancies}</span>
      </div>
    </section>
  );
}

export function OpenVacanciesCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="w-full animate-pulse rounded-xl bg-white p-5 shadow-card motion-reduce:animate-none md:flex-[35]"
    >
      <div className="mb-3 h-5 w-40 rounded bg-gray-200" />
      <div className="flex flex-col items-center gap-2 py-4">
        <div className="h-9 w-12 rounded bg-gray-200" />
        <div className="h-3 w-24 rounded bg-gray-200" />
      </div>
    </div>
  );
}
