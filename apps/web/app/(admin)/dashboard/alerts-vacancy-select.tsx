'use client';

import { useId } from 'react';
import { useI18n } from '../../../lib/i18n';
import { selectClasses } from '../../../components/field-styles';

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
  const id = useId();
  if (vacancies.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="text-callout text-secondary">
        {rd.alertsVacancyLabel}
      </label>
      <select
        id={id}
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className={selectClasses('md', 'w-auto max-w-60 truncate')}
      >
        {vacancies.map((v) => (
          <option key={v.id} value={v.id}>
            {v.title}
          </option>
        ))}
      </select>
    </div>
  );
}
