'use client';

import { useI18n } from '../../../../lib/i18n';
import { EmptyState } from '../../../../components';

/**
 * Honest unavailable state: no latency telemetry source is queried yet (no metrics store / OTel pipeline).
 * Wire to real metrics when a telemetry backend exists; never draw a placeholder line that looks like data.
 */
export function LatencyCard() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="latency-title" className="flex flex-col rounded-xl bg-white p-5 shadow-card">
      <h2 id="latency-title" className="text-heading font-semibold text-brand">
        {t.health.apiResponseTime}
      </h2>
      <div className="flex flex-1 items-center justify-center">
        <EmptyState size="compact" title={t.health.latencyUnavailable} description={t.health.latencyUnavailableHint} />
      </div>
    </section>
  );
}
