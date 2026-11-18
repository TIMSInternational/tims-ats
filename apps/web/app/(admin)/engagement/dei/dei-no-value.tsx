'use client';

import { useI18n } from '../../../../lib/i18n';

/** A masked or missing figure: a visible dash, read aloud as "Sin datos" (never "N/D"). */
export function DeiNoValue() {
  const { t } = useI18n();
  return (
    <span className="text-muted">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t.dei.noData}</span>
    </span>
  );
}
