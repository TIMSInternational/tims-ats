'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatDate, formatRelativeTime } from '../../../../lib/format-utils';
import { KpiCard, KpiCardSkeleton, DataTable, EmptyState, StatusBadge, CandidateAvatar } from '../../../../components';

const TYPE_LABELS: Record<string, string> = {
  phone: 'Telefonica',
  video: 'Video',
  panel: 'Panel',
  onsite: 'Presencial',
  technical: 'Tecnica',
  cultural: 'Cultural',
};

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  scheduled: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: 'Programada' },
  in_progress: { cls: 'bg-amber-50 text-amber-600 border border-amber-200', label: 'En curso' },
  completed: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'Completada' },
  cancelled: { cls: 'bg-gray-100 text-gray-600', label: 'Cancelada' },
  no_show: { cls: 'bg-red-50 text-red-600', label: 'No show' },
};

export default function InterviewsPage() {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const interviews = trpc.interview.list.useQuery({
    pageSize: 50,
    status: statusFilter || undefined,
    type: typeFilter || undefined,
  });

  const utils = trpc.useUtils();
  const cancelInterview = trpc.interview.cancel.useMutation({
    onSuccess: () => { utils.interview.list.invalidate(); toast(t.common.cancel, { type: 'success' }); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const items = interviews.data?.items ?? [];

  const columns = [
    { key: 'candidate', label: t.candidates.colName },
    { key: 'vacancy', label: t.sidebar.vacancies },
    { key: 'type', label: t.common.type },
    { key: 'date', label: t.common.date },
    { key: 'evaluators', label: 'Evaluadores' },
    { key: 'status', label: t.common.status },
    { key: 'actions', label: t.common.actions, align: 'right' as const },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
        >
          <option value="">Todos los estados</option>
          <option value="scheduled">Programadas</option>
          <option value="completed">Completadas</option>
          <option value="cancelled">Canceladas</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
        >
          <option value="">Todos los tipos</option>
          <option value="phone">Telefonica</option>
          <option value="video">Video</option>
          <option value="panel">Panel</option>
          <option value="onsite">Presencial</option>
          <option value="technical">Tecnica</option>
        </select>

        {(statusFilter || typeFilter) && (
          <button onClick={() => { setStatusFilter(''); setTypeFilter(''); }} className="h-9 px-3 rounded-lg border border-[#EDEDED] text-xs text-[#8B8B8B] hover:bg-[#F6F6F6] transition">
            {t.subscriptions.clearFilters}
          </button>
        )}
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        loading={interviews.isLoading}
        skeletonRows={8}
        empty={
          <EmptyState
            icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>}
            message="No hay entrevistas programadas"
            description="Las entrevistas aparecen cuando se programan desde el pipeline"
          />
        }
      >
        {items.map((interview) => (
          <tr key={interview.id} className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition">
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <CandidateAvatar
                  firstName={interview.candidate.firstName}
                  lastName={interview.candidate.lastName}
                  avatar={interview.candidate.avatar}
                  size="sm"
                />
                <div>
                  <Link href={`/recruitment/candidates/${interview.candidate.id}`} className="text-[13px] font-medium text-[#333] hover:underline">
                    {interview.candidate.firstName} {interview.candidate.lastName}
                  </Link>
                </div>
              </div>
            </td>
            <td className="px-4 py-3">
              <span className="text-[12px] text-[#585858]">{interview.vacancy.title}</span>
            </td>
            <td className="px-4 py-3">
              <span className="text-[11px] bg-[#F6F6F6] text-[#585858] px-2 py-0.5 rounded font-medium">
                {TYPE_LABELS[interview.type] ?? interview.type}
              </span>
            </td>
            <td className="px-4 py-3">
              <div>
                <p className="text-[12px] text-[#333]">{formatDate(interview.scheduledAt)}</p>
                <p className="text-[10px] text-[#8B8B8B]">{interview.duration} min</p>
              </div>
            </td>
            <td className="px-4 py-3">
              <div className="flex -space-x-2">
                {interview.evaluators.slice(0, 3).map((ev) => (
                  <CandidateAvatar
                    key={ev.user.id}
                    firstName={ev.user.firstName}
                    lastName={ev.user.lastName}
                    avatar={ev.user.avatar}
                    size="sm"
                  />
                ))}
                {interview.evaluators.length > 3 && (
                  <div className="w-7 h-7 rounded-full bg-[#F6F6F6] flex items-center justify-center text-[9px] text-[#8B8B8B] font-bold border-2 border-white">
                    +{interview.evaluators.length - 3}
                  </div>
                )}
              </div>
            </td>
            <td className="px-4 py-3">
              <StatusBadge status={interview.status} map={STATUS_MAP} />
            </td>
            <td className="px-4 py-3 text-right">
              <div className="flex items-center justify-end gap-1">
                {interview.status === 'scheduled' && (
                  <button
                    onClick={() => cancelInterview.mutate({ id: interview.id, cancelReason: 'Cancelled by recruiter' })}
                    disabled={cancelInterview.isPending}
                    className="h-7 px-2.5 rounded-md text-[11px] text-[#DD0C15] border border-red-200 hover:bg-red-50 transition"
                  >
                    {t.common.cancel}
                  </button>
                )}
                {interview.meetingUrl && (
                  <a
                    href={interview.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-7 px-2.5 rounded-md text-[11px] text-[#1F114C] border border-[#EDEDED] hover:bg-[#F6F6F6] transition inline-flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757" /></svg>
                    Join
                  </a>
                )}
              </div>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
