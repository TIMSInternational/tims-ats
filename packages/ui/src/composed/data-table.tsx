"use client";

import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Loader2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { SearchInput } from "./search-input";
import { EmptyState } from "./empty-state";

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  isLoading?: boolean;
  pageSize?: number;
  className?: string;
  toolbar?: React.ReactNode;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "Search…",
  emptyMessage = "No results found.",
  isLoading = false,
  pageSize = 10,
  className,
  toolbar,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  const [searchValue, setSearchValue] = React.useState("");

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
    initialState: {
      pagination: { pageSize },
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Drive column filter from search input
  const handleSearch = React.useCallback(
    (val: string) => {
      setSearchValue(val);
      if (searchKey) {
        table.getColumn(searchKey)?.setFilterValue(val);
      }
    },
    [searchKey, table]
  );

  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination;
  const totalRows = table.getFilteredRowModel().rows.length;
  const firstRow = totalRows === 0 ? 0 : pageIndex * currentPageSize + 1;
  const lastRow = Math.min((pageIndex + 1) * currentPageSize, totalRows);

  return (
    <div className={cn("flex flex-col gap-0 rounded-xl border border-border overflow-hidden bg-card", className)}>
      {/* Toolbar */}
      {(searchKey || toolbar) && (
        <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
          <div className="flex items-center gap-3 flex-1">
            {searchKey && (
              <SearchInput
                value={searchValue}
                onChange={handleSearch}
                placeholder={searchPlaceholder}
                className="w-full max-w-xs"
              />
            )}
          </div>
          {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
        </div>
      )}

      {/* Loading overlay */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Loading…</p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const canSort = header.column.getCanSort();
                      const sorted = header.column.getIsSorted();

                      return (
                        <th
                          key={header.id}
                          scope="col"
                          className={cn(
                            "h-11 px-4 text-left font-medium text-muted-foreground whitespace-nowrap",
                            canSort && "cursor-pointer select-none hover:text-foreground transition-colors"
                          )}
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          aria-sort={
                            sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                              ? "descending"
                              : canSort
                              ? "none"
                              : undefined
                          }
                        >
                          {header.isPlaceholder ? null : (
                            <span className="inline-flex items-center gap-1.5">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {canSort && (
                                <span className="text-muted-foreground/50">
                                  {sorted === "asc" ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : sorted === "desc" ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronsUpDown className="h-3.5 w-3.5" />
                                  )}
                                </span>
                              )}
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>

              <tbody className="divide-y divide-border">
                {table.getRowModel().rows.length > 0 ? (
                  table.getRowModel().rows.map((row) => (
                    <tr
                      key={row.id}
                      data-state={row.getIsSelected() ? "selected" : undefined}
                      className="transition-colors hover:bg-muted/30 data-[state=selected]:bg-muted/50"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="h-12 px-4 align-middle">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={columns.length}>
                      <EmptyState
                        title="No results"
                        description={emptyMessage}
                        className="py-12"
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalRows > 0 && (
            <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {totalRows === 0 ? "No results" : `${firstRow}–${lastRow} of ${totalRows} row${totalRows !== 1 ? "s" : ""}`}
              </p>

              <div className="flex items-center gap-1">
                <PaginationButton
                  onClick={() => table.setPageIndex(0)}
                  disabled={!table.getCanPreviousPage()}
                  aria-label="First page"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </PaginationButton>
                <PaginationButton
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </PaginationButton>

                <span className="px-2 text-xs text-muted-foreground tabular-nums">
                  {pageIndex + 1} / {table.getPageCount() || 1}
                </span>

                <PaginationButton
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </PaginationButton>
                <PaginationButton
                  onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                  disabled={!table.getCanNextPage()}
                  aria-label="Last page"
                >
                  <ChevronsRight className="h-4 w-4" />
                </PaginationButton>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Internal pagination button helper
function PaginationButton({
  children,
  onClick,
  disabled,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  "aria-label": string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
