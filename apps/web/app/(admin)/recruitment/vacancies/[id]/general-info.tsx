'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';
import type { VacancyDetail } from '../../../../../lib/trpc-types';
import { MarkdownText } from '../../../../../components/markdown-text';
import {
  enumLabel,
  formatPortalSalary,
  parsePortalSalary,
} from '../../../../(portal)/careers/[orgSlug]/_lib/vacancy-display';
import { positionCountLabel } from '../create-modal.helpers';
import { VACANCY_PRIORITY_DOT } from '../vacancy-status';

interface GeneralInfoProps {
  vacancy: VacancyDetail;
}

export function GeneralInfo({ vacancy: v }: GeneralInfoProps) {
  const { t, locale } = useI18n();

  // Same formatter as the careers portal (#301/#311): currency code + the STORED period only — a salary
  // with no period (seed-demo) or an unknown one shows none instead of a fabricated "/ month".
  const salary = parsePortalSalary(v.salary);
  const salaryText = salary ? formatPortalSalary(salary, locale, t.portal) : '—';

  const remoteLabel = enumLabel(v.remotePolicy, t.portal.remotePolicies);
  const locationText = v.location && remoteLabel ? `${v.location} (${remoteLabel})` : (v.location ?? remoteLabel ?? '');

  const priorityLabels: Record<string, string> = {
    low: t.vacancies.priorityLow,
    medium: t.vacancies.priorityMedium,
    high: t.vacancies.priorityHigh,
    urgent: t.vacancies.priorityUrgent,
  };

  // The title is the page's h1, which truncates to one line; on a phone the full name is repeated here so the
  // part that tells similar vacancies apart is never lost (typography.md › Keep text truncation to a minimum).
  const fields: { label: string; value?: string; render?: ReactNode; className?: string }[] = [
    { label: t.vacancies.titleLabel, value: v.title, className: 'sm:hidden' },
    { label: t.vacancies.company, value: v.company?.name ?? '—' },
    { label: t.vacancies.department, value: v.unit?.name ?? '—' },
    { label: t.vacancies.location, value: locationText || '—' },
    { label: t.vacancies.contractTypeLabel, value: enumLabel(v.contractType, t.portal.contractTypes) ?? '—' },
    { label: t.vacancies.salaryBand, value: salaryText },
    {
      label: t.vacancies.hiringManager,
      value: v.assignee ? `${v.assignee.firstName} ${v.assignee.lastName}` : '—',
    },
    {
      label: t.vacancies.priority,
      render: (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${VACANCY_PRIORITY_DOT[v.priority] ?? 'bg-muted'}`}
          />
          {priorityLabels[v.priority] ?? v.priority}
        </span>
      ),
    },
    { label: t.vacancies.openDateLabel, value: formatDate(v.createdAt) },
    { label: t.vacancies.positions, value: positionCountLabel(v.positions, t.vacancies) },
  ];

  return (
    <section
      aria-labelledby="vacancy-general-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card"
    >
      <h2 id="vacancy-general-title" className="mb-4 text-heading font-semibold text-brand">
        {t.vacancies.generalInfo}
      </h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <div key={f.label} className={`min-w-0 ${f.className ?? ''}`}>
            <dt className="text-callout text-secondary">{f.label}</dt>
            <dd className="mt-0.5 break-words text-body text-primary">
              {f.render ?? f.value}
            </dd>
          </div>
        ))}
      </dl>

      {v.description && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2 text-subheading font-semibold text-primary">{t.vacancies.description}</h3>
          {/* Safe Markdown subset rendered as React elements: no HTML string is ever produced. */}
          <MarkdownText
            source={v.description}
            className="max-w-prose space-y-2 text-body leading-relaxed text-primary"
          />
        </div>
      )}
    </section>
  );
}
