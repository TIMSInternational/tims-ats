'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { MonitoringKpis } from './monitoring-kpis';
import { ModuleHealthGrid } from './monitoring-modules';
import { AlertsPanel } from './monitoring-alerts';
import { CrossModuleTrend, QuickActions } from './monitoring-bottom';

export default function MonitoringPage() {
  const { t } = useI18n();
  const kpis = trpc.monitoring.getExecutiveKpis.useQuery();

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 h-16 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">Estrategia</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.sidebar.monitoring}</span>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-8 rounded-lg text-[12px]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
            Exportar
          </button>
          <button className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            Configurar Alertas
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-5">
        <div className="flex flex-col h-full gap-4">
          <MonitoringKpis data={kpis.data ?? null} loading={kpis.isLoading} />

          {/* Row 2: Module Health + Alerts */}
          <div className="flex gap-4 flex-1 min-h-0">
            <ModuleHealthGrid />
            <AlertsPanel />
          </div>

          {/* Row 3: Trend + Quick Actions */}
          <div className="flex gap-4 shrink-0" style={{ height: '165px' }}>
            <CrossModuleTrend />
            <QuickActions />
          </div>
        </div>
      </div>
    </div>
  );
}
