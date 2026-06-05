'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { IntegrationKpis } from './integration-kpis';
import { ActiveConnectors, WebhooksConfig } from './integration-connectors';
import { ErrorLog, SyncActivity, ApiKeysPanel } from './integration-right-column';
import { AuditTrail, SystemHealth } from './integration-bottom';

export default function IntegrationsPage() {
  const { t } = useI18n();
  const kpis = trpc.integration.getDashboardKpis.useQuery();

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.integrations.breadcrumbParent}</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.sidebar.integrations}</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => toast(`${t.integrations.exportLogs}: ${t.common.comingSoon}`, { type: 'info' })} className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            {t.integrations.exportLogs}
          </button>
          <button onClick={() => toast(`${t.integrations.newIntegration}: ${t.common.comingSoon}`, { type: 'info' })} className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4.5v15m7.5-7.5h-15" /></svg>
            {t.integrations.newIntegration}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <IntegrationKpis data={kpis.data ?? null} loading={kpis.isLoading} />

        {/* Middle 2-Column */}
        <div className="flex flex-col md:flex-row gap-4 mb-4">
          <div className="w-full md:w-[55%] flex flex-col gap-4">
            <ActiveConnectors />
            <WebhooksConfig />
          </div>
          <div className="w-full md:w-[45%] flex flex-col gap-4">
            <ErrorLog />
            <SyncActivity />
            <ApiKeysPanel />
          </div>
        </div>

        {/* Bottom Row */}
        <div className="flex flex-col md:flex-row gap-4">
          <AuditTrail />
          <SystemHealth />
        </div>
      </div>
    </div>
  );
}
