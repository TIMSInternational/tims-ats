'use client';

import { useI18n } from '../../../lib/i18n';

interface AlertsVacancySelectProps {
  vacancies: ReadonlyArray<{ id: string; title: string }>;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

/**
 * The SLA and risk alert panels read one vacancy's board. This names that vacancy and lets the user switch
 * it; before, both panels silently covered only the first published vacancy (A-18 / D-10).
 */
export function AlertsVacancySelect({ vacancies, selectedId, onSelect }: AlertsVacancySelectProps) {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;
  if (vacancies.length === 0) return null;
  return (
    <label className="flex items-center gap-2 text-[12px] text-[#585858]">
      <span>{rd.alertsVacancyLabel}</span>
      <select
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className="h-8 max-w-[240px] truncate rounded-lg border border-[#EDEDED] bg-white px-2 text-[12px] text-[#1F114C] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
      >
        {vacancies.map((v) => (
          <option key={v.id} value={v.id}>
            {v.title}
          </option>
        ))}
      </select>
    </label>
  );
}
