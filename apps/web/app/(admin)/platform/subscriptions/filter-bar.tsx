'use client';

import { useI18n } from '../../../../lib/i18n';
import { Button, inputClasses, selectClasses } from '../../../../components';
import { PLAN_KEYS, planLabel } from '../organizations/plan-label';

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  planFilter: string;
  onPlanChange: (value: string) => void;
  onClearFilters: () => void;
  hasFilters: boolean;
}

export function FilterBar({
  search,
  onSearchChange,
  statusFilter,
  onStatusChange,
  planFilter,
  onPlanChange,
  onClearFilters,
  hasFilters,
}: FilterBarProps) {
  const { t } = useI18n();
  const sb = t.subscriptions;

  return (
    <div className="mb-4 flex shrink-0 flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-card md:gap-3 md:p-4">
      <div className="relative w-full sm:w-auto sm:min-w-56 sm:max-w-xs sm:flex-1">
        <input
          type="search"
          aria-label={sb.searchOrgLabel}
          placeholder={sb.searchOrg}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className={inputClasses('md', 'pl-9')}
        />
        <svg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
        </svg>
      </div>
      <select
        aria-label={sb.filterPlan}
        value={planFilter}
        onChange={(e) => onPlanChange(e.target.value)}
        className={selectClasses('md', 'min-w-0 flex-1 sm:w-auto sm:flex-none')}
      >
        <option value="">{sb.allPlans}</option>
        {PLAN_KEYS.map((p) => (
          <option key={p} value={p}>{planLabel(p, t)}</option>
        ))}
      </select>
      <select
        aria-label={sb.filterStatus}
        value={statusFilter}
        onChange={(e) => onStatusChange(e.target.value)}
        className={selectClasses('md', 'min-w-0 flex-1 sm:w-auto sm:flex-none')}
      >
        <option value="">{sb.allStatuses}</option>
        <option value="active">{sb.statusActive}</option>
        <option value="trialing">{sb.statusTrialing}</option>
        <option value="past_due">{sb.statusPastDue}</option>
        <option value="cancelled">{sb.statusCanceled}</option>
      </select>
      {hasFilters && (
        <Button variant="tertiary" onClick={onClearFilters}>
          {t.common.clearFilters}
        </Button>
      )}
    </div>
  );
}
