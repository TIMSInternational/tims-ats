'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage, pluralize } from '../../../../lib/i18n/format';
import { Button, ErrorState, KpiCard, KpiCardSkeleton, PageHeader } from '../../../../components';
import { candidatePoolLabel } from '../../../../lib/candidate-labels';
import { FilterBar } from './filter-bar';
import { CandidateTable } from './candidate-table';
import { CreateModal } from './create-modal';

const LIST_LIMIT = 50;

export default function CandidatesPage() {
  const { t, locale } = useI18n();

  const [search, setSearch] = useState('');
  const [poolFilter, setPoolFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const kpis = trpc.candidate.getDashboardKpis.useQuery();
  const candidates = trpc.candidate.list.useQuery({
    limit: LIST_LIMIT,
    search: search || undefined,
    poolType: poolFilter || undefined,
    source: sourceFilter || undefined,
  });

  const utils = trpc.useUtils();
  const invalidateAll = () => {
    utils.candidate.list.invalidate();
    utils.candidate.getDashboardKpis.invalidate();
  };

  const createCandidate = trpc.candidate.create.useMutation({
    onSuccess: () => {
      invalidateAll();
      setShowCreate(false);
      toast(t.candidates.created, { type: 'success' });
    },
    // Errors show inside the dialog, next to the step they concern (writing.md › Best practices).
  });

  const openCreate = () => {
    createCandidate.reset();
    setShowCreate(true);
  };

  const clearFilters = () => {
    setSearch('');
    setPoolFilter('');
    setSourceFilter('');
  };
  const hasFilters = !!(search || poolFilter || sourceFilter);

  const items = candidates.data?.items ?? [];
  const poolSummary = kpis.data?.byPool
    .map((p) => `${candidatePoolLabel(p.poolType, t.candidates)}: ${p.count}`)
    .join(', ');

  return (
    <div className="flex flex-col md:h-full md:overflow-hidden">
      <PageHeader
        title={t.candidates.title}
        actions={
          <Button
            onClick={openCreate}
            icon={
              <svg
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            }
          >
            {t.candidates.newCandidate}
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col px-4 py-5 md:px-6 md:py-6">
        {/* KPI Row */}
        <div className="mb-5 grid shrink-0 grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {kpis.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : kpis.isError ? (
            <div className="col-span-2 lg:col-span-4">
              <ErrorState
                size="compact"
                message={t.candidates.kpiLoadError}
                onRetry={() => kpis.refetch()}
                error={kpis.error}
              />
            </div>
          ) : kpis.data ? (
            <>
              <KpiCard
                label={t.candidates.kpiTotal}
                value={kpis.data.total}
                subtitle={pluralize(
                  kpis.data.byPool.length,
                  { one: t.candidates.kpiPoolTypesOne, other: t.candidates.kpiPoolTypesOther },
                  locale,
                )}
              />
              <KpiCard label={t.candidates.kpiNew} value={kpis.data.newThisMonth} subtitle={t.vacancies.thisMonth} />
              <KpiCard
                label={t.candidates.kpiActive}
                value={kpis.data.activeApplications}
                subtitle={`${kpis.data.total > 0 ? Math.round((kpis.data.activeApplications / kpis.data.total) * 100) : 0}%`}
              />
              <KpiCard
                label={t.candidates.colPool}
                value={kpis.data.byPool.length}
                subtitle={poolSummary}
                clampSubtitle
              />
            </>
          ) : null}
        </div>

        <FilterBar
          search={search}
          onSearchChange={setSearch}
          poolFilter={poolFilter}
          onPoolChange={setPoolFilter}
          sourceFilter={sourceFilter}
          onSourceChange={setSourceFilter}
          onClearFilters={clearFilters}
          hasFilters={hasFilters}
        />

        <CandidateTable
          candidates={items}
          isLoading={candidates.isLoading}
          isError={candidates.isError}
          error={candidates.error}
          onRetry={() => candidates.refetch()}
          hasFilters={hasFilters}
          onClearFilters={clearFilters}
          onCreate={openCreate}
        />

        {candidates.data?.nextCursor && kpis.data && (
          <p className="mt-3 shrink-0 text-callout text-secondary" role="status">
            {hasFilters
              ? formatMessage(t.candidates.listCappedFiltered, { shown: LIST_LIMIT })
              : formatMessage(t.candidates.listCapped, { shown: LIST_LIMIT, total: kpis.data.total })}
          </p>
        )}
      </div>

      {showCreate && (
        <CreateModal
          onConfirm={(data) => createCandidate.mutate(data)}
          onClose={() => setShowCreate(false)}
          isPending={createCandidate.isPending}
          errorCode={createCandidate.error ? (createCandidate.error.data?.code ?? 'UNKNOWN') : undefined}
        />
      )}
    </div>
  );
}
