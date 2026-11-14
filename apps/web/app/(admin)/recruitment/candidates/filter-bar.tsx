'use client';

import { useI18n } from '../../../../lib/i18n';
import { Button, inputClasses, selectClasses } from '../../../../components';
import {
  CANDIDATE_POOL_TYPES,
  CANDIDATE_SOURCES,
  candidatePoolLabel,
  candidateSourceLabel,
} from '../../../../lib/candidate-labels';

interface FilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  poolFilter: string;
  onPoolChange: (v: string) => void;
  sourceFilter: string;
  onSourceChange: (v: string) => void;
  onClearFilters: () => void;
  hasFilters: boolean;
}

/** Search and filters for the candidate list. Every control is named (accessibility.md › Vision). */
export function FilterBar({
  search,
  onSearchChange,
  poolFilter,
  onPoolChange,
  sourceFilter,
  onSourceChange,
  onClearFilters,
  hasFilters,
}: FilterBarProps) {
  const { t } = useI18n();

  return (
    <div className="mb-4 flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
      <div className="relative w-full sm:max-w-sm sm:flex-1">
        <label htmlFor="cand-search" className="sr-only">
          {t.candidates.searchLabel}
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
        <input
          id="cand-search"
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.candidates.searchCandidate}
          className={inputClasses('md', 'pl-9')}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-3">
        <select
          value={poolFilter}
          onChange={(e) => onPoolChange(e.target.value)}
          aria-label={t.candidates.colPool}
          className={selectClasses('md', 'sm:w-auto')}
        >
          <option value="">{t.candidates.allPools}</option>
          {CANDIDATE_POOL_TYPES.map((pool) => (
            <option key={pool} value={pool}>
              {candidatePoolLabel(pool, t.candidates)}
            </option>
          ))}
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => onSourceChange(e.target.value)}
          aria-label={t.candidates.colSource}
          className={selectClasses('md', 'sm:w-auto')}
        >
          <option value="">{t.candidates.allSources}</option>
          {CANDIDATE_SOURCES.map((source) => (
            <option key={source} value={source}>
              {candidateSourceLabel(source, t.candidates)}
            </option>
          ))}
        </select>
      </div>

      {hasFilters && (
        <Button variant="tertiary" size="sm" onClick={onClearFilters} className="self-start sm:self-auto">
          {t.common.clearFilters}
        </Button>
      )}
    </div>
  );
}
