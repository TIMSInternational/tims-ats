'use client';

import { formatMessage, useI18n } from '../lib/i18n';

export interface PaginationProps {
  /** Zero-based current page. */
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Optional noun after the range ("candidatos"). */
  itemLabel?: string;
  className?: string;
}

/** First, last and a window around the current page, with gaps marked by null. */
export function pageWindow(current: number, totalPages: number): Array<number | null> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i);
  const pages = new Set([0, totalPages - 1, current - 1, current, current + 1].filter((p) => p >= 0 && p < totalPages));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev > 1) out.push(null);
    out.push(p);
  });
  return out;
}

const PAGE_BUTTON =
  'inline-flex size-8 items-center justify-center rounded-lg text-callout font-medium tabular-nums transition-colors pointer-coarse:size-11';

/** Table pagination (foundation-spec.md §7): i18n range text, a page window, aria-current on the current page. */
export function Pagination({ page, limit, total, onPageChange, itemLabel, className = '' }: PaginationProps) {
  const { t } = useI18n();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const from = total > 0 ? page * limit + 1 : 0;
  const to = Math.min((page + 1) * limit, total);
  const range = formatMessage(t.common.showingRange, { from, to, total });

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-3 md:px-5 ${className}`}
    >
      <span className="text-callout tabular-nums text-secondary">
        {range}
        {itemLabel ? ` ${itemLabel}` : ''}
      </span>
      <nav aria-label={t.common.pagination} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className={`${PAGE_BUTTON} border border-border text-secondary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40`}
          aria-label={t.common.prevPage}
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {pageWindow(page, totalPages).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-callout text-muted">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-label={`${t.common.page} ${p + 1}`}
              aria-current={p === page ? 'page' : undefined}
              className={`${PAGE_BUTTON} ${p === page ? 'bg-brand text-white' : 'border border-border text-secondary hover:bg-surface'}`}
            >
              {p + 1}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={(page + 1) * limit >= total}
          className={`${PAGE_BUTTON} border border-border text-secondary hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40`}
          aria-label={t.common.nextPage}
        >
          <svg
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </nav>
    </div>
  );
}
