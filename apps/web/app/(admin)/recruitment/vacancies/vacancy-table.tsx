'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { formatDate, formatCurrency } from '../../../../lib/format-utils';
import { DataTable, StatusBadge, EmptyState, ErrorState } from '../../../../components';
import type { VacancyListItem } from '../../../../lib/trpc-types';
import { vacancyStatusMap, VACANCY_PRIORITY_DOT } from './vacancy-status';
import { positionCountLabel } from './create-modal.helpers';
import { VacancyRowActions } from './vacancy-row-actions';

interface VacancyTableProps {
  vacancies: VacancyListItem[];
  isLoading: boolean;
  isError?: boolean;
  /** The failed query's error, so a permission denial reads "no access" instead of offering a retry. */
  error?: unknown;
  onRetry?: () => void;
  /** A search or filter is active: the empty state says "no matches" and offers "Borrar filtros". */
  hasFilters?: boolean;
  onClearFilters?: () => void;
  /** The empty organisation's first step (the page header keeps the primary "Nueva vacante"). */
  onCreate?: () => void;
  /** The row whose "Duplicar" is in flight. */
  duplicatingId?: string | null;
  onDuplicate: (id: string) => void;
  onClose: (vacancy: VacancyListItem) => void;
  onFreeze: (vacancy: VacancyListItem) => void;
  /** A-08: "Reanudar" on a frozen row. Optional so read-only embeddings need not wire it. */
  onResume?: (vacancy: VacancyListItem) => void;
}

function formatSalaryRange(salary: unknown, t: { naSalary: string }): string {
  if (!salary || typeof salary !== 'object') return t.naSalary;
  const s = salary as { min?: number; max?: number; currency?: string; period?: string };
  if (!s.min && !s.max) return t.naSalary;
  const cur = s.currency || 'USD';
  const min = s.min ? formatCurrency(s.min, cur) : '';
  const max = s.max ? formatCurrency(s.max, cur) : '';
  if (min && max) return `${min} – ${max}`;
  return min || max;
}

function BriefcaseIcon() {
  return (
    <svg className="size-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a4 4 0 00-8 0v2" />
    </svg>
  );
}

export function VacancyTable({
  vacancies,
  isLoading,
  isError,
  error,
  onRetry,
  hasFilters = false,
  onClearFilters,
  onCreate,
  duplicatingId = null,
  onDuplicate,
  onClose,
  onFreeze,
  onResume,
}: VacancyTableProps) {
  const { t } = useI18n();

  if (isError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-white shadow-card">
        <ErrorState onRetry={onRetry} error={error} />
      </div>
    );
  }

  const statusMap = vacancyStatusMap(t.vacancies);
  const priorityLabels: Record<string, string> = {
    low: t.vacancies.priorityLow,
    medium: t.vacancies.priorityMedium,
    high: t.vacancies.priorityHigh,
    urgent: t.vacancies.priorityUrgent,
  };

  const columns = [
    { key: 'title', label: t.vacancies.colTitle },
    { key: 'status', label: t.vacancies.colStatus },
    { key: 'priority', label: t.vacancies.colPriority },
    { key: 'positions', label: t.vacancies.colPositions, align: 'center' as const },
    { key: 'location', label: t.vacancies.colLocation },
    { key: 'salary', label: t.vacancies.colSalary },
    { key: 'applications', label: t.vacancies.colApplications, align: 'center' as const },
    { key: 'created', label: t.vacancies.colCreated },
    { key: 'actions', label: t.vacancies.colActions, align: 'right' as const, srOnly: true },
  ];

  const empty = hasFilters ? (
    <EmptyState
      icon={<BriefcaseIcon />}
      title={t.vacancies.noMatchesTitle}
      description={t.vacancies.noMatchesDesc}
      secondaryAction={onClearFilters ? { label: t.common.clearFilters, onClick: onClearFilters } : undefined}
    />
  ) : (
    <EmptyState
      icon={<BriefcaseIcon />}
      title={t.vacancies.noVacancies}
      description={t.vacancies.noVacanciesDesc}
      secondaryAction={onCreate ? { label: t.vacancies.emptyCreateAction, onClick: onCreate } : undefined}
    />
  );

  const remoteLabel = (policy: string | null | undefined) =>
    policy === 'remote' ? t.vacancies.remote : policy === 'hybrid' ? t.vacancies.hybrid : null;

  const rowActions = (v: VacancyListItem) => (
    <VacancyRowActions
      vacancy={v}
      isDuplicating={duplicatingId === v.id}
      onDuplicate={onDuplicate}
      onClose={onClose}
      onFreeze={onFreeze}
      onResume={onResume}
    />
  );

  // Phones: a stacked list (foundation §7) so the row actions and the facts are never behind a sideways scroll.
  const mobileList = vacancies.map((v) => {
    const facts = [
      v.location || null,
      positionCountLabel(v.positions, t.vacancies),
      `${t.vacancies.colApplications}: ${v._count.applications}`,
    ].filter(Boolean);
    return (
      <div key={v.id} className="flex min-h-12 items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/recruitment/vacancies/${v.id}`}
              className="min-w-0 text-body font-medium text-primary hover:text-brand pointer-coarse:min-h-11 pointer-coarse:py-2.5"
            >
              {v.title}
            </Link>
            <StatusBadge status={v.status} map={statusMap} />
          </div>
          <p className="mt-0.5 text-callout text-secondary">{facts.join(' · ')}</p>
          <p className="text-callout tabular-nums text-secondary">{formatDate(v.createdAt)}</p>
        </div>
        {rowActions(v)}
      </div>
    );
  });

  return (
    <DataTable
      columns={columns}
      loading={isLoading}
      skeletonRows={8}
      label={t.vacancies.title}
      empty={empty}
      mobileList={mobileList}
    >
      {vacancies.map((v) => (
        <tr key={v.id} className="border-b border-border transition-colors hover:bg-surface-hover">
          <td className="px-4 py-3">
            <Link href={`/recruitment/vacancies/${v.id}`} className="group block">
              <span className="block text-body font-medium text-primary group-hover:text-brand group-hover:underline">
                {v.title}
              </span>
              {v.company && <span className="block text-caption text-secondary">{v.company.name}</span>}
            </Link>
          </td>
          <td className="px-4 py-3">
            <StatusBadge status={v.status} map={statusMap} />
          </td>
          <td className="px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${VACANCY_PRIORITY_DOT[v.priority] ?? 'bg-muted'}`}
              />
              <span className="text-callout text-secondary">{priorityLabels[v.priority] ?? v.priority}</span>
            </div>
          </td>
          <td className="px-4 py-3 text-center text-body tabular-nums text-primary">{v.positions}</td>
          <td className="px-4 py-3">
            <span className="text-callout text-secondary">{v.location || '—'}</span>
            {remoteLabel(v.remotePolicy) && (
              <span className="ml-1 rounded bg-surface px-1.5 py-0.5 text-caption text-secondary">
                {remoteLabel(v.remotePolicy)}
              </span>
            )}
          </td>
          <td className="px-4 py-3 text-callout tabular-nums text-secondary">
            {formatSalaryRange(v.salary, t.vacancies)}
          </td>
          <td className="px-4 py-3 text-center text-body font-medium tabular-nums text-brand">
            {v._count.applications}
          </td>
          <td className="whitespace-nowrap px-4 py-3 text-callout tabular-nums text-secondary">
            {formatDate(v.createdAt)}
          </td>
          <td className="px-4 py-3 text-right">{rowActions(v)}</td>
        </tr>
      ))}
    </DataTable>
  );
}
