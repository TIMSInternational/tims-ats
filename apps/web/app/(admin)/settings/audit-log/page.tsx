'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';

function downloadBlob(data: string, format: 'csv' | 'json') {
  const mime = format === 'json' ? 'application/json' : 'text/csv;charset=utf-8;';
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditLogExportPage() {
  const { t } = useI18n();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [actorId, setActorId] = useState('');

  const users = trpc.user.list.useQuery({ limit: 100 });
  const exportMutation = trpc.audit.exportLogs.useMutation();

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setAction('');
    setEntity('');
    setActorId('');
  };

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const result = await exportMutation.mutateAsync({
        format,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
        action: action || undefined,
        entity: entity || undefined,
        actorId: actorId || undefined,
      });
      downloadBlob(result.data, result.format);
      if (result.truncated) {
        toast(t.auditExport.exportTruncated.replace('{count}', String(result.count)), { type: 'info' });
      } else {
        toast(t.auditExport.exportSuccess.replace('{count}', String(result.count)), { type: 'success' });
      }
    } catch {
      toast(t.auditExport.exportError, { type: 'error' });
    }
  };

  const isExporting = exportMutation.isPending;

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.auditExport.breadcrumbParent}</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m9 18 6-6-6-6" />
          </svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.auditExport.title}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-4 max-w-3xl">
          <p className="text-[12px] text-[#8B8B8B] mb-4">{t.auditExport.description}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.auditExport.dateFrom}</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.auditExport.dateTo}</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.auditExport.actionLabel}</label>
              <input
                type="text"
                maxLength={200}
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder={t.auditExport.actionPlaceholder}
                className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.auditExport.entityLabel}</label>
              <input
                type="text"
                maxLength={200}
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                placeholder={t.auditExport.entityPlaceholder}
                className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.auditExport.actorLabel}</label>
              <select
                value={actorId}
                onChange={(e) => setActorId(e.target.value)}
                disabled={users.isLoading}
                className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40 disabled:bg-[#F6F6F6] disabled:text-[#B8B8B8]"
              >
                <option value="">{t.auditExport.allActors}</option>
                {(users.data?.users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName} ({u.email})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExport('csv')}
              disabled={isExporting}
              className="flex items-center gap-1.5 bg-[#1F114C] text-white px-4 h-9 rounded-lg text-[12px] font-medium disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {t.auditExport.exportCsv}
            </button>
            <button
              onClick={() => handleExport('json')}
              disabled={isExporting}
              className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-4 h-9 rounded-lg text-[12px] font-medium disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {t.auditExport.exportJson}
            </button>
            <button onClick={clearFilters} className="text-[12px] text-[#8B8B8B] hover:text-[#DD0C15] ml-1">
              {t.auditExport.clearFilters}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
