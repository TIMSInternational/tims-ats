'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';

const STATUS_META: Record<string, { dot: string; badge: string }> = {
  healthy: { dot: 'bg-green-400', badge: 'text-green-600 bg-green-50' },
  warning: { dot: 'bg-amber-400', badge: 'text-amber-600 bg-amber-50' },
  critical: { dot: 'bg-[#DD0C15]', badge: 'text-red-600 bg-red-50' },
};

export function ModuleHealthGrid() {
  const { t } = useI18n();
  const q = trpc.monitoring.getModuleHealth.useQuery();

  const modLabel: Record<string, string> = {
    recruitment: t.monitoring.mod_recruitment, onboarding: t.monitoring.mod_onboarding,
    people: t.monitoring.mod_people, engagement: t.monitoring.mod_engagement,
    compensation: t.monitoring.mod_compensation, dei: t.monitoring.mod_dei,
    time: t.monitoring.mod_time, performance: t.monitoring.mod_performance,
  };
  const statusLabel: Record<string, string> = {
    healthy: t.monitoring.statusHealthy, warning: t.monitoring.statusWarning, critical: t.monitoring.statusCritical,
  };

  return (
    <div className="flex-1 min-w-0">
      {q.isLoading ? (
        <div className="h-full bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse" />
      ) : q.isError ? (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 text-[12px] text-[#DD0C15]">{t.monitoring.moduleHealthErr}</div>
      ) : (
        <div className="grid grid-cols-3 gap-3 h-full">
          {(q.data ?? []).map((m) => {
            const meta = STATUS_META[m.status] ?? STATUS_META.healthy;
            return (
              <div key={m.module} className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
                    <span className="text-[13px] font-semibold text-[#333]">{modLabel[m.module] ?? m.module}</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${meta.badge}`}>{statusLabel[m.status] ?? m.status}</span>
                </div>
                <p className="text-[11px] text-[#8B8B8B]">
                  {m.activeAlerts > 0 ? `${m.activeAlerts} ${t.monitoring.activeAlertsSuffix}` : t.monitoring.noAlertsModule}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
