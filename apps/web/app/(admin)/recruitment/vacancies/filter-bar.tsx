'use client';

import { useI18n } from '../../../../lib/i18n';

interface FilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusChange: (v: string) => void;
  priorityFilter: string;
  onPriorityChange: (v: string) => void;
  onClearFilters: () => void;
  hasFilters: boolean;
  onCreateClick: () => void;
}

export function FilterBar({
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  priorityFilter,
  onPriorityChange,
  onClearFilters,
  hasFilters,
  onCreateClick,
}: FilterBarProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-3 mb-4 flex-shrink-0">
      <div className="relative flex-1 max-w-sm">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.vacancies.searchVacancy}
          className="w-full h-9 pl-9 pr-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]"
        />
      </div>

      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value)}
        className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
      >
        <option value="">{t.vacancies.filterAll}</option>
        <option value="draft">{t.vacancies.filterDraft}</option>
        <option value="pending_approval">{t.vacancies.filterPending}</option>
        <option value="approved">{t.vacancies.filterApproved}</option>
        <option value="published">{t.vacancies.filterPublished}</option>
        <option value="closed">{t.vacancies.filterClosed}</option>
        <option value="frozen">{t.vacancies.filterFrozen}</option>
      </select>

      <select
        value={priorityFilter}
        onChange={(e) => onPriorityChange(e.target.value)}
        className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
      >
        <option value="">{t.vacancies.allPriorities}</option>
        <option value="low">{t.vacancies.priorityLow}</option>
        <option value="medium">{t.vacancies.priorityMedium}</option>
        <option value="high">{t.vacancies.priorityHigh}</option>
        <option value="urgent">{t.vacancies.priorityUrgent}</option>
      </select>

      {hasFilters && (
        <button
          onClick={onClearFilters}
          className="h-9 px-3 rounded-lg border border-[#EDEDED] text-xs text-[#8B8B8B] hover:bg-[#F6F6F6] transition"
        >
          {t.subscriptions.clearFilters}
        </button>
      )}

      <button
        onClick={onCreateClick}
        className="h-9 px-4 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition flex items-center gap-2 ml-auto"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
        {t.vacancies.newVacancy}
      </button>
    </div>
  );
}
