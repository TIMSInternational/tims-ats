'use client';

import { useId } from 'react';
import { useI18n } from '../../../lib/i18n';
import { Skeleton } from '../../../components';
import { LoadError } from './load-error';

interface CulturePulseProps {
  totalResponses: string;
  // highRiskCount + actionPlansOpen are administrative-record counts (Alert / ActionPlan rows),
  // NOT person head-counts — no min-5 suppression needed. If either is ever wired to a
  // person-population metric, add a `suppressed` flag at the API layer and render via suppressedValue.
  highRiskCount: number;
  actionPlansOpen: number;
  isLoading: boolean;
  error?: boolean;
  onRetry?: () => void;
}

export function CulturePulse({
  totalResponses,
  highRiskCount,
  actionPlansOpen,
  isLoading,
  error,
  onRetry,
}: CulturePulseProps) {
  const { t } = useI18n();
  const occ = t.orgCommandCenter;
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="w-full rounded-xl bg-white p-5 shadow-card">
      <h2 id={titleId} className="text-heading font-semibold text-brand">
        {occ.culturePulse}
      </h2>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {error ? (
          <div className="md:col-span-3">
            <LoadError message={occ.loadError} onRetry={onRetry} />
          </div>
        ) : isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
        ) : (
          <>
            <PulseTile label={occ.responseRate} value={totalResponses} />
            <PulseTile label={occ.highRisk} value={highRiskCount} />
            <PulseTile label={occ.actionPlans} value={actionPlansOpen} />
          </>
        )}
      </div>
    </section>
  );
}

function PulseTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-surface p-4">
      <div className="font-display text-title font-bold tabular-nums text-primary">{value}</div>
      <div className="mt-1 text-callout text-secondary">{label}</div>
    </div>
  );
}
