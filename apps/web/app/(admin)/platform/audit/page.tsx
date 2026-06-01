'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';

const ACTION_OPTIONS = ['', 'create', 'update', 'delete', 'access', 'login'] as const;
const ENTITY_OPTIONS = ['', 'user', 'vacancy', 'candidate', 'organization', 'role'] as const;

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  create: { bg: 'bg-green-100', text: 'text-green-700' },
  update: { bg: 'bg-blue-100', text: 'text-blue-700' },
  delete: { bg: 'bg-red-100', text: 'text-red-700' },
  access: { bg: 'bg-gray-100', text: 'text-gray-600' },
  login: { bg: 'bg-purple-100', text: 'text-purple-700' },
};

const AVATAR_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-600' },
  { bg: 'bg-green-100', text: 'text-green-600' },
  { bg: 'bg-orange-100', text: 'text-orange-600' },
  { bg: 'bg-red-100', text: 'text-red-600' },
  { bg: 'bg-purple-100', text: 'text-purple-600' },
  { bg: 'bg-teal-100', text: 'text-teal-600' },
  { bg: 'bg-pink-100', text: 'text-pink-600' },
  { bg: 'bg-indigo-100', text: 'text-indigo-600' },
];

function getInitials(name?: string | null): string {
  if (!name) return '??';
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getAvatarColor(name?: string | null) {
  if (!name) return AVATAR_COLORS[0];
  const idx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);
  const limit = 12;

  const { data, isLoading } = trpc.platform.getCrossOrgAuditLogs.useQuery(
    {
      action: action || undefined,
      entity: entity || undefined,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      limit,
      cursor: page > 0 ? String(page * limit) : undefined,
    },
    { placeholderData: (prev) => prev }
  );

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const hasActiveFilters = action || entity || dateFrom || dateTo;

  function clearFilters() {
    setAction('');
    setEntity('');
    setDateFrom('');
    setDateTo('');
    setPage(0);
  }

  function formatTimestamp(ts: string | Date) {
    const d = new Date(ts);
    const day = d.getDate();
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const mon = months[d.getMonth()];
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    return `${day} ${mon} ${h}:${m}:${s}`;
  }

  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Filters Row */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
        <div className="flex items-center gap-3">
          {/* Date From */}
          <div className="flex items-center gap-2 border border-[#EDEDED] rounded-lg px-3 py-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
              className="text-sm text-gray-600 bg-transparent outline-none"
              placeholder="Desde"
            />
            <span className="text-gray-300">-</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
              className="text-sm text-gray-600 bg-transparent outline-none"
              placeholder="Hasta"
            />
          </div>

          {/* Action Filter */}
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(0); }}
            className="border border-[#EDEDED] rounded-lg px-3 py-2 text-sm text-gray-600 bg-white"
          >
            <option value="">Todas las Acciones</option>
            {ACTION_OPTIONS.filter(Boolean).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          {/* Entity Filter */}
          <select
            value={entity}
            onChange={(e) => { setEntity(e.target.value); setPage(0); }}
            className="border border-[#EDEDED] rounded-lg px-3 py-2 text-sm text-gray-600 bg-white"
          >
            <option value="">Todas las Entidades</option>
            {ENTITY_OPTIONS.filter(Boolean).map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>

          {/* Export stub */}
          <div className="flex-1" />
          <button className="flex items-center gap-2 px-4 py-2 border border-[#EDEDED] rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Exportar
          </button>
        </div>

        {/* Active Filters */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 mt-3">
            <span className="text-xs text-gray-400">Filtros activos:</span>
            {action && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1F114C]/10 text-[#1F114C] rounded-full text-xs font-medium">
                {action}
                <button onClick={() => { setAction(''); setPage(0); }} className="hover:text-[#DD0C15]">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </span>
            )}
            {entity && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1F114C]/10 text-[#1F114C] rounded-full text-xs font-medium">
                {entity}
                <button onClick={() => { setEntity(''); setPage(0); }} className="hover:text-[#DD0C15]">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </span>
            )}
            {(dateFrom || dateTo) && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#1F114C]/10 text-[#1F114C] rounded-full text-xs font-medium">
                {dateFrom || '...'} - {dateTo || '...'}
                <button onClick={() => { setDateFrom(''); setDateTo(''); setPage(0); }} className="hover:text-[#DD0C15]">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </span>
            )}
            <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-[#DD0C15] ml-1">
              Limpiar todo
            </button>
          </div>
        )}
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        {isLoading ? (
          <div className="p-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3 animate-pulse">
                <div className="h-3 bg-gray-200 rounded w-28" />
                <div className="w-6 h-6 bg-gray-200 rounded-full" />
                <div className="h-3 bg-gray-200 rounded w-24" />
                <div className="h-4 bg-gray-200 rounded-full w-14" />
                <div className="h-3 bg-gray-200 rounded w-16" />
                <div className="h-3 bg-gray-100 rounded w-40 flex-1" />
                <div className="h-3 bg-gray-100 rounded w-24" />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-sm text-gray-500">No se encontraron registros de auditoria</p>
            <p className="text-xs text-gray-400 mt-1">Ajusta los filtros para buscar eventos</p>
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#EDEDED]">
                  <th className="text-left text-[11px] text-gray-400 uppercase tracking-wider font-medium px-5 py-3">Fecha / Hora</th>
                  <th className="text-left text-[11px] text-gray-400 uppercase tracking-wider font-medium px-5 py-3">Actor</th>
                  <th className="text-left text-[11px] text-gray-400 uppercase tracking-wider font-medium px-5 py-3">Accion</th>
                  <th className="text-left text-[11px] text-gray-400 uppercase tracking-wider font-medium px-5 py-3">Entidad</th>
                  <th className="text-left text-[11px] text-gray-400 uppercase tracking-wider font-medium px-5 py-3">Detalle</th>
                  <th className="text-left text-[11px] text-gray-400 uppercase tracking-wider font-medium px-5 py-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EDEDED]">
                {logs.map((log, idx) => {
                  const actorName = log.actor ? `${log.actor.firstName} ${log.actor.lastName}`.trim() || log.actor.email : (log.userId ?? 'Sistema');
                  const avatar = getAvatarColor(actorName);
                  const actionStyle = ACTION_COLORS[log.action] ?? { bg: 'bg-gray-100', text: 'text-gray-600' };

                  return (
                    <tr key={log.id ?? idx} className="hover:bg-gray-50/50">
                      <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {log.createdAt ? formatTimestamp(log.createdAt) : '--'}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full ${avatar.bg} flex items-center justify-center text-[10px] font-semibold ${avatar.text}`}>
                            {getInitials(actorName)}
                          </div>
                          <span className="text-sm text-gray-700">{actorName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${actionStyle.bg} ${actionStyle.text}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">{log.entity ?? '--'}</td>
                      <td className="px-5 py-3 text-sm text-gray-500 max-w-[200px] truncate">{log.entityId ?? '--'}</td>
                      <td className="px-5 py-3 text-xs text-gray-400 font-mono">{log.ipAddress ?? '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#EDEDED]">
              <span className="text-sm text-gray-500">
                Mostrando {page * limit + 1}-{Math.min((page + 1) * limit, total)} de {total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                </button>

                {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i;
                  } else if (page < 3) {
                    pageNum = i;
                  } else if (page > totalPages - 4) {
                    pageNum = totalPages - 5 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }

                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium ${
                        page === pageNum
                          ? 'bg-[#1F114C] text-white'
                          : 'border border-[#EDEDED] text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {pageNum + 1}
                    </button>
                  );
                })}

                {totalPages > 5 && page < totalPages - 3 && (
                  <>
                    <span className="text-gray-400 px-1">...</span>
                    <button
                      onClick={() => setPage(totalPages - 1)}
                      className="w-8 h-8 rounded-lg border border-[#EDEDED] text-sm text-gray-600 hover:bg-gray-50"
                    >
                      {totalPages}
                    </button>
                  </>
                )}

                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-gray-400 hover:bg-gray-50 disabled:opacity-30"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
