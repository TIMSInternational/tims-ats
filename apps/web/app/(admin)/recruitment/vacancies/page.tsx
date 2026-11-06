'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState, KpiCard, KpiCardSkeleton } from '../../../../components';
import { FilterBar } from './filter-bar';
import { VacancyTable } from './vacancy-table';
import { CreateModal } from './create-modal';
import { CloseModal } from './close-modal';
import { FreezeVacancyConfirm } from './freeze-vacancy-confirm';
import { ResumeVacancyConfirm } from './resume-vacancy-confirm';
import type { VacancyListItem } from '../../../../lib/trpc-types';
import { summarizeVacancyKpis } from './vacancy-kpis';

export default function VacanciesPage() {
  const { t } = useI18n();
  const router = useRouter();
  // `?create=1` (the dashboard's "Nueva vacante" shortcut) opens the wizard straight away.
  const openCreateOnLoad = useSearchParams().get('create') === '1';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showCreate, setShowCreate] = useState(openCreateOnLoad);
  const [closeTarget, setCloseTarget] = useState<VacancyListItem | null>(null);
  const [freezeTarget, setFreezeTarget] = useState<VacancyListItem | null>(null);
  const [resumeTarget, setResumeTarget] = useState<VacancyListItem | null>(null);

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
  });

  const utils = trpc.useUtils();
  const invalidateAll = () => {
    utils.vacancy.list.invalidate();
    utils.vacancy.getDashboardKpis.invalidate();
  };

  // After creating, open the new vacancy: a draft's next step ("Enviar a aprobación") lives on its page.
  const createVacancy = trpc.vacancy.create.useMutation({
    onSuccess: (created) => {
      invalidateAll();
      setShowCreate(false);
      toast(created.status === 'draft' ? t.vacancies.createdDraftNextStep : t.vacancies.created, { type: 'success' });
      router.push(`/recruitment/vacancies/${created.id}`);
    },
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

  // A-08: the way back from "Congelar".
  const resumeVacancy = trpc.vacancy.resume.useMutation({
    onSuccess: () => { invalidateAll(); setResumeTarget(null); toast(t.vacancies.resumed, { type: 'success' }); },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      if (err.data?.code === 'CONFLICT') { invalidateAll(); setResumeTarget(null); }
    },
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
  const k = kpis.data;
  const { total: totalAll, fillRatePct: fillRate } = k ? summarizeVacancyKpis(k) : { total: 0, fillRatePct: 0 };

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5 flex-shrink-0">
        {kpis.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />)
        ) : kpis.isError ? (
          <div className="col-span-2 md:col-span-3">
            <ErrorState onRetry={() => kpis.refetch()} error={kpis.error} />
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
        onClearFilters={clearFilters}
        hasFilters={!!(search || statusFilter || priorityFilter)}
        onCreateClick={() => {
          createVacancy.reset();
          setShowCreate(true);
        }}
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
        onResume={setResumeTarget}
      />

      {/* Modals */}
      {showCreate && (
        <CreateModal
          onConfirm={(data) => createVacancy.mutate(data)}
          onClose={() => {
            setShowCreate(false);
            // Drop `?create=1` so a reload does not reopen the wizard the user just closed.
            if (openCreateOnLoad) router.replace('/recruitment/vacancies');
          }}
          isPending={createVacancy.isPending}
          errorMessage={createVacancy.error?.message ?? null}
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
        <FreezeVacancyConfirm
          vacancyTitle={freezeTarget.title}
          onConfirm={() => freezeVacancy.mutate({ id: freezeTarget.id })}
          onClose={() => setFreezeTarget(null)}
          isPending={freezeVacancy.isPending}
        />
      )}
      {resumeTarget && (
        <ResumeVacancyConfirm
          vacancyTitle={resumeTarget.title}
          onConfirm={() => resumeVacancy.mutate({ id: resumeTarget.id })}
          onClose={() => setResumeTarget(null)}
          isPending={resumeVacancy.isPending}
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
function CheckCircleIcon() {
  return (
    <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" />
    </svg>
  );
}
