'use client';

import React from 'react';
import { Skeleton } from './skeleton';

interface Column {
  key: string;
  label: string;
  align?: 'left' | 'center' | 'right';
}

interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}

interface DataTableProps {
  columns: Column[];
  children: React.ReactNode;
  loading?: boolean;
  skeletonRows?: number;
  empty?: React.ReactNode;
  pagination?: PaginationProps;
}

function SkeletonRows({
  columns,
  count,
}: {
  columns: Column[];
  count: number;
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, rowIdx) => (
        <tr
          key={rowIdx}
          className="border-b border-[#F6F6F6] animate-pulse"
        >
          {columns.map((col) => (
            <td
              key={col.key}
              className={`px-4 py-3 ${
                col.align === 'right'
                  ? 'text-right'
                  : col.align === 'center'
                    ? 'text-center'
                    : ''
              }`}
            >
              <Skeleton
                className={`h-4 ${
                  col.align === 'right'
                    ? 'w-16 ml-auto'
                    : col.align === 'center'
                      ? 'w-16 mx-auto'
                      : 'w-24'
                } rounded`}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function DataTable({
  columns,
  children,
  loading,
  skeletonRows = 5,
  empty,
  pagination,
}: DataTableProps) {
  const totalPages = pagination
    ? Math.ceil(pagination.total / pagination.limit)
    : 0;
  const visiblePages = pagination
    ? Math.min(totalPages, 5)
    : 0;

  const showEmpty = !loading && React.Children.count(children) === 0;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0">
        <table className="w-full">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-[#EDEDED]">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3 ${
                    col.align === 'right'
                      ? 'text-right'
                      : col.align === 'center'
                        ? 'text-center'
                        : 'text-left'
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows columns={columns} count={skeletonRows} />
            ) : showEmpty && empty ? (
              <tr>
                <td colSpan={columns.length}>{empty}</td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#EDEDED] flex-shrink-0">
          <span className="text-xs text-[#8B8B8B]">
            Mostrando{' '}
            {pagination.total > 0
              ? pagination.page * pagination.limit + 1
              : 0}
            -
            {Math.min(
              (pagination.page + 1) * pagination.limit,
              pagination.total,
            )}{' '}
            de {pagination.total}{' '}
            {pagination.itemLabel || 'registros'}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() =>
                pagination.onPageChange(
                  Math.max(0, pagination.page - 1),
                )
              }
              disabled={pagination.page === 0}
              className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#8B8B8B] hover:bg-[#F6F6F6] transition disabled:opacity-40"
              aria-label="Pagina anterior"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {Array.from({ length: visiblePages }).map((_, i) => (
              <button
                key={i}
                onClick={() => pagination.onPageChange(i)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition ${
                  pagination.page === i
                    ? 'bg-[#1F114C] text-white'
                    : 'border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'
                }`}
              >
                {i + 1}
              </button>
            ))}
            {totalPages > 5 && (
              <>
                <span className="text-xs text-[#8B8B8B] px-1">...</span>
                <button
                  onClick={() =>
                    pagination.onPageChange(totalPages - 1)
                  }
                  className="w-8 h-8 rounded-lg text-xs font-medium border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6] transition"
                >
                  {totalPages}
                </button>
              </>
            )}
            <button
              onClick={() =>
                pagination.onPageChange(pagination.page + 1)
              }
              disabled={
                (pagination.page + 1) * pagination.limit >=
                pagination.total
              }
              className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-40"
              aria-label="Pagina siguiente"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
