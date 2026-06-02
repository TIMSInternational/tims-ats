'use client';

import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';
import type { VacancyDetail } from '../../../../../lib/trpc-types';

interface GeneralInfoProps {
  vacancy: VacancyDetail;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'text-gray-500',
  medium: 'text-blue-600',
  high: 'text-amber-600',
  urgent: 'text-[#DD0C15]',
};

const PRIORITY_DOTS: Record<string, string> = {
  low: 'bg-gray-400',
  medium: 'bg-blue-500',
  high: 'bg-amber-500',
  urgent: 'bg-[#DD0C15]',
};

const REMOTE_LABELS: Record<string, string> = {
  onsite: 'Presencial',
  remote: 'Remoto',
  hybrid: 'Hibrido',
};

export function GeneralInfo({ vacancy: v }: GeneralInfoProps) {
  const { t } = useI18n();

  const salary = v.salary as { min?: number; max?: number; currency?: string; period?: string } | null;
  const salaryText = salary
    ? `$${(salary.min ?? 0).toLocaleString()} – $${(salary.max ?? 0).toLocaleString()} ${salary.currency ?? 'COP'}/${salary.period === 'yearly' ? t.vacancies.yearly : t.vacancies.monthly}`
    : '—';

  const locationText = [v.location, v.remotePolicy ? REMOTE_LABELS[v.remotePolicy] : null].filter(Boolean).join(' (') + (v.remotePolicy ? ')' : '');

  const priorityLabels: Record<string, string> = {
    low: t.vacancies.priorityLow,
    medium: t.vacancies.priorityMedium,
    high: t.vacancies.priorityHigh,
    urgent: t.vacancies.priorityUrgent,
  };

  const fields = [
    { label: t.vacancies.titleLabel, value: v.title },
    { label: t.vacancies.company, value: v.company?.name ?? '—' },
    { label: t.vacancies.department, value: v.unit?.name ?? '—' },
    { label: t.vacancies.location, value: locationText || '—' },
    { label: t.vacancies.contractType, value: v.contractType ?? '—' },
    { label: t.vacancies.salaryBand, value: salaryText },
    {
      label: t.vacancies.hiringManager,
      value: v.assignee ? `${v.assignee.firstName} ${v.assignee.lastName}` : '—',
    },
    {
      label: t.vacancies.priority,
      render: (
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${PRIORITY_DOTS[v.priority] ?? 'bg-gray-400'}`} />
          <span className={`text-[13px] font-medium ${PRIORITY_COLORS[v.priority] ?? 'text-gray-500'}`}>
            {priorityLabels[v.priority] ?? v.priority}
          </span>
        </div>
      ),
    },
    { label: t.vacancies.openDate, value: formatDate(v.createdAt) },
    { label: t.vacancies.positions, value: `${v.positions} vacante${v.positions > 1 ? 's' : ''}` },
  ];

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.vacancies.generalInfo}</h3>
      <div className="grid grid-cols-3 gap-x-6 gap-y-3">
        {fields.map((f, i) => (
          <div key={i}>
            <p className="text-[11px] text-[#8B8B8B] mb-0.5">{f.label}</p>
            {'render' in f && f.render ? f.render : <p className="text-[13px] text-[#333]">{f.value}</p>}
          </div>
        ))}
      </div>

      {v.description && (
        <div className="mt-4 pt-4 border-t border-[#F6F6F6]">
          <p className="text-[12px] text-[#585858] font-medium mb-2">{t.vacancies.description}</p>
          <div className="bg-[#F6F6F6] rounded-lg p-3 text-[12px] text-[#585858] leading-relaxed whitespace-pre-wrap">
            {v.description}
          </div>
        </div>
      )}
    </div>
  );
}
