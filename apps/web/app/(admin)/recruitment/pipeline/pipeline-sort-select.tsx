'use client';

import { IconButton, selectClasses } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

interface PipelineSortSelectProps<K extends string> {
  keys: readonly K[];
  labels: Record<K, string>;
  sortKey: K;
  sortDir: 'asc' | 'desc';
  onSortKey: (key: K) => void;
  onReverse: () => void;
}

/** Phones have no column headings to click, so the table's sort is a select plus a reverse button. */
export function PipelineSortSelect<K extends string>({
  keys,
  labels,
  sortKey,
  sortDir,
  onSortKey,
  onReverse,
}: PipelineSortSelectProps<K>) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1">
      <label htmlFor="pipeline-sort" className="text-callout text-secondary">
        {t.pipeline.sortBy}
      </label>
      <div className="w-36">
        <select
          id="pipeline-sort"
          value={sortKey}
          onChange={(e) => onSortKey(e.target.value as K)}
          className={selectClasses('md')}
        >
          {keys.map((key) => (
            <option key={key} value={key}>
              {labels[key]}
            </option>
          ))}
        </select>
      </div>
      <IconButton label={t.pipeline.sortReverse} onClick={onReverse}>
        <svg
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          {sortDir === 'asc' ? <path d="M7 14l5-5 5 5" /> : <path d="M7 10l5 5 5-5" />}
        </svg>
      </IconButton>
    </div>
  );
}
