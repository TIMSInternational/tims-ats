'use client';

import { useI18n } from '../../../../lib/i18n';
import { Skeleton } from '../../../../components';
import type { VacancyListItem } from '../../../../lib/trpc-types';

interface VacancySelectorProps {
  vacancies: VacancyListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}

export function VacancySelector({ vacancies, selectedId, onSelect, isLoading }: VacancySelectorProps) {
  const { t } = useI18n();

  if (isLoading) return <Skeleton className="h-10 w-64 rounded-lg" />;

  return (
    <div className="flex items-center gap-2">
      <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>
      <select
        value={selectedId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className="h-10 px-4 pr-8 bg-[#F6F6F6] rounded-lg text-[13px] text-[#1F114C] font-medium border-0 focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 appearance-none cursor-pointer"
      >
        <option value="" disabled>{t.pipeline.selectVacancy}</option>
        {vacancies.map((v) => (
          <option key={v.id} value={v.id}>
            {v.title} {v.company ? `— ${v.company.name}` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
