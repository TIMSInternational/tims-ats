'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton } from '../../../../components';
import { FilterBar } from './filter-bar';
import { VacancyTable } from './vacancy-table';
import { CreateModal } from './create-modal';
import { CloseModal } from './close-modal';
import type { VacancyListItem } from '../../../../lib/trpc-types';

export default function VacanciesPage() {
  const { t } = useI18n();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [closeTarget, setCloseTarget] = useState<VacancyListItem | null>(null);
  const [freezeTarget, setFreezeTarget] = useState<VacancyListItem | null>(null);

  const kpis = trpc.vacancy.getDashboardKpis.useQuery();
  const vacancies = trpc.vacancy.list.useQuery({
    limit: 50,
    search: search || undefined,
    status: statusFilter ? (statusFilter as 'draft' | 'pending_approval' | 'approved' | 'published' | 'closed' | 'frozen') : undefined,
    priority: priorityFilter ? (priorityFilter as 'low' | 'medium' | 'high' | 'urgent') : undefined,
  });

  const utils = trpc.useUtils();
  const invalidateAll = () => {
    utils.vacancy.list.invalidate();
    utils.vacancy.getDashboardKpis.invalidate();
  };

  const createVacancy = trpc.vacancy.create.useMutation({
    onSuccess: () => { invalidateAll(); setShowCreate(false); toast(t.vacancies.created, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const closeVacancy = trpc.vacancy.close.useMutation({
    onSuccess: () => { invalidateAll(); setCloseTarget(null); toast(t.vacancies.closed, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const freezeVacancy = trpc.vacancy.freeze.useMutation({
    onSuccess: () => { invalidateAll(); setFreezeTarget(null); toast(t.vacancies.frozen, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const duplicateVacancy = trpc.vacancy.duplicate.useMutation({
    onSuccess: () => { invalidateAll(); toast(t.vacancies.duplicated, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setPriorityFilter('');
  };

  const items = vacancies.data?.items ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4 mb-5 flex-shrink-0">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : kpis.data ? (
          <>
            <KpiCard
              label={t.vacancies.kpiOpen}
              value={kpis.data.totalOpen}
              subtitle={`${kpis.data.totalPublished} ${t.vacancies.visibleCandidates}`}
              icon={<svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>}
              iconBg="bg-green-50"
            />
            <KpiCard
              label={t.vacancies.kpiDraft}
              value={kpis.data.totalDraft}
              subtitle={`${kpis.data.totalPendingApproval} ${t.vacancies.awaitingReview}`}
              icon={<svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>}
              iconBg="bg-amber-50"
              highlight={kpis.data.totalPendingApproval > 0}
            />
            <KpiCard
              label={t.vacancies.kpiApplications}
              value={kpis.data.totalApplications}
              subtitle={t.vacancies.thisMonth}
              icon={<svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
              iconBg="bg-blue-50"
            />
            <KpiCard
              label={t.vacancies.kpiClosed}
              value={kpis.data.totalClosed}
              subtitle={`${kpis.data.totalOpen + kpis.data.totalDraft + kpis.data.totalPendingApproval + kpis.data.totalPublished + kpis.data.totalClosed} total`}
              icon={<svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>}
              iconBg="bg-gray-100"
            />
          </>
        ) : null}
      </div>

      {/* Filter Bar */}
      <FilterBar
        search={search}
        onSearchChange={(v) => setSearch(v)}
        statusFilter={statusFilter}
        onStatusChange={(v) => setStatusFilter(v)}
        priorityFilter={priorityFilter}
        onPriorityChange={(v) => setPriorityFilter(v)}
        onClearFilters={clearFilters}
        hasFilters={!!(search || statusFilter || priorityFilter)}
        onCreateClick={() => setShowCreate(true)}
      />

      {/* Table */}
      <VacancyTable
        vacancies={items}
        isLoading={vacancies.isLoading}
        onDuplicate={(id) => duplicateVacancy.mutate({ id })}
        onClose={setCloseTarget}
        onFreeze={setFreezeTarget}
      />

      {/* Modals */}
      {showCreate && (
        <CreateModal
          onConfirm={(data) => createVacancy.mutate(data)}
          onClose={() => setShowCreate(false)}
          isPending={createVacancy.isPending}
        />
      )}
      {closeTarget && (
        <CloseModal
          vacancyTitle={closeTarget.title}
          onConfirm={(reason) => closeVacancy.mutate({ id: closeTarget.id, reason })}
          onClose={() => setCloseTarget(null)}
          isPending={closeVacancy.isPending}
        />
      )}
      {freezeTarget && (
        <FreezeConfirm
          vacancyTitle={freezeTarget.title}
          onConfirm={() => freezeVacancy.mutate({ id: freezeTarget.id })}
          onClose={() => setFreezeTarget(null)}
          isPending={freezeVacancy.isPending}
        />
      )}
    </div>
  );
}

function FreezeConfirm({ vacancyTitle, onConfirm, onClose, isPending }: { vacancyTitle: string; onConfirm: () => void; onClose: () => void; isPending: boolean }) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-[#333] mb-2">{t.vacancies.confirmFreeze}</h2>
        <p className="text-sm text-[#585858] mb-1">{vacancyTitle}</p>
        <p className="text-xs text-[#8B8B8B] mb-6">{t.vacancies.confirmFreezeDesc}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition">
            {t.common.cancel}
          </button>
          <button onClick={onConfirm} disabled={isPending} className="h-9 px-5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition disabled:opacity-50">
            {isPending ? t.common.saving : t.vacancies.freezeVacancy}
          </button>
        </div>
      </div>
    </div>
  );
}
