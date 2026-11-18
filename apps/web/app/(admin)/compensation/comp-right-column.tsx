'use client';

import { useState } from 'react';
import {
  useCompensationCompaRatioDistribution,
  useCompensationBenefitsUtilization,
  useCompensationListPendingAdjustments,
} from '../../../lib/platform-api/compensation';
import { useI18n, formatMessage } from '../../../lib/i18n';
import { Button, CountBadge, ProgressBar, Skeleton } from '../../../components';
import { CompCard } from './comp-card';
import { CompCardError } from './comp-card-error';
import { ApproveAdjustmentModal } from './approve-adjustment-modal';

// Compa-ratio buckets as returned by the C# GET /compensation/compa-ratio-distribution read
// (via useCompensationCompaRatioDistribution), with display meta.
// Bar fills are decoration (the count sits beside each bar); counts are dark text, never a status colour.
const CR_BUCKETS = [
  { key: '<0.80', label: '< 0.80', color: 'bg-danger', tag: 'crUnderpaid' as const },
  { key: '0.80-0.90', label: '0.80 - 0.90', color: 'bg-warning', tag: 'crBelow' as const },
  { key: '0.90-1.00', label: '0.90 - 1.00', color: 'bg-success', tag: 'crOnTarget' as const },
  { key: '1.00-1.10', label: '1.00 - 1.10', color: 'bg-success', tag: 'crOnTarget' as const },
  { key: '1.10-1.20', label: '1.10 - 1.20', color: 'bg-info', tag: 'crAbove' as const },
  { key: '>1.20', label: '> 1.20', color: 'bg-warning', tag: 'crOver' as const },
];

export function CompaRatioDistribution() {
  const { t } = useI18n();
  const q = useCompensationCompaRatioDistribution();
  const total = q.data?.totalEmployees ?? 0;

  return (
    <CompCard title={t.compensation.compaRatioDist}>
      {q.isLoading ? (
        <Skeleton className="h-32" />
      ) : q.isError ? (
        <CompCardError message={t.compensation.compaRatioErr} error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <ul className="space-y-2.5">
          {CR_BUCKETS.map((b) => {
            // Slice 6: each bucket is now a min-5 SuppressedCount. A 1..4-person
            // bucket arrives as { suppressed: true, count: null }, AND (round 2,
            // all-or-nothing differencing guard) when ANY bucket is sub-floor EVERY
            // bucket's count is nulled — so mask whenever count is null, not just on
            // the bucket's own `suppressed` flag.
            const bucket = q.data?.distribution[b.key];
            const count = bucket?.count ?? null;
            const masked = count === null;
            const pct = total && !masked ? Math.round((count / total) * 100) : 0;
            return (
              <li key={b.key} className="flex items-center gap-3">
                <div className="w-20 shrink-0 text-callout tabular-nums text-secondary">{b.label}</div>
                <div className="h-5 flex-1 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                  <div className={`h-full ${b.color} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex w-24 shrink-0 items-baseline gap-1">
                  <span className="text-callout font-semibold tabular-nums text-primary">{masked ? '–' : count}</span>
                  <span className="text-caption text-secondary">{t.compensation[b.tag]}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CompCard>
  );
}

export function BenefitsUtilization() {
  const { t } = useI18n();
  const q = useCompensationBenefitsUtilization();

  return (
    <CompCard title={t.compensation.benefitsUtil}>
      {q.isLoading ? (
        <Skeleton className="h-28" />
      ) : q.isError ? (
        <CompCardError message={t.compensation.benefitsErr} error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-callout text-secondary">{t.compensation.benefitsEmpty}</p>
      ) : (
        <ul className="space-y-2.5">
          {q.data.map((b) => (
            <li key={b.id}>
              <ProgressBar value={Math.min(b.utilization, 100)} label={b.name} valueText={`${b.utilization}%`} />
            </li>
          ))}
        </ul>
      )}
    </CompCard>
  );
}

const ADJ_LABEL: Record<string, 'adjMerit' | 'adjPromotion' | 'adjMarket' | 'adjEquity' | 'adjOther'> = {
  merit: 'adjMerit', promotion: 'adjPromotion', market: 'adjMarket', equity: 'adjEquity', other: 'adjOther',
};

export function PendingAdjustments() {
  const { t } = useI18n();
  const q = useCompensationListPendingAdjustments();
  const [target, setTarget] = useState<{ id: string; name: string; mode: 'approve' | 'reject' } | null>(null);

  return (
    <CompCard
      title={t.compensation.pendingTitle}
      aside={q.data && q.data.length > 0 ? <CountBadge count={q.data.length} tone="neutral" /> : undefined}
    >
      {q.isLoading ? (
        <Skeleton className="h-28" />
      ) : q.isError ? (
        <CompCardError message={t.compensation.pendingErr} error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-callout text-secondary">{t.compensation.pendingEmpty}</p>
      ) : (
        <table className="w-full text-callout">
          <thead>
            <tr className="border-b border-border text-secondary">
              <th scope="col" className="pb-2 text-left font-medium">{t.compensation.colEmployee}</th>
              <th scope="col" className="pb-2 text-left font-medium">{t.compensation.colType}</th>
              <th scope="col" className="pb-2 text-right font-medium">{t.compensation.colChange}</th>
              <th scope="col" className="pb-2 text-right font-medium">
                <span className="sr-only">{t.common.actions}</span>
              </th>
            </tr>
          </thead>
          <tbody className="text-primary">
            {q.data.map((a, i) => {
              // §21 field-auth (slice 6): previousSalary/newSalary/type are present only
              // for callers entitled to those salaryAdjustment fields (super/hr; type also
              // hrbp). For a leader/hrbp without them, mask the change %. Guard each.
              const adj = a as Partial<{ previousSalary: unknown; newSalary: unknown; type: string }> & { id: string; user: { firstName: string; lastName: string } };
              const hasSalaries = adj.previousSalary != null && adj.newSalary != null;
              const prev = Number(adj.previousSalary);
              const next = Number(adj.newSalary);
              const pct = hasSalaries && prev ? Math.round(((next - prev) / prev) * 1000) / 10 : null;
              const name = `${adj.user.firstName} ${adj.user.lastName}`;
              return (
                <tr key={adj.id} className={i < q.data!.length - 1 ? 'border-b border-border/60' : ''}>
                  <td className="py-2 font-medium">{name}</td>
                  <td className="py-2 text-secondary">{adj.type ? t.compensation[ADJ_LABEL[adj.type] ?? 'adjOther'] : '–'}</td>
                  <td className="py-2 text-right tabular-nums">
                    {pct === null ? <span className="text-muted">–</span> : <span className="font-semibold text-primary">+{pct}%</span>}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setTarget({ id: adj.id, name, mode: 'approve' })}
                        aria-label={formatMessage(t.compensation.approveFor, { name })}
                      >
                        {t.compensation.approveAction}
                      </Button>
                      <Button
                        variant="destructive-secondary"
                        size="sm"
                        onClick={() => setTarget({ id: adj.id, name, mode: 'reject' })}
                        aria-label={formatMessage(t.compensation.rejectFor, { name })}
                      >
                        {t.compensation.rejectAction}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {target && (
        <ApproveAdjustmentModal
          adjustmentId={target.id}
          employeeName={target.name}
          mode={target.mode}
          onClose={() => setTarget(null)}
        />
      )}
    </CompCard>
  );
}
