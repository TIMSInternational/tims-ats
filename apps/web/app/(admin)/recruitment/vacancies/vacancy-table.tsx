'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { formatDate, formatCurrency } from '../../../../lib/format-utils';
import { DataTable, StatusBadge, EmptyState } from '../../../../components';
import type { VacancyListItem } from '../../../../lib/trpc-types';

interface VacancyTableProps {
  vacancies: VacancyListItem[];
  isLoading: boolean;
  onDuplicate: (id: string) => void;
  onClose: (vacancy: VacancyListItem) => void;
  onFreeze: (vacancy: VacancyListItem) => void;
}

const PRIORITY_DOTS: Record<string, string> = {
  low: 'bg-gray-400',
  medium: 'bg-blue-500',
  high: 'bg-amber-500',
  urgent: 'bg-[#DD0C15]',
};

function formatSalaryRange(salary: unknown, t: { naSalary: string }): string {
  if (!salary || typeof salary !== 'object') return t.naSalary;
  const s = salary as { min?: number; max?: number; currency?: string; period?: string };
  if (!s.min && !s.max) return t.naSalary;
  const cur = s.currency || 'USD';
  const min = s.min ? formatCurrency(s.min, cur) : '';
  const max = s.max ? formatCurrency(s.max, cur) : '';
  if (min && max) return `${min} - ${max}`;
  return min || max;
}

export function VacancyTable({
  vacancies,
  isLoading,
  onDuplicate,
  onClose,
  onFreeze,
}: VacancyTableProps) {
  const { t } = useI18n();

  const statusMap: Record<string, { cls: string; label: string }> = {
    draft: { cls: 'bg-gray-100 text-gray-600', label: t.vacancies.statusDraft },
    pending_approval: {
      cls: 'bg-amber-50 text-amber-600 border border-amber-200',
      label: t.vacancies.statusPendingApproval,
    },
    approved: {
      cls: 'bg-blue-50 text-blue-600 border border-blue-200',
      label: t.vacancies.statusApproved,
    },
    published: {
      cls: 'bg-green-50 text-green-600 border border-green-200',
      label: t.vacancies.statusPublished,
    },
    closed: { cls: 'bg-red-50 text-red-600', label: t.vacancies.statusClosed },
    frozen: {
      cls: 'bg-purple-50 text-purple-600 border border-purple-200',
      label: t.vacancies.statusFrozen,
    },
  };

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
    { key: 'actions', label: t.vacancies.colActions, align: 'right' as const },
  ];

  return (
    <DataTable
      columns={columns}
      loading={isLoading}
      skeletonRows={8}
      empty={
        <EmptyState
          icon={
            <svg
              className="w-10 h-10 text-[#ccc]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
            >
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a4 4 0 00-8 0v2" />
            </svg>
          }
          message={t.vacancies.noVacancies}
          description={t.vacancies.noVacanciesDesc}
        />
      }
    >
      {vacancies.map((v) => (
        <tr
          key={v.id}
          className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition"
        >
          {/* Title + Company */}
          <td className="px-4 py-3">
            <Link href={`/recruitment/vacancies/${v.id}`} className="hover:underline">
              <p className="text-[13px] font-medium text-[#333]">{v.title}</p>
              {v.company && (
                <p className="text-[11px] text-[#8B8B8B]">{v.company.name}</p>
              )}
            </Link>
          </td>

          {/* Status */}
          <td className="px-4 py-3">
            <StatusBadge status={v.status} map={statusMap} />
          </td>

          {/* Priority */}
          <td className="px-4 py-3">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${PRIORITY_DOTS[v.priority] ?? 'bg-gray-400'}`}
              />
              <span className="text-[12px] text-[#585858]">
                {priorityLabels[v.priority] ?? v.priority}
              </span>
            </div>
          </td>

          {/* Positions */}
          <td className="px-4 py-3 text-center">
            <span className="text-[13px] text-[#333]">{v.positions}</span>
          </td>

          {/* Location */}
          <td className="px-4 py-3">
            <span className="text-[12px] text-[#585858]">
              {v.location || '\u2014'}
            </span>
            {v.remotePolicy && v.remotePolicy !== 'onsite' && (
              <span className="ml-1 text-[10px] text-[#8B8B8B] bg-[#F6F6F6] px-1.5 py-0.5 rounded">
                {v.remotePolicy === 'remote'
                  ? t.vacancies.remote
                  : t.vacancies.hybrid}
              </span>
            )}
          </td>

          {/* Salary */}
          <td className="px-4 py-3">
            <span className="text-[12px] text-[#585858]">
              {formatSalaryRange(v.salary, t.vacancies)}
            </span>
          </td>

          {/* Applications */}
          <td className="px-4 py-3 text-center">
            <span className="text-[13px] font-medium text-[#1F114C]">
              {v._count.applications}
            </span>
          </td>

          {/* Created */}
          <td className="px-4 py-3">
            <span className="text-[12px] text-[#8B8B8B]">
              {formatDate(v.createdAt)}
            </span>
          </td>

          {/* Actions */}
          <td className="px-4 py-3 text-right">
            <ActionButtons
              vacancy={v}
              t={t}
              onDuplicate={onDuplicate}
              onClose={onClose}
              onFreeze={onFreeze}
            />
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

/* ---------- Action Buttons (extracted to keep table under 300 lines) ---------- */

function ActionButtons({
  vacancy: v,
  t,
  onDuplicate,
  onClose,
  onFreeze,
}: {
  vacancy: VacancyListItem;
  t: ReturnType<typeof useI18n>['t'];
  onDuplicate: (id: string) => void;
  onClose: (v: VacancyListItem) => void;
  onFreeze: (v: VacancyListItem) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/recruitment/vacancies/${v.id}`}
        className="h-7 px-2.5 rounded-md text-[11px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition flex items-center"
      >
        {t.vacancies.viewDetails}
      </Link>
      <button
        onClick={() => onDuplicate(v.id)}
        className="h-7 px-2.5 rounded-md text-[11px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition"
        title={t.vacancies.duplicateVacancy}
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
        >
          <rect x="8" y="8" width="12" height="12" rx="2" />
          <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
        </svg>
      </button>
      {v.status !== 'closed' && v.status !== 'frozen' && (
        <button
          onClick={() => onClose(v)}
          className="h-7 px-2.5 rounded-md text-[11px] text-[#DD0C15] border border-red-200 hover:bg-red-50 transition"
          title={t.vacancies.closeVacancy}
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      {v.status === 'published' && (
        <button
          onClick={() => onFreeze(v)}
          className="h-7 px-2.5 rounded-md text-[11px] text-purple-600 border border-purple-200 hover:bg-purple-50 transition"
          title={t.vacancies.freezeVacancy}
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
          >
            <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07" />
          </svg>
        </button>
      )}
    </div>
  );
}
