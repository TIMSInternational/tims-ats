'use client';

import { useI18n } from '../../../../lib/i18n';
import { ErrorState, KpiCard, KpiCardSkeleton } from '../../../../components';

interface IntegrationKpisProps {
  data: { connectorCount: number; activeWebhooks: number; pendingErrors: number; recentSyncs: number } | null;
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

const GRID = 'grid grid-cols-2 md:grid-cols-4 gap-3';

export function IntegrationKpis({ data, loading, isError, onRetry }: IntegrationKpisProps) {
  const { t } = useI18n();

  if (isError) return <ErrorState size="compact" title={t.integrations.kpisErr} onRetry={onRetry} />;

  if (loading || !data) {
    return (
      <div className={GRID} aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className={GRID}>
      <KpiCard label={t.integrations.kpiConnectors} value={data.connectorCount} />
      <KpiCard label={t.integrations.kpiWebhooks} value={data.activeWebhooks} />
      <KpiCard label={t.integrations.kpiErrors} value={data.pendingErrors} tone="danger" />
      <KpiCard label={t.integrations.kpiSyncs} value={data.recentSyncs} />
    </div>
  );
}
