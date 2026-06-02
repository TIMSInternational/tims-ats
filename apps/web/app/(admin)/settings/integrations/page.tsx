'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { EmptyState, StatusBadge } from '../../../../components';

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  active: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'Activo' },
  error: { cls: 'bg-red-50 text-red-600', label: 'Error' },
  inactive: { cls: 'bg-gray-100 text-gray-600', label: 'Inactivo' },
  pending: { cls: 'bg-amber-50 text-amber-600', label: 'Pendiente' },
};

export default function IntegrationsPage() {
  const { t } = useI18n();
  const connectors = trpc.integration.listConnectors.useQuery();
  const items = connectors.data ?? [];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.sidebar.integrations}</h1>

      {connectors.isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="bg-white rounded-xl p-5 animate-pulse"><div className="h-20 bg-gray-100 rounded" /></div>)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>} message="No hay integraciones configuradas" description="Conecta HRIS, calendarios y otros servicios" />
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {items.map((conn) => (
            <div key={conn.id} className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#F6F6F6] flex items-center justify-center text-[#1F114C] text-[11px] font-bold">
                    {conn.type.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-[#333]">{conn.name}</p>
                    <p className="text-[10px] text-[#8B8B8B]">{conn.type}</p>
                  </div>
                </div>
                <StatusBadge status={conn.status} map={STATUS_MAP} />
              </div>
              {conn.lastSyncAt && (
                <p className="text-[10px] text-[#8B8B8B]">Last sync: {new Date(conn.lastSyncAt).toLocaleDateString()}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
