'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';

function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function connectorStatus(t: ReturnType<typeof useI18n>['t'], status: string): { label: string; cls: string } {
  switch (status) {
    case 'connected': case 'active': return { label: t.integrations.statusConnected, cls: 'bg-green-50 text-green-600' };
    case 'error': return { label: t.integrations.statusError, cls: 'bg-red-50 text-[#DD0C15]' };
    case 'paused': return { label: t.integrations.statusPaused, cls: 'bg-amber-50 text-amber-600' };
    default: return { label: t.integrations.statusDisconnected, cls: 'bg-gray-50 text-[#8B8B8B]' };
  }
}

export function ActiveConnectors() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const q = trpc.integration.listConnectors.useQuery();
  const filtered = (q.data ?? []).filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col max-h-[280px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.integrations.connectors}</h3>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.integrations.searchConnector}
          className="border border-[#EDEDED] rounded-lg px-2.5 h-7 text-[11px] w-[140px] outline-none focus:border-[#1F114C]"
        />
      </div>
      <div className="flex-1 overflow-y-auto space-y-2">
        {q.isLoading ? (
          <div className="h-20 bg-gray-50 rounded animate-pulse" />
        ) : q.isError ? (
          <p className="text-[12px] text-[#DD0C15]">{t.integrations.connectorsErr}</p>
        ) : filtered.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B]">{t.integrations.connectorsEmpty}</p>
        ) : (
          filtered.map((c) => {
            const st = connectorStatus(t, c.status);
            return (
              <div key={c.id} className="border border-[#EDEDED] rounded-lg p-2.5 hover:border-[#1F114C]/20">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded bg-[#1F114C]/10 text-[#1F114C] flex items-center justify-center">
                      <span className="text-[10px] font-bold">{c.name.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div>
                      <span className="text-[12px] font-medium text-[#333]">{c.name}</span>
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-medium ${st.cls}`}>{st.label}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => toast(`${t.integrations.syncNow}: ${t.common.comingSoon}`, { type: 'info' })} className="px-2 py-1 rounded text-[9px] font-medium bg-[#1F114C] text-white">{t.integrations.syncNow}</button>
                    <button onClick={() => toast(`${t.integrations.config}: ${t.common.comingSoon}`, { type: 'info' })} className="px-2 py-1 rounded text-[9px] font-medium border border-[#EDEDED] text-[#585858]">{t.integrations.config}</button>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-[#8B8B8B]">
                  <span>{t.integrations.lastSync}: {fmtDateTime(c.lastSyncAt)}</span>
                  <span>{c.entitiesSynced} {t.integrations.entitiesSuffix}</span>
                  {c.syncFrequency && <span>{c.syncFrequency}</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function WebhooksConfig() {
  const { t } = useI18n();
  const q = trpc.integration.listWebhooks.useQuery();

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col max-h-[175px]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.integrations.webhooks}</h3>
      <div className="flex-1 overflow-y-auto">
        {q.isLoading ? (
          <div className="h-16 bg-gray-50 rounded animate-pulse" />
        ) : q.isError ? (
          <p className="text-[12px] text-[#DD0C15]">{t.integrations.webhooksErr}</p>
        ) : !q.data || q.data.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B]">{t.integrations.webhooksEmpty}</p>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
                <th className="text-left pb-2 font-medium">{t.integrations.colEndpoint}</th>
                <th className="text-left pb-2 font-medium">{t.integrations.colEvents}</th>
                <th className="text-left pb-2 font-medium">{t.integrations.colStatus}</th>
                <th className="text-left pb-2 font-medium">{t.integrations.colLastTrigger}</th>
              </tr>
            </thead>
            <tbody className="text-[#333]">
              {q.data.map((w, i) => (
                <tr key={w.id} className={i < q.data!.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
                  <td className="py-1.5 font-mono text-[9px] truncate max-w-[160px]">{w.url}</td>
                  <td className="py-1.5">{Array.isArray(w.events) ? (w.events as string[]).join(', ') : ''}</td>
                  <td className="py-1.5"><span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${w.isActive ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>{w.isActive ? t.integrations.active : t.integrations.inactive}</span></td>
                  <td className="py-1.5 text-[#8B8B8B]">{fmtDateTime(w.lastTriggeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
