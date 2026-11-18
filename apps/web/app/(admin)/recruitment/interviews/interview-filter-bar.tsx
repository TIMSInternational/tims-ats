'use client';

import { useI18n } from '../../../../lib/i18n';
import { SegmentedControl } from '../../../../components/segmented-control';
import { Button } from '../../../../components/button';
import { selectClasses } from '../../../../components/field-styles';
import { STARTED_UNSCORED_FILTER } from './interview-status';

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
}

export function InterviewFilterBar({
  view, onViewChange,
  statusFilter, onStatusChange,
  typeFilter, onTypeChange,
  onClearFilters, hasFilters,
}: InterviewFilterBarProps) {
  const { t } = useI18n();

  return (
    <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3 gap-y-2">
      <SegmentedControl
        label={t.interviews.viewToggleLabel}
        value={view}
        onChange={onViewChange}
        options={[
          { value: 'upcoming', label: t.interviews.viewUpcoming },
          { value: 'past', label: t.interviews.viewPast },
        ]}
      />

      <select
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value)}
        aria-label={t.interviews.filterStatusLabel}
        className={selectClasses('md', 'sm:w-auto max-w-full')}
      >
        <option value="">{t.interviews.allStatuses}</option>
        {/* Values filter by what the rows SHOW (interview-status.ts), not by the stored status. */}
        <option value="scheduled">{t.interviews.statusScheduled}</option>
        <option value={STARTED_UNSCORED_FILTER}>{t.interviews.filterStartedUnscored}</option>
        <option value="completed">{t.interviews.statusCompleted}</option>
        <option value="cancelled">{t.interviews.statusCancelled}</option>
        <option value="no_show">{t.interviews.statusNoShow}</option>
      </select>

      <select
        value={typeFilter}
        onChange={(e) => onTypeChange(e.target.value)}
        aria-label={t.interviews.filterTypeLabel}
        className={selectClasses('md', 'sm:w-auto max-w-full')}
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
        <Button variant="tertiary" onClick={onClearFilters}>
          {t.interviews.clearFilters}
        </Button>
      )}
    </div>
  );
}
