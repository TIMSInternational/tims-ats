'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatCurrency, formatNumber, formatPercent } from '../../../../lib/format-utils';

interface AiUsageCardProps {
  usage: {
    totalCalls: number;
    totalCost: number;
    haikuCalls: number;
    sonnetCalls: number;
    topAgents: { name: string; calls: number }[];
  };
}

const CIRCUMFERENCE_FACTOR = 3.14;

/** AI calls in the last 30 days, split by model. With no calls the split is not shown (it would be 0 % / 100 %). */
export function AiUsageCard({ usage }: AiUsageCardProps) {
  const { t, locale } = useI18n();
  const an = t.analytics;
  const total = usage.totalCalls;
  const haikuPct = total > 0 ? Math.round((usage.haikuCalls / total) * 100) : 0;
  const sonnetPct = total > 0 ? 100 - haikuPct : 0;
  const models = [
    { key: 'haiku', label: t.aiAgents.modelHaiku, calls: usage.haikuCalls, pct: haikuPct, dot: 'bg-chart-1' },
    { key: 'sonnet', label: t.aiAgents.modelSonnet, calls: usage.sonnetCalls, pct: sonnetPct, dot: 'bg-chart-3' },
  ];

  return (
    <figure aria-labelledby="ai-usage-title" className="rounded-xl bg-white p-5 shadow-card">
      <h2 id="ai-usage-title" className="mb-4 text-heading font-semibold text-brand">
        {an.aiUsage}
      </h2>
      <div className="flex flex-col gap-5 sm:flex-row">
        <dl className="flex-1 space-y-3">
          <div>
            <dt className="text-callout text-secondary">{an.totalCalls}</dt>
            <dd className="text-title font-semibold tabular-nums text-primary">{formatNumber(total, locale)}</dd>
          </div>
          <div>
            <dt className="text-callout text-secondary">{an.totalCost}</dt>
            <dd className="text-title font-semibold tabular-nums text-primary">
              {formatCurrency(usage.totalCost, 'USD', 2)}
            </dd>
          </div>
          {usage.topAgents.length > 0 && (
            <div className="border-t border-border pt-2">
              <dt className="mb-2 text-callout text-secondary">{an.topAgents}</dt>
              <dd>
                <ul className="space-y-1.5">
                  {usage.topAgents.slice(0, 3).map((a) => (
                    <li key={a.name} className="flex justify-between text-body">
                      <span className="text-secondary">{a.name}</span>
                      <span className="font-medium tabular-nums text-primary">{formatNumber(a.calls, locale)}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
        <div className="flex flex-col items-center justify-center">
          <svg viewBox="0 0 120 120" className="size-30 -rotate-90" aria-hidden="true">
            <circle cx="60" cy="60" r="50" fill="none" strokeWidth="12" className="stroke-surface" />
            {total > 0 && (
              <>
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  strokeWidth="12"
                  className="stroke-chart-1"
                  strokeDasharray={`${haikuPct * CIRCUMFERENCE_FACTOR} ${(100 - haikuPct) * CIRCUMFERENCE_FACTOR}`}
                />
                <circle
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  strokeWidth="12"
                  className="stroke-chart-3"
                  strokeDasharray={`${sonnetPct * CIRCUMFERENCE_FACTOR} ${(100 - sonnetPct) * CIRCUMFERENCE_FACTOR}`}
                  strokeDashoffset={`${-(haikuPct * CIRCUMFERENCE_FACTOR)}`}
                />
              </>
            )}
          </svg>
          {total > 0 ? (
            <>
              <ul aria-hidden="true" className="mt-3 flex gap-4 text-callout text-secondary">
                {models.map((m) => (
                  <li key={m.key} className="flex items-center gap-1">
                    <span className={`size-2 rounded-full ${m.dot}`} />
                    {m.label} {formatPercent(m.pct, locale)}
                  </li>
                ))}
              </ul>
              <table className="sr-only">
                <caption>{an.aiUsage}</caption>
                <thead>
                  <tr>
                    <th scope="col">{an.model}</th>
                    <th scope="col">{an.calls}</th>
                    <th scope="col">{an.share}</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m.key}>
                      <th scope="row">{m.label}</th>
                      <td>{m.calls}</td>
                      <td>{formatPercent(m.pct, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="mt-3 max-w-40 text-center text-callout text-secondary">{an.noAiCalls}</p>
          )}
        </div>
      </div>
    </figure>
  );
}
