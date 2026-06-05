'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { getInitials, getAvatarColor } from '../../../../lib/format-utils';

const ACTION_OPTIONS = ['create', 'update', 'delete', 'access', 'login', 'user_deactivated', 'user_activated', 'user_role_changed', 'password_reset_requested', 'invoice_status_paid', 'invoice_status_void', 'payment_reminder_sent', 'dunning_reminder_sent', 'feature_flag_enabled', 'feature_flag_disabled', 'ai_agent_status_active', 'ai_agent_status_disabled', 'bulk_notification_sent'];
const ENTITY_OPTIONS = ['user', 'vacancy', 'candidate', 'organization', 'role', 'invoice', 'subscription', 'feature_flag', 'ai_agent', 'notification'];

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  create: { bg: 'bg-green-100', text: 'text-green-700' },
  update: { bg: 'bg-blue-100', text: 'text-blue-700' },
  delete: { bg: 'bg-red-100', text: 'text-red-700' },
  access: { bg: 'bg-gray-100', text: 'text-gray-600' },
  login: { bg: 'bg-purple-100', text: 'text-purple-700' },
};

function getActionColor(action: string) {
  if (action in ACTION_COLORS) return ACTION_COLORS[action];
  if (action.includes('delete') || action.includes('void') || action.includes('deactivat') || action.includes('disabled')) return { bg: 'bg-red-100', text: 'text-red-700' };
  if (action.includes('create') || action.includes('paid') || action.includes('activat') || action.includes('enabled')) return { bg: 'bg-green-100', text: 'text-green-700' };
  if (action.includes('update') || action.includes('change') || action.includes('reset')) return { bg: 'bg-blue-100', text: 'text-blue-700' };
  return { bg: 'bg-gray-100', text: 'text-gray-600' };
}

