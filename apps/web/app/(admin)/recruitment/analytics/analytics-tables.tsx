'use client';

import { useI18n } from '../../../../lib/i18n';
import { useReportingRecruiterSla } from '../../../../lib/platform-api/reporting';
import { AnalyticsCard } from './analytics-card';

function slaColors(sla: number | null) {
  if (sla == null) return { bar: 'bg-chart-5', text: 'text-muted' };
  if (sla >= 80) return { bar: 'bg-success', text: 'text-success' };
  if (sla >= 60) return { bar: 'bg-warning', text: 'text-warning' };
  return { bar: 'bg-danger', text: 'text-danger' };
}

export function AnalyticsSlaTable() {
  const { t } = useI18n();
  const q = useReportingRecruiterSla();
  const rows = q.data;
  const th = 'py-2.5 px-3 text-callout font-semibold text-secondary';

  return (
    <AnalyticsCard
      title={t.recruitAnalytics.slaByRecruiter}
      loading={q.isLoading}
      error={q.isError || (!q.isLoading && !rows) ? (q.error ?? true) : undefined}
      onRetry={() => void q.refetch()}
    >
      {rows &&
        (rows.length === 0 ? (
          <p className="py-8 text-center text-callout text-secondary">{t.recruitAnalytics.noAssignedVacancies}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-callout">
                <thead>
                  <tr className="border-b border-border bg-surface-hover">
                    <th scope="col" className={`${th} text-left`}>{t.recruitAnalytics.recruiter}</th>
                    <th scope="col" className={`${th} text-right`}>{t.recruitAnalytics.vacancies}</th>
                    <th scope="col" className={`${th} text-right`}>{t.recruitAnalytics.avgTtf}</th>
                    <th scope="col" className={`${th} text-right`}>{t.recruitAnalytics.candidates}</th>
                    <th scope="col" className={`${th} text-left`}>{t.recruitAnalytics.slaCompliance}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const colors = slaColors(row.slaCompliancePct);
                    return (
                      <tr key={row.name} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-2.5 font-medium text-primary">{row.name}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{row.vacancies}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {row.avgTtfDays != null ? `${row.avgTtfDays} ${t.recruitAnalytics.days}` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{row.candidates}</td>
                        <td className="px-3 py-2.5">
                          {row.slaCompliancePct == null ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <div className="h-2 w-16 rounded-full bg-surface" aria-hidden="true">
                                <div className={`h-2 ${colors.bar} rounded-full`} style={{ width: `${row.slaCompliancePct}%` }} />
                              </div>
                              <span className={`${colors.text} font-medium tabular-nums`}>{row.slaCompliancePct}%</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </AnalyticsCard>
  );
}
