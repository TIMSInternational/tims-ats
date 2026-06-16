'use client';

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
}

export function CulturePulse({
  totalResponses,
  highRiskCount,
  actionPlansOpen,
  isLoading,
  error,
}: CulturePulseProps) {
  const { t } = useI18n();
  const occ = t.orgCommandCenter;

  return (
    <div className="w-full bg-white rounded-xl p-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <span className="text-base font-semibold text-[#1F114C]">{occ.culturePulse}</span>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        {error ? (
          <div className="md:col-span-3">
            <LoadError message={occ.loadError} />
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
    </div>
  );
}

function PulseTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-[#F6F6F6] p-4">
      <div className="text-xl font-bold text-[#1F114C]">{value}</div>
      <div className="text-xs text-[#8B8B8B] mt-1">{label}</div>
    </div>
  );
}