function formatTimestamp(ts: string | Date) {
  const d = new Date(ts);
  const day = d.getDate().toString().padStart(2, '0');
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${day} ${months[d.getMonth()]} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

export default function AuditPage() {
  const { t } = useI18n();
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const limit = 15;

  const { data, isLoading } = trpc.platform.getCrossOrgAuditLogs.useQuery({
    action: action || undefined,
    entity: entity || undefined,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(dateTo) : undefined,
    limit,
  }, { placeholderData: (prev) => prev });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasActiveFilters = action || entity || dateFrom || dateTo;

  const exportCsv = trpc.platform.exportAuditLogsCsv.useQuery({
    action: action || undefined,
    entity: entity || undefined,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(dateTo) : undefined,
  }, { enabled: false });

  const handleExport = async () => {
    const result = await exportCsv.refetch();
    if (result.data) {
      const blob = new Blob([result.data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`${t.audit.export}: ${result.data.count}`, { type: 'success' });
    }
  };

  function clearFilters() { setAction(''); setEntity(''); setDateFrom(''); setDateTo(''); setPage(0); }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 border border-[#EDEDED] rounded-lg px-3 py-2">
            <svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className="text-sm text-[#585858] bg-transparent outline-none" />
            <span className="text-[#EDEDED]">-</span>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className="text-sm text-[#585858] bg-transparent outline-none" />
          </div>
          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }} className="border border-[#EDEDED] rounded-lg px-3 py-2 text-sm text-[#585858] bg-white">
            <option value="">{t.audit.allActions}</option>
            {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(0); }} className="border border-[#EDEDED] rounded-lg px-3 py-2 text-sm text-[#585858] bg-white">
            <option value="">{t.audit.allEntities}</option>
            {ENTITY_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <div className="flex-1" />
          <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 border border-[#EDEDED] rounded-lg text-sm text-[#585858] hover:bg-[#F6F6F6] transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            {t.audit.export}
          </button>
        </div>
        {hasActiveFilters && (
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-[#8B8B8B]">{t.audit.activeFilters}:</span>
            {action && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1F114C]/10 text-[#1F114C] rounded-full text-xs font-medium">
                {action}
                <button onClick={() => { setAction(''); setPage(0); }} className="hover:text-[#DD0C15]"><svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
              </span>
            )}
            {entity && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1F114C]/10 text-[#1F114C] rounded-full text-xs font-medium">
                {entity}
                <button onClick={() => { setEntity(''); setPage(0); }} className="hover:text-[#DD0C15]"><svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
              </span>
            )}
            {(dateFrom || dateTo) && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1F114C]/10 text-[#1F114C] rounded-full text-xs font-medium">
                {dateFrom || '...'} - {dateTo || '...'}
                <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(0); }} className="hover:text-[#DD0C15]"><svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
              </span>
            )}
            <button onClick={clearFilters} className="text-xs text-[#8B8B8B] hover:text-[#DD0C15] ml-1">{t.audit.clearAll}</button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {isLoading ? (
          <div className="p-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3 animate-pulse">
                <div className="h-3 bg-gray-200 rounded w-28" /><div className="w-6 h-6 bg-gray-200 rounded-full" /><div className="h-3 bg-gray-200 rounded w-24" /><div className="h-4 bg-gray-200 rounded-full w-14" /><div className="h-3 bg-gray-200 rounded w-16" /><div className="h-3 bg-gray-100 rounded w-40 flex-1" /><div className="h-3 bg-gray-100 rounded w-24" />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="w-12 h-12 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
            <p className="text-sm text-[#8B8B8B]">{t.audit.noLogs}</p>
            <p className="text-xs text-[#ABABAB] mt-1">{t.audit.noLogsDesc}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto"><table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-[#EDEDED]">
                  <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">{t.audit.colDateTime}</th>
                  <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">{t.audit.colActor}</th>
                  <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">{t.audit.colAction}</th>
                  <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">{t.audit.colEntity}</th>
                  <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">{t.audit.colDetail}</th>
                  <th className="text-left text-[11px] text-[#8B8B8B] uppercase tracking-wider font-medium px-5 py-3">{t.audit.colIp}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDEDED]">
                {logs.map((log) => {
                  const actorName = log.actor ? `${log.actor.firstName} ${log.actor.lastName}`.trim() || log.actor.email : (log.userId ?? t.audit.system);
                  const actionStyle = getActionColor(log.action);
                  return (
                    <tr key={log.id} className="hover:bg-[#FAFAFA]/50">
                      <td className="px-5 py-3 text-xs text-[#8B8B8B] whitespace-nowrap">{formatTimestamp(log.createdAt)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full ${getAvatarColor(actorName)} flex items-center justify-center text-[10px] font-semibold text-white`}>{getInitials(actorName)}</div>
                          <span className="text-sm text-[#585858]">{actorName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${actionStyle.bg} ${actionStyle.text}`}>{log.action}</span>
                      </td>
                      <td className="px-5 py-3 text-sm text-[#585858]">{log.entity ?? '--'}</td>
                      <td className="px-5 py-3 text-sm text-[#8B8B8B] max-w-[200px] truncate">{log.entityId ?? '--'}</td>
                      <td className="px-5 py-3 text-xs text-[#ABABAB] font-mono">{log.ipAddress ?? '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#EDEDED]">
              <span className="text-sm text-[#8B8B8B]">{t.audit.showing} {total > 0 ? page * limit + 1 : 0}-{Math.min((page + 1) * limit, total)} {t.audit.of} {total.toLocaleString()}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#8B8B8B] hover:bg-[#F6F6F6] disabled:opacity-30"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.75 19.5L8.25 12l7.5-7.5" /></svg></button>
                {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => (
                  <button key={i} onClick={() => setPage(i)} className={`w-8 h-8 rounded-lg text-sm font-medium ${page === i ? 'bg-[#1F114C] text-white' : 'border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'}`}>{i + 1}</button>
                ))}
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#8B8B8B] hover:bg-[#F6F6F6] disabled:opacity-30"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg></button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
