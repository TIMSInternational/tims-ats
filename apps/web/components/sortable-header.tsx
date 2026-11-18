'use client';

import React from 'react';

export type SortDirection = 'asc' | 'desc' | null;

interface SortableHeaderProps {
  label: React.ReactNode;
  direction: SortDirection;
  onSort: () => void;
  align?: 'left' | 'center' | 'right';
  className?: string;
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;
const JUSTIFY = { left: 'justify-start', center: 'justify-center', right: 'justify-end' } as const;

/**
 * A sortable column heading (lists-and-tables.md › Desktop: "let people click a column heading to sort"):
 * a th with scope=col and aria-sort, wrapping a button. Unsorted columns show a neutral up/down glyph.
 */
export function SortableHeader({ label, direction, onSort, align = 'left', className = '' }: SortableHeaderProps) {
  const ariaSort = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none';
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={`px-4 py-2.5 text-callout font-semibold text-secondary ${ALIGN[align]} ${className}`}
    >
      <button
        type="button"
        onClick={onSort}
        className={`inline-flex w-full items-center gap-1 rounded transition-colors hover:text-primary ${JUSTIFY[align]} ${direction ? 'text-primary' : ''}`}
      >
        {label}
        <svg
          className={`size-3.5 shrink-0 ${direction ? 'text-brand' : 'text-muted'}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          {direction === 'asc' ? (
            <path d="M7 14l5-5 5 5" />
          ) : direction === 'desc' ? (
            <path d="M7 10l5 5 5-5" />
          ) : (
            <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
          )}
        </svg>
      </button>
    </th>
  );
}
