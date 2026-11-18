'use client';

import { useI18n } from '../../../../lib/i18n';
import { EmptyState, StatusBadge, type StatusMapEntry, type StatusTone } from '../../../../components';
import type { useAccessReview } from '../../../../lib/platform-api/access-review';

type Report = NonNullable<ReturnType<typeof useAccessReview>['data']>;
type Row = Report['rows'][number];

const TH = 'px-5 py-3 text-left text-callout font-medium text-secondary';

/** The report rows: who has access, with which roles, and which risk flags apply. */
export function AccessReportTable({ report }: { report: Report }) {
  const { t } = useI18n();
  const ar = t.accessReview;
  const statusMap: Record<string, StatusMapEntry> = {
    active: { tone: 'success', label: ar.statusActive },
    inactive: { tone: 'neutral', label: ar.statusInactive },
    deleted: { tone: 'danger', label: ar.statusDeleted },
  };
  // The two gaps the KPIs single out are danger; privilege is brand; staleness is a warning.
  const flagDefs: { key: keyof Row['flags']; tone: StatusTone; label: string }[] = [
    { key: 'deprovisionGap', tone: 'danger', label: ar.flagDeprovisionGap },
    { key: 'expiredGrant', tone: 'danger', label: ar.flagExpiredGrant },
    { key: 'privileged', tone: 'brand', label: ar.flagPrivileged },
    { key: 'stale', tone: 'warning', label: ar.flagStale },
    { key: 'neverLoggedIn', tone: 'warning', label: ar.flagNeverLoggedIn },
    { key: 'crossOrgRole', tone: 'info', label: ar.flagCrossOrg },
  ];

  if (report.rows.length === 0) {
    return (
      <div className="rounded-xl bg-white shadow-card">
        <EmptyState title={ar.noRows} />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]" aria-label={ar.reportTableLabel}>
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>{ar.colUser}</th>
              <th className={TH}>{ar.colStatus}</th>
              <th className={TH}>{ar.colRoles}</th>
              <th className={TH}>{ar.colFlags}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {report.rows.map((row) => (
              <tr key={row.userId} className="align-top hover:bg-surface-hover">
                <td className="px-5 py-3">
                  <div className="text-body font-medium text-primary">{row.name}</div>
                  <div className="text-callout text-secondary">{row.email}</div>
                </td>
                <td className="px-5 py-3">
                  <StatusBadge status={row.status} map={statusMap} />
                </td>
                <td className="px-5 py-3 text-body text-secondary">
                  {row.roles.length === 0 ? '—' : row.roles.map((r) => r.name || r.slug).join(', ')}
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {flagDefs
                      .filter((f) => row.flags[f.key])
                      .map((f) => (
                        <StatusBadge key={f.key} tone={f.tone}>
                          {f.label}
                        </StatusBadge>
                      ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
