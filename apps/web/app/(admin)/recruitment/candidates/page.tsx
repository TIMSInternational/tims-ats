'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton } from '../../../../components';
import { FilterBar } from './filter-bar';
import { CandidateTable } from './candidate-table';
import { CreateModal } from './create-modal';

export default function CandidatesPage() {
  const { t } = useI18n();

  const [search, setSearch] = useState('');
  const [poolFilter, setPoolFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const kpis = trpc.candidate.getDashboardKpis.useQuery();
  const candidates = trpc.candidate.list.useQuery({
    limit: 50,
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
    onSuccess: () => { invalidateAll(); setShowCreate(false); toast(t.candidates.created, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const clearFilters = () => { setSearch(''); setPoolFilter(''); setSourceFilter(''); };

  const items = candidates.data?.items ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 flex-shrink-0">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : kpis.data ? (
          <>
            <KpiCard
              label={t.candidates.kpiTotal}
              value={kpis.data.total}
              subtitle={`${kpis.data.byPool.length} pools`}
              icon={<svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
              iconBg="bg-[#1F114C]/10"
            />
            <KpiCard
              label={t.candidates.kpiNew}
              value={kpis.data.newThisMonth}
              subtitle={t.vacancies.thisMonth}
              icon={<svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>}
              iconBg="bg-green-50"
            />
            <KpiCard
              label={t.candidates.kpiActive}
              value={kpis.data.activeApplications}
              subtitle={`${kpis.data.total > 0 ? Math.round((kpis.data.activeApplications / kpis.data.total) * 100) : 0}%`}
              icon={<svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>}
              iconBg="bg-blue-50"
            />
            <KpiCard
              label={t.candidates.colPool}
              value={kpis.data.byPool.length}
              subtitle={kpis.data.byPool.map((p) => `${p.poolType}: ${p.count}`).join(', ').slice(0, 40)}
              icon={<svg className="w-4 h-4 text-violet-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>}
              iconBg="bg-violet-50"
            />
          </>
        ) : null}
      </div>

      {/* Filter Bar */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        poolFilter={poolFilter}
        onPoolChange={setPoolFilter}
        sourceFilter={sourceFilter}
        onSourceChange={setSourceFilter}
        onClearFilters={clearFilters}
        hasFilters={!!(search || poolFilter || sourceFilter)}
        onCreateClick={() => setShowCreate(true)}
      />

      {/* Table */}
      <CandidateTable
        candidates={items}
        isLoading={candidates.isLoading}
      />

      {/* Create Modal */}
      {showCreate && (
        <CreateModal
          onConfirm={(data) => createCandidate.mutate(data)}
          onClose={() => setShowCreate(false)}
          isPending={createCandidate.isPending}
        />
      )}
    </div>
  );
}
