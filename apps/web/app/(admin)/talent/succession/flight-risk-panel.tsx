'use client';

import { CandidateAvatar, EmptyState, ErrorState, Skeleton, StatusBadge } from '../../../../components';
import { useI18n, pluralize } from '../../../../lib/i18n';
import { formatPercent } from '../../../../lib/format-utils';

interface FlightRiskRole {
  id: string;
  title: string;
  flightRisk: number | null;
  currentHolder?: { id: string; firstName: string; lastName: string; avatar?: string | null } | null;
  _count: { successors: number };
}

interface FlightRiskPanelProps {
  data: FlightRiskRole[] | undefined;
  loading: boolean;
  isError: boolean;
  t: {
    flightRiskAnalysis: string;
    flightRiskEmpty: string;
    flightRiskEmptyDesc: string;
    loadError: string;
  };
}

export function FlightRiskPanel({ data, loading, isError, t: ts }: FlightRiskPanelProps) {
  const { t, locale } = useI18n();
  const items = data ?? [];

  return (
    <section aria-labelledby="flight-risk" className="flex-1 rounded-xl border border-border bg-white p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="flight-risk" className="text-heading font-semibold text-brand">
          {ts.flightRiskAnalysis}
        </h2>
        {!loading && !isError && items.length > 0 && (
          <StatusBadge tone="danger">{pluralize(items.length, t.succession.inHighRiskCount, locale)}</StatusBadge>
        )}
      </div>
      {loading ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState size="compact" title={ts.loadError} />
      ) : items.length === 0 ? (
        <EmptyState size="compact" title={ts.flightRiskEmpty} description={ts.flightRiskEmptyDesc} />
      ) : (
        <ul className="space-y-2">
          {items.map((role) => {
            const holder = role.currentHolder;
            const risk = Math.round((role.flightRisk ?? 0) * 100);
            return (
              <li key={role.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                {holder ? (
                  <CandidateAvatar
                    firstName={holder.firstName}
                    lastName={holder.lastName}
                    avatar={holder.avatar}
                    size="sm"
                    decorative
                  />
                ) : (
                  <span
                    className="size-8 shrink-0 rounded-full border border-dashed border-field-border"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-primary">
                    {holder ? `${holder.firstName} ${holder.lastName}` : role.title}
                  </p>
                  <p className="text-callout text-secondary">{role.title}</p>
                </div>
                <StatusBadge tone={risk >= 80 ? 'danger' : 'warning'} className="tabular-nums">
                  {formatPercent(risk, locale)}
                </StatusBadge>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
