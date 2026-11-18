'use client';

import { useState, useCallback } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage, pluralize } from '../../../../lib/i18n/format';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { Button, Modal, PageHeader, inputClasses } from '../../../../components';
import { TalentPoolFilters } from './talent-pool-filters';
import { TalentPoolResultsHeader } from './talent-pool-results-header';
import { TalentPoolTable } from './talent-pool-table';
import { CreateModal } from '../candidates/create-modal';
import { createErrorMessage } from '../candidates/create-modal.helpers';

export interface TalentPoolFilterState {
  search: string;
  poolTypes: string[];
  fitMin: number;
  skills: string[];
  // Kept in the state shape, but not shown: the list query does not support them yet, and a filter that
  // changes nothing must not be offered (searching.md › Best practices).
  locations: string[];
  experienceLevels: string[];
  sort: string;
}

const DEFAULT_FILTERS: TalentPoolFilterState = {
  search: '',
  poolTypes: [],
  fitMin: 0,
  skills: [],
  locations: [],
  experienceLevels: [],
  sort: 'fit',
};

export default function TalentPoolsPage() {
  const { t, locale } = useI18n();
  const tp = t.talentPool;
  const [filters, setFilters] = useState<TalentPoolFilterState>(DEFAULT_FILTERS);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showFilterSheet, setShowFilterSheet] = useState(false);

  const updateFilter = useCallback(<K extends keyof TalentPoolFilterState>(key: K, value: TalentPoolFilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCursor(undefined);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setCursor(undefined);
  }, []);

  const query = trpc.candidate.list.useQuery({
    cursor,
    limit: 25,
    search: filters.search || undefined,
    poolType: filters.poolTypes.length === 1 ? filters.poolTypes[0] : undefined,
    fitMin: filters.fitMin > 0 ? filters.fitMin : undefined,
    skills: filters.skills.length > 0 ? filters.skills : undefined,
  });

  const utils = trpc.useUtils();
  const createMutation = trpc.candidate.create.useMutation({
    onSuccess: () => {
      toast(tp.candidateAdded);
      utils.candidate.list.invalidate();
      setShowCreateModal(false);
    },
    // Said twice on purpose: in the dialog, next to the step it concerns, and as a toast (frontend.md).
    onError: (error) => toast(createErrorMessage(error.data?.code, t.candidates), { type: 'error' }),
  });
  const openCreate = () => {
    createMutation.reset();
    setShowCreateModal(true);
  };

  const candidates = query.data?.items ?? [];
  const nextCursor = query.data?.nextCursor;
  const activeFilterCount = filters.poolTypes.length + (filters.fitMin > 0 ? 1 : 0) + filters.skills.length;
  const hasFilters = activeFilterCount > 0 || filters.search !== '';

  const exportMutation = trpc.candidate.pool.export.useMutation();
  const handleExport = async () => {
    try {
      const result = await exportMutation.mutateAsync({
        format: 'csv',
        poolType: filters.poolTypes.length === 1 ? filters.poolTypes[0] : undefined,
      });
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `candidates-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (result.truncated) {
        toast(tp.exportTruncated.replace('{count}', String(result.count)), { type: 'info' });
      } else {
        toast(pluralize(result.count, { one: tp.exportDoneOne, other: tp.exportDoneOther }, locale), {
          type: 'success',
        });
      }
    } catch {
      toast(t.common.exportError, { type: 'error' });
    }
  };

  const filterButtonLabel =
    activeFilterCount > 0 ? formatMessage(tp.filtersCount, { n: activeFilterCount }) : tp.filters;

  return (
    <div className="flex flex-col md:h-full md:overflow-hidden">
      <PageHeader
        title={tp.title}
        description={tp.description}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={handleExport}
              loading={exportMutation.isPending}
              loadingLabel={t.common.exporting}
            >
              {tp.exportCsv}
            </Button>
            <Button onClick={openCreate}>{tp.addToPool}</Button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1 md:overflow-hidden">
        <TalentPoolFilters
          filters={filters}
          onFilterChange={updateFilter}
          onClear={clearFilters}
          className="hidden w-64 shrink-0 overflow-y-auto border-r border-border p-4 md:block"
        />
        <div className="min-w-0 flex-1 px-4 py-5 md:overflow-y-auto md:px-6 md:py-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="relative min-w-0 flex-1 md:max-w-md">
              <label htmlFor="pool-search" className="sr-only">
                {tp.searchLabel}
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
                id="pool-search"
                type="search"
                value={filters.search}
                onChange={(e) => updateFilter('search', e.target.value)}
                placeholder={tp.searchCandidate}
                className={inputClasses('md', 'pl-9')}
              />
            </div>
            <Button variant="secondary" className="md:hidden" onClick={() => setShowFilterSheet(true)}>
              {filterButtonLabel}
            </Button>
          </div>

          <TalentPoolResultsHeader totalCount={candidates.length} filters={filters} onFilterChange={updateFilter} />
          <TalentPoolTable
            candidates={candidates}
            isLoading={query.isLoading}
            isError={query.isError}
            error={query.error}
            onRetry={() => query.refetch()}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
            nextCursor={nextCursor}
            onNextPage={() => setCursor(nextCursor)}
            onPrevPage={() => setCursor(undefined)}
            currentCursor={cursor}
          />
        </div>
      </div>

      {showFilterSheet && (
        <Modal
          title={tp.filters}
          onClose={() => setShowFilterSheet(false)}
          footer={<Button onClick={() => setShowFilterSheet(false)}>{tp.showResults}</Button>}
        >
          <TalentPoolFilters filters={filters} onFilterChange={updateFilter} onClear={clearFilters} hideTitle />
        </Modal>
      )}

      {showCreateModal && (
        <CreateModal
          onConfirm={(data) => createMutation.mutate(data)}
          onClose={() => setShowCreateModal(false)}
          isPending={createMutation.isPending}
          errorCode={createMutation.error ? (createMutation.error.data?.code ?? 'UNKNOWN') : undefined}
        />
      )}
    </div>
  );
}
