'use client';

import { pluralize, useI18n } from '../../../../../lib/i18n';
import { ProgressBar } from '../../../../../components';
import type { VacancyDetail } from '../../../../../lib/trpc-types';

interface SlaCardProps {
  vacancy: VacancyDetail;
}

export function SlaCard({ vacancy }: SlaCardProps) {
  const { t, locale } = useI18n();

  const settings = vacancy.settings as { slaTargetDays?: number } | null;
  const slaTarget = settings?.slaTargetDays ?? 30;
  const createdDate = new Date(vacancy.createdAt);
  const now = new Date();
  const daysElapsed = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
  const isOverdue = daysElapsed > slaTarget;
  const daysRemaining = Math.max(slaTarget - daysElapsed, 0);

  return (
    <section aria-labelledby="vacancy-sla-title" className="rounded-xl border border-border bg-white p-5 shadow-card">
      <h2 id="vacancy-sla-title" className="mb-3 text-heading font-semibold text-brand">
        {t.vacancies.slaAndTimeline}
      </h2>
      <div className="mb-4 flex gap-3">
        <div
          className={`flex-1 rounded-lg p-3 text-center ${isOverdue ? 'border border-danger/30 bg-danger-bg' : 'bg-surface'}`}
        >
          <p className="text-caption text-secondary">{t.vacancies.daysElapsed}</p>
          <p className={`text-2xl font-semibold tabular-nums ${isOverdue ? 'text-danger' : 'text-brand'}`}>
            {daysElapsed}
          </p>
          <p className="text-caption text-secondary">
            SLA: {slaTarget} {t.vacancies.days}
          </p>
          {/* Overdue is said in words, with an icon, never by the red alone (color.md › Inclusive color). */}
          {isOverdue && (
            <p className="mt-1 inline-flex items-center gap-1 text-callout font-medium text-danger">
              <svg
                className="size-3 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 7v6m0 4h.01" strokeLinecap="round" />
              </svg>
              {pluralize(
                daysElapsed - slaTarget,
                { one: t.vacancies.slaOverdueOne, other: t.vacancies.slaOverdueMany },
                locale,
              )}
            </p>
          )}
        </div>
        <div className="flex-1 rounded-lg bg-surface p-3 text-center">
          <p className="text-caption text-secondary">{t.vacancies.daysRemaining}</p>
          <p className="text-2xl font-semibold tabular-nums text-brand">{daysRemaining}</p>
          <p className="text-caption text-secondary">
            {t.vacancies.positions}: {vacancy.positions}
          </p>
        </div>
      </div>

      <ProgressBar
        value={Math.min(daysElapsed, slaTarget)}
        max={slaTarget}
        label={t.vacancies.slaProgress}
        valueText={`${daysElapsed} / ${slaTarget} ${t.vacancies.days}`}
        tone={isOverdue ? 'danger' : 'success'}
      />
    </section>
  );
}
