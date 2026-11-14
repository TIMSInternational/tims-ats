'use client';

import { useI18n } from '../../../../lib/i18n';
import { useEngagementLowClimateAlerts } from '../../../../lib/platform-api/engagement';
import { EmptyState, ErrorState, Skeleton, StatusBadge, type StatusTone } from '../../../../components';

// Word cloud + sentiment require an NLP service that does not exist yet. They render as ONE explicit
// "coming soon" card (placed after the real alerts and plans), never fabricated data (rule #4).
// UPDATE 2026-08-05 (#56): the TS `engagement.getWordCloud` / `getSentiment` procedures these two
// panels once referred to have been DELETED. They returned HTTP 200 with an empty payload — which
// a caller cannot tell apart from a survey that genuinely has no text answers — so the honest
// unavailable state was always THIS static placeholder, not the procedure. C# still maps both
// routes with the same stub (EngagementReadEndpoints.cs:277,:297) for whenever the NLP service
// lands; nothing here calls them.
export function CommentsAnalysis() {
  const { t } = useI18n();
  return (
    <section
      aria-labelledby="climate-comments"
      className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="climate-comments" className="text-heading font-semibold text-brand">
          {t.climate.commentsAnalysis}
        </h2>
        <StatusBadge tone="neutral">{t.climate.comingSoon}</StatusBadge>
      </div>
      <p className="mt-1 text-callout text-secondary">{t.climate.commentsAnalysisBody}</p>
    </section>
  );
}

function severity(sev: string): { tone: StatusTone; level: 'high' | 'medium' | 'low' | null } {
  const s = sev.toLowerCase();
  if (s === 'critical' || s === 'critico' || s === 'crítico' || s === 'high' || s === 'alto')
    return { tone: 'danger', level: 'high' };
  if (s === 'medium' || s === 'medio') return { tone: 'warning', level: 'medium' };
  if (s === 'low' || s === 'bajo') return { tone: 'neutral', level: 'low' };
  return { tone: 'warning', level: null };
}

export function LowClimateAlerts() {
  const { t } = useI18n();
  const q = useEngagementLowClimateAlerts();
  const levelLabel = { high: t.climate.severityHigh, medium: t.climate.severityMedium, low: t.climate.severityLow };

  return (
    <section
      aria-labelledby="climate-alerts"
      className="rounded-xl border border-border bg-white p-4 shadow-card md:p-5"
    >
      <h2 id="climate-alerts" className="mb-3 text-heading font-semibold text-brand">
        {t.climate.lowAlerts}
      </h2>
      {q.isLoading ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t.common.loadingContent}</span>
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ) : q.isError ? (
        <ErrorState size="compact" title={t.climate.errAlerts} error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState size="compact" title={t.climate.noAlerts} />
      ) : (
        <ul className="space-y-2">
          {q.data.map((a) => {
            const s = severity(a.severity);
            return (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-primary">{a.title}</p>
                  <p className="truncate text-callout text-secondary">{a.message}</p>
                </div>
                <StatusBadge tone={s.tone} className="shrink-0">
                  {s.level ? levelLabel[s.level] : a.severity}
                </StatusBadge>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
