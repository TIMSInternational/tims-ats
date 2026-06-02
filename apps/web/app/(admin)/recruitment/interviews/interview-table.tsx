'use client';

import Link from 'next/link';
import { useI18n } from '../../../../lib/i18n';
import { formatDate } from '../../../../lib/format-utils';
import { DataTable, EmptyState, StatusBadge, CandidateAvatar } from '../../../../components';
import type { InterviewListItem } from '../../../../lib/trpc-types';

interface InterviewTableProps {
  interviews: InterviewListItem[];
  isLoading: boolean;
  onCancel: (id: string) => void;
  isCancelling: boolean;
}

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  scheduled: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: 'Programada' },
  in_progress: { cls: 'bg-amber-50 text-amber-600 border border-amber-200', label: 'En curso' },
  completed: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'Completada' },
  cancelled: { cls: 'bg-gray-100 text-gray-600', label: 'Cancelada' },
  no_show: { cls: 'bg-red-50 text-red-600 border border-red-200', label: 'No show' },
  rescheduled: { cls: 'bg-violet-50 text-violet-600 border border-violet-200', label: 'Reprogramada' },
};

const TYPE_LABELS: Record<string, string> = {
  phone: 'Telefonica',
  video: 'Video',
  panel: 'Panel',
  onsite: 'Presencial',
  technical: 'Tecnica',
  cultural: 'Cultural',
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  phone: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>,
  video: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>,
  panel: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" /></svg>,
  onsite: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21" /></svg>,
  technical: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>,
  cultural: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>,
};

export function InterviewTable({ interviews, isLoading, onCancel, isCancelling }: InterviewTableProps) {
  const { t } = useI18n();

  const columns = [
    { key: 'candidate', label: t.interviews.colCandidate },
    { key: 'vacancy', label: t.interviews.colVacancy },
    { key: 'type', label: t.interviews.colType },
    { key: 'date', label: t.interviews.colDate },
    { key: 'evaluators', label: t.interviews.colEvaluators },
    { key: 'status', label: t.interviews.colStatus },
    { key: 'actions', label: t.interviews.colActions, align: 'right' as const },
  ];

  return (
    <DataTable
      columns={columns}
      loading={isLoading}
      skeletonRows={8}
      empty={
        <EmptyState
          icon={
            <svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
          }
          message={t.interviews.noInterviews}
          description={t.interviews.noInterviewsDesc}
        />
      }
    >
      {interviews.map((iv) => (
        <tr key={iv.id} className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition">
          <td className="px-4 py-3">
            <div className="flex items-center gap-2.5">
              <CandidateAvatar
                firstName={iv.candidate.firstName}
                lastName={iv.candidate.lastName}
                avatar={iv.candidate.avatar}
                size="sm"
              />
              <div>
                <Link
                  href={`/recruitment/candidates/${iv.candidate.id}`}
                  className="text-[13px] font-medium text-[#333] hover:underline"
                >
                  {iv.candidate.firstName} {iv.candidate.lastName}
                </Link>
                <p className="text-[11px] text-[#8B8B8B]">{iv.candidate.email}</p>
              </div>
            </div>
          </td>
          <td className="px-4 py-3">
            <span className="text-[12px] text-[#585858]">{iv.vacancy.title}</span>
          </td>
          <td className="px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] bg-[#F6F6F6] text-[#585858] px-2 py-0.5 rounded font-medium">
              {TYPE_ICONS[iv.type] ?? null}
              {TYPE_LABELS[iv.type] ?? iv.type}
            </span>
          </td>
          <td className="px-4 py-3">
            <div>
              <p className="text-[12px] text-[#333]">{formatDate(iv.scheduledAt)}</p>
              <p className="text-[10px] text-[#8B8B8B]">
                {new Date(iv.scheduledAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                {' '}&middot;{' '}{iv.duration} {t.interviews.minutes}
              </p>
            </div>
          </td>
          <td className="px-4 py-3">
            <div className="flex -space-x-2">
              {iv.evaluators.slice(0, 3).map((ev) => (
                <CandidateAvatar
                  key={ev.user.id}
                  firstName={ev.user.firstName}
                  lastName={ev.user.lastName}
                  avatar={ev.user.avatar}
                  size="sm"
                />
              ))}
              {iv.evaluators.length > 3 && (
                <div className="w-7 h-7 rounded-full bg-[#F6F6F6] flex items-center justify-center text-[9px] text-[#8B8B8B] font-bold border-2 border-white">
                  +{iv.evaluators.length - 3}
                </div>
              )}
            </div>
          </td>
          <td className="px-4 py-3">
            <StatusBadge status={iv.status} map={STATUS_MAP} />
          </td>
          <td className="px-4 py-3 text-right">
            <div className="flex items-center justify-end gap-1">
              {iv.status === 'scheduled' && (
                <button
                  onClick={() => onCancel(iv.id)}
                  disabled={isCancelling}
                  className="h-7 px-2.5 rounded-md text-[11px] text-[#DD0C15] border border-red-200 hover:bg-red-50 transition"
                >
                  {t.interviews.cancelInterview}
                </button>
              )}
              {iv.meetingUrl && iv.status === 'scheduled' && (
                <a
                  href={iv.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-7 px-2.5 rounded-md text-[11px] text-white bg-[#1F114C] hover:bg-[#2a1863] transition inline-flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  {t.interviews.joinMeeting}
                </a>
              )}
            </div>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
