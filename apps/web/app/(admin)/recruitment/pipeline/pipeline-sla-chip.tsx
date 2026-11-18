'use client';

import { StatusBadge } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import type { FlatApp } from './pipeline-table-data';
import { PipelineNoValue } from './pipeline-no-value';

/** "Vencido" / "En plazo" for one application, or a dash when its stage has no target. */
export function PipelineSlaChip({ app }: { app: FlatApp }) {
  const { t } = useI18n();
  if (app.isOverdue) return <StatusBadge tone="danger">{t.pipeline.slaOverdueShort}</StatusBadge>;
  if (app.actionable && app.slaHours) return <StatusBadge tone="success">{t.pipeline.slaOnTime}</StatusBadge>;
  return <PipelineNoValue />;
}
