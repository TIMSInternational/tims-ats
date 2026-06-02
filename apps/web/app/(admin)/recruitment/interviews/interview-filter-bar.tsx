'use client';

import { useI18n } from '../../../../lib/i18n';

interface InterviewFilterBarProps {
  statusFilter: string;
  onStatusChange: (v: string) => void;
  typeFilter: string;
  onTypeChange: (v: string) => void;
  onClearFilters: () => void;
  hasFilters: boolean;
}

export function InterviewFilterBar({
  statusFilter, onStatusChange,
  typeFilter, onTypeChange,
  onClearFilters, hasFilters,
}: InterviewFilterBarProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-3 mb-4 flex-shrink-0">
      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value)}
        className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
      >
        <option value="">{t.interviews.allStatuses}</option>
        <option value="scheduled">{t.interviews.statusScheduled}</option>
        <option value="in_progress">{t.interviews.statusInProgress}</option>
        <option value="completed">{t.interviews.statusCompleted}</option>
        <option value="cancelled">{t.interviews.statusCancelled}</option>
        <option value="no_show">{t.interviews.statusNoShow}</option>
      </select>

      <select
        value={typeFilter}
        onChange={(e) => onTypeChange(e.target.value)}
        className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
      >
        <option value="">{t.interviews.allTypes}</option>
        <option value="phone">{t.interviews.typePhone}</option>
        <option value="video">{t.interviews.typeVideo}</option>
        <option value="panel">{t.interviews.typePanel}</option>
        <option value="onsite">{t.interviews.typeOnsite}</option>
        <option value="technical">{t.interviews.typeTechnical}</option>
        <option value="cultural">{t.interviews.typeCultural}</option>
      </select>

      {hasFilters && (
        <button
          onClick={onClearFilters}
          className="h-9 px-3 rounded-lg border border-[#EDEDED] text-xs text-[#8B8B8B] hover:bg-[#F6F6F6] transition"
        >
          {t.interviews.clearFilters}
        </button>
      )}

      <div className="ml-auto">
        <button className="h-9 px-4 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t.interviews.scheduleNew}
        </button>
      </div>
    </div>
  );
}
