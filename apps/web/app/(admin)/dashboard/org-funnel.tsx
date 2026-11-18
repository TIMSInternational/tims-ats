'use client';

import { useId } from 'react';
import { useI18n } from '../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../components';
import { PLACEHOLDER } from '../../../lib/dashboard/suppress';
import { LoadError } from './load-error';
import { formatMessage } from '../../../lib/i18n/format';

const FUNNEL_STAGE_COLORS = [
  'bg-[#E8E5F0] text-brand',
  'bg-[#D4CFE5] text-brand',
  'bg-[#B8AED4] text-brand',
  'bg-[#9B8DC4] text-brand',
  'bg-[#7B6BAA] text-white',
  'bg-[#5C4B99] text-white',
  'bg-brand text-white',
];

interface OrgFunnelProps {
  stages: { name: string; count: number; pctOfMax: number }[] | undefined;
  conversionPct: number | null;
  totalHired: number;
  isLoading: boolean;
  error?: boolean;
  onRetry?: () => void;
}

export function OrgFunnel({ stages, conversionPct, totalHired, isLoading, error, onRetry }: OrgFunnelProps) {
  const { t } = useI18n();
  const occ = t.orgCommandCenter;

  const showHeaderStats = !isLoading && !error && !!stages;
  const titleId = useId();
  const conversion = conversionPct === null ? PLACEHOLDER : `${conversionPct}%`;

  return (
    <section aria-labelledby={titleId} className="w-full rounded-xl bg-white p-5 shadow-card md:flex-[65]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="text-heading font-semibold text-brand">
          {occ.recruitingFunnel}
        </h2>
        {showHeaderStats && (
          <span className="text-callout tabular-nums text-secondary">
            {formatMessage(occ.conversionLabel, { pct: conversion })} ·{' '}
            {formatMessage(occ.hiredLabel, { count: totalHired })}
          </span>
        )}
      </div>

      {error ? (
        <LoadError message={occ.loadError} onRetry={onRetry} />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !stages?.length ? (
        <EmptyState size="compact" message={occ.noData} />
      ) : (
        <ol className="space-y-2">
          {/* The stage name leads each row, next to its bar, so a short bar is never far from its label. */}
          {stages.map((item, idx) => (
            <li key={item.name} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-callout text-secondary sm:w-44">{item.name}</span>
              <div className="min-w-0 flex-1">
                <div
                  className={`flex h-6 min-w-6 items-center justify-center rounded-sm ${FUNNEL_STAGE_COLORS[idx % FUNNEL_STAGE_COLORS.length]}`}
                  style={{ width: `${Math.max(item.pctOfMax, 3)}%` }}
                >
                  <span className="text-caption font-semibold tabular-nums">{item.count}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
