'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';

function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ErrorLog() {
  const { t } = useI18n();
  const q = trpc.integration.getErrorLog.useQuery({});
  const items = q.data?.items ?? [];

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col max-h-[195px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.integrations.errorLog}</h3>
        <span className="text-[10px] text-[#8B8B8B]">{t.integrations.last24h}</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2">
        {q.isLoading ? (
          <div className="h-16 bg-gray-50 rounded animate-pulse" />
        ) : q.isError ? (
          <p className="text-[12px] text-[#DD0C15]">{t.integrations.errorLogErr}</p>
        ) : items.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B]">{t.integrations.errorLogEmpty}</p>
        ) : (
          items.map((e) => (
            <div key={e.id} className="border-l-2 border-[#DD0C15] pl-2.5 py-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-[#333]">{e.connector?.name} — {e.errorType}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${e.status === 'pending' ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>{e.status}</span>
              </div>
              <p className="text-[10px] text-[#8B8B8B] mt-0.5">{e.message}</p>
              <div className="flex items-center gap-3 mt-1 text-[9px] text-[#8B8B8B]">
                <span>{fmtDateTime(e.createdAt)}</span>
                <span>{t.integrations.retriesLabel}: {e.retryCount}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function SyncActivity() {
  const { t } = useI18n();
  const q = trpc.integration.getRecentSyncs.useQuery({});

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col max-h-[150px]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.integrations.syncActivity}</h3>
      <div className="flex-1 overflow-y-auto space-y-2">
        {q.isLoading ? (
          <div className="h-12 bg-gray-50 rounded animate-pulse" />
        ) : q.isError ? (
          <p className="text-[12px] text-[#DD0C15]">{t.integrations.syncActivityErr}</p>
        ) : !q.data || q.data.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B]">{t.integrations.syncActivityEmpty}</p>
        ) : (
          q.data.map((s) => {
            const isError = s.status === 'error' || s.status === 'failed';
            return (
              <div key={s.id} className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isError ? 'bg-[#DD0C15]' : 'bg-green-500'}`} />
                <span className="text-[10px] text-[#8B8B8B] w-[78px] shrink-0">{fmtDateTime(s.startedAt)}</span>
                <span className={`text-[10px] ${isError ? 'text-[#DD0C15]' : 'text-[#333]'} truncate`}>
                  <strong>{s.connector?.name}</strong> — {isError ? (s.error ?? s.status) : `${s.entitiesProcessed} ${t.integrations.entitiesProcessed}`}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function ApiKeysPanel() {
  const { t } = useI18n();
  const q = trpc.integration.listApiKeys.useQuery();

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex flex-col max-h-[120px]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.integrations.apiKeys}</h3>
      <div className="flex-1 overflow-y-auto">
        {q.isLoading ? (
          <div className="h-12 bg-gray-50 rounded animate-pulse" />
        ) : q.isError ? (
          <p className="text-[12px] text-[#DD0C15]">{t.integrations.apiKeysErr}</p>
        ) : !q.data || q.data.length === 0 ? (
          <p className="text-[12px] text-[#8B8B8B]">{t.integrations.apiKeysEmpty}</p>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
                <th className="text-left pb-1.5 font-medium">{t.integrations.colApiKey}</th>
                <th className="text-left pb-1.5 font-medium">{t.integrations.colEnv}</th>
                <th className="text-left pb-1.5 font-medium">{t.integrations.colCreated}</th>
                <th className="text-left pb-1.5 font-medium">{t.integrations.colLastUsed}</th>
              </tr>
            </thead>
            <tbody className="text-[#333]">
              {q.data.map((k, i) => (
                <tr key={k.id} className={i < q.data!.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
                  <td className="py-1.5 font-mono text-[9px]">{k.keyPrefix}…</td>
                  <td className="py-1.5"><span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[#1F114C]/5 text-[#1F114C]">{k.environment}</span></td>
                  <td className="py-1.5 text-[#8B8B8B]">{fmtDate(k.createdAt)}</td>
                  <td className="py-1.5 text-[#8B8B8B]">{fmtDateTime(k.lastUsedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
