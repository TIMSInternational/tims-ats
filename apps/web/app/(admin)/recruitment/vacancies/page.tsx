'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { pluralize, useI18n } from '../../../../lib/i18n';
import { Button, ErrorState, KpiCard, KpiCardSkeleton, PageHeader } from '../../../../components';
import { FilterBar } from './filter-bar';
import { VacancyTable } from './vacancy-table';
import { CreateModal } from './create-modal';
import { CloseModal } from './close-modal';
import { FreezeVacancyConfirm } from './freeze-vacancy-confirm';
import { ResumeVacancyConfirm } from './resume-vacancy-confirm';
import type { VacancyListItem } from '../../../../lib/trpc-types';
import { summarizeVacancyKpis } from './vacancy-kpis';

export default function VacanciesPage() {
  const { t, locale } = useI18n();
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
    priority: priorityFilter ? (priorityFilter as 'low' | 'medium' | 'high' | 'urgent') : undefined,
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
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const closeVacancy = trpc.vacancy.close.useMutation({
    onSuccess: () => {
      invalidateAll();
      setCloseTarget(null);
      toast(t.vacancies.closed, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const freezeVacancy = trpc.vacancy.freeze.useMutation({
    onSuccess: () => {
      invalidateAll();
      setFreezeTarget(null);
      toast(t.vacancies.frozen, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  // A-08: the way back from "Congelar".
  const resumeVacancy = trpc.vacancy.resume.useMutation({
    onSuccess: () => {
      invalidateAll();
      setResumeTarget(null);
      toast(t.vacancies.resumed, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      if (err.data?.code === 'CONFLICT') {
        invalidateAll();
        setResumeTarget(null);
      }
    },
  });

  const duplicateVacancy = trpc.vacancy.duplicate.useMutation({
    onSuccess: (copy) => {
      invalidateAll();
      toast(t.vacancies.duplicated, {
        type: 'success',
        action: { label: t.vacancies.openVacancy, href: `/recruitment/vacancies/${copy.id}` },
      });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setPriorityFilter('');
  };
  const hasFilters = !!(search || statusFilter || priorityFilter);
  const openCreate = () => {
    createVacancy.reset();
    setShowCreate(true);
  };
  // Stable handlers so an open dialog is not re-initialised by every list/KPI refetch.
  const closeCreate = useCallback(() => {
    setShowCreate(false);
    // Drop `?create=1` so a reload does not reopen the wizard the user just closed.
    if (openCreateOnLoad) router.replace('/recruitment/vacancies');
  }, [openCreateOnLoad, router]);
  const closeCloseModal = useCallback(() => setCloseTarget(null), []);
  const closeFreeze = useCallback(() => setFreezeTarget(null), []);
  const closeResume = useCallback(() => setResumeTarget(null), []);

  const items = vacancies.data?.items ?? [];
  const k = kpis.data;
  const { total: totalAll, fillRatePct: fillRate } = k ? summarizeVacancyKpis(k) : { total: 0, fillRatePct: 0 };

  return (
    <div className="flex min-h-full flex-col md:h-full md:overflow-hidden">
      <PageHeader
        title={t.vacancies.title}
        description={t.vacancies.listDescription}
        actions={
          <Button onClick={openCreate} icon={<PlusIcon />}>
            {t.vacancies.newVacancy}
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-5 px-4 py-5 md:overflow-hidden md:px-6 md:py-6">
        {/* KPI row: one column on phones (no orphan card), three from sm. */}
        <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-3">
          {kpis.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <KpiCardSkeleton key={i} />)
          ) : kpis.isError ? (
            <div className="sm:col-span-3">
              <ErrorState onRetry={() => kpis.refetch()} error={kpis.error} size="compact" />
            </div>
          ) : k ? (
            <>
              <KpiCard
                label={t.vacancies.kpiTotal}
                value={totalAll}
                subtitle={`${k.totalOpen} ${t.vacancies.activeVacancies}`}
                icon={<BriefcaseIcon />}
              />
              <KpiCard
                label={t.vacancies.kpiOpen}
                value={k.totalOpen}
                subtitle={`${k.totalPublished} ${t.vacancies.visibleCandidates}`}
                icon={<OpenIcon />}
              />
              <KpiCard
                label={t.vacancies.kpiFillRate}
                value={`${fillRate}%`}
                subtitle={pluralize(
                  k.totalClosed,
                  { one: t.vacancies.closedCountOne, other: t.vacancies.closedCountMany },
                  locale,
                )}
                icon={<CheckCircleIcon />}
              />
            </>
          ) : null}
        </div>

        <FilterBar
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          priorityFilter={priorityFilter}
          onPriorityChange={setPriorityFilter}
          onClearFilters={clearFilters}
          hasFilters={hasFilters}
        />

        <VacancyTable
          vacancies={items}
          isLoading={vacancies.isLoading}
          isError={vacancies.isError}
          error={vacancies.error}
          onRetry={() => vacancies.refetch()}
          hasFilters={hasFilters}
          onClearFilters={clearFilters}
          onCreate={openCreate}
          duplicatingId={duplicateVacancy.isPending ? (duplicateVacancy.variables?.id ?? null) : null}
          onDuplicate={(id) => duplicateVacancy.mutate({ id })}
          onClose={setCloseTarget}
          onFreeze={setFreezeTarget}
          onResume={setResumeTarget}
        />
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateModal
          onConfirm={(data) => createVacancy.mutate(data)}
          onClose={closeCreate}
          isPending={createVacancy.isPending}
          errorMessage={createVacancy.error?.message ?? null}
        />
      )}
      {closeTarget && (
        <CloseModal
          vacancyTitle={closeTarget.title}
          onConfirm={(reason) => closeVacancy.mutate({ id: closeTarget.id, reason })}
          onClose={closeCloseModal}
          isPending={closeVacancy.isPending}
        />
      )}
      {freezeTarget && (
        <FreezeVacancyConfirm
          vacancyTitle={freezeTarget.title}
          onConfirm={() => freezeVacancy.mutate({ id: freezeTarget.id })}
          onClose={closeFreeze}
          isPending={freezeVacancy.isPending}
        />
      )}
      {resumeTarget && (
        <ResumeVacancyConfirm
          vacancyTitle={resumeTarget.title}
          onConfirm={() => resumeVacancy.mutate({ id: resumeTarget.id })}
          onClose={closeResume}
          isPending={resumeVacancy.isPending}
        />
      )}
    </div>
  );
}

/* ---------- Inline icons (decorative) ---------- */

function PlusIcon() {
  return (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function BriefcaseIcon() {
  return (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a4 4 0 00-8 0v2" />
    </svg>
  );
}
function OpenIcon() {
  return (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function CheckCircleIcon() {
  return (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <path d="M22 4L12 14.01l-3-3" />
    </svg>
  );
}
