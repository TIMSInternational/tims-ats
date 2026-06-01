'use client';

import Link from 'next/link';
import { trpc } from '../../../../../../lib/trpc';
import { Skeleton } from '../../org-utils';

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  CREATE: { bg: 'bg-green-100', text: 'text-green-700' },
  UPDATE: { bg: 'bg-blue-100', text: 'text-blue-700' },
  DELETE: { bg: 'bg-red-100', text: 'text-red-700' },
  LOGIN: { bg: 'bg-purple-100', text: 'text-purple-700' },
  LOGOUT: { bg: 'bg-gray-100', text: 'text-gray-600' },
  INVITE: { bg: 'bg-amber-100', text: 'text-amber-700' },
  SUSPEND: { bg: 'bg-rose-100', text: 'text-rose-700' },
  ACTIVATE: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
};

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

const avatarColors = [
  'bg-[#1F114C]', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-teal-500', 'bg-cyan-500', 'bg-emerald-600',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function formatTimestamp(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days}d`;
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

export function ActivitySection({ organizationId }: { organizationId: string }) {
  const { data: logs, isLoading } = trpc.platform.getOrgAuditLogs.useQuery({ organizationId });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#333]">Actividad Reciente</h3>
        <Link href="/platform/audit" className="text-xs text-[#1F114C] hover:underline font-medium flex items-center gap-1">
          Ver Auditoria Completa
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
        </Link>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 animate-pulse">
              <Skeleton className="h-3 w-16" />
              <div className="w-7 h-7 bg-gray-200 rounded-full" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-40 flex-1" />
            </div>
          ))}
        </div>
      ) : !logs || logs.length === 0 ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] py-16 text-center">
          <svg className="w-10 h-10 text-[#EDEDED] mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-sm text-[#8B8B8B]">No hay actividad reciente para esta organizacion</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="divide-y divide-[#F3F3F3]">
            {logs.map((log, idx) => {
              const actorName = log.actor
                ? `${log.actor.firstName || ''} ${log.actor.lastName || ''}`.trim() || log.actor.email
                : 'Sistema';
              const actionStyle = ACTION_COLORS[log.action] ?? { bg: 'bg-gray-100', text: 'text-gray-600' };
              const avatarBg = getAvatarColor(actorName);

              return (
                <div key={log.id ?? idx} className="flex items-center gap-4 px-5 py-3 hover:bg-[#FAFAFA] transition">
                  <span className="text-xs text-[#8B8B8B] w-20 flex-shrink-0">
                    {log.createdAt ? formatTimestamp(log.createdAt) : '--'}
                  </span>
                  <div className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0`}>
                    {getInitials(actorName)}
                  </div>
                  <span className="text-sm text-[#333] min-w-[100px]">{actorName}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${actionStyle.bg} ${actionStyle.text} flex-shrink-0`}>
                    {log.action}
                  </span>
                  <span className="text-xs text-[#585858]">{log.entity ?? '--'}</span>
                  <span className="text-xs text-[#8B8B8B] truncate flex-1">{log.entityId ?? '--'}</span>
                  {log.ipAddress && (
                    <span className="text-[10px] text-[#8B8B8B] font-mono flex-shrink-0">{log.ipAddress}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
