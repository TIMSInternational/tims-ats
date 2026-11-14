'use client';

import { useEffect, useState } from 'react';
import { formatMessage, useI18n } from '../../../../lib/i18n';
import { formatRelativeTimeLocale } from '../../../../lib/format-utils';
import { Button } from '../../../../components';

interface HealthRefreshProps {
  dataUpdatedAt: number;
  isFetching: boolean;
  onRefresh: () => void;
}

/** "Actualizado hace 2 minutos" that keeps ticking between refetches, and a refresh button with a busy state. */
export function HealthRefresh({ dataUpdatedAt, isFetching, onRefresh }: HealthRefreshProps) {
  const { t, locale } = useI18n();
  const [, setTick] = useState(0);

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
      <Button variant="secondary" size="sm" onClick={onRefresh} loading={isFetching} loadingLabel={t.health.refreshing}>
        {t.health.refresh}
      </Button>
    </>
  );
}
