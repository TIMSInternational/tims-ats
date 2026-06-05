'use client';

import { useI18n } from '../../../../lib/i18n';

interface IntegrationKpisProps {
  data: { connectorCount: number; activeWebhooks: number; pendingErrors: number; recentSyncs: number } | null;
  loading: boolean;
}

function KpiSkeleton() {
  return <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse"><div className="h-16 bg-gray-100 rounded" /></div>;
}

export function IntegrationKpis({ data, loading }: IntegrationKpisProps) {
  const { t } = useI18n();

  if (loading || !data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    );
  }

  const items = [
    { label: t.integrations.kpiConnectors, value: data.connectorCount, color: 'text-[#1F114C]' },
    { label: t.integrations.kpiWebhooks, value: data.activeWebhooks, color: 'text-[#1F114C]' },
    { label: t.integrations.kpiErrors, value: data.pendingErrors, color: data.pendingErrors > 0 ? 'text-[#DD0C15]' : 'text-[#1F114C]' },
    { label: t.integrations.kpiSyncs, value: data.recentSyncs, color: 'text-[#1F114C]' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {items.map((k) => (
        <div key={k.label} className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[11px] text-[#8B8B8B] mb-1">{k.label}</p>
          <p className={`text-[26px] font-bold ${k.color}`}>{k.value}</p>
        </div>
      ))}
    </div>
  );
}
