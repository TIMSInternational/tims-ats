'use client';

import React from 'react';
import { Skeleton } from './skeleton';
import { Pagination, type PaginationProps } from './pagination';
import { SortableHeader, type SortDirection } from './sortable-header';
import { useI18n } from '../lib/i18n';

interface Column {
  key: string;
  /** Sentence case, descriptive (lists-and-tables.md › Content). */
  label: string;
  align?: 'left' | 'center' | 'right';
  /** Makes the heading a sort button with aria-sort. */
  sortDirection?: SortDirection;
  onSort?: () => void;
  /** Visually hidden heading (e.g. an actions column). */
  srOnly?: boolean;
}

interface DataTableProps {
  columns: Column[];
  /** The table rows (<tr>). Rows are `border-b border-border hover:bg-surface-hover`, cells `px-4 py-3 text-body`. */
  children: React.ReactNode;
  loading?: boolean;
  skeletonRows?: number;
  /** Shown full width (outside the scrolling table) when there are no rows. */
  empty?: React.ReactNode;
  pagination?: Omit<PaginationProps, 'className'>;
  /**
   * The same items as a stacked list for phones (foundation-spec.md §7): when given, it shows below md and
   * the table from md up. Each item: primary text, two facts, a status chip.
   */
  mobileList?: React.ReactNode;
  /** Accessible name for the table (e.g. the page title). */
  label?: string;
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;
const TABLE_FROM_MD = 'hidden md:block';

function renderHeader(col: Column) {
  if (col.onSort) {
    return (
      <SortableHeader
        key={col.key}
        label={col.label}
        direction={col.sortDirection ?? null}
        onSort={col.onSort}
        align={col.align}
      />
    );
  }
  return (
    <th
      key={col.key}
      scope="col"
      className={`px-4 py-2.5 text-callout font-semibold text-secondary ${ALIGN[col.align ?? 'left']}`}
    >
      {col.srOnly ? <span className="sr-only">{col.label}</span> : col.label}
    </th>
  );
}

function SkeletonRows({ columns, count }: { columns: Column[]; count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, rowIdx) => (
        <tr key={rowIdx} className="border-b border-border-subtle">
          {columns.map((col) => (
            <td key={col.key} className={`px-4 py-3 ${ALIGN[col.align ?? 'left']}`}>
              <Skeleton
                className={`h-4 ${col.align === 'right' ? 'w-16 ml-auto' : col.align === 'center' ? 'w-16 mx-auto' : 'w-24'} rounded`}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** The shared table card (foundation-spec.md §7). */
export function DataTable({
  columns,
  children,
  loading,
  skeletonRows = 5,
  empty,
  pagination,
  mobileList,
  label,
}: DataTableProps) {
  const { t } = useI18n();
  const showEmpty = !loading && React.Children.count(children) === 0 && Boolean(empty);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-white shadow-card">
      {loading && (
        <span className="sr-only" role="status">
          {t.common.loadingContent}
        </span>
      )}
      {showEmpty ? (
        <div className="flex-1">{empty}</div>
      ) : (
        <>
          {mobileList && !loading && <div className="divide-y divide-border md:hidden">{mobileList}</div>}
          <div className={`min-h-0 flex-1 overflow-auto ${mobileList && !loading ? TABLE_FROM_MD : ''}`}>
            <table className="w-full min-w-[640px]" aria-label={label} aria-busy={loading || undefined}>
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b border-border">{columns.map(renderHeader)}</tr>
              </thead>
              <tbody>{loading ? <SkeletonRows columns={columns} count={skeletonRows} /> : children}</tbody>
            </table>
          </div>
        </>
      )}

      {pagination && <Pagination {...pagination} className="shrink-0" />}
    </div>
  );
}
