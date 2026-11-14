'use client';

import React from 'react';
import { Skeleton } from './skeleton';
import type { StatusTone } from './status-badge';

type KpiTone = Extract<StatusTone, 'success' | 'warning' | 'danger' | 'info'>;

const TONE_VALUE: Record<KpiTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

interface KpiCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  /** Optional icon (outline svg, size-4, aria-hidden). Its tile is always brand tint. */
  icon?: React.ReactNode;
  /** @deprecated Still honoured; omit it to get the standard brand-tint tile (colour only for status: `tone`). */
  iconBg?: string;
  /** A red outline for a number that needs attention. */
  highlight?: boolean;
  /** @deprecated Use `tone`. */
  valueColor?: string;
  /** Colour the number ONLY when it is a status (overdue, at risk), and only when it is non-zero. */
  tone?: KpiTone;
  /** The figure cannot be computed: shows "—" and this reason as the caption. */
  unavailableReason?: string;
}

/** A KPI card (foundation-spec.md §8): caption label, tabular numeral, optional brand-tint icon tile. */
export function KpiCard({
  label,
  value,
  subtitle,
  icon,
  iconBg,
  highlight,
  valueColor,
  tone,
  unavailableReason,
}: KpiCardProps) {
  const unavailable = unavailableReason !== undefined;
  const isZero = value === 0 || value === '0';
  const valueClass = unavailable ? 'text-muted' : tone && !isZero ? TONE_VALUE[tone] : (valueColor ?? 'text-primary');
  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-card md:p-5 ${highlight ? 'border-danger/40' : 'border-border'}`}
    >
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
        <span className="text-caption font-medium uppercase tracking-wide text-muted">{label}</span>
        {icon && (
          <div
            className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${iconBg ?? 'bg-brand-tint text-brand'}`}
            aria-hidden="true"
          >
            {icon}
          </div>
        )}
      </div>
      <div className={`text-xl font-semibold tabular-nums md:text-2xl ${valueClass}`}>{unavailable ? '—' : value}</div>
      {(unavailable || subtitle) && (
        <div className="mt-1 text-callout text-secondary">{unavailable ? unavailableReason : subtitle}</div>
      )}
    </div>
  );
}

export function KpiCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5" aria-hidden="true">
      <Skeleton className="mb-3 h-3 w-24" />
      <Skeleton className="mb-2 h-7 w-16" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}
