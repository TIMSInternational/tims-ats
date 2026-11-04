'use client';

import { useI18n } from '../../../../lib/i18n';

export type InterviewListView = 'upcoming' | 'past';

interface InterviewFilterBarProps {
  view: InterviewListView;
  onViewChange: (v: InterviewListView) => void;
  statusFilter: string;
  onStatusChange: (v: string) => void;
  typeFilter: string;
  onTypeChange: (v: string) => void;
  onClearFilters: () => void;
  hasFilters: boolean;
  /** Omitted when the viewer may not schedule (committee-only, or no candidate/vacancy read): no button. */
  onSchedule?: () => void;
}

const viewButton = (active: boolean) =>
  `h-9 px-3 text-sm transition ${active ? 'bg-[#1F114C] text-white' : 'bg-white text-[#585858] hover:bg-[#F6F6F6]'}`;

export function InterviewFilterBar({
  view, onViewChange,
  statusFilter, onStatusChange,
  typeFilter, onTypeChange,
  onClearFilters, hasFilters,
  onSchedule,
}: InterviewFilterBarProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap items-center gap-3 gap-y-2 mb-4 flex-shrink-0">
      <div role="group" aria-label={t.interviews.viewToggleLabel} className="inline-flex rounded-lg border border-[#EDEDED] overflow-hidden">
        <button type="button" aria-pressed={view === 'upcoming'} onClick={() => onViewChange('upcoming')} className={viewButton(view === 'upcoming')}>
          {t.interviews.viewUpcoming}
        </button>
        <button type="button" aria-pressed={view === 'past'} onClick={() => onViewChange('past')} className={viewButton(view === 'past')}>
          {t.interviews.viewPast}
        </button>
      </div>

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
        <option value="online">{t.interviews.typeOnline}</option>
      </select>

      {hasFilters && (
        <button
          onClick={onClearFilters}
          className="h-9 px-3 rounded-lg border border-[#EDEDED] text-xs text-[#8B8B8B] hover:bg-[#F6F6F6] transition"
        >
          {t.interviews.clearFilters}
        </button>
      )}

      {onSchedule && (
        <div className="ml-auto">
          <button onClick={onSchedule} className="h-9 px-4 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t.interviews.scheduleNew}
          </button>
        </div>
      )}
    </div>
  );
}
