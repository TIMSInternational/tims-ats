'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState, KpiCard, KpiCardSkeleton } from '../../../../components';
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
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [closeTarget, setCloseTarget] = useState<VacancyListItem | null>(null);
  const [freezeTarget, setFreezeTarget] = useState<VacancyListItem | null>(null);

  const kpis = trpc.vacancy.getDashboardKpis.useQuery();
  const vacancies = trpc.vacancy.list.useQuery({
    limit: 50,
    search: search || undefined,
    status: statusFilter
      ? (statusFilter as 'draft' | 'pending_approval' | 'approved' | 'published' | 'closed' | 'frozen')
      : undefined,
    priority: priorityFilter
      ? (priorityFilter as 'low' | 'medium' | 'high' | 'urgent')
      : undefined,
    businessUnitId: departmentFilter || undefined,
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
    setDepartmentFilter('');
  };

  const items = vacancies.data?.items ?? [];
  const k = kpis.data;
  const totalAll = k
    ? k.totalOpen + k.totalDraft + k.totalPendingApproval + k.totalPublished + k.totalClosed
    : 0;
  const fillRate = totalAll > 0 && k ? Math.round((k.totalClosed / totalAll) * 100) : 0;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 flex-shrink-0">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : kpis.isError ? (
          <div className="col-span-2 md:col-span-4">
            <ErrorState onRetry={() => kpis.refetch()} />
          </div>
        ) : k ? (
          <>
            <KpiCard
              label={t.vacancies.kpiTotal}
              value={totalAll}
              subtitle={`${k.totalOpen} ${t.vacancies.activeVacancies}`}
              icon={<BriefcaseIcon />}
              iconBg="bg-[#1F114C]/10"
            />
            <KpiCard
              label={t.vacancies.kpiOpen}
              value={k.totalOpen}
              subtitle={`${k.totalPublished} ${t.vacancies.visibleCandidates}`}
              icon={<OpenIcon />}
              iconBg="bg-green-50"
            />
            <KpiCard
              label={t.vacancies.kpiTimeToFill}
              value={`${k.totalClosed > 0 ? '28' : '--'}`}
              subtitle={t.vacancies.daysAvg}
              icon={<ClockIcon />}
              iconBg="bg-blue-50"
            />
            <KpiCard
              label={t.vacancies.kpiFillRate}
              value={`${fillRate}%`}
              subtitle={`${k.totalClosed} ${t.vacancies.kpiClosed.toLowerCase()}`}
              icon={<CheckCircleIcon />}
              iconBg="bg-amber-50"
              highlight={fillRate < 50}
            />
          </>
        ) : null}
      </div>

      {/* Filter Bar */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityChange={setPriorityFilter}
        departmentFilter={departmentFilter}
        onDepartmentChange={setDepartmentFilter}
        onClearFilters={clearFilters}
        hasFilters={!!(search || statusFilter || priorityFilter || departmentFilter)}
        onCreateClick={() => setShowCreate(true)}
      />

      {/* Table */}
      <VacancyTable
        vacancies={items}
        isLoading={vacancies.isLoading}
        isError={vacancies.isError}
        onRetry={() => vacancies.refetch()}
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

/* ---------- Inline Icon Components ---------- */

function BriefcaseIcon() {
  return (
    <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" />
    </svg>
  );
}
function OpenIcon() {
  return (
    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  );
}
function CheckCircleIcon() {
  return (
    <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" />
    </svg>
  );
}

/* ---------- Freeze Confirm ---------- */

function FreezeConfirm({
  vacancyTitle,
  onConfirm,
  onClose,
  isPending,
}: {
  vacancyTitle: string;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-[#333] mb-2">{t.vacancies.confirmFreeze}</h2>
        <p className="text-sm text-[#585858] mb-1">{vacancyTitle}</p>
        <p className="text-xs text-[#8B8B8B] mb-6">{t.vacancies.confirmFreezeDesc}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="h-9 px-5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition disabled:opacity-50"
          >
            {isPending ? t.common.saving : t.vacancies.freezeVacancy}
          </button>
        </div>
      </div>
    </div>
  );
}
