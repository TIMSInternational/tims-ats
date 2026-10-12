'use client';

import { useI18n } from '../../../../lib/i18n';
import type { DisplayService, DisplayStatus } from './merge-health';

const METRIC_COLORS: Record<string, string> = {
  green: 'text-green-600',
  red: 'text-[#DD0C15]',
  amber: 'text-amber-600',
};

const STATUS_STYLE: Record<DisplayStatus, { dot: string; badge: string; badgeText: string; ring?: string }> = {
  operational: { dot: 'bg-green-500', badge: 'bg-green-100', badgeText: 'text-green-700' },
  degraded: { dot: 'bg-amber-500', badge: 'bg-amber-100', badgeText: 'text-amber-700', ring: 'ring-1 ring-amber-200' },
  down: { dot: 'bg-red-500', badge: 'bg-red-100', badgeText: 'text-red-700', ring: 'ring-1 ring-red-200' },
  not_configured: { dot: 'bg-slate-300', badge: 'bg-slate-100', badgeText: 'text-slate-600' },
  not_monitored: { dot: 'bg-slate-400', badge: 'bg-slate-100', badgeText: 'text-slate-700' },
};

export function HealthServiceGrid({ services }: { services: DisplayService[] }) {
  const { t } = useI18n();
  const statusLabel: Record<DisplayStatus, string> = {
    operational: t.health.statusOperational,
    degraded: t.health.statusDegraded,
    down: t.health.statusDown,
    not_configured: t.health.statusNotConfigured,
    not_monitored: t.health.statusNotMonitored,
  };
  const names = t.health.serviceNames as Record<string, string>;
  const metricLabels = t.health.metricLabels as Record<string, string>;
  const reasons = t.health.reasons as Record<string, string>;
  const metricValues = t.health.metricValues as Record<string, string>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 shrink-0">
      {services.map((service) => {
        const style = STATUS_STYLE[service.status] ?? STATUS_STYLE.not_monitored;
        const reasonText = service.reason ? (reasons[service.reason] ?? reasons.unknown) : null;
        return (
          <div
            key={service.id}
            data-testid={`health-service-${service.id}`}
            data-status={service.status}
            className={`bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] ${style.ring || ''}`}
          >
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} />
                <span className="text-[13px] font-semibold text-[#1F114C] truncate">
                  {names[service.id] ?? service.id}
                </span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[9px] font-semibold shrink-0 ${style.badge} ${style.badgeText}`}
              >
                {statusLabel[service.status] ?? statusLabel.not_monitored}
              </span>
            </div>
            {reasonText && <p className="text-[10px] text-[#8B8B8B] mb-2">{reasonText}</p>}
            <div className="space-y-2">
              {service.metrics.map((metric) => (
                <div key={metric.id} className="flex justify-between gap-2">
                  <span className="text-[11px] text-[#8B8B8B]">{metricLabels[metric.id] ?? metric.id}</span>
                  <span
                    className={`text-[12px] font-medium ${metric.color ? METRIC_COLORS[metric.color] || 'text-[#1F114C]' : 'text-[#1F114C]'}`}
                  >
                    {metric.value === null ? t.health.notAvailable : (metricValues[metric.value] ?? metric.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
