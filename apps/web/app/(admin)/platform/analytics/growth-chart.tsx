'use client';

import { formatMessage, useI18n } from '../../../../lib/i18n';
import { formatNumber } from '../../../../lib/format-utils';

interface GrowthChartProps {
  growth: { month: string; orgs: number; users: number }[];
  totalOrgs: number;
  totalUsers: number;
}

// Bar heights in 5% steps of the 160px plot, as literal classes (no inline styles).
const HEIGHTS = [
  'h-0', 'h-[5%]', 'h-[10%]', 'h-[15%]', 'h-[20%]', 'h-[25%]', 'h-[30%]', 'h-[35%]', 'h-[40%]', 'h-[45%]',
  'h-[50%]', 'h-[55%]', 'h-[60%]', 'h-[65%]', 'h-[70%]', 'h-[75%]', 'h-[80%]', 'h-[85%]', 'h-[90%]',
  'h-[95%]', 'h-full',
] as const;

/**
 * Monthly new organizations and users. The bars are drawn for sight only (aria-hidden); the same numbers are
 * in an sr-only table and the latest month is written out as the headline (charting-data.md › Best practices).
 */
export function GrowthChart({ growth, totalOrgs, totalUsers }: GrowthChartProps) {
  const { t, locale } = useI18n();
  const an = t.analytics;
  const latest = growth[growth.length - 1];
  const maxVal = Math.max(...growth.map((g) => Math.max(g.orgs, g.users)), 1);
  // Zero draws no bar at all (charts.md › Axes: a zero baseline keeps heights honest); any value shows at least one step.
  const barHeight = (value: number) => (value === 0 ? HEIGHTS[0] : HEIGHTS[Math.max(1, Math.round((value / maxVal) * 20))]);

  return (
    <figure aria-labelledby="growth-chart-title" className="rounded-xl bg-white p-5 shadow-card">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id="growth-chart-title" className="text-heading font-semibold text-brand">
          {an.growth}
        </h2>
        <div aria-hidden="true" className="flex items-center gap-4 text-callout text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-chart-1" />
            {an.organizations}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-chart-3" />
            {an.users}
          </span>
        </div>
      </div>
      {latest ? (
        <>
          <p className="mb-4 text-callout text-secondary">
            {formatMessage(an.growthHeadline, { orgs: latest.orgs, users: latest.users, month: latest.month })}
          </p>
          <div aria-hidden="true" className="flex items-end gap-3 border-b border-border px-2">
            {growth.map((g) => (
              <div key={g.month} className="flex h-40 flex-1 items-end gap-1">
                <div className={`flex-1 rounded-t-md bg-chart-1 ${barHeight(g.orgs)}`} />
                <div className={`flex-1 rounded-t-md bg-chart-3 ${barHeight(g.users)}`} />
              </div>
            ))}
          </div>
          <div aria-hidden="true" className="mt-1 flex gap-3 px-2">
            {growth.map((g) => (
              <span key={g.month} className="flex-1 text-center text-caption text-muted">
                {g.month}
              </span>
            ))}
          </div>
          <table className="sr-only">
            <caption>{an.growth}</caption>
            <thead>
              <tr>
                <th scope="col">{an.month}</th>
                <th scope="col">{an.organizations}</th>
                <th scope="col">{an.users}</th>
              </tr>
            </thead>
            <tbody>
              {growth.map((g) => (
                <tr key={g.month}>
                  <th scope="row">{g.month}</th>
                  <td>{g.orgs}</td>
                  <td>{g.users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="py-8 text-center text-body text-secondary">{an.noData}</p>
      )}
      <dl className="mt-4 flex gap-6 text-callout text-secondary">
        <div className="flex gap-1">
          <dt>{an.organizations}:</dt>
          <dd className="font-semibold tabular-nums text-primary">{formatNumber(totalOrgs, locale)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>{an.users}:</dt>
          <dd className="font-semibold tabular-nums text-primary">{formatNumber(totalUsers, locale)}</dd>
        </div>
      </dl>
    </figure>
  );
}
