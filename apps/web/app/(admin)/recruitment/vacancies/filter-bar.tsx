'use client';

import { useId } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Button, Select, TextInput } from '../../../../components';

interface FilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: string;
  onStatusChange: (v: string) => void;
  priorityFilter: string;
  onPriorityChange: (v: string) => void;
  onClearFilters: () => void;
  hasFilters: boolean;
}

/**
 * Search + status + priority filters for the vacancy list. Every control has a (visually hidden) label; the
 * page's primary action ("Nueva vacante") lives in the PageHeader, not here.
 */
export function FilterBar({
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  priorityFilter,
  onPriorityChange,
  onClearFilters,
  hasFilters,
}: FilterBarProps) {
  const { t } = useI18n();
  const id = useId();
  const searchId = `${id}-search`;
  const statusId = `${id}-status`;
  const priorityId = `${id}-priority`;

  return (
    <div role="search" className="flex shrink-0 flex-wrap items-center gap-3">
      <div className="relative w-full sm:w-auto sm:min-w-[200px] sm:max-w-sm sm:flex-1">
        <label htmlFor={searchId} className="sr-only">
          {t.vacancies.searchLabel}
        </label>
        <svg
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <TextInput
          id={searchId}
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.vacancies.searchVacancy}
          maxLength={200}
          className="pl-9"
        />
      </div>

      <div className="w-full min-w-0 sm:w-auto sm:flex-none">
        <label htmlFor={statusId} className="sr-only">
          {t.vacancies.filterStatusLabel}
        </label>
        <Select
          id={statusId}
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className="sm:w-auto"
        >
          <option value="">{t.vacancies.filterAll}</option>
          <option value="draft">{t.vacancies.filterDraft}</option>
          <option value="pending_approval">{t.vacancies.filterPending}</option>
          <option value="approved">{t.vacancies.filterApproved}</option>
          <option value="published">{t.vacancies.filterPublished}</option>
          <option value="closed">{t.vacancies.filterClosed}</option>
          <option value="frozen">{t.vacancies.filterFrozen}</option>
        </Select>
      </div>

      <div className="w-full min-w-0 sm:w-auto sm:flex-none">
        <label htmlFor={priorityId} className="sr-only">
          {t.vacancies.filterPriorityLabel}
        </label>
        <Select
          id={priorityId}
          value={priorityFilter}
          onChange={(e) => onPriorityChange(e.target.value)}
          className="sm:w-auto"
        >
          <option value="">{t.vacancies.allPriorities}</option>
          <option value="low">{t.vacancies.priorityLow}</option>
          <option value="medium">{t.vacancies.priorityMedium}</option>
          <option value="high">{t.vacancies.priorityHigh}</option>
          <option value="urgent">{t.vacancies.priorityUrgent}</option>
        </Select>
      </div>

      {hasFilters && (
        <Button variant="tertiary" onClick={onClearFilters}>
          {t.vacancies.clearFilters}
        </Button>
      )}
    </div>
  );
}
