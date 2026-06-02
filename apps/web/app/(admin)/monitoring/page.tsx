'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { KpiCard, KpiCardSkeleton, DataTable, EmptyState, StatusBadge } from '../../../components';
import { formatRelativeTime } from '../../../lib/format-utils';

const SEVERITY_MAP: Record<string, { cls: string; label: string }> = {
  low: { cls: 'bg-blue-50 text-blue-600', label: 'Bajo' },
  medium: { cls: 'bg-amber-50 text-amber-600', label: 'Medio' },
  high: { cls: 'bg-red-50 text-red-600', label: 'Alto' },
  critical: { cls: 'bg-red-100 text-red-700', label: 'Critico' },
};

export default function MonitoringPage() {
  const { t } = useI18n();
  const kpis = trpc.monitoring.getExecutiveKpis.useQuery();
  const alerts = trpc.monitoring.getActiveAlerts.useQuery({ limit: 20 });

  const columns = [
    { key: 'module', label: 'Modulo' },
    { key: 'message', label: 'Alerta' },
    { key: 'severity', label: 'Severidad' },
    { key: 'time', label: 'Tiempo' },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.sidebar.monitoring}</h1>

      <div className="grid grid-cols-4 gap-4 mb-6 flex-shrink-0">
        {kpis.isLoading ? Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />) : kpis.data ? (
          <>
            <KpiCard label="Headcount" value={kpis.data.totalEmployees} subtitle="empleados activos" icon={<svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>} iconBg="bg-[#1F114C]/10" />
            <KpiCard label="Vacantes Abiertas" value={kpis.data.activeVacancies} subtitle="en reclutamiento" icon={<svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>} iconBg="bg-green-50" />
            <KpiCard label="Alertas Activas" value={kpis.data.openAlerts} subtitle={kpis.data.openAlerts > 0 ? t.common.requiresAttention : t.common.noIssues} valueColor={kpis.data.openAlerts > 0 ? 'text-[#DD0C15]' : undefined} icon={<svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>} iconBg="bg-red-50" highlight={kpis.data.openAlerts > 0} />
            <KpiCard label="Turnover" value={`${kpis.data.turnoverRate}%`} subtitle="ultimos 12 meses" icon={<svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5-3L16.5 18m0 0L12 13.5m4.5 4.5V4.5" /></svg>} iconBg="bg-amber-50" />
          </>
        ) : null}
      </div>

      <DataTable columns={columns} loading={alerts.isLoading} skeletonRows={5} empty={<EmptyState icon={<svg className="w-10 h-10 text-emerald-300" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} message="Sin alertas activas" description="Todos los modulos funcionando correctamente" />}>
        {(alerts.data?.items ?? []).map((alert) => (
          <tr key={alert.id} className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition">
            <td className="px-4 py-3"><span className="text-[12px] text-[#585858]">{alert.module}</span></td>
            <td className="px-4 py-3"><p className="text-[13px] text-[#333]">{alert.message}</p></td>
            <td className="px-4 py-3"><StatusBadge status={alert.severity} map={SEVERITY_MAP} /></td>
            <td className="px-4 py-3"><span className="text-[12px] text-[#8B8B8B]">{formatRelativeTime(alert.createdAt)}</span></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
