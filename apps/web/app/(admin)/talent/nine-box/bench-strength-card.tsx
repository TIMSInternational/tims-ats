'use client';

import { EmptyState, ErrorState, Skeleton, StatusBadge, type StatusTone } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

interface BenchRole {
  id: string;
  title: string;
  successors?: Array<{ readiness: string }>;
}

interface BenchStrengthCardProps {
  roles: BenchRole[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Successor coverage per critical role: ready now, in development, and a worded coverage status. */
export function BenchStrengthCard({ roles, isLoading, error, onRetry }: BenchStrengthCardProps) {
  const { t } = useI18n();
  const coverage: Record<'covered' | 'risk' | 'critical', { label: string; tone: StatusTone }> = {
    covered: { label: t.nineBox.benchCovered, tone: 'success' },
    risk: { label: t.nineBox.benchRisk, tone: 'warning' },
    critical: { label: t.nineBox.benchCritical, tone: 'danger' },
  };

  return (
    <section
      aria-labelledby="nine-box-bench"
      className="flex-1 rounded-xl border border-border bg-white p-4 shadow-card"
    >
      <h2 id="nine-box-bench" className="mb-2 text-heading font-semibold text-brand">
        {t.nineBox.benchStrengthTitle}
      </h2>
      {isLoading ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t.common.loadingContent}</span>
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : error ? (
        <ErrorState size="compact" error={error} onRetry={onRetry} />
      ) : roles.length === 0 ? (
        <EmptyState size="compact" title={t.nineBox.noCriticalRoles} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border text-callout text-secondary">
                <th scope="col" className="pb-1.5 text-left font-semibold">
                  {t.succession.colRole}
                </th>
                <th scope="col" className="pb-1.5 text-right font-semibold">
                  {t.succession.readyNow}
                </th>
                <th scope="col" className="pb-1.5 text-right font-semibold">
                  {t.nineBox.inDevelopment}
                </th>
                <th scope="col" className="pb-1.5 pl-3 text-left font-semibold">
                  {t.nineBox.colGap}
                </th>
              </tr>
            </thead>
            <tbody className="text-primary">
              {roles.map((role) => {
                const ready = role.successors?.filter((s) => s.readiness === 'ready_now').length ?? 0;
                const developing = role.successors?.filter((s) => s.readiness !== 'ready_now').length ?? 0;
                const gap = ready === 0 && developing === 0 ? 'critical' : ready === 0 ? 'risk' : 'covered';
                return (
                  <tr key={role.id} className="border-b border-border-subtle">
                    <td className="py-2">{role.title}</td>
                    <td className="py-2 text-right tabular-nums">{ready}</td>
                    <td className="py-2 text-right tabular-nums">{developing}</td>
                    <td className="py-2 pl-3">
                      <StatusBadge tone={coverage[gap].tone}>{coverage[gap].label}</StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
