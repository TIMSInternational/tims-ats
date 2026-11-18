'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage, pluralize } from '../../../../lib/i18n/format';
import { IconButton, StatusBadge } from '../../../../components';
import { talentPoolTypeLabel } from './talent-pool-filters';
import type { TalentPoolFilterState } from './page';

interface ResultsHeaderProps {
  /** Rows on the current page (the list is cursor-paged, so there is no grand total). */
  totalCount: number;
  filters: TalentPoolFilterState;
  onFilterChange: <K extends keyof TalentPoolFilterState>(key: K, value: TalentPoolFilterState[K]) => void;
}

interface FilterPill {
  label: string;
  key: 'skills' | 'poolTypes' | 'fitMin';
  value: string;
}

/**
 * The count of results on this page and a removable pill per applied filter. Only filters the query applies
 * get a pill; there is no sort control because the list query cannot sort yet.
 */
export function TalentPoolResultsHeader({ totalCount, filters, onFilterChange }: ResultsHeaderProps) {
  const { t, locale } = useI18n();
  const tp = t.talentPool;

  const pills: FilterPill[] = [
    ...filters.poolTypes.map((pt) => ({
      label: talentPoolTypeLabel(pt, t.candidates, tp),
      key: 'poolTypes' as const,
      value: pt,
    })),
    ...(filters.fitMin > 0
      ? [{ label: formatMessage(tp.fitMinPill, { n: filters.fitMin }), key: 'fitMin' as const, value: '0' }]
      : []),
    ...filters.skills.map((skill) => ({ label: skill, key: 'skills' as const, value: skill })),
  ];

  const removePill = (pill: FilterPill) => {
    if (pill.key === 'fitMin') onFilterChange('fitMin', 0);
    else
      onFilterChange(
        pill.key,
        filters[pill.key].filter((v) => v !== pill.value),
      );
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="text-body text-secondary" role="status">
        {pluralize(totalCount, { one: tp.onPageOne, other: tp.onPageOther }, locale)}
      </p>
      {pills.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label={tp.appliedFilters}>
          {pills.map((pill) => (
            <li key={`${pill.key}-${pill.value}`}>
              <StatusBadge tone="brand" icon="none" className="py-0 pr-0.5">
                {pill.label}
                <IconButton
                  label={`${t.common.removeFilter}: ${pill.label}`}
                  size="sm"
                  hideTooltip
                  onClick={() => removePill(pill)}
                  className="-my-1 rounded-full text-brand hover:bg-surface-hover"
                >
                  <svg
                    className="size-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </IconButton>
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
