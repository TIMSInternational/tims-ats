'use client';

import { formatMessage, useI18n } from '../../../../lib/i18n';
import type { SystemHealthData } from '../../../../lib/trpc-types';

type HealthData = NonNullable<SystemHealthData>;

interface HealthStatusBannerProps {
  overall: HealthData['overall'];
  services: HealthData['services'];
}

// Text and tint share one status token, so every pair stays at or above 4.79:1 (no -600 on -50).
const TONES = {
  operational: 'bg-success-bg text-success border-success/30',
  down: 'bg-danger-bg text-danger border-danger/30',
  degraded: 'bg-warning-bg text-warning border-warning/30',
  unmonitored: 'bg-surface text-secondary border-border',
} as const;

/** The overall state of the platform. role="status" so a change on an automatic refresh is read out. */
export function HealthStatusBanner({ overall, services }: HealthStatusBannerProps) {
  const { t } = useI18n();
  const h = t.health;
  const count = (status: string) => services.filter((service) => service.status === status).length;
  const unmonitoredCount = count('unmonitored');
  const degradedCount = count('degraded');
  const downCount = count('down');
  const tone = TONES[overall as keyof typeof TONES] ?? TONES.unmonitored;
  const title =
    overall === 'operational'
      ? h.allOperational
      : overall === 'down'
        ? h.someDown
        : overall === 'degraded'
          ? h.someIssues
          : h.monitoringIncomplete;
  const details = [
    formatMessage(h.servicesVerifiedCount, { count: count('operational'), total: services.length }),
    unmonitoredCount > 0 ? formatMessage(h.unmonitoredCount, { count: unmonitoredCount }) : null,
    degradedCount > 0 ? formatMessage(h.degradedCount, { count: degradedCount }) : null,
    downCount > 0 ? formatMessage(h.downCount, { count: downCount }) : null,
  ].filter(Boolean);

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${tone}`}>
      <svg
        className="mt-0.5 size-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {overall === 'operational' ? (
          <path d="M4.5 12.75l6 6 9-13.5" />
        ) : (
          <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        )}
      </svg>
      <div className="min-w-0">
        <p role="status" className="text-subheading font-semibold">
          {title}
        </p>
        <p className="text-callout">{details.join(' · ')}</p>
        <p className="mt-0.5 text-callout text-secondary">{h.monitoringNote}</p>
      </div>
    </div>
  );
}
