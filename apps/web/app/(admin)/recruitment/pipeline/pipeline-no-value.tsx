'use client';

import { useI18n } from '../../../../lib/i18n';

/** An empty cell: a muted dash on screen, "Sin dato" for screen readers. */
export function PipelineNoValue() {
  const { t } = useI18n();
  return (
    <span className="text-body text-muted">
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t.pipeline.noValue}</span>
    </span>
  );
}
