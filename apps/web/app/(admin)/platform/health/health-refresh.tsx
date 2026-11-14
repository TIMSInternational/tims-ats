'use client';

import { useEffect, useState } from 'react';
import { formatMessage, useI18n } from '../../../../lib/i18n';
import { formatRelativeTimeLocale } from '../../../../lib/format-utils';
import { Button } from '../../../../components';

interface HealthRefreshProps {
  dataUpdatedAt: number;
  onRefresh: () => Promise<unknown>;
}

/**
 * "Actualizado hace 2 minutos" that keeps ticking between refetches, and a refresh button.
 * The button shows its busy state only for a refresh the user asked for, never for the 30 s background poll.
 */
export function HealthRefresh({ dataUpdatedAt, onRefresh }: HealthRefreshProps) {
  const { t, locale } = useI18n();
  const [, setTick] = useState(0);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const handleRefresh = () => {
    if (isManualRefreshing) return;
    setIsManualRefreshing(true);
    void onRefresh().finally(() => setIsManualRefreshing(false));
  };

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <>
      {dataUpdatedAt > 0 && (
        <span className="text-callout text-secondary">
          {formatMessage(t.health.updatedAgo, { time: formatRelativeTimeLocale(new Date(dataUpdatedAt), locale) })}
        </span>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={handleRefresh}
        loading={isManualRefreshing}
        loadingLabel={t.health.refreshing}
      >
        {t.health.refresh}
      </Button>
    </>
  );
}
