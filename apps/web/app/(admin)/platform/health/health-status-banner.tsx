'use client';

import { useI18n } from '../../../../lib/i18n';
import type { SystemHealthData } from '../../../../lib/trpc-types';

type HealthData = NonNullable<SystemHealthData>;

interface HealthStatusBannerProps {
  overall: HealthData['overall'];
  services: HealthData['services'];
  dataUpdatedAt: number;
  onRefresh: () => void;
}

export function HealthStatusBanner({ overall, services, dataUpdatedAt, onRefresh }: HealthStatusBannerProps) {
  const { t } = useI18n();
  const operationalCount = services.filter((service) => service.status === 'operational').length;
  const unmonitoredCount = services.filter((service) => service.status === 'unmonitored').length;
  const degradedCount = services.filter((service) => service.status === 'degraded').length;
  const downCount = services.filter((service) => service.status === 'down').length;
  const bannerStyle =
    overall === 'operational'
      ? {
          border: 'bg-green-50 border-green-200',
          icon: 'bg-green-500',
          text: 'text-green-800',
          muted: 'text-green-600',
        }
      : overall === 'down'
        ? { border: 'bg-red-50 border-red-200', icon: 'bg-red-500', text: 'text-red-800', muted: 'text-red-600' }
        : overall === 'degraded'
          ? {
              border: 'bg-amber-50 border-amber-200',
              icon: 'bg-amber-500',
              text: 'text-amber-800',
              muted: 'text-amber-600',
            }
          : {
              border: 'bg-slate-50 border-slate-200',
              icon: 'bg-slate-500',
              text: 'text-slate-800',
              muted: 'text-slate-600',
            };
  const bannerTitle =
    overall === 'operational'
      ? t.health.allOperational
      : overall === 'down'
        ? t.health.someDown
        : overall === 'degraded'
          ? t.health.someIssues
          : t.health.monitoringIncomplete;
  const timeSinceUpdate = dataUpdatedAt
    ? `${t.health.ago} ${Math.max(1, Math.floor((Date.now() - dataUpdatedAt) / 1000))} ${t.health.seconds}`
    : '';

  return (
    <div className={`${bannerStyle.border} border rounded-xl px-4 py-3 mb-3 flex items-center gap-3 shrink-0`}>
      <div className={`w-9 h-9 rounded-full ${bannerStyle.icon} flex items-center justify-center shrink-0`}>
        {overall === 'operational' ? (
          <svg
            className="w-4.5 h-4.5 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
          >
            <path d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ) : (
          <svg
            className="w-4.5 h-4.5 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
          >
            <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        )}
      </div>
      <div className="flex-1">
        <p className={`text-[13px] font-semibold ${bannerStyle.text}`}>{bannerTitle}</p>
        <p className={`text-[11px] ${bannerStyle.muted}`}>
          {operationalCount} {t.health.of} {services.length} {t.health.servicesVerified}
          {unmonitoredCount > 0 && `. ${unmonitoredCount} ${t.health.unmonitored}.`}
          {degradedCount > 0 && `. ${degradedCount} ${t.health.degraded}.`}
          {downCount > 0 && `. ${downCount} ${t.health.down}.`}
        </p>
        <p className={`text-[10px] ${bannerStyle.muted}`}>{t.health.monitoringNote}</p>
      </div>
      <div className="text-right mr-3">
        <p className={`text-[10px] ${bannerStyle.muted}`}>{t.health.uptime30d}</p>
        <p className={`text-[17px] font-bold ${bannerStyle.text}`}>N/D</p>
      </div>
      <span className="text-[10px] text-[#8B8B8B]">
        {timeSinceUpdate ? `${t.health.updated}: ${timeSinceUpdate}` : ''}
      </span>
      <button
        onClick={onRefresh}
        className="flex items-center gap-1.5 border border-[#EDEDED] text-[#585858] px-3 h-7 rounded-lg text-[11px] hover:bg-[#FAFAFA] bg-white shrink-0"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
        </svg>
        {t.health.refresh}
      </button>
    </div>
  );
}
